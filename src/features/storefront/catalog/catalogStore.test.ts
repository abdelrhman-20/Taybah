import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from './catalogData';
import type { GuestOrder, OrderLine } from '../checkout/orderStore';
import { catalogCategories, catalogCollections } from './catalogData';
import { freshBackend } from '../../../test/harness';

const seed = { categories: catalogCategories, collections: catalogCollections };

// Dedicated coverage for catalogStore's product-level behavior: public
// discoverability, and — the focus of Step 11B — productReferenceInfo and
// removeProduct's deletion-safety contract (never blocked, never corrupts
// historical order snapshots). Store modules are loaded fresh per test
// against an isolated FAKE backend (client.mock.ts) and an isolated cart
// storage so cart/wishlist/homepage/order state never leaks between tests.
// The catalog starts INITIALIZED (as after a completed migration) with the
// built-in categories and collections; products are written through the
// store like the admin does, so every mutation is awaited.

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
  const docs = await import('./catalogDocs');
  const catalog = await import('./catalogStore');
  const orders = await import('../checkout/orderStore');
  const cart = await import('../cart/useCart');
  const wishlist = await import('../wishlist/useWishlist');
  const home = await import('../home/homeStore');
  await docs.whenDocsSettled();
  await home.refreshHomeContent();
  // As after a completed migration: flag set, taxonomy present, no products.
  b.setInitialized(true);
  for (const c of seed.categories) b.putDoc('category', c.slug, c, { slug: c.slug, visible: c.visible, sort_order: c.order });
  for (const c of seed.collections) b.putDoc('collection', c.slug, c, { slug: c.slug, visible: c.visible, sort_order: c.order });
  await docs.refreshDocs();
  return { b, docs, catalog, orders, cart, wishlist, home };
}

beforeEach(() => {
  storage = memoryStorage();
});

// ---- fixtures ---------------------------------------------------------------

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
  colors: ['burgundy'],
  materials: [],
  size: 'medium',
  sizes: ['medium'],
  createdAt: '2025-01-01',
  featured: false,
  published: true,
  isNew: false,
  image: 'img',
  imageHover: 'img',
  images: ['img'],
  ...over,
});

const orderLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  productId: 'p1',
  slug: 'test-rug',
  name: { ar: 'سجادة اختبار', en: 'Test Rug' },
  color: 'burgundy',
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

describe('productIsPublic / publicProducts', () => {
  it('a published product in a visible category and collection is public', async () => {
    const { catalog } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    const state = catalog.getCatalog();
    expect(catalog.productIsPublic(p, state)).toBe(true);
    expect(catalog.publicProducts(state).map((x) => x.id)).toContain('p1');
  });

  it('an unpublished product is never public, even in a visible taxonomy', async () => {
    const { catalog } = await stores();
    const p = product({ published: false });
    await catalog.upsertProduct(p);
    const state = catalog.getCatalog();
    expect(catalog.productIsPublic(p, state)).toBe(false);
    expect(catalog.publicProducts(state).map((x) => x.id)).not.toContain('p1');
  });

  it('a product in a hidden category is never public even when published', async () => {
    const { catalog } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    await catalog.upsertCategory({
      slug: 'rugs',
      name: { ar: 'سجاد', en: 'Rugs' },
      description: { ar: '', en: '' },
      image: 'img',
      visible: false,
      order: 1,
    });
    const state = catalog.getCatalog();
    expect(catalog.productIsPublic(p, state)).toBe(false);
  });
});

describe('productReferenceInfo (Step 11B)', () => {
  it('reports all-zero when nothing touches the product', async () => {
    const { catalog } = await stores();
    await catalog.upsertProduct(product());
    expect(catalog.productReferenceInfo('p1')).toEqual({
      cartLines: 0,
      wishlisted: false,
      homepageFeatured: false,
      historicalOrders: 0,
    });
  });

  it('counts an active cart line referencing the product', async () => {
    const { catalog, cart } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    cart.addToCart(p, { color: 'burgundy', size: null }, 1);
    expect(catalog.productReferenceInfo('p1').cartLines).toBe(1);
  });

  it('detects a wishlist save', async () => {
    const { catalog, wishlist } = await stores();
    await catalog.upsertProduct(product());
    wishlist.toggleWishlist('p1');
    expect(catalog.productReferenceInfo('p1').wishlisted).toBe(true);
  });

  it('detects homepage featured-product usage', async () => {
    const { catalog, home } = await stores();
    await catalog.upsertProduct(product());
    await home.updateHomeSection('products', { ...home.getHomeContent().products, productIds: ['p1'] });
    expect(catalog.productReferenceInfo('p1').homepageFeatured).toBe(true);
  });

  it('counts historical orders referencing the product, purely informationally', async () => {
    const { catalog, orders } = await stores();
    await catalog.upsertProduct(product());
    await orders.saveOrder(order([orderLine()]));
    await orders.saveOrder(order([orderLine({ productId: 'other' })], 'TYB-2025-OTHER'));
    expect(catalog.productReferenceInfo('p1').historicalOrders).toBe(1);
  });

  it('counts every kind of reference at once without double counting across types', async () => {
    const { catalog, cart, wishlist, home, orders } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    cart.addToCart(p, { color: 'burgundy', size: null }, 1);
    wishlist.toggleWishlist('p1');
    await home.updateHomeSection('products', { ...home.getHomeContent().products, productIds: ['p1'] });
    await orders.saveOrder(order([orderLine()]));
    expect(catalog.productReferenceInfo('p1')).toEqual({
      cartLines: 1,
      wishlisted: true,
      homepageFeatured: true,
      historicalOrders: 1,
    });
  });
});

