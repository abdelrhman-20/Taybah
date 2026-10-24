import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';
import { generateId } from '../utils/id';

// PERSISTENT MEDIA — admin-uploaded images live in the public Supabase
// Storage bucket `storefront-media` (created by migration 0003; reads are
// public, writes are admin-only via storage RLS). Records reference an image
// with the stable string `media:<path>`; the public URL is derived from the
// path at render time, so moving the project never rewrites stored records.
//
//   media:uploads/<uuid>[-name].<ext>     new uploads from the admin
//   media:migrated/<legacyId>.<ext>       images moved out of a browser's
//                                         IndexedDB by the migration tool
//
// The bucket is PUBLIC by design (storefront imagery only). Never upload
// anything private here.

export const MEDIA_BUCKET = 'storefront-media';
export const MEDIA_REF_PREFIX = 'media:';
export const UPLOAD_DIR = 'uploads';
export const MIGRATED_DIR = 'migrated';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_MB = 5;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isMediaRef(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(MEDIA_REF_PREFIX);
}

export function mediaRef(path: string): string {
  return `${MEDIA_REF_PREFIX}${path}`;
}

export function mediaPath(ref: string): string {
  return ref.slice(MEDIA_REF_PREFIX.length);
}

const urlCache = new Map<string, string>();

export function mediaPublicUrl(path: string): string {
  let url = urlCache.get(path);
  if (url === undefined) {
    url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    urlCache.set(path, url);
  }
  return url;
}

// ---- validation ------------------------------------------------------------

async function sniffMagicBytes(blob: Blob): Promise<'jpeg' | 'png' | 'webp' | null> {
  const buf = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...buf.slice(8, 12)) === 'WEBP'
  )
    return 'webp';
  return null;
}

const MAGIC_TO_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

export type ImageValidation = { ok: true; mime: string } | { ok: false; message: string };

// Type allow-list + size cap + real file signature (MIME/extension alone can
// lie). Messages are user-facing Arabic.
export async function validateImage(
  file: Blob,
  maxMB: number = MAX_IMAGE_MB,
): Promise<ImageValidation> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, message: 'صيغة غير مدعومة — اختر صورة JPEG أو PNG أو WebP.' };
  }
  if (file.size > maxMB * 1024 * 1024) {
    return { ok: false, message: `حجم الصورة يتجاوز ${maxMB} ميجابايت — اختر ملفًا أصغر.` };
  }
  const magic = await sniffMagicBytes(file);
  if (!magic || MAGIC_TO_MIME[magic] !== file.type) {
    return { ok: false, message: 'محتوى الملف لا يطابق نوعه — اختر صورة صالحة.' };
  }
  return { ok: true, mime: file.type };
}

function safeStem(name: string): string {
  const stem = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return stem;
}

// ---- upload ----------------------------------------------------------------

export interface UploadedImage {
  ref: string;
  path: string;
}

async function putObject(path: string, blob: Blob, contentType: string, upsert: boolean) {
  const { error } = await withTimeout(
    supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
      contentType,
      upsert,
      cacheControl: '31536000',
    }),
    60_000,
  );
  return error;
}

// Confirms the object really exists with the expected size (a successful
// upload call alone is not proof of persistence).
export async function verifyObject(path: string, size: number): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await withTimeout(
    supabase.storage.from(MEDIA_BUCKET).list(dir, { search: name, limit: 10 }),
  );
  if (error) throw classifyError(error);
  const hit = (data ?? []).find((o) => o.name === name);
  const got = Number((hit?.metadata as { size?: number } | null | undefined)?.size);
  return Boolean(hit) && got === size;
}

// New admin upload: validate -> upload to a unique path -> verify it landed.
// Returns the `media:` ref to store on the record. A later failure to save
// that record leaves an unreferenced object, which the media library shows
// (and can delete) — nothing is silently lost or duplicated.
export async function uploadImage(file: File): Promise<UploadedImage> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  const valid = await validateImage(file);
  if (!valid.ok) throw new PersistenceError('invalid', valid.message);
  const stem = safeStem(file.name);
  const path = `${UPLOAD_DIR}/${generateId()}${stem ? `-${stem}` : ''}.${EXT[valid.mime]}`;
  const error = await putObject(path, file, valid.mime, false);
  if (error) throw classifyError(error);
  if (!(await verifyObject(path, file.size))) {
    throw new PersistenceError('verify_failed', 'uploaded object not found');
  }
  return { ref: mediaRef(path), path };
}

// Deterministic path for a legacy IndexedDB image, so re-running the
// migration finds the already-uploaded object instead of duplicating it.
export function migratedPath(legacyId: string, mime: string): string {
  return `${MIGRATED_DIR}/${legacyId}.${EXT[mime] ?? 'bin'}`;
}

export type MigrateUpload = 'uploaded' | 'already_present';

// Idempotent: uploads without overwriting; if the object already exists with
// the same size it counts as done, with a different size it is a conflict.
export async function uploadMigratedImage(
  legacyId: string,
  blob: Blob,
): Promise<{ ref: string; path: string; result: MigrateUpload }> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  const valid = await validateImage(blob);
  if (!valid.ok) throw new PersistenceError('invalid', valid.message);
  const path = migratedPath(legacyId, valid.mime);
  const error = await putObject(path, blob, valid.mime, false);
  let result: MigrateUpload = 'uploaded';
  if (error) {
    const dup = /already exists|duplicate|resource already/i.test(error.message ?? '');
    if (!dup) throw classifyError(error);
    result = 'already_present';
  }
  if (!(await verifyObject(path, blob.size))) {
    throw new PersistenceError(
      result === 'already_present' ? 'conflict' : 'verify_failed',
      `migrated object ${path} missing or different size`,
    );
  }
  return { ref: mediaRef(path), path, result };
}

// ---- library listing / deletion ---------------------------------------------

export interface RemoteImage {
  ref: string;
  path: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
}

export async function listRemoteImages(): Promise<RemoteImage[]> {
  if (!supabaseConfigured) return [];
  const out: RemoteImage[] = [];
  for (const dir of [UPLOAD_DIR, MIGRATED_DIR]) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await withTimeout(
        supabase.storage.from(MEDIA_BUCKET).list(dir, {
          limit: 100,
          offset,
          sortBy: { column: 'created_at', order: 'desc' },
        }),
      );
      if (error) throw classifyError(error);
      const items = data ?? [];
      for (const o of items) {
        if (!o.id) continue; // folder placeholder
        const meta = (o.metadata ?? {}) as { size?: number; mimetype?: string };
        const path = `${dir}/${o.name}`;
        out.push({
          ref: mediaRef(path),
          path,
          name: o.name,
          size: Number(meta.size ?? 0),
          type: meta.mimetype ?? '',
          createdAt: o.created_at ?? '',
        });
      }
      if (items.length < 100) break;
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Storage's remove() reports which objects it actually deleted; zero removed
// (no permission, or already gone) must not look like success.
export async function deleteRemoteImage(path: string): Promise<void> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  const { data, error } = await withTimeout(supabase.storage.from(MEDIA_BUCKET).remove([path]));
  if (error) throw classifyError(error);
  if (!data || data.length === 0) {
    throw new PersistenceError('unauthorized', 'storage delete removed 0 objects');
  }
}
