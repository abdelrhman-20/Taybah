import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyBundle, LegacySource } from './legacyBundle';
import { freshBackend } from '../../../test/harness';

// Reading, backing up and parsing the browser-only data. IndexedDB does not
// exist in the node test environment, so the image store is mocked for the
// one test that needs image bytes; localStorage is a plain in-memory Storage.

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const bundle = (raw: Partial<Record<'catalog' | 'attributes' | 'navigation' | 'homepage', string>> = {}): LegacyBundle => ({
  format: 'taybah-local-backup',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  origin: 'http://localhost',
  storage: {
    catalog: { present: 'catalog' in raw, raw: raw.catalog ?? null },
    attributes: { present: 'attributes' in raw, raw: raw.attributes ?? null },
    navigation: { present: 'navigation' in raw, raw: raw.navigation ?? null },
    homepage: { present: 'homepage' in raw, raw: raw.homepage ?? null },
  },
  images: [],
});

beforeEach(async () => {
  await freshBackend('admin');
});

describe('parseLegacy', () => {
  it('uses the built-in defaults — and says so — for parts the browser never saved', async () => {
    const { parseLegacy } = await import('./legacyBundle');
    const p = parseLegacy(bundle());
    expect(p.errors).toEqual([]);
    expect(p.usedDefaults.sort()).toEqual(['attributes', 'catalog', 'navigation']);
    expect(p.products.length).toBeGreaterThan(5);
    expect(p.categories.length).toBeGreaterThan(0);
    expect(p.attributes.map((a) => a.key)).toEqual(['color', 'material', 'size']);
    expect(p.navigation.main.length).toBeGreaterThan(0);
  });

  it('keeps saved records, ids and relationships exactly (no defaults mixed in)', async () => {
    const { parseLegacy } = await import('./legacyBundle');
    const saved = {
      products: [
        {
          id: 'custom-1', slug: 'my-rug', sku: 'X-1', name: { ar: 'سجادتي', en: '' }, description: { ar: '', en: '' },
          category: 'rugs', collection: 'diwan', price: 5, compareAtPrice: null, availability: 'in_stock',
          colors: [], materials: [], size: '', sizes: [], createdAt: '2025-01-01', featured: false,
          published: false, isNew: false, image: 'local:img1', imageHover: 'local:img1', images: ['local:img1'],
        },
      ],
      categories: [{ slug: 'rugs', name: { ar: 'سجاد', en: '' }, description: { ar: '', en: '' }, image: '', visible: true, order: 1 }],
      collections: [],
    };
    const p = parseLegacy(bundle({ catalog: JSON.stringify(saved) }));
    expect(p.usedDefaults).not.toContain('catalog');
    expect(p.products.map((x) => x.id)).toEqual(['custom-1']);
    expect(p.products[0].published).toBe(false);
    expect(p.products[0].images).toEqual(['local:img1']);
    expect(p.categories.map((c) => c.slug)).toEqual(['rugs']);
    expect(p.collections).toEqual([]);
  });

  it('flags corrupt saved JSON as an error instead of importing defaults over it', async () => {
    const { parseLegacy } = await import('./legacyBundle');
    const p = parseLegacy(bundle({ catalog: '{not json' }));
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('taybah:catalog');
  });

  it('legacy attributes get the seeded sizes backfilled; navigation is sanitized', async () => {
    const { parseLegacy } = await import('./legacyBundle');
    const p = parseLegacy(
      bundle({
        attributes: JSON.stringify([
          { key: 'size', name: { ar: 'المقاس' }, values: [{ key: 'only', label: { ar: 'وحيد' } }] },
        ]),
        navigation: JSON.stringify({
          main: [{ id: 'x', label: 'x', kind: 'external', path: 'javascript:alert(1)', visible: true }],
          footer: [],
        }),
      }),
    );
    expect(p.attributes.find((a) => a.key === 'size')!.values.length).toBeGreaterThan(1);
    expect(p.navigation.main).toEqual([]); // unsafe link dropped
  });
});

