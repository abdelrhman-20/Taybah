import { supabase } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';
import { jsonEqual } from '../../../lib/persistence/stableJson';
import {
  getDoc,
  refreshDocs,
  getDocsState,
  type DocKind,
} from '../../storefront/catalog/catalogDocs';
import {
  HOME_SECTION_KEYS,
  getHomeContent,
  refreshHomeContent,
  updateHomeSection,
  type HomeContent,
  type HomeSectionKey,
} from '../../storefront/home/homeStore';
import {
  migratedPath,
  mediaRef,
  uploadMigratedImage,
  verifyObject,
} from '../../shared/assets/mediaStorage';
import { localImageRef } from '../../shared/assets/imageStore';
import { normalizeSku } from '../../storefront/catalog/variants';
import type { LegacySource, ParsedLegacy } from './legacyBundle';

// The migration pipeline (pure planning + the steps the admin page runs).
// Design rules:
//  • Nothing here ever deletes or clears local data, or overwrites a stored
//    database record — existing records that differ are REPORTED as conflicts.
//  • Every step is idempotent, so a half-finished run is resumed by running it
//    again.
//  • Local `local:<id>` image refs are replaced by `media:` refs only inside
//    the documents that get imported, and (for the homepage) only after the
//    image upload was verified.

export interface DocInput {
  kind: DocKind;
  id: string;
  slug: string | null;
  visible: boolean;
  sort_order: number;
  data: Record<string, unknown>;
}

export interface DocRef {
  kind: DocKind;
  id: string;
}

export interface ImportReport {
  dryRun: boolean;
  inserted: DocRef[];
  unchanged: DocRef[];
  conflicts: Array<DocRef & { reason: ConflictReason; sku?: string }>;
}

export type ConflictReason =
  | 'different_data'
  | 'slug_taken'
  | 'sku_taken'
  | 'sku_duplicate_in_product';

export const isSkuConflict = (reason: ConflictReason): boolean => reason.startsWith('sku_');

// ---- image references -------------------------------------------------------------

const LOCAL = 'local:';

export function collectLocalRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith(LOCAL)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectLocalRefs(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectLocalRefs(v, out);
  }
  return out;
}

// Replaces whole-string `local:<id>` values found in `map`; everything else
// (including unmapped local refs) is left untouched.
export function rewriteLocalRefs<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') {
    return (map.get(value) ?? value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteLocalRefs(v, map)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteLocalRefs(v, map);
    }
    return out as T;
  }
  return value;
}

// ---- planning ---------------------------------------------------------------------

export interface ImagePlanItem {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  localRef: string;
  ref: string;
}

export interface MigrationPlan {
  docs: DocInput[];
  images: ImagePlanItem[];
  // local refs the records point at that have NO image bytes in the source —
  // those images are gone from this source and cannot be migrated.
  missingImageRefs: string[];
  // local refs used by records (for the report)
  referencedLocalRefs: string[];
  counts: Record<DocKind, number>;
  // SKUs that appear more than once inside the data being migrated. The
  // database enforces global SKU uniqueness, so these cannot be imported until
  // the admin chooses new values (see skuOverrides).
  skuProblems: SkuProblem[];
}

// ---- SKU resolution ---------------------------------------------------------------
// The old rule ("a SKU is unique") only lived in the product form, so legacy
// browser data can contain duplicates. NOTHING is renamed automatically: each
// offending SKU is listed and the admin types a replacement, which is applied
// to the IMPORTED copy only — the backup ZIP keeps the original values.

// Key: the product id, or `${productId}:${variantId}` for a variant SKU.
export type SkuOverrides = Record<string, string>;

export const skuKey = (productId: string, variantId: string | null): string =>
  variantId === null ? productId : `${productId}:${variantId}`;

export interface SkuOccurrence {
  productId: string;
  productName: string;
  variantId: string | null;
  sku: string; // as written (not normalized)
}

