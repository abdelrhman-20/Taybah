import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct, ProductVariant } from './catalogData';
import type { GuestOrder, OrderLine } from '../checkout/orderStore';
import { filterAttributes, type AttributeDef } from './attributeStore';

// Dedicated coverage for the attribute registry: sanitization/migration,
// mutations, label resolution, and — most importantly — the reference scans
// that gate attribute/value deletion. The scans read catalog, orders, and
// cart stores transitively, so every test boots the four persistence-backed
// modules together against one fresh memory storage.

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
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  const catalog = await import('./catalogStore');
  const orders = await import('../checkout/orderStore');
  const cart = await import('../cart/useCart');
  const attrs = await import('./attributeStore');
  return { catalog, orders, cart, attrs };
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
  compareAtPrice: 1500,
  availability: 'in_stock',
  colors: [],
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

const variant = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'v1',
  sku: 'V-1',
  combo: { color: 'burgundy' },
  price: null,
  compareAtPrice: null,
  stockQuantity: null,
  availability: 'in_stock',
  image: null,
  active: true,
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

const attrDef = (
  key: string,
  values: { key: string; ar: string; enabled?: boolean; hex?: string }[],
  extra: Partial<AttributeDef> = {},
): AttributeDef => ({
  key,
  name: { ar: key, en: key },
  display: 'chips',
  categories: [],
  required: false,
  variationCapable: false,
  filterable: false,
  enabled: true,
  order: 10,
  values: values.map((v, i) => ({
    key: v.key,
    label: { ar: v.ar, en: v.ar },
    ...(v.hex ? { hex: v.hex } : {}),
    enabled: v.enabled !== false,
    order: i + 1,
  })),
  ...extra,
});

// Deterministic catalog — seeds carry real color/material assignments that
// would add noise to reference assertions.
function seedCatalog(products: CatalogProduct[]) {
  storage.setItem(
    'taybah:catalog',
    JSON.stringify({ products, categories: [], collections: [] }),
  );
}

// ---- migration & sanitization -----------------------------------------------

describe('migration and sanitization', () => {
  it('seeds the three reserved attributes with their legacy options intact', async () => {
    const { attrs } = await stores();
    const list = attrs.getAttributes();
    expect(list.map((a) => a.key)).toEqual(['color', 'material', 'size']);
    expect(list[0].display).toBe('swatch');
    expect(list[0].variationCapable).toBe(true);
    expect(list[0].values.some((v) => v.hex)).toBe(true);
    expect(list[1].variationCapable).toBe(false); // material is seeded non-capable
    expect(list[2].display).toBe('chips');
    expect(attrs.attributeValueLabel('material', 'wool', 'ar')).toBe('صوف');
  });

  it('drops malformed records and values, dedupes keys, appends missing defaults', async () => {
    storage.setItem(
      'taybah:attributes',
      JSON.stringify([
        { key: 'BAD KEY!', name: { ar: 'x' } },
        { key: 'empty-name', name: { ar: '' } },
        {
          key: 'weave',
          name: { ar: 'النسيج' },
          display: 'swatch',
          required: true,
          variationCapable: true,
          filterable: true,
          enabled: true,
          order: 1,
          values: [
            { key: 'flat', label: { ar: 'مسطح' }, enabled: true, order: 1 },
            { key: 'UPPER-CASE', label: { ar: 'x' } },
            { key: 'flat', label: { ar: 'مكرر' } },
            { key: 'kilim', label: { ar: 'كليم' }, enabled: false, order: 2 },
          ],
        },
        { key: 'weave', name: { ar: 'مكرر' } },
      ]),
    );
    const { attrs } = await stores();
    const list = attrs.getAttributes();
    expect(list.map((a) => a.key)).toEqual(['weave', 'color', 'material', 'size']);
    const weave = list[0];
    expect(weave.values.map((v) => v.key)).toEqual(['flat', 'kilim']);
    expect(weave.values[1].enabled).toBe(false);
    expect(weave.required).toBe(true);
    expect(weave.filterable).toBe(true);
  });

  it('lets stored admin edits win over the seed definitions', async () => {
    storage.setItem(
      'taybah:attributes',
      JSON.stringify([
        {
          key: 'color',
          name: { ar: 'اللون المعدّل' },
          display: 'chips',
          categories: [],
          enabled: false,
          order: 1,
          values: [],
        },
      ]),
    );
    const { attrs } = await stores();
    const color = attrs.attributeByKey('color')!;
    expect(color.name.ar).toBe('اللون المعدّل');
    expect(color.enabled).toBe(false);
    expect(attrs.getAttributes().map((a) => a.key)).toEqual(['color', 'material', 'size']);
  });
});