describe('backup zip', () => {
  it('round-trips the raw storage strings verbatim and every image byte', async () => {
    const { createBackupZip, parseBackupZip } = await import('./legacyBundle');
    const raw = JSON.stringify({ products: [], odd: 'مرحبا ✓' });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
    const src: LegacySource = {
      bundle: {
        ...bundle({ catalog: raw }),
        images: [
          { id: 'img-1', name: 'a.png', type: 'image/png', size: bytes.length, createdAt: '2026-01-01T00:00:00Z', file: 'images/img-1.png' },
        ],
      },
      blobs: new Map([['img-1', new Blob([bytes], { type: 'image/png' })]]),
    };
    const zip = await createBackupZip(src);
    const back = parseBackupZip(zip);
    expect(back.bundle.storage.catalog.raw).toBe(raw);
    expect(back.bundle.storage.attributes).toEqual({ present: false, raw: null });
    const got = new Uint8Array(await back.blobs.get('img-1')!.arrayBuffer());
    expect(got).toEqual(bytes);
    expect(back.blobs.get('img-1')!.type).toBe('image/png');
  });

  it('includes recovery instructions', async () => {
    const { createBackupZip } = await import('./legacyBundle');
    const { readZip } = await import('./zip');
    const zip = await createBackupZip({ bundle: bundle(), blobs: new Map() });
    const readme = readZip(zip).find((e) => e.name === 'README.txt')!;
    expect(new TextDecoder().decode(readme.data)).toContain('RESTORE');
  });

  it('rejects a zip that is not a Taybah backup', async () => {
    const { parseBackupZip } = await import('./legacyBundle');
    const { createZip } = await import('./zip');
    const other = createZip([{ name: 'x.txt', data: new TextEncoder().encode('x') }]);
    expect(() => parseBackupZip(other)).toThrow(/manifest/);
  });

  it('rejects a backup whose image bytes are missing', async () => {
    const { parseBackupZip } = await import('./legacyBundle');
    const { createZip } = await import('./zip');
    const b = { ...bundle(), images: [{ id: 'i', name: 'n', type: 'image/png', size: 1, createdAt: '', file: 'images/i.png' }] };
    const zip = createZip([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(b)) }]);
    expect(() => parseBackupZip(zip)).toThrow(/image bytes missing/);
  });
});

describe('readLegacyFromBrowser', () => {
  it('captures raw localStorage values without modifying or clearing them', async () => {
    const store = memoryStorage({
      'taybah:catalog': '{"products":[]}',
      'taybah:navigation': '{"main":[],"footer":[]}',
    });
    vi.stubGlobal('localStorage', store);
    const { readLegacyFromBrowser } = await import('./legacyBundle');
    const src = await readLegacyFromBrowser();
    expect(src.bundle.storage.catalog).toEqual({ present: true, raw: '{"products":[]}' });
    expect(src.bundle.storage.attributes.present).toBe(false);
    // read-only: nothing removed or rewritten
    expect(store.getItem('taybah:catalog')).toBe('{"products":[]}');
    expect(store.length).toBe(2);
  });

  it('collects image bytes from the legacy image store when available', async () => {
    vi.resetModules();
    vi.doMock('../../shared/assets/imageStore', () => ({
      listImageAssets: async () => [
        { id: 'a1', name: 'one.png', type: 'image/png', size: 4, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'gone', name: 'gone.png', type: 'image/png', size: 4, createdAt: '2026-01-01T00:00:00Z' },
      ],
      getImageBlob: async (id: string) => (id === 'a1' ? new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) : undefined),
      localImageRef: (id: string) => `local:${id}`,
    }));
    vi.stubGlobal('localStorage', memoryStorage());
    const { readLegacyFromBrowser } = await import('./legacyBundle');
    const src = await readLegacyFromBrowser();
    vi.doUnmock('../../shared/assets/imageStore');
    expect(src.bundle.images.map((i) => i.id)).toEqual(['a1']); // unreadable one is skipped, not fatal
    expect(src.bundle.images[0].file).toBe('images/a1.png');
    expect(src.blobs.get('a1')!.size).toBe(4);
  });
});
