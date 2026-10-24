import { useSyncExternalStore } from 'react';
import {
  colorOptions,
  materialOptions,
  sizeOptions,
  type Localized,
} from './catalogData';
import { getCatalog } from './catalogStore';
import {
  docsOfKind,
  getDocsState,
  subscribeDocs,
  writeDocs,
  type DocOp,
  type DocPut,
} from './catalogDocs';
import { getOrders } from '../checkout/orderStore';
import { getCartLines } from '../cart/useCart';

// PRODUCT ATTRIBUTE STORE — typed view over the persistent attribute documents
// (public.catalog_docs, kind 'attribute'; see catalogDocs.ts). Option
// DEFINITIONS (colors, materials, sizes, custom attributes) live in the
// database; product records still own their assignments. Until the catalog
// is migrated (`initialized`) the built-in defaults seeded from catalogData
// are served read-only. Mutations resolve only after the server confirmed
// the write.

export type AttributeDisplay = 'swatch' | 'chips' | 'list';

// Seeded attributes backed by the legacy product fields — these keys are
// reserved and must never appear in CatalogProduct.attributes.
export const RESERVED_ATTRIBUTE_KEYS = ['color', 'material', 'size'] as const;
export type ReservedAttributeKey = (typeof RESERVED_ATTRIBUTE_KEYS)[number];

export interface AttributeValue {
  key: string; // stable Latin key — never rendered as customer-facing text
  label: Localized;
  hex?: string; // only meaningful for display 'swatch'
  // Only meaningful for the 'size' attribute — the real numeric dimensions
  // behind the label (e.g. "280 × 200 سم"), not just a display string, so
  // they can be used for calculations/filtering later. Optional so every
  // other attribute's values are unaffected.
  widthCm?: number;
  lengthCm?: number;
  enabled: boolean;
  order: number;
}

export interface AttributeDef {
  key: string; // immutable relationship key ('color', 'material', 'size', …)
  name: Localized;
  display: AttributeDisplay;
  // Category slugs this attribute applies to; empty = all categories.
  categories: string[];
  required: boolean; // enforced for custom attributes when saving a product
  variationCapable: boolean; // metadata for future variant axes
  filterable: boolean; // expose as a storefront listing facet (attr_<key>)
  enabled: boolean;
  order: number;
  values: AttributeValue[];
}

function seedValues(
  options: { key: string; label: Localized; hex?: string; widthCm?: number; lengthCm?: number }[],
): AttributeValue[] {
  return options.map((o, i) => ({
    key: o.key,
    label: o.label,
    ...(o.hex ? { hex: o.hex } : {}),
    ...(o.widthCm !== undefined ? { widthCm: o.widthCm } : {}),
    ...(o.lengthCm !== undefined ? { lengthCm: o.lengthCm } : {}),
    enabled: true,
    order: i + 1,
  }));
}

export function defaultAttributes(): AttributeDef[] {
  return [
    {
      key: 'color',
      name: { ar: 'اللون', en: 'Color' },
      display: 'swatch',
      categories: [],
      required: false,
      variationCapable: true,
      filterable: true, // shows the colour filter on listings; admins can switch it off in السمات
      enabled: true,
      order: 1,
      values: seedValues(colorOptions),
    },
    {
      key: 'material',
      name: { ar: 'الخامة', en: 'Material' },
      display: 'list',
      categories: [],
      required: false,
      variationCapable: false,
      filterable: false,
      enabled: true,
      order: 2,
      values: seedValues(materialOptions),
    },
    {
      key: 'size',
      name: { ar: 'المقاس', en: 'Size' },
      display: 'chips',
      categories: [],
      required: false,
      variationCapable: true,
      filterable: false,
      enabled: true,
      order: 3,
      values: seedValues(sizeOptions),
    },
  ];
}

const DISPLAYS: AttributeDisplay[] = ['swatch', 'chips', 'list'];

