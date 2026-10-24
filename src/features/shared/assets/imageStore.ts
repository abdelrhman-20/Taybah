import { useEffect, useSyncExternalStore } from 'react';
import { generateId } from '../utils/id';
import { IMAGE_VARIANTS } from './imageVariants';
import { isMediaRef, mediaPath, mediaPublicUrl } from './mediaStorage';

// LEGACY LOCAL IMAGE STORE — IndexedDB-backed blob storage that admin uploads
// used before images moved to Supabase Storage (see mediaStorage.ts). It is
// still read here for two reasons only: (1) records saved before the
// migration may still hold `local:<id>` refs that must keep rendering in the
// browser that owns them, and (2) the migration tool reads these blobs to
// upload them. New uploads never go to IndexedDB.
//
// Original description:
// images. Entities (products, categories, homepage sections…) store only a
// `local:<assetId>` reference string; the blob itself lives in IndexedDB, so
// no Base64 ever enters localStorage and one blob is shared by every
// consumer. External http(s) URLs pass through the resolver untouched for
// backward compatibility with the seeded mock imagery.
// This is browser-local storage only — not a server upload or cloud store.

const DB_NAME = 'taybah-assets';
const DB_VERSION = 1;
const STORE = 'images';

export const LOCAL_IMAGE_PREFIX = 'local:';
export { MAX_IMAGE_MB, ACCEPTED_IMAGE_TYPES } from './mediaStorage';

export interface ImageAssetMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

interface ImageAssetRecord extends ImageAssetMeta {
  blob: Blob;
}

export function isLocalImageRef(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(LOCAL_IMAGE_PREFIX);
}

export function localImageRef(id: string): string {
  return `${LOCAL_IMAGE_PREFIX}${id}`;
}

function refToId(ref: string): string {
  return ref.slice(LOCAL_IMAGE_PREFIX.length);
}

// ---- IndexedDB -------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err: unknown) => {
    // Don't cache a permanently-rejected promise — a transient failure
    // (blocked upgrade, momentary quota pressure) must not brick every
    // later media operation for the rest of the session. The next caller
    // gets a fresh attempt; the current one still sees this rejection.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function runTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function saveImageBlob(blob: Blob, meta: { name: string }): Promise<string> {
  const id = generateId();
  const record: ImageAssetRecord = {
    id,
    name: meta.name,
    type: blob.type,
    size: blob.size,
    createdAt: new Date().toISOString(),
    blob,
  };
  await runTx('readwrite', (s) => s.put(record));
  urlCache.set(id, URL.createObjectURL(blob));
  metaList = metaList ? [record, ...metaList] : metaList;
  notify();
  return id;
}

export async function deleteImageAsset(id: string): Promise<void> {
  await runTx('readwrite', (s) => s.delete(id));
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
  missing.add(id);
  metaList = metaList ? metaList.filter((m) => m.id !== id) : metaList;
  notify();
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  const rec = await runTx('readonly', (s) => s.get(id) as IDBRequest<ImageAssetRecord | undefined>);
  return rec?.blob;
}

export async function listImageAssets(): Promise<ImageAssetMeta[]> {
  const recs = await runTx('readonly', (s) => s.getAll() as IDBRequest<ImageAssetRecord[]>);
  return recs.map((r) => {
    const meta: ImageAssetMeta = {
      id: r.id,
      name: r.name,
      type: r.type,
      size: r.size,
      createdAt: r.createdAt,
    };
    return meta;
  });
}

// ---- reactive object-URL resolution ----------------------------------------

const urlCache = new Map<string, string>();
const missing = new Set<string>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function ensureLoaded(id: string) {
  if (urlCache.has(id) || missing.has(id) || loading.has(id)) return;
  loading.add(id);
  getImageBlob(id)
    .then((blob) => {
      loading.delete(id);
      if (blob) urlCache.set(id, URL.createObjectURL(blob));
      else missing.add(id);
      notify();
    })
    .catch(() => {
      loading.delete(id);
      missing.add(id);
      notify();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- media-library metadata ------------------------------------------------

let metaList: ImageAssetMeta[] | null = null;
let metaLoading = false;

function ensureMetaLoaded() {
  if (metaList !== null || metaLoading) return;
  metaLoading = true;
  listImageAssets()
    .then((list) => {
      metaList = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    })
    .catch(() => {
      metaList = [];
    })
    .finally(() => {
      metaLoading = false;
      notify();
    });
}

// Reactive asset-metadata list for the Admin media library and picker dialog.
// `null` = still loading.
export function useImageAssets(): ImageAssetMeta[] | null {
  const list = useSyncExternalStore(subscribe, () => metaList);
  useEffect(() => {
    ensureMetaLoaded();
  }, []);
  return list;
}

// Root-absolute refs (e.g. `/images/home/x.jpg` in public/) must gain the
// deployment base — on GitHub Pages the site lives under /<repo>/, so a bare
// `/images/...` would resolve against the domain root and 404.
const ASSET_BASE = import.meta.env.BASE_URL;

// Images ship as WebP — refs written before the conversion (source data,
// admin-saved content, cached localStorage) may still end in .jpg/.jpeg, so
// point them at the converted file instead of a 404.
function toWebp(ref: string): string {
  return /\.jpe?g$/i.test(ref) && ref.includes('/images/') ? ref.replace(/\.jpe?g$/i, '.webp') : ref;
}

function withBase(ref: string): string {
  return ref.startsWith('/') ? `${ASSET_BASE}${ref.slice(1)}` : ref;
}

// Builds a srcset for a resolved local image URL using the generated variant
// manifest (scripts/optimize-images.mjs). External and blob: URLs (admin
// uploads) return undefined — nothing to vary.
export function imageSrcSet(resolvedUrl: string): string | undefined {
  const m = resolvedUrl.match(/\/images\/home\/([^/]+)\.webp$/);
  const entry = m && IMAGE_VARIANTS[m[1]];
  if (!m || !entry || !entry.variants.length) return undefined;
  const dir = resolvedUrl.slice(0, resolvedUrl.length - m[1].length - '.webp'.length);
  const parts = entry.variants.map((w) => `${dir}${m[1]}-${w}.webp ${w}w`);
  parts.push(`${resolvedUrl} ${entry.full}w`);
  return parts.join(', ');
}

// Resolves any image reference to a renderable URL: `media:` refs become
// public Storage URLs (synchronous); legacy `local:` refs become
// object URLs (async, notified on arrival); external URLs return as-is;
// missing/empty refs resolve to '' so callers can render a safe fallback.
export function useImageUrl(ref: string | null | undefined): string {
  const id = ref && isLocalImageRef(ref) ? refToId(ref) : null;
  const url = useSyncExternalStore(subscribe, () =>
    id
      ? (urlCache.get(id) ?? '')
      : ref && isMediaRef(ref)
        ? mediaPublicUrl(mediaPath(ref))
        : ref
          ? withBase(toWebp(ref))
          : '',
  );
  useEffect(() => {
    if (id) ensureLoaded(id);
  }, [id]);
  return url;
}