export interface SkuProblem {
  sku: string; // normalized
  occurrences: SkuOccurrence[];
}

function occurrencesOf(docs: DocInput[]): SkuOccurrence[] {
  const out: SkuOccurrence[] = [];
  for (const d of docs) {
    if (d.kind !== 'product') continue;
    const data = d.data as { sku?: unknown; name?: { ar?: unknown }; variants?: unknown };
    const name = typeof data.name?.ar === 'string' ? data.name.ar : d.id;
    if (typeof data.sku === 'string' && normalizeSku(data.sku)) {
      out.push({ productId: d.id, productName: name, variantId: null, sku: data.sku });
    }
    if (Array.isArray(data.variants)) {
      for (const v of data.variants as Array<{ id?: unknown; sku?: unknown }>) {
        if (v && typeof v.sku === 'string' && normalizeSku(v.sku)) {
          out.push({ productId: d.id, productName: name, variantId: String(v.id ?? ''), sku: v.sku });
        }
      }
    }
  }
  return out;
}

// Same rule as the database registry: trim + lowercase, product and variant
// SKUs in one namespace, blanks ignored.
export function findSkuProblems(docs: DocInput[]): SkuProblem[] {
  const groups = new Map<string, SkuOccurrence[]>();
  for (const o of occurrencesOf(docs)) {
    const k = normalizeSku(o.sku);
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  return [...groups.entries()]
    .filter(([, occ]) => occ.length > 1)
    .map(([sku, occurrences]) => ({ sku, occurrences }));
}

export interface SkuRow extends SkuOccurrence {
  key: string;
  reason: 'duplicate_in_data' | 'taken_in_database';
}

// Which SKU values the admin must replace. For duplicates inside the data the
// FIRST occurrence keeps its value and every later one needs a new one; for a
// SKU the database already assigns to another product, the incoming
// occurrence(s) need a new one (the stored product is never changed).
export function skuRowsNeedingNewValue(
  base: MigrationPlan,
  serverConflicts: ReadonlyArray<{ id: string; reason: ConflictReason; sku?: string }>,
): SkuRow[] {
  const rows = new Map<string, SkuRow>();
  for (const p of base.skuProblems) {
    p.occurrences.slice(1).forEach((o) => {
      const key = skuKey(o.productId, o.variantId);
      rows.set(key, { ...o, key, reason: 'duplicate_in_data' });
    });
  }
  const all = occurrencesOf(base.docs);
  for (const c of serverConflicts) {
    if (c.reason !== 'sku_taken' || !c.sku) continue;
    for (const o of all) {
      if (o.productId === c.id && normalizeSku(o.sku) === c.sku) {
        const key = skuKey(o.productId, o.variantId);
        if (!rows.has(key)) rows.set(key, { ...o, key, reason: 'taken_in_database' });
      }
    }
  }
  return [...rows.values()];
}

function applySkuOverrides(
  productId: string,
  data: Record<string, unknown>,
  overrides: SkuOverrides,
): Record<string, unknown> {
  // A blank replacement means "not resolved yet" — it must never blank a SKU.
  const pick = (key: string): string | undefined => {
    const v = overrides[key];
    return v !== undefined && normalizeSku(v) !== '' ? v.trim() : undefined;
  };
  const own = pick(skuKey(productId, null));
  const variants = Array.isArray(data.variants) ? (data.variants as Array<Record<string, unknown>>) : null;
  const touchesVariant = variants?.some((v) => pick(skuKey(productId, String(v.id ?? ''))) !== undefined);
  if (own === undefined && !touchesVariant) return data;
  return {
    ...data,
    ...(own !== undefined ? { sku: own } : {}),
    ...(variants
      ? {
          variants: variants.map((v) => {
            const o = pick(skuKey(productId, String(v.id ?? '')));
            return o === undefined ? v : { ...v, sku: o };
          }),
        }
      : {}),
  };
}

export function buildPlan(
  parsed: ParsedLegacy,
  source: LegacySource,
  skuOverrides: SkuOverrides = {},
): MigrationPlan {
  const images: ImagePlanItem[] = source.bundle.images
    .filter((i) => source.blobs.has(i.id))
    .map((i) => {
      const path = migratedPath(i.id, i.type);
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        size: i.size,
        path,
        localRef: localImageRef(i.id),
        ref: mediaRef(path),
      };
    });
  const refMap = new Map(images.map((i) => [i.localRef, i.ref]));

  const docs: DocInput[] = [];
  parsed.products.forEach((p, i) =>
    docs.push({
      kind: 'product',
      id: p.id,
      slug: p.slug,
      visible: p.published,
      sort_order: i,
      data: applySkuOverrides(
        p.id,
        rewriteLocalRefs(p as unknown as Record<string, unknown>, refMap),
        skuOverrides,
      ),
    }),
  );
  for (const c of parsed.categories) {
    docs.push({
      kind: 'category',
      id: c.slug,
      slug: c.slug,
      visible: c.visible,
      sort_order: c.order,
      data: rewriteLocalRefs(c as unknown as Record<string, unknown>, refMap),
    });
  }
  for (const c of parsed.collections) {
    docs.push({
      kind: 'collection',
      id: c.slug,
      slug: c.slug,
      visible: c.visible,
      sort_order: c.order,
      data: rewriteLocalRefs(c as unknown as Record<string, unknown>, refMap),
    });
  }
  for (const a of parsed.attributes) {
    docs.push({
      kind: 'attribute',
      id: a.key,
      slug: null,
      visible: true,
      sort_order: a.order,
      data: rewriteLocalRefs(a as unknown as Record<string, unknown>, refMap),
    });
  }
  docs.push({
    kind: 'nav',
    id: 'main',
    slug: null,
    visible: true,
    sort_order: 0,
    data: { items: rewriteLocalRefs(parsed.navigation.main, refMap) },
  });
  docs.push({
    kind: 'nav',
    id: 'footer',
    slug: null,
    visible: true,
    sort_order: 1,
    data: { items: rewriteLocalRefs(parsed.navigation.footer, refMap) },
  });

  // Anything still `local:` after rewriting has no uploadable bytes.
  const remaining = new Set<string>();
  for (const d of docs) collectLocalRefs(d.data, remaining);
  const referenced = new Set<string>();
  const sourceDocs = [
    ...parsed.products,
    ...parsed.categories,
    ...parsed.collections,
    ...parsed.attributes,
    parsed.navigation,
  ];
  for (const s of sourceDocs) collectLocalRefs(s, referenced);

  const counts: Record<DocKind, number> = {
    product: parsed.products.length,
    category: parsed.categories.length,
    collection: parsed.collections.length,
    attribute: parsed.attributes.length,
    nav: 2,
  };
  return {
    docs,
    images,
    missingImageRefs: [...remaining].sort(),
    referencedLocalRefs: [...referenced].sort(),
    counts,
    skuProblems: findSkuProblems(docs),
  };
}