function sanitizeValue(raw: unknown, fallbackOrder: number): AttributeValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<AttributeValue>;
  if (typeof v.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.key)) return null;
  const label = v.label as Partial<Localized> | undefined;
  if (typeof label?.ar !== 'string' || !label.ar.trim()) return null;
  return {
    key: v.key,
    label: { ar: label.ar, en: typeof label.en === 'string' ? label.en : '' },
    ...(typeof v.hex === 'string' && v.hex ? { hex: v.hex } : {}),
    ...(typeof v.widthCm === 'number' && Number.isFinite(v.widthCm) ? { widthCm: v.widthCm } : {}),
    ...(typeof v.lengthCm === 'number' && Number.isFinite(v.lengthCm) ? { lengthCm: v.lengthCm } : {}),
    enabled: v.enabled !== false,
    order: typeof v.order === 'number' ? v.order : fallbackOrder,
  };
}

function sanitizeAttr(raw: unknown, fallbackOrder: number): AttributeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<AttributeDef>;
  if (typeof a.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.key)) return null;
  const name = a.name as Partial<Localized> | undefined;
  if (typeof name?.ar !== 'string' || !name.ar.trim()) return null;
  const values: AttributeValue[] = [];
  const seen = new Set<string>();
  if (Array.isArray(a.values)) {
    a.values.forEach((v, i) => {
      const sv = sanitizeValue(v, i + 1);
      if (sv && !seen.has(sv.key)) {
        seen.add(sv.key);
        values.push(sv);
      }
    });
  }
  return {
    key: a.key,
    name: { ar: name.ar, en: typeof name.en === 'string' ? name.en : '' },
    display: DISPLAYS.includes(a.display as AttributeDisplay)
      ? (a.display as AttributeDisplay)
      : 'chips',
    categories: Array.isArray(a.categories)
      ? a.categories.filter((c): c is string => typeof c === 'string')
      : [],
    required: a.required === true,
    variationCapable: a.variationCapable === true,
    // Stored attributes created before `filterable` existed default to false —
    // migration never enables facets on its own.
    filterable: a.filterable === true,
    enabled: a.enabled !== false,
    order: typeof a.order === 'number' ? a.order : fallbackOrder,
    values,
  };
}

// Stored attributes win as-is; any default attribute the stored data predates
// is appended so future versions never destroy admin customizations.
export function migrateAttributes(raw: unknown, opts: { backfillDefaults: boolean }): AttributeDef[] {
  const defaults = defaultAttributes();
  if (!Array.isArray(raw)) return defaults;
  const out: AttributeDef[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const a = sanitizeAttr(r, i + 1);
    if (a && !seen.has(a.key)) {
      seen.add(a.key);
      out.push(a);
    }
  });
  for (const d of defaults) {
    if (!seen.has(d.key)) out.push({ ...d, order: out.length + 1 });
  }
  // Additive only: a saved 'size' attribute that predates the dimension audit
  // gains any seeded size values it lacks (so seed products never fall back to
  // raw keys). Saved values — labels, enabled state, order — are never touched
  // and nothing is removed.
  const sizeDefault = defaults.find((d) => d.key === 'size');
  // Legacy browser data only: the database is authoritative, so a size the
  // admin deleted must NOT be resurrected on every read.
  return out.map((a) => {
    if (!opts.backfillDefaults || a.key !== 'size' || !sizeDefault) return a;
    const have = new Set(a.values.map((v) => v.key));
    const missing = sizeDefault.values.filter((v) => !have.has(v.key));
    if (missing.length === 0) return a;
    const base = a.values.reduce((m, v) => Math.max(m, v.order), 0);
    return { ...a, values: [...a.values, ...missing.map((v, i) => ({ ...v, order: base + i + 1 }))] };
  });
}

function docAttributes(): AttributeDef[] {
  const raw = docsOfKind('attribute').map((d) => structuredClone(d.data));
  return migrateAttributes(raw, { backfillDefaults: false });
}

let cache: { version: number; value: AttributeDef[] } | null = null;

export function getAttributes(): AttributeDef[] {
  const version = getDocsState().version;
  if (!cache || cache.version !== version) {
    cache = {
      version,
      value: getDocsState().initialized ? docAttributes() : defaultAttributes(),
    };
  }
  return cache.value;
}

export function useAttributes(): AttributeDef[] {
  return useSyncExternalStore(subscribeDocs, getAttributes);
}

export function attributeByKey(key: string): AttributeDef | undefined {
  return getAttributes().find((a) => a.key === key);
}

// Enabled attributes applicable to a category (empty scope = all).
export function attributesForCategory(categorySlug: string): AttributeDef[] {
  return getAttributes()
    .filter((a) => a.enabled && (a.categories.length === 0 || a.categories.includes(categorySlug)))
    .sort((a, b) => a.order - b.order);
}

