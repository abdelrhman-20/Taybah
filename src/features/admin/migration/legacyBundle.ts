import {
  catalogCategories,
  catalogCollections,
  catalogProducts,
  type CatalogCategory,
  type CatalogCollection,
  type CatalogProduct,
} from '../../storefront/catalog/catalogData';
import { migrateCatalogState } from '../../storefront/catalog/catalogStore';
import {
  defaultAttributes,
  migrateAttributes,
  type AttributeDef,
} from '../../storefront/catalog/attributeStore';
import {
  defaultNav,
  migrateNav,
  type StorefrontNavState,
} from '../../storefront/layout/navStore';
import { getImageBlob, listImageAssets } from '../../shared/assets/imageStore';
import { createZip, readZip } from './zip';

// LEGACY (BROWSER-ONLY) DATA — before the database migration, the admin kept
// the catalog, attributes and navigation in this browser's localStorage and
// uploaded images in its IndexedDB. This module reads that data WITHOUT ever
// modifying or clearing it, packages it into a recoverable backup ZIP, and
// parses it into the typed shapes the importer needs.
//
// The backup stores the raw localStorage strings verbatim (so nothing is lost
// even if a newer app version would interpret them differently) plus every
// image's actual bytes.

export const LEGACY_KEYS = {
  catalog: 'taybah:catalog',
  attributes: 'taybah:attributes',
  navigation: 'taybah:navigation',
  homepage: 'taybah:homepage',
} as const;
export type LegacyKey = keyof typeof LEGACY_KEYS;

export interface LegacyImageMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  // Path of the bytes inside the backup ZIP.
  file: string;
}

export interface LegacyBundle {
  format: 'taybah-local-backup';
  version: 1;
  createdAt: string;
  origin: string;
  storage: Record<LegacyKey, { present: boolean; raw: string | null }>;
  images: LegacyImageMeta[];
}

export interface LegacySource {
  bundle: LegacyBundle;
  blobs: Map<string, Blob>;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ---- reading the current browser -------------------------------------------------

export async function readLegacyFromBrowser(): Promise<LegacySource> {
  const storage = {} as LegacyBundle['storage'];
  for (const key of Object.keys(LEGACY_KEYS) as LegacyKey[]) {
    let raw: string | null;
    try {
      raw = localStorage.getItem(LEGACY_KEYS[key]);
    } catch {
      raw = null;
    }
    storage[key] = { present: raw !== null, raw };
  }

  const images: LegacyImageMeta[] = [];
  const blobs = new Map<string, Blob>();
  // IndexedDB unavailable => nothing to read here.
  const metas = await listImageAssets().catch(() => [] as Awaited<ReturnType<typeof listImageAssets>>);
  for (const m of metas) {
    const blob = await getImageBlob(m.id).catch(() => undefined);
    if (!blob) continue;
    blobs.set(m.id, blob);
    images.push({
      id: m.id,
      name: m.name,
      type: m.type,
      size: m.size,
      createdAt: m.createdAt,
      file: `images/${m.id}.${EXT[m.type] ?? 'bin'}`,
    });
  }

  return {
    bundle: {
      format: 'taybah-local-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      origin: typeof location !== 'undefined' ? location.origin : '',
      storage,
      images,
    },
    blobs,
  };
}

// ---- backup ZIP ------------------------------------------------------------------

const README = `Taybah local-data backup
========================

This archive was created by the Taybah admin ("النسخ الاحتياطي والترحيل").

manifest.json   the raw browser data (catalog, attributes, navigation, homepage
                cache) exactly as it was stored, plus an index of the images.
images/         every image that was stored in the browser, original bytes.

HOW TO RESTORE / RE-RUN THE MIGRATION
1. Sign in to /admin as an administrator on any browser.
2. Open "النسخ الاحتياطي والترحيل" and choose "رفع نسخة احتياطية" (upload a
   backup), then select this .zip.
3. Run the dry run, then the migration. It is safe to repeat: existing records
   are never overwritten, differences are reported as conflicts.

Nothing in this archive is secret, but it contains your catalog: store it safely.
`;

export async function createBackupZip(src: LegacySource): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries = [
    { name: 'README.txt', data: enc.encode(README) },
    { name: 'manifest.json', data: enc.encode(JSON.stringify(src.bundle, null, 2)) },
  ];
  for (const img of src.bundle.images) {
    const blob = src.blobs.get(img.id);
    if (blob) entries.push({ name: img.file, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return createZip(entries);
}

export function parseBackupZip(bytes: Uint8Array): LegacySource {
  const entries = readZip(bytes);
  const manifest = entries.find((e) => e.name === 'manifest.json');
  if (!manifest) throw new Error('manifest.json is missing — this is not a Taybah backup');
  const bundle = JSON.parse(new TextDecoder().decode(manifest.data)) as LegacyBundle;
  if (bundle.format !== 'taybah-local-backup' || bundle.version !== 1) {
    throw new Error('unsupported backup format');
  }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const blobs = new Map<string, Blob>();
  for (const img of bundle.images) {
    const data = byName.get(img.file);
    if (!data) throw new Error(`image bytes missing from backup: ${img.file}`);
    blobs.set(img.id, new Blob([data as BlobPart], { type: img.type }));
  }
  return { bundle, blobs };
}

// ---- parsing into typed shapes ----------------------------------------------------

export interface ParsedLegacy {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  collections: CatalogCollection[];
  attributes: AttributeDef[];
  navigation: StorefrontNavState;
  // Which parts came from real saved browser data vs the built-in defaults
  // (the browser had never saved that part, so the default IS what visitors
  // currently see).
  usedDefaults: LegacyKey[];
  // Corrupt JSON etc. — the importer refuses to proceed while this is non-empty
  // rather than quietly importing defaults over data it could not read.
  errors: string[];
}

function parseRaw(
  bundle: LegacyBundle,
  key: LegacyKey,
  errors: string[],
): { value: unknown; present: boolean } {
  const slot = bundle.storage[key];
  if (!slot?.present || slot.raw === null) return { value: null, present: false };
  try {
    return { value: JSON.parse(slot.raw), present: true };
  } catch {
    errors.push(`البيانات المحلية «${LEGACY_KEYS[key]}» تالفة ولا يمكن قراءتها.`);
    return { value: null, present: false };
  }
}

export function parseLegacy(bundle: LegacyBundle): ParsedLegacy {
  const errors: string[] = [];
  const usedDefaults: LegacyKey[] = [];

  const cat = parseRaw(bundle, 'catalog', errors);
  if (!cat.present) usedDefaults.push('catalog');
  const catalog = migrateCatalogState(
    cat.present && cat.value && typeof cat.value === 'object'
      ? (cat.value as Parameters<typeof migrateCatalogState>[0])
      : {
          products: structuredClone(catalogProducts),
          categories: structuredClone(catalogCategories),
          collections: structuredClone(catalogCollections),
        },
  );

  const attr = parseRaw(bundle, 'attributes', errors);
  if (!attr.present) usedDefaults.push('attributes');
  const attributes = attr.present
    ? migrateAttributes(attr.value, { backfillDefaults: true })
    : defaultAttributes();

  const nav = parseRaw(bundle, 'navigation', errors);
  if (!nav.present) usedDefaults.push('navigation');
  const navigation = nav.present
    ? migrateNav(nav.value as Partial<StorefrontNavState>)
    : defaultNav();

  return {
    products: catalog.products,
    categories: catalog.categories,
    collections: catalog.collections,
    attributes,
    navigation,
    usedDefaults,
    errors,
  };
}
