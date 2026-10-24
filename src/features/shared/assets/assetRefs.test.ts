import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '../../storefront/catalog/catalogData';
import type { GuestOrder, OrderLine } from '../../storefront/checkout/orderStore';
import { catalogCategories, catalogCollections } from '../../storefront/catalog/catalogData';
import { freshBackend } from '../../../test/harness';

// Dedicated coverage for the image-reference scan that gates media-library
// deletion — mirrors attributeStore.ts's reference-scanning tests. Pure
// logic over catalogStore/homeStore/orderStore against the FAKE backend
// (client.mock.ts); no IndexedDB or Storage involved. imageReferences takes
// the full image ref string (`local:<id>` legacy or `media:<path>`).

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

let storage: Storage;

async function stores() {
  const b = await freshBackend('admin');
  vi.stubGlobal('localStorage', storage);
  const docs = await import('../../storefront/catalog/catalogDocs');
  const catalog = await import('../../storefront/catalog/catalogStore');
  const orders = await import('../../storefront/checkout/orderStore');
  const home = await import('../../storefront/home/homeStore');
  const refs = await import('./assetRefs');
  await docs.whenDocsSettled();
  await home.refreshHomeContent();
  // As after a completed migration: initialized catalog with the built-in taxonomy.
  b.setInitialized(true);
  for (const c of catalogCategories) b.putDoc('category', c.slug, c, { slug: c.slug, visible: c.visible, sort_order: c.order });
  for (const c of catalogCollections) b.putDoc('collection', c.slug, c, { slug: c.slug, visible: c.visible, sort_order: c.order });
  await docs.refreshDocs();
  return { b, catalog, orders, home, refs };
}

beforeEach(() => {
  storage = memoryStorage();
});

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p1',
  slug: 'test-rug',
  sku: 'TYB-P1',
  name: { ar: 'سجادة اختبار', en: 'Test Rug' },
  description: { ar: '', en: '' },
  category: 'rugs',
  collection: 'diwan',
  price: 1000,
  compareAtPrice: null,
  availability: 'in_stock',
  colors: [],
  materials: [],
  size: 'medium',
  sizes: ['medium'],
  createdAt: '2025-01-01',
  featured: false,
  published: true,
  isNew: false,
  image: 'local:asset-1',
  imageHover: 'img',
  images: ['img'],
  ...over,
});

const orderLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  productId: 'p1',
  slug: 'test-rug',
  name: { ar: 'سجادة اختبار', en: 'Test Rug' },
  color: null,
  size: null,
  qty: 1,
  price: 1000,
  image: 'img',
  ...over,
});

const order = (lines: OrderLine[], ref = 'TYB-2025-TEST'): GuestOrder => ({
  id: ref,
  ref,
  createdAt: '2025-10-01T00:00:00.000Z',
  status: 'pending',
  contact: { name: 'ضيف', phone: '01000000000', email: 'g@x.co' },
  address: {
    country: 'EG',
    governorate: 'Cairo',
    city: 'c',
    street: 's',
    building: 'b',
    apartment: '',
    instructions: '',
  },
  delivery: { method: 'standard' },
  lines,
  subtotal: 1000,
  total: 1000,
});