// Value keys allowed in URL filter params — all known keys, so existing
// filtered URLs keep working even for disabled values (they just are not
// offered as new selections).
export function valueKeySet(attrKey: string): Set<string> {
  const a = attributeByKey(attrKey);
  return new Set((a?.values ?? []).map((v) => v.key));
}

// Enabled values in display order — what storefront selectors/filters offer.
export function enabledValues(attrKey: string): AttributeValue[] {
  const a = attributeByKey(attrKey);
  if (!a || !a.enabled) return [];
  return a.values.filter((v) => v.enabled).sort((x, y) => x.order - y.order);
}

// Label lookup resolves DISABLED values too — historical orders, cart lines,
// and product assignments must keep rendering their Arabic label even after
// an admin disables the option.
export function attributeValueLabel(
  attrKey: string,
  valueKey: string | null,
  locale: 'ar' | 'en',
): string | null {
  if (!valueKey) return null;
  const v = attributeByKey(attrKey)?.values.find((x) => x.key === valueKey);
  return v ? v.label[locale] : valueKey;
}

export function attributeValueHex(attrKey: string, valueKey: string): string | undefined {
  return attributeByKey(attrKey)?.values.find((x) => x.key === valueKey)?.hex;
}

// Enabled-only subset of a product's assigned value keys for one attribute,
// in the product's own order — drives LIVE customer-facing specs (PDP specs
// table, material/color/size rows) so a disabled attribute or disabled value
// never surfaces as current information, without touching the product's
// stored assignment. Historical surfaces (orders, cart lines) intentionally
// keep using attributeValueLabel directly instead, so a since-disabled value
// still renders its saved label there.
export function visibleAssignedValues(attrKey: string, keys: string[]): string[] {
  const a = attributeByKey(attrKey);
  if (!a || !a.enabled) return [];
  const enabled = new Set(a.values.filter((v) => v.enabled).map((v) => v.key));
  return keys.filter((k) => enabled.has(k));
}

// ---- mutations -------------------------------------------------------------

export interface AttributeWriteOpts {
  expectedRevision?: number | null;
}

export function attributeDocOp(attr: AttributeDef, opts: AttributeWriteOpts = {}): DocPut {
  return {
    op: 'put',
    kind: 'attribute',
    id: attr.key,
    slug: null,
    visible: true,
    sortOrder: attr.order,
    data: attr,
    expectedRevision: opts.expectedRevision,
  };
}

// Replaces the whole list in ONE atomic write: every entry in `next` is
// upserted, and stored attributes missing from it are deleted.
export function saveAttributes(next: AttributeDef[]): Promise<void> {
  const keep = new Set(next.map((a) => a.key));
  const removed = docsOfKind('attribute').filter((d) => !keep.has(d.id));
  return writeDocs([
    ...next.map((a) => attributeDocOp(a)),
    ...removed.map((d): DocOp => ({ op: 'delete', kind: 'attribute', id: d.id })),
  ]);
}

export function upsertAttribute(attr: AttributeDef, opts?: AttributeWriteOpts): Promise<void> {
  return writeDocs([attributeDocOp(attr, opts)]);
}

export function removeAttribute(key: string): Promise<void> {
  return writeDocs([{ op: 'delete', kind: 'attribute', id: key }]);
}

// ---- reference scanning (deletion safety) ----------------------------------
// Product assignments live in the legacy fields for the three seeded keys
// (color/material/size) plus the optional generic `attributes` map reserved
// for future custom attributes. Variant records hold resolved value keys in
// `combo`; order lines snapshot raw value keys in legacy `color`/`size` and
// (for variant lines) in `options[]`; cart lines carry `combo`/`color`/`size`
// while they exist. Deleting a referenced key would degrade every one of
// these to raw technical keys — the scans below cover all of them.

type ProductWithAttrs = {
  colors: string[];
  materials: string[];
  size: string;
  sizes: string[];
  name: Localized;
  attributes?: Record<string, string[]>;
};