describe('removeProduct never blocks on references (Step 11B)', () => {
  it('removes the product even while it has active cart/wishlist/homepage references', async () => {
    const { catalog, cart, wishlist, home } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    cart.addToCart(p, { color: 'burgundy', size: null }, 1);
    wishlist.toggleWishlist('p1');
    await home.updateHomeSection('products', { ...home.getHomeContent().products, productIds: ['p1'] });

    await catalog.removeProduct('p1');

    expect(catalog.getCatalog().products.find((x) => x.id === 'p1')).toBeUndefined();
  });

  it('removes the product even with historical orders referencing it', async () => {
    const { catalog, orders } = await stores();
    await catalog.upsertProduct(product());
    await orders.saveOrder(order([orderLine()]));

    await catalog.removeProduct('p1');

    expect(catalog.getCatalog().products.find((x) => x.id === 'p1')).toBeUndefined();
  });

  it('never rewrites a historical order snapshot after deleting the referenced product', async () => {
    const { catalog, orders } = await stores();
    await catalog.upsertProduct(product());
    const original = order([
      orderLine({
        productId: 'p1',
        name: { ar: 'سجادة اختبار', en: 'Test Rug' },
        color: 'burgundy',
        qty: 2,
        price: 1000,
        image: 'img',
      }),
    ]);
    await orders.saveOrder(original);

    await catalog.removeProduct('p1');

    const [stored] = orders.getOrders();
    expect(stored.lines).toEqual(original.lines);
    expect(stored.lines[0].name.ar).toBe('سجادة اختبار');
    expect(stored.lines[0].price).toBe(1000);
    expect(stored.lines[0].qty).toBe(2);
    expect(stored.lines[0].image).toBe('img');
    expect(stored.subtotal).toBe(original.subtotal);
  });

  it('leaves the cart line readable and blocked (never deleted) after the product is removed', async () => {
    const { catalog, cart } = await stores();
    const p = product();
    await catalog.upsertProduct(p);
    cart.addToCart(p, { color: 'burgundy', size: null }, 1);

    await catalog.removeProduct('p1');

    const [resolved] = catalog.resolveCartLines(cart.getCartLines(), catalog.getCatalog());
    expect(resolved.block).toBe('unavailable');
    expect(resolved.name?.ar).toBe('سجادة اختبار'); // snapshot survives the live product's removal
    cart.removeLine(resolved.line.key);
    expect(cart.getCartLines()).toHaveLength(0); // still removable
  });

  it('leaves a dangling wishlist id in place — not auto-cleaned, but harmless (filtered at render)', async () => {
    const { catalog, wishlist } = await stores();
    await catalog.upsertProduct(product());
    wishlist.toggleWishlist('p1');

    await catalog.removeProduct('p1');

    // The wishlist store itself doesn't know the product is gone — the
    // storefront's WishlistPage filters unresolved ids when rendering.
    // Confirming this doesn't throw and the id simply stays is the point:
    // deletion never reaches into and mutates the wishlist store.
    expect(wishlist.getWishlistIds().has('p1')).toBe(true);
  });

  it('leaves a dangling homepage featured-product id in place — not auto-cleaned, but harmless (filtered at render)', async () => {
    const { catalog, home } = await stores();
    await catalog.upsertProduct(product());
    await home.updateHomeSection('products', { ...home.getHomeContent().products, productIds: ['p1'] });

    await catalog.removeProduct('p1');

    expect(home.getHomeContent().products.productIds).toEqual(['p1']);
  });
});