describe('imageReferences', () => {
  it('returns no references for an asset nothing points to', async () => {
    const { refs } = await stores();
    expect(refs.imageReferences('local:unused-asset')).toEqual([]);
  });

  it('detects a product\'s primary image', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertProduct(product({ image: 'local:asset-1' }));
    expect(refs.imageReferences('local:asset-1')).toEqual([expect.stringContaining('سجادة اختبار')]);
  });

  it('detects a product\'s hover image and gallery images independently', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertProduct(
      product({ id: 'p2', image: 'other', imageHover: 'local:asset-2', images: ['local:asset-3'] }),
    );
    expect(refs.imageReferences('local:asset-2').length).toBe(1);
    expect(refs.imageReferences('local:asset-3').length).toBe(1);
  });

  it('detects a variant-specific image, labeled with the variant SKU', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertProduct(
      product({
        id: 'p3',
        image: 'other',
        variantAxes: ['color'],
        variants: [
          {
            id: 'v1',
            sku: 'V-1',
            combo: { color: 'burgundy' },
            price: null,
            compareAtPrice: null,
            stockQuantity: null,
            availability: 'in_stock',
            image: 'local:asset-4',
            active: true,
          },
        ],
      }),
    );
    const uses = refs.imageReferences('local:asset-4');
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain('V-1');
  });

  it('detects a category or collection image', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertCategory({
      slug: 'rugs',
      name: { ar: 'سجاد', en: 'Rugs' },
      description: { ar: '', en: '' },
      image: 'local:asset-5',
      visible: true,
      order: 1,
    });
    expect(refs.imageReferences('local:asset-5')).toEqual([expect.stringContaining('تصنيف')]);
  });

  it('detects every homepage section image independently', async () => {
    const { home, refs } = await stores();
    const hero = home.getHomeContent().hero;
    await home.updateHomeSection('hero', {
      slides: [{ ...hero.slides[0], image: 'local:asset-hero' }, ...hero.slides.slice(1)],
    });
    await home.updateHomeSection('brand', { ...home.getHomeContent().brand, image: 'local:asset-brand' });
    expect(refs.imageReferences('local:asset-hero')).toEqual([expect.stringContaining('البطل')]);
    expect(refs.imageReferences('local:asset-brand')).toEqual([expect.stringContaining('العلامة')]);
  });

  it('detects a historical order line\'s snapshotted image', async () => {
    const { orders, refs } = await stores();
    await orders.saveOrder(order([orderLine({ image: 'local:asset-order' })]));
    expect(refs.imageReferences('local:asset-order')).toEqual([expect.stringContaining('TYB-2025-TEST')]);
  });

  it('detects images used by the story, category-card and collection-card sections', async () => {
    const { home, refs } = await stores();
    const c = home.getHomeContent();
    await home.updateHomeSection('story', { ...c.story, image: 'local:asset-story' });
    await home.updateHomeSection('shopCategories', {
      ...home.getHomeContent().shopCategories,
      cards: [{ slug: 'rugs', title: '', subtitle: '', image: 'local:asset-cat' }],
    });
    await home.updateHomeSection('collections', {
      ...home.getHomeContent().collections,
      cards: [{ slug: 'diwan', title: '', description: '', image: 'local:asset-coll' }],
    });
    expect(refs.imageReferences('local:asset-story')).toHaveLength(1);
    expect(refs.imageReferences('local:asset-cat')).toHaveLength(1);
    expect(refs.imageReferences('local:asset-coll')).toHaveLength(1);
  });

  it('aggregates multiple distinct references to the same asset', async () => {
    const { catalog, orders, refs } = await stores();
    await catalog.upsertProduct(product({ image: 'local:asset-shared' }));
    await orders.saveOrder(order([orderLine({ image: 'local:asset-shared' })]));
    expect(refs.imageReferences('local:asset-shared')).toHaveLength(2);
  });
});

describe('media deletion protection (Step 11C Part B)', () => {
  it('a referenced asset is reported as blocked (non-empty references) so the Admin UI refuses deletion', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertProduct(product({ image: 'local:asset-1' }));
    const uses = refs.imageReferences('local:asset-1');
    expect(uses.length).toBeGreaterThan(0); // AdminMediaPage treats non-empty as `blocked`
  });

  it('an unreferenced asset reports zero uses so deletion is allowed', async () => {
    const { refs } = await stores();
    expect(refs.imageReferences('local:orphan-asset')).toHaveLength(0);
  });
});

describe('media: refs (Supabase Storage)', () => {
  it('detects a product image stored as media:<path>', async () => {
    const { catalog, refs } = await stores();
    await catalog.upsertProduct(product({ image: 'media:uploads/abc.webp' }));
    expect(refs.imageReferences('media:uploads/abc.webp')).toEqual([expect.stringContaining('سجادة اختبار')]);
    expect(refs.imageReferences('media:uploads/other.webp')).toEqual([]);
  });

  it('detects a media: ref used by a homepage section', async () => {
    const { home, refs } = await stores();
    await home.updateHomeSection('brand', { ...home.getHomeContent().brand, image: 'media:uploads/brand.webp' });
    expect(refs.imageReferences('media:uploads/brand.webp')).toEqual([expect.stringContaining('العلامة')]);
  });
});