// ---- mutations ----------------------------------------------------------------

describe('mutations', () => {
  it('upserts new attributes and replaces existing ones without duplicating keys', async () => {
    const { attrs } = await stores();
    const weave = attrDef('weave', [{ key: 'flat', ar: 'مسطح' }], {
      name: { ar: 'النسيج', en: 'Weave' },
    });
    attrs.upsertAttribute(weave);
    expect(attrs.attributeByKey('weave')?.name.ar).toBe('النسيج');
    attrs.upsertAttribute({ ...weave, name: { ar: 'النسيج الجديد', en: 'Weave' } });
    expect(attrs.getAttributes().filter((a) => a.key === 'weave')).toHaveLength(1);
    expect(attrs.attributeByKey('weave')?.name.ar).toBe('النسيج الجديد');
    expect(
      JSON.parse(storage.getItem('taybah:attributes')!).some(
        (a: { key: string }) => a.key === 'weave',
      ),
    ).toBe(true);
  });

  it('removes an attribute with no references', async () => {
    seedCatalog([product()]);
    const { attrs } = await stores();
    attrs.upsertAttribute(attrDef('weave', [{ key: 'flat', ar: 'مسطح' }]));
    expect(attrs.attributeReferences('weave')).toEqual([]);
    attrs.removeAttribute('weave');
    expect(attrs.attributeByKey('weave')).toBeUndefined();
    expect(
      JSON.parse(storage.getItem('taybah:attributes')!).some(
        (a: { key: string }) => a.key === 'weave',
      ),
    ).toBe(false);
  });
});

// ---- reference scanning -------------------------------------------------------

describe('attribute reference scanning', () => {
  it('returns no references for an unused custom attribute', async () => {
    seedCatalog([product({ attributes: { knot: ['loops'] } })]);
    const { attrs } = await stores();
    expect(attrs.attributeReferences('weave')).toEqual([]);
    expect(attrs.attributeValueReferences('weave', 'flat')).toEqual([]);
  });

  it('flags products assigning through legacy fields and the attributes map', async () => {
    seedCatalog([
      product({ id: 'p1', name: { ar: 'سجادة اللون', en: '' }, colors: ['burgundy'] }),
      product({ id: 'p2', name: { ar: 'سجادة النسيج', en: '' }, attributes: { weave: ['flat'] } }),
      product({ id: 'p3', name: { ar: 'سجادة المقاس', en: '' }, size: 'xl', sizes: [] }),
    ]);
    const { attrs } = await stores();
    expect(attrs.attributeReferences('color')).toEqual(['منتج: سجادة اللون']);
    expect(attrs.attributeReferences('weave')).toEqual(['منتج: سجادة النسيج']);
    // size resolves the union of default + selectable sizes — a product whose
    // only reference is its default size still counts.
    expect(attrs.attributeReferences('size')).toContain('منتج: سجادة المقاس');
    expect(attrs.attributeReferences('size')).toHaveLength(3); // every fixture carries a size
  });

  it('flags variant combos even when the product fields never assign the axis', async () => {
    const v = variant({ sku: 'V-ORPHAN', combo: { weave: 'flat' } });
    seedCatalog([product({ variantAxes: ['weave'], variants: [v] })]);
    const { attrs } = await stores();
    expect(attrs.attributeReferences('weave')).toEqual(['تنويعات في «سجادة اختبار»: V-ORPHAN']);
    expect(attrs.attributeValueReferences('weave', 'flat')).toEqual([
      'تنويعات في «سجادة اختبار»: V-ORPHAN',
    ]);
    expect(attrs.attributeValueReferences('weave', 'kilim')).toEqual([]);
  });

  it('flags order snapshots through options[] axes', async () => {
    seedCatalog([]);
    const { attrs, orders } = await stores();
    await orders.saveOrder(
      order([
        orderLine({
          options: [
            {
              axis: 'weave',
              axisLabel: { ar: 'النسيج', en: 'Weave' },
              value: 'flat',
              valueLabel: { ar: 'مسطح', en: 'Flat' },
            },
          ],
        }),
      ]),
    );
    expect(attrs.attributeReferences('weave')).toEqual(['طلب: TYB-2025-TEST']);
    expect(attrs.attributeValueReferences('weave', 'flat')).toEqual(['طلب: TYB-2025-TEST']);
    expect(attrs.attributeValueReferences('weave', 'kilim')).toEqual([]);
  });

  it('flags legacy order lines by reserved color/size keys — once per order', async () => {
    seedCatalog([]);
    const { attrs, orders } = await stores();
    await orders.saveOrder(
      order([
        orderLine({ color: 'burgundy', size: 'large' }),
        orderLine({ color: 'ivory', size: 'large' }),
      ]),
    );
    expect(attrs.attributeReferences('color')).toEqual(['طلب: TYB-2025-TEST']);
    expect(attrs.attributeValueReferences('color', 'burgundy')).toEqual(['طلب: TYB-2025-TEST']);
    expect(attrs.attributeValueReferences('size', 'large')).toEqual(['طلب: TYB-2025-TEST']);
    expect(attrs.attributeValueReferences('size', 'xl')).toEqual([]);
    // 'material' is not a reserved order-line axis — legacy lines never carry it.
    expect(attrs.attributeReferences('material')).toEqual([]);
  });

  it('flags cart lines holding the attribute while they exist', async () => {
    seedCatalog([]);
    const { attrs, cart } = await stores();
    const p = product();
    cart.addToCart(
      p,
      { variant: variant({ sku: 'V-CART', combo: { weave: 'flat' } }) },
      1,
    );
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 1);
    expect(attrs.attributeReferences('weave')).toEqual(['سلة التسوق']);
    expect(attrs.attributeValueReferences('weave', 'flat')).toEqual(['سلة التسوق']);
    expect(attrs.attributeValueReferences('color', 'burgundy')).toEqual(['سلة التسوق']);
    expect(attrs.attributeValueReferences('color', 'ivory')).toEqual([]);
  });
});