describe('persistence (catalog documents)', () => {
  it('serves the built-in catalog read-only until the migration flag is set', async () => {
    const b = await freshBackend('admin');
    vi.stubGlobal('localStorage', storage);
    const docs = await import('./catalogDocs');
    const catalog = await import('./catalogStore');
    await docs.whenDocsSettled();
    expect(catalog.getCatalog().products.length).toBeGreaterThan(5); // seed demo products
    await expect(catalog.upsertProduct(product())).rejects.toMatchObject({ code: 'not_initialized' });
    expect(b.tables.catalog_docs).toHaveLength(0);
  });

  it('after the flag is set, the storefront view comes from the database, not the seed', async () => {
    const { catalog } = await stores();
    expect(catalog.getCatalog().products).toEqual([]);
    await catalog.upsertProduct(product());
    expect(catalog.getCatalog().products.map((p) => p.id)).toEqual(['p1']);
  });

  it('a saved product is stored in the database and read back identically', async () => {
    const { b, catalog } = await stores();
    await catalog.upsertProduct(product({ price: 4321 }));
    const row = b.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === 'p1')!;
    expect(row.slug).toBe('test-rug');
    expect((row.data as { price: number }).price).toBe(4321);
    expect(catalog.getCatalog().products[0].price).toBe(4321);
  });

  it('survives a full reload: a new module graph reads the same product from the database', async () => {
    const { b, catalog } = await stores();
    await catalog.upsertProduct(product({ price: 999 }));
    const dbState = JSON.stringify(b.tables.catalog_docs); // what the server holds
    // "Reload the page": fresh modules, SAME backend contents
    const backendMod = (await import('../../../lib/supabase/client')) as unknown as {
      backend: typeof b;
    };
    const keepTables = b.tables;
    vi.resetModules();
    const b2 = ((await import('../../../lib/supabase/client')) as unknown as { backend: typeof b }).backend;
    b2.reset();
    b2.role = 'anon'; // a visitor in a fresh private window
    b2.tables = keepTables;
    void backendMod;
    const docs2 = await import('./catalogDocs');
    const catalog2 = await import('./catalogStore');
    await docs2.whenDocsSettled();
    expect(catalog2.getCatalog().products.map((p) => [p.id, p.price])).toEqual([['p1', 999]]);
    expect(JSON.stringify(b2.tables.catalog_docs)).toBe(dbState);
  });

  it('new products are listed first (newest first), matching the old array order', async () => {
    const { catalog } = await stores();
    await catalog.upsertProduct(product({ id: 'a', slug: 'a', sku: 'SKU-A' }));
    await catalog.upsertProduct(product({ id: 'b', slug: 'b', sku: 'SKU-B' }));
    await catalog.upsertProduct(product({ id: 'c', slug: 'c', sku: 'SKU-C' }));
    expect(catalog.getCatalog().products.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    // editing keeps the position
    await catalog.upsertProduct(product({ id: 'b', slug: 'b', sku: 'SKU-B', price: 5 }));
    expect(catalog.getCatalog().products.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('a stale form (opened on an older revision) is rejected and the newer copy is kept', async () => {
    const { b, docs, catalog } = await stores();
    await catalog.upsertProduct(product({ price: 100 }));
    const opened = docs.docRevision('product', 'p1');
    await catalog.upsertProduct(product({ price: 200 })); // a second admin saves
    await expect(
      catalog.upsertProduct(product({ price: 300 }), { expectedRevision: opened }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const row = b.tables.catalog_docs.find((d) => d.id === 'p1')!;
    expect((row.data as { price: number }).price).toBe(200);
  });

  it('a duplicate slug is refused and nothing is saved', async () => {
    const { catalog } = await stores();
    await catalog.upsertProduct(product({ id: 'a', slug: 'same' }));
    await expect(catalog.upsertProduct(product({ id: 'b', slug: 'same' }))).rejects.toMatchObject({
      code: 'duplicate_slug',
    });
    expect(catalog.getCatalog().products.map((p) => p.id)).toEqual(['a']);
  });

  it('a signed-in non-admin cannot write (unauthorized), and the catalog is unchanged', async () => {
    const { b, catalog, docs } = await stores();
    await catalog.upsertProduct(product());
    b.signIn('user');
    await docs.refreshDocs();
    await expect(catalog.upsertProduct(product({ price: 1 }))).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(catalog.getCatalog().products[0].price).toBe(1000);
  });

  it('draft (unpublished) products are not delivered to visitors', async () => {
    const { b, catalog, docs } = await stores();
    await catalog.upsertProduct(product({ id: 'live', slug: 'live', sku: 'SKU-LIVE' }));
    await catalog.upsertProduct(product({ id: 'draft', slug: 'draft', sku: 'SKU-DRAFT', published: false }));
    b.signIn('anon');
    await docs.refreshDocs();
    expect(catalog.getCatalog().products.map((p) => p.id)).toEqual(['live']);
  });

  it('removing a category persists the removal', async () => {
    const { b, catalog } = await stores();
    await catalog.removeCategory('rugs');
    expect(b.tables.catalog_docs.some((d) => d.kind === 'category' && d.id === 'rugs')).toBe(false);
    expect(catalog.getCatalog().categories.some((c) => c.slug === 'rugs')).toBe(false);
  });
});