// ---- executing --------------------------------------------------------------------

export type UploadStatus = 'uploaded' | 'already_present' | 'failed';
export interface UploadResult {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
}

// Sequential + idempotent: re-running skips objects that already exist with
// the same size, and reports (never overwrites) a same-path/different-size
// object.
export async function uploadImages(
  items: ImagePlanItem[],
  blobs: ReadonlyMap<string, Blob>,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const [i, item] of items.entries()) {
    const blob = blobs.get(item.id);
    try {
      if (!blob) throw new PersistenceError('not_found', 'image bytes missing from source');
      const r = await uploadMigratedImage(item.id, blob);
      results.push({ id: item.id, name: item.name, status: r.result });
    } catch (e) {
      const err = classifyError(e);
      results.push({ id: item.id, name: item.name, status: 'failed', error: err.code });
    }
    onProgress?.(i + 1, items.length);
  }
  return results;
}

const CHUNK = 200;

export async function importDocs(docs: DocInput[], dryRun: boolean): Promise<ImportReport> {
  const report: ImportReport = { dryRun, inserted: [], unchanged: [], conflicts: [] };
  for (let i = 0; i < docs.length; i += CHUNK) {
    const { data, error } = await withTimeout(
      supabase.rpc('catalog_import', { p_docs: docs.slice(i, i + CHUNK), p_dry_run: dryRun }),
      60_000,
    );
    if (error) throw classifyError(error);
    const part = data as Pick<ImportReport, 'inserted' | 'unchanged' | 'conflicts'>;
    report.inserted.push(...part.inserted);
    report.unchanged.push(...part.unchanged);
    report.conflicts.push(...part.conflicts);
  }
  return report;
}