// ---- resolution ----------------------------------------------------------------

describe('value resolution and scoping', () => {
  it('routes reserved keys to legacy fields and others to the attributes map', async () => {
    const p = product({
      colors: ['burgundy'],
      materials: ['wool'],
      size: 'xl',
      sizes: ['xl', 'xxl'],
      attributes: { weave: ['flat'], color: ['shadowed'] },
    });
    const { attrs } = await stores();
    expect(attrs.productAxisValues(p, 'color')).toEqual(['burgundy']);
    expect(attrs.productAxisValues(p, 'material')).toEqual(['wool']);
    expect(attrs.productAxisValues(p, 'size')).toEqual(['xl', 'xxl']);
    expect(attrs.productAxisValues(p, 'weave')).toEqual(['flat']);
    expect(attrs.productAxisValues(p, 'unknown-attr')).toEqual([]);
  });

  it('keeps disabled attributes and values label-resolvable but unselectable', async () => {
    const { attrs } = await stores();
    attrs.upsertAttribute(
      attrDef('weave', [
        { key: 'flat', ar: 'مسطح' },
        { key: 'kilim', ar: 'كليم', enabled: false },
      ]),
    );
    expect(attrs.enabledValues('weave').map((v) => v.key)).toEqual(['flat']);
    // Disabled values still resolve — historical orders, cart lines, and
    // product assignments must keep their Arabic label.
    expect(attrs.attributeValueLabel('weave', 'kilim', 'ar')).toBe('كليم');
    expect(attrs.attributeValueLabel('weave', 'missing', 'ar')).toBe('missing');

    attrs.saveAttributes(
      attrs.getAttributes().map((a) => (a.key === 'weave' ? { ...a, enabled: false } : a)),
    );
    expect(attrs.enabledValues('weave')).toEqual([]);
    expect(attrs.attributeValueLabel('weave', 'flat', 'ar')).toBe('مسطح');
  });

  it('scopes attributes by category, enabled state, and order', async () => {
    const { attrs } = await stores();
    attrs.saveAttributes([
      ...attrs.getAttributes(),
      attrDef('rugs-only', [{ key: 'x', ar: 'س' }], { categories: ['rugs'], order: 4 }),
      attrDef('everywhere', [{ key: 'y', ar: 'ص' }], { order: 5 }),
      attrDef('off', [{ key: 'z', ar: 'ع' }], { enabled: false, order: 6 }),
    ]);
    expect(attrs.attributesForCategory('rugs').map((a) => a.key)).toEqual([
      'color',
      'material',
      'size',
      'rugs-only',
      'everywhere',
    ]);
    expect(attrs.attributesForCategory('bedding').map((a) => a.key)).toEqual([
      'color',
      'material',
      'size',
      'everywhere',
    ]);
  });
});

// ---- admin list filtering -------------------------------------------------------

