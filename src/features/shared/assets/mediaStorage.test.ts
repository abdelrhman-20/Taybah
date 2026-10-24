import { describe, expect, it } from 'vitest';
import { freshBackend } from '../../../test/harness';

// Supabase Storage media layer against the FAKE backend (client.mock.ts).

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

const file = (bytes: number[], type: string, name = 'photo.jpg', pad = 0) =>
  new File([new Uint8Array([...bytes, ...new Array(pad).fill(1)])], name, { type });

async function media() {
  return import('./mediaStorage');
}

describe('validateImage', () => {
  it('accepts jpeg / png / webp whose bytes match their type', async () => {
    await freshBackend('admin');
    const m = await media();
    expect(await m.validateImage(file(JPEG, 'image/jpeg'))).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(await m.validateImage(file(PNG, 'image/png'))).toEqual({ ok: true, mime: 'image/png' });
    expect(await m.validateImage(file(WEBP, 'image/webp'))).toEqual({ ok: true, mime: 'image/webp' });
  });

  it('rejects an unsupported type', async () => {
    await freshBackend('admin');
    const m = await media();
    const r = await m.validateImage(file(JPEG, 'image/gif'));
    expect(r.ok).toBe(false);
  });

  it('rejects a file over the size limit', async () => {
    await freshBackend('admin');
    const m = await media();
    const big = file(JPEG, 'image/jpeg', 'big.jpg', 2 * 1024 * 1024 + 1);
    const r = await m.validateImage(big, 2);
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toContain('2');
  });

  it('rejects a file whose bytes do not match its declared type (disguised upload)', async () => {
    await freshBackend('admin');
    const m = await media();
    const r = await m.validateImage(file(PNG, 'image/jpeg'));
    expect(r).toMatchObject({ ok: false });
  });
});

describe('uploadImage', () => {
  it('uploads, verifies the object exists with the right size, and returns a media: ref', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    const f = file(JPEG, 'image/jpeg', 'My Rug (1).jpg', 100);
    const { ref, path } = await m.uploadImage(f);
    expect(ref).toBe(`media:${path}`);
    expect(path).toMatch(/^uploads\/[0-9a-f-]{36}-my-rug-1\.jpg$/);
    expect(b.objects.get(path)?.size).toBe(f.size);
    expect(m.isMediaRef(ref)).toBe(true);
    expect(m.mediaPath(ref)).toBe(path);
  });

  it('non-latin file names fall back to the id alone', async () => {
    await freshBackend('admin');
    const m = await media();
    const { path } = await m.uploadImage(file(PNG, 'image/png', 'سجادة.png'));
    expect(path).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
  });

  it('a non-admin upload is rejected as unauthorized and stores nothing', async () => {
    const b = await freshBackend('user');
    const m = await media();
    await expect(m.uploadImage(file(JPEG, 'image/jpeg'))).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.objects.size).toBe(0);
  });

  it('an invalid file is rejected before any upload is attempted', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    await expect(m.uploadImage(file(PNG, 'image/jpeg'))).rejects.toMatchObject({ code: 'invalid' });
    expect(b.calls('storage:upload')).toBe(0);
  });

  it('a provider failure surfaces as an error and returns no ref', async () => {
    const b = await freshBackend('admin');
    b.failNext('storage:upload', { message: 'Failed to fetch' });
    const m = await media();
    await expect(m.uploadImage(file(JPEG, 'image/jpeg'))).rejects.toMatchObject({ code: 'network' });
    expect(b.objects.size).toBe(0);
  });

  it('an upload the storage cannot confirm afterwards is verify_failed (never a silent success)', async () => {
    const b = await freshBackend('admin');
    b.respondNext('storage:list', []); // listing does not show the object
    const m = await media();
    await expect(m.uploadImage(file(JPEG, 'image/jpeg'))).rejects.toMatchObject({ code: 'verify_failed' });
  });
});

describe('uploadMigratedImage (idempotent migration upload)', () => {
  it('uploads under a deterministic path, then reports already_present on re-run', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    const blob = file(PNG, 'image/png', 'x.png', 50);
    const first = await m.uploadMigratedImage('legacy-1', blob);
    expect(first).toMatchObject({ result: 'uploaded', path: 'migrated/legacy-1.png', ref: 'media:migrated/legacy-1.png' });
    const second = await m.uploadMigratedImage('legacy-1', blob);
    expect(second.result).toBe('already_present');
    expect(b.objects.size).toBe(1); // never duplicated
  });

  it('refuses (conflict) when the path already holds a DIFFERENT file — never overwrites', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    await m.uploadMigratedImage('legacy-2', file(PNG, 'image/png', 'a.png', 10));
    const sizeBefore = b.objects.get('migrated/legacy-2.png')!.size;
    await expect(
      m.uploadMigratedImage('legacy-2', file(PNG, 'image/png', 'a.png', 999)),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(b.objects.get('migrated/legacy-2.png')!.size).toBe(sizeBefore);
  });

  it('rejects an invalid blob', async () => {
    await freshBackend('admin');
    const m = await media();
    await expect(m.uploadMigratedImage('legacy-3', file(JPEG, 'image/png'))).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('listRemoteImages / deleteRemoteImage', () => {
  it('lists uploaded and migrated images with refs and sizes, newest first', async () => {
    await freshBackend('admin');
    const m = await media();
    await m.uploadMigratedImage('old', file(PNG, 'image/png', 'o.png', 5));
    const up = await m.uploadImage(file(JPEG, 'image/jpeg', 'n.jpg', 7));
    const list = await m.listRemoteImages();
    expect(list.map((i) => i.ref)).toEqual([up.ref, 'media:migrated/old.png']);
    expect(list[0].size).toBe(JPEG.length + 7);
    expect(list.every((i) => i.ref.startsWith('media:'))).toBe(true);
  });

  it('deletes an object and confirms it is gone', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    const { path } = await m.uploadImage(file(JPEG, 'image/jpeg'));
    await m.deleteRemoteImage(path);
    expect(b.objects.has(path)).toBe(false);
  });

  it('a delete that removes zero objects (not permitted / already gone) is an error', async () => {
    const b = await freshBackend('admin');
    const m = await media();
    const { path } = await m.uploadImage(file(JPEG, 'image/jpeg'));
    b.signIn('user');
    await expect(m.deleteRemoteImage(path)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.objects.has(path)).toBe(true);
  });
});

describe('mediaPublicUrl', () => {
  it('derives a public URL from the stable path', async () => {
    await freshBackend('admin');
    const m = await media();
    expect(m.mediaPublicUrl('uploads/a.webp')).toContain('/storefront-media/uploads/a.webp');
  });
});