export interface VerifyReport {
  ok: boolean;
  checked: number;
  mismatches: Array<DocRef & { reason: 'missing' | 'different' }>;
  missingObjects: string[];
}

// Re-reads the database and checks every planned document is there with the
// planned content, and that every uploaded image object really exists.
export async function verifyMigration(
  plan: MigrationPlan,
  uploaded: ReadonlyArray<UploadResult>,
): Promise<VerifyReport> {
  await refreshDocs();
  const mismatches: VerifyReport['mismatches'] = [];
  for (const d of plan.docs) {
    const got = getDoc(d.kind, d.id);
    if (!got) mismatches.push({ kind: d.kind, id: d.id, reason: 'missing' });
    else if (!jsonEqual(got.data, d.data)) mismatches.push({ kind: d.kind, id: d.id, reason: 'different' });
  }
  const missingObjects: string[] = [];
  const okIds = new Set(
    uploaded.filter((u) => u.status !== 'failed').map((u) => u.id),
  );
  for (const img of plan.images) {
    if (!okIds.has(img.id)) continue;
    if (!(await verifyObject(img.path, img.size).catch(() => false))) missingObjects.push(img.path);
  }
  return {
    ok: mismatches.length === 0 && missingObjects.length === 0,
    checked: plan.docs.length,
    mismatches,
    missingObjects,
  };
}

// ---- homepage image references ------------------------------------------------------

export function homeLocalRefs(content: HomeContent = getHomeContent()): string[] {
  return [...collectLocalRefs(content)].sort();
}

export interface HomeRewriteResult {
  section: HomeSectionKey;
  status: 'rewritten' | 'unchanged' | 'failed';
  error?: string;
}

// Points homepage sections at the migrated images. Only call this after the
// uploads were verified. Uses the normal verified save path (admin check,
// fresh read, conflict guard, read-back).
export async function rewriteHomepageRefs(
  map: ReadonlyMap<string, string>,
): Promise<HomeRewriteResult[]> {
  await refreshHomeContent();
  const results: HomeRewriteResult[] = [];
  for (const section of HOME_SECTION_KEYS) {
    const current = getHomeContent()[section];
    const next = rewriteLocalRefs(current, map);
    if (jsonEqual(current, next)) {
      results.push({ section, status: 'unchanged' });
      continue;
    }
    try {
      await updateHomeSection(section, next as never, { base: current as never });
      results.push({ section, status: 'rewritten' });
    } catch (e) {
      results.push({ section, status: 'failed', error: classifyError(e).code });
    }
  }
  return results;
}

// ---- cutover ------------------------------------------------------------------------

export async function finalizeMigration(): Promise<void> {
  const { error } = await withTimeout(supabase.rpc('catalog_mark_initialized'));
  if (error) throw classifyError(error);
  await refreshDocs();
  if (!getDocsState().initialized) {
    throw new PersistenceError('verify_failed', 'cutover flag not visible after finalize');
  }
}

export async function rollbackMigrationFlag(): Promise<void> {
  const { error } = await withTimeout(supabase.rpc('catalog_unmark_initialized'));
  if (error) throw classifyError(error);
  await refreshDocs();
}