// Shared resolver — returns the assigned value keys for any attribute on a
// product, whether the assignment lives in a legacy field (reserved seeds) or
// the generic attributes map. Used by reference scanning, storefront filters,
// and (later) variant-axis resolution; variant logic itself lives elsewhere.
export function productAxisValues(p: ProductWithAttrs, attrKey: string): string[] {
  switch (attrKey) {
    case 'color':
      return p.colors;
    case 'material':
      return p.materials;
    case 'size':
      // Union of default + selectable sizes (deduped, falsy-safe) so reference
      // scanning catches a value used only as the product's default size.
      return [...new Set([p.size, ...p.sizes].filter(Boolean))];
    default:
      return p.attributes?.[attrKey] ?? [];
  }
}

export function attributeReferences(attrKey: string): string[] {
  const uses: string[] = [];
  for (const p of getCatalog().products) {
    if (productAxisValues(p as ProductWithAttrs, attrKey).length > 0) {
      uses.push(`منتج: ${p.name.ar}`);
    }
    const comboRefs = (p.variants ?? [])
      .filter((v) => v.combo[attrKey] !== undefined)
      .map((v) => v.sku || v.id);
    if (comboRefs.length > 0) {
      uses.push(`تنويعات في «${p.name.ar}»: ${comboRefs.join('، ')}`);
    }
  }
  for (const o of getOrders()) {
    const hit = o.lines.some(
      (l) =>
        (attrKey === 'color' && l.color !== null) ||
        (attrKey === 'size' && l.size !== null) ||
        (l.options?.some((x) => x.axis === attrKey) ?? false),
    );
    if (hit) uses.push(`طلب: ${o.ref}`);
  }
  if (
    getCartLines().some(
      (l) =>
        l.combo?.[attrKey] !== undefined ||
        (attrKey === 'color' && l.color !== null) ||
        (attrKey === 'size' && l.size !== null),
    )
  ) {
    uses.push('سلة التسوق');
  }
  return uses;
}

export function attributeValueReferences(attrKey: string, valueKey: string): string[] {
  const uses: string[] = [];
  for (const p of getCatalog().products) {
    if (productAxisValues(p as ProductWithAttrs, attrKey).includes(valueKey)) {
      uses.push(`منتج: ${p.name.ar}`);
    }
    const comboRefs = (p.variants ?? [])
      .filter((v) => v.combo[attrKey] === valueKey)
      .map((v) => v.sku || v.id);
    if (comboRefs.length > 0) {
      uses.push(`تنويعات في «${p.name.ar}»: ${comboRefs.join('، ')}`);
    }
  }
  for (const o of getOrders()) {
    const hit = o.lines.some(
      (l) =>
        (attrKey === 'color' && l.color === valueKey) ||
        (attrKey === 'size' && l.size === valueKey) ||
        (l.options?.some((x) => x.axis === attrKey && x.value === valueKey) ?? false),
    );
    if (hit) uses.push(`طلب: ${o.ref}`);
  }
  if (
    getCartLines().some(
      (l) =>
        l.combo?.[attrKey] === valueKey ||
        (attrKey === 'color' && l.color === valueKey) ||
        (attrKey === 'size' && l.size === valueKey),
    )
  ) {
    uses.push('سلة التسوق');
  }
  return uses;
}

// ---- admin list filtering ----------------------------------------------------

export type AttributeStatusFilter = 'all' | 'enabled' | 'disabled';

// Pure selection for the Admin attributes page — case-insensitive substring
// match across the attribute's name (both locales), technical key, and every
// value's label and key. Arabic is unaffected by case folding, so the same
// lowercased comparison covers both languages. The input list's order is
// preserved as-is; sorting stays the caller's job.
export function filterAttributes(
  list: AttributeDef[],
  query: string,
  status: AttributeStatusFilter = 'all',
): AttributeDef[] {
  const q = query.trim().toLowerCase();
  return list.filter((a) => {
    if (status === 'enabled' && !a.enabled) return false;
    if (status === 'disabled' && a.enabled) return false;
    if (!q) return true;
    if (
      a.name.ar.toLowerCase().includes(q) ||
      a.name.en.toLowerCase().includes(q) ||
      a.key.toLowerCase().includes(q)
    ) {
      return true;
    }
    return a.values.some(
      (v) =>
        v.label.ar.toLowerCase().includes(q) ||
        v.label.en.toLowerCase().includes(q) ||
        v.key.toLowerCase().includes(q),
    );
  });
}