describe('filterAttributes', () => {
  const list = (): AttributeDef[] => [
    attrDef('color', [{ key: 'burgundy', ar: 'عنابي' }], {
      name: { ar: 'اللون', en: 'Color' },
      order: 1,
    }),
    attrDef('weave', [{ key: 'flat-weave', ar: 'نسيج مسطح' }], {
      name: { ar: 'النسيج', en: 'Weave' },
      enabled: false,
      order: 2,
    }),
    attrDef('pile', [{ key: 'high-pile', ar: 'وبر عالٍ' }], {
      name: { ar: 'الوبر', en: 'Pile' },
      order: 3,
    }),
  ];

  it('matches by Arabic attribute name', () => {
    expect(filterAttributes(list(), 'النسيج').map((a) => a.key)).toEqual(['weave']);
    expect(filterAttributes(list(), 'نسيج مسطح').map((a) => a.key)).toEqual(['weave']);
  });

  it('matches technical keys case-insensitively', () => {
    expect(filterAttributes(list(), 'WEAVE').map((a) => a.key)).toEqual(['weave']);
    expect(filterAttributes(list(), 'High-Pile').map((a) => a.key)).toEqual(['pile']);
  });

  it('matches by Arabic value label and value key', () => {
    expect(filterAttributes(list(), 'عنابي').map((a) => a.key)).toEqual(['color']);
    expect(filterAttributes(list(), 'burgundy').map((a) => a.key)).toEqual(['color']);
  });

  it('filters enabled and disabled statuses', () => {
    expect(filterAttributes(list(), '', 'enabled').map((a) => a.key)).toEqual([
      'color',
      'pile',
    ]);
    expect(filterAttributes(list(), '', 'disabled').map((a) => a.key)).toEqual(['weave']);
    expect(filterAttributes(list(), '', 'all')).toHaveLength(3);
  });

  it('combines query and status filters', () => {
    expect(filterAttributes(list(), 'نسيج', 'disabled').map((a) => a.key)).toEqual([
      'weave',
    ]);
    expect(filterAttributes(list(), 'نسيج', 'enabled')).toEqual([]);
    expect(filterAttributes(list(), 'عنابي', 'disabled')).toEqual([]);
  });

  it('returns empty for unmatched queries and trims whitespace', () => {
    expect(filterAttributes(list(), 'لا شيء')).toEqual([]);
    expect(filterAttributes(list(), '  النسيج  ').map((a) => a.key)).toEqual(['weave']);
  });

  it('preserves input order without mutating the list', () => {
    const src = list();
    const before = src.map((a) => a.order);
    const out = filterAttributes(src, '');
    expect(out.map((a) => a.key)).toEqual(['color', 'weave', 'pile']);
    expect(src.map((a) => a.order)).toEqual(before);
  });
});

// ---- storefront display safety (Step 10D-3) --------------------------------
// visibleAssignedValues drives every LIVE customer-facing specs/attribute
// row (PDP specs table, material/color/size, custom attributes) — it must
// never surface a disabled attribute or disabled value as current product
// information, while leaving the product's own stored assignment untouched.

describe('visibleAssignedValues', () => {
  it('passes through every assigned value when the attribute and all values are enabled', async () => {
    const { attrs } = await stores();
    expect(attrs.visibleAssignedValues('color', ['burgundy', 'ivory'])).toEqual([
      'burgundy',
      'ivory',
    ]);
  });

  it('drops a disabled value while keeping the still-enabled ones, in original order', async () => {
    const { attrs } = await stores();
    attrs.saveAttributes(
      attrs
        .getAttributes()
        .map((a) =>
          a.key === 'color'
            ? { ...a, values: a.values.map((v) => (v.key === 'ivory' ? { ...v, enabled: false } : v)) }
            : a,
        ),
    );
    expect(attrs.visibleAssignedValues('color', ['burgundy', 'ivory', 'sand'])).toEqual([
      'burgundy',
      'sand',
    ]);
  });

  it('returns nothing once the whole attribute is disabled, even if values stay enabled', async () => {
    const { attrs } = await stores();
    attrs.saveAttributes(
      attrs.getAttributes().map((a) => (a.key === 'material' ? { ...a, enabled: false } : a)),
    );
    expect(attrs.visibleAssignedValues('material', ['wool', 'cotton'])).toEqual([]);
  });

  it('returns nothing for an attribute key that no longer exists', async () => {
    const { attrs } = await stores();
    expect(attrs.visibleAssignedValues('ghost-attribute', ['x'])).toEqual([]);
  });

  it('never mutates the product-held key list it filters', async () => {
    const { attrs } = await stores();
    attrs.saveAttributes(
      attrs
        .getAttributes()
        .map((a) =>
          a.key === 'color'
            ? { ...a, values: a.values.map((v) => (v.key === 'ivory' ? { ...v, enabled: false } : v)) }
            : a,
        ),
    );
    const assigned = ['burgundy', 'ivory', 'sand'];
    const visible = attrs.visibleAssignedValues('color', assigned);
    expect(visible).toEqual(['burgundy', 'sand']);
    expect(assigned).toEqual(['burgundy', 'ivory', 'sand']); // the product's own assignment is untouched
  });
});
