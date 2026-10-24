import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttributeDef } from './attributeStore';
import {
  catalogCategories,
  catalogCollections,
  catalogProducts,
  type CatalogProduct,
  type ProductVariant,
} from './catalogData';
import type { CatalogState } from './catalogStore';
import {
  MAX_VARIANT_AXES,
  MAX_VARIANT_COMBINATIONS,
  activeAxisValues,
  axisProductValues,
  axisValueEnabled,
  axisValuesForAxes,
  canDeleteVariant,

  comboComplete,
  comboKey,
  combinationCount,
  combosEqual,
  comboValuesEnabled,
  comboValuesValid,
  deriveAxisSelections,
  generateVariantCombos,
  hasDuplicateCombos,
  hasPurchasableVariant,
  initialVariantSelection,
  isVariantReferencedByOrders,
  isVariantProduct,
  newVariantId,
  normalizeSku,
  offeredAxisValues,
  orderLineMayReferenceVariant,
  productOrderReferences,
  reconcileSelection,
  resolveSelectedVariant,
  selectionComplete,
  sellableVariantAxes,
  sanitizeVariantFields,
  singlePurchasableVariant,
  skuTaken,
  suggestVariantSku,
  syncVariantMatrix,
  validateProductVariants,
  validVariantAxes,
  variantAvailability,
  variantByCombo,
  variantById,
  variantCompareAtPrice,
  variantOrderReferences,
  variantPrice,
  variantPricingValid,
  variantPurchasable,
  withoutDisabledSelections,
} from './variants';
import type { GuestOrder } from '../checkout/orderStore';

// ---- fixtures ---------------------------------------------------------------

const attr = (
  key: string,
  values: string[],
  extra: Partial<AttributeDef> = {},
): AttributeDef => ({
  key,
  name: { ar: key, en: key },
  display: 'chips',
  categories: [],
  required: false,
  variationCapable: true,
  filterable: false,
  enabled: true,
  order: 1,
  values: values.map((k, i) => ({
    key: k,
    label: { ar: k, en: k },
    enabled: true,
    order: i + 1,
  })),
  ...extra,
});

const ATTRS = [
  attr('color', ['burgundy', 'ivory', 'sand']),
  attr('size', ['small', 'medium', 'large', 'xl']),
];

const baseProduct = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
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
  id: newVariantId(),
  sku: 'TYB-P1-V1',
  combo: { color: 'burgundy', size: 'large' },
  price: null,
  compareAtPrice: null,
  stockQuantity: null,
  availability: 'in_stock',
  image: null,
  active: true,
  ...over,
});

const order = (lines: GuestOrder['lines']): GuestOrder => ({
  id: 'o1',
  ref: 'TYB-2025-TEST',
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

const orderLine = (
  productId: string,
  color: string | null,
  size: string | null,
): GuestOrder['lines'][number] => ({
  productId,
  slug: 'test-rug',
  name: { ar: 'سجادة اختبار', en: 'Test Rug' },
  color,
  size,
  qty: 1,
  price: 1000,
  image: 'img',
});

// ---- identity & combination normalization -----------------------------------

describe('combination normalization', () => {
  it('normalizes combo keys by sorting axes consistently', () => {
    expect(comboKey({ size: 'large', color: 'burgundy' })).toBe(
      comboKey({ color: 'burgundy', size: 'large' }),
    );
    expect(comboKey({ color: 'burgundy', size: 'large' })).not.toBe(
      comboKey({ color: 'ivory', size: 'large' }),
    );
  });

  it('compares combinations regardless of key order', () => {
    expect(
      combosEqual({ size: 'large', color: 'burgundy' }, { color: 'burgundy', size: 'large' }),
    ).toBe(true);
    expect(combosEqual({ color: 'burgundy' }, { color: 'ivory' })).toBe(false);
  });

  it('finds a variant by normalized combo', () => {
    const v = variant();
    const p = baseProduct({ variantAxes: ['color', 'size'], variants: [v] });
    expect(variantByCombo(p, { size: 'large', color: 'burgundy' })?.id).toBe(v.id);
    expect(variantByCombo(p, { color: 'ivory', size: 'large' })).toBeUndefined();
  });

  it('generates stable unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newVariantId()));
    expect(ids.size).toBe(200);
  });
});

// ---- axis & completeness validation -----------------------------------------

describe('axis and combo validation', () => {
  it('accepts 1–3 unique axes and rejects 0 or more than 3', () => {
    expect(validVariantAxes(['color'])).toBe(true);
    expect(validVariantAxes(['color', 'size'])).toBe(true);
    expect(validVariantAxes(['a', 'b', 'c'])).toBe(true);
    expect(validVariantAxes([])).toBe(false);
    expect(validVariantAxes(['a', 'b', 'c', 'd'])).toBe(false);
    expect(validVariantAxes(['color', 'color'])).toBe(false);
  });

  it('requires every axis exactly once in a complete combo', () => {
    const axes = ['color', 'size'];
    expect(comboComplete({ color: 'burgundy', size: 'large' }, axes)).toBe(true);
    expect(comboComplete({ color: 'burgundy' }, axes)).toBe(false);
    expect(comboComplete({ color: 'burgundy', size: 'large', material: 'wool' }, axes)).toBe(false);
    expect(comboComplete({ color: '', size: 'large' }, axes)).toBe(false);
  });

  it('validates combo values against the attribute registry', () => {
    expect(comboValuesValid({ color: 'burgundy', size: 'large' }, ATTRS)).toBe(true);
    expect(comboValuesValid({ color: 'not-a-color', size: 'large' }, ATTRS)).toBe(false);
    expect(comboValuesValid({ origin: 'egypt' }, ATTRS)).toBe(false);
  });
});

// ---- combination counting & generation ---------------------------------------

describe('combination generation', () => {
  it('calculates the theoretical combination count', () => {
    expect(
      combinationCount(['color', 'size'], {
        color: ['burgundy', 'ivory', 'sand'],
        size: ['small', 'medium', 'large', 'xl'],
      }),
    ).toBe(12);
    expect(combinationCount(['color'], { color: [] })).toBe(0);
  });

  it('generates the full cartesian product in stable order', () => {
    const combos = generateVariantCombos(['color', 'size'], {
      color: ['burgundy', 'ivory'],
      size: ['large', 'xl'],
    });
    expect(combos).toEqual([
      { color: 'burgundy', size: 'large' },
      { color: 'burgundy', size: 'xl' },
      { color: 'ivory', size: 'large' },
      { color: 'ivory', size: 'xl' },
    ]);
  });

  it('enforces the maximum of 3 axes and 60 combinations', () => {
    expect(MAX_VARIANT_AXES).toBe(3);
    expect(
      generateVariantCombos(['a', 'b', 'c', 'd'], {
        a: ['x'],
        b: ['x'],
        c: ['x'],
        d: ['x'],
      }),
    ).toBeNull();
    expect(
      generateVariantCombos(['a', 'b', 'c'], {
        a: ['1', '2', '3', '4', '5'],
        b: ['1', '2', '3', '4'],
        c: ['1', '2', '3'],
      }),
    ).not.toBeNull();
    // 5 × 4 × 4 = 80 > 60
    expect(
      generateVariantCombos(['a', 'b', 'c'], {
        a: ['1', '2', '3', '4', '5'],
        b: ['1', '2', '3', '4'],
        c: ['1', '2', '3', '4'],
      }),
    ).toBeNull();
  });

  it('rejects generation when an axis has no selected values', () => {
    expect(generateVariantCombos(['color', 'size'], { color: ['ivory'], size: [] })).toBeNull();
    expect(generateVariantCombos(['color'], {})).toBeNull();
  });

  it('generates combinations from three axes deterministically', () => {
    const combos = generateVariantCombos(['color', 'size', 'material'], {
      color: ['ivory', 'sand'],
      size: ['small', 'large'],
      material: ['wool', 'cotton'],
    });
    expect(combos).toHaveLength(8);
    expect(combos![0]).toEqual({ color: 'ivory', size: 'small', material: 'wool' });
    expect(combos![7]).toEqual({ color: 'sand', size: 'large', material: 'cotton' });
    // regenerated output is identical — deterministic axis/value order
    expect(
      generateVariantCombos(['color', 'size', 'material'], {
        color: ['ivory', 'sand'],
        size: ['small', 'large'],
        material: ['wool', 'cotton'],
      }),
    ).toEqual(combos);
  });
});

// ---- pricing -----------------------------------------------------------------

describe('variant pricing', () => {
  it('inherits product price and compare-at price when null', () => {
    const p = baseProduct({ price: 800, compareAtPrice: 1200 });
    const v = variant({ price: null, compareAtPrice: null });
    expect(variantPrice(v, p)).toBe(800);
    expect(variantCompareAtPrice(v, p)).toBe(1200);
  });

  it('uses explicit variant prices when set', () => {
    const p = baseProduct();
    const v = variant({ price: 950, compareAtPrice: 1400 });
    expect(variantPrice(v, p)).toBe(950);
    expect(variantCompareAtPrice(v, p)).toBe(1400);
  });

  it('rejects negative prices and compare-at <= selling price', () => {
    const p = baseProduct({ price: 1000, compareAtPrice: null });
    expect(variantPricingValid(variant({ price: -5 }), p)).toBe(false);
    expect(variantPricingValid(variant({ price: 0 }), p)).toBe(true);
    expect(variantPricingValid(variant({ price: 900, compareAtPrice: 900 }), p)).toBe(false);
    expect(variantPricingValid(variant({ price: 900, compareAtPrice: 901 }), p)).toBe(true);
    // Inherited compareAt (1500) vs overridden price (2000) also fails.
    expect(variantPricingValid(variant({ price: 2000 }), p)).toBe(true);
    expect(variantPricingValid(variant({ price: 2000 }), baseProduct({ compareAtPrice: 1500 }))).toBe(
      false,
    );
  });
});

// ---- availability & purchasability ----------------------------------------------

describe('variant availability', () => {
  it('exposes the manual availability field as-is', () => {
    expect(variantAvailability(variant({ availability: 'in_stock' }))).toBe('in_stock');
    expect(variantAvailability(variant({ availability: 'low_stock' }))).toBe('low_stock');
    expect(variantAvailability(variant({ availability: 'out_of_stock' }))).toBe('out_of_stock');
  });

  it('blocks purchasing only when manually out of stock or inactive', () => {
    expect(variantPurchasable(variant({ availability: 'out_of_stock' }))).toBe(false);
    expect(variantPurchasable(variant({ availability: 'low_stock' }))).toBe(true);
    expect(variantPurchasable(variant({ availability: 'in_stock' }))).toBe(true);
    expect(variantPurchasable(variant({ active: false }))).toBe(false);
    expect(variantPurchasable(variant({ active: false, availability: 'out_of_stock' }))).toBe(
      false,
    );
  });
});

// ---- SKU uniqueness ------------------------------------------------------------

describe('SKU uniqueness', () => {
  it('detects collisions between product SKUs and variant SKUs', () => {
    const other = baseProduct({ id: 'p2', sku: 'TYB-P2' });
    const vp = baseProduct({
      id: 'p3',
      sku: 'TYB-P3',
      variantAxes: ['color'],
      variants: [variant({ sku: 'TYB-V-1' })],
    });
    const all = [other, vp];

    expect(skuTaken('TYB-P2', all)).toBe(true); // product → product
    expect(skuTaken('tyb-v-1', all)).toBe(true); // case-insensitive variant hit
    expect(skuTaken('  TYB-V-1 ', all)).toBe(true); // trimmed
    expect(skuTaken('TYB-P3', all)).toBe(true); // variant product's own SKU
    expect(skuTaken('TYB-NEW', all)).toBe(false);
    expect(skuTaken('   ', all)).toBe(false); // empty never matches
  });

  it('excludes the current product and variant while editing', () => {
    const v1 = variant({ id: 'v1', sku: 'TYB-V-1' });
    const v2 = variant({ id: 'v2', sku: 'TYB-V-2' });
    const p = baseProduct({ variantAxes: ['color'], variants: [v1, v2] });

    expect(skuTaken('TYB-P1', [p], { productId: 'p1' })).toBe(false); // own product SKU
    expect(skuTaken('TYB-V-1', [p], { variantId: 'v1' })).toBe(false); // own variant SKU
    expect(skuTaken('TYB-V-1', [p], { variantId: 'v2' })).toBe(true); // sibling still collides
    expect(skuTaken('TYB-P1', [p], { variantId: 'v1' })).toBe(true); // product SKU vs variant
  });
});

// ---- validateProductVariants ---------------------------------------------------

describe('validateProductVariants', () => {
  it('returns no issues for healthy simple and variant products', () => {
    expect(validateProductVariants(baseProduct(), ATTRS, [])).toEqual([]);
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ sku: 'V-1', combo: { color: 'burgundy', size: 'large' } }),
        variant({ sku: 'V-2', combo: { color: 'ivory', size: 'large' } }),
      ],
    });
    expect(validateProductVariants(p, ATTRS, [p])).toEqual([]);
  });

  it('rejects incomplete and unknown-value combinations', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ combo: { color: 'burgundy' } }),
        variant({ sku: 'V-2', combo: { color: 'burgundy', size: 'large', material: 'wool' } }),
        variant({ sku: 'V-3', combo: { color: 'burgundy', size: 'huge' } }),
      ],
    });
    const codes = validateProductVariants(p, ATTRS, [p]).map((i) => i.code);
    expect(codes).toContain('combo_incomplete');
    expect(codes.filter((c) => c === 'combo_incomplete')).toHaveLength(2);
    expect(codes).toContain('combo_value_unknown');
  });

  it('rejects duplicate combinations by normalized key', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ combo: { color: 'burgundy', size: 'large' } }),
        variant({ sku: 'V-2', combo: { size: 'large', color: 'burgundy' } }),
      ],
    });
    expect(hasDuplicateCombos(p.variants!)).toBe(true);
    const issues = validateProductVariants(p, ATTRS, [p]);
    expect(issues.filter((i) => i.code === 'combo_duplicate')).toHaveLength(1);
  });

  it('enforces the 3-axis and 60-combination limits', () => {
    const manyAxes = baseProduct({
      variantAxes: ['a', 'b', 'c', 'd'],
      variants: [variant()],
    });
    expect(validateProductVariants(manyAxes, ATTRS, []).map((i) => i.code)).toContain(
      'axes_too_many',
    );

    const over = baseProduct({
      variantAxes: ['color'],
      variants: Array.from({ length: MAX_VARIANT_COMBINATIONS + 1 }, (_, i) =>
        variant({ sku: `V-${i}`, combo: { color: `c${i}` } }),
      ),
    });
    expect(validateProductVariants(over, ATTRS, []).map((i) => i.code)).toContain('combo_limit');
  });

  it('flags axes that are unknown, disabled, out of scope, or not variation-capable', () => {
    const scoped = attr('color', ['ivory'], { categories: ['curtains'] });
    const disabled = attr('size', ['large'], { enabled: false });
    const notCapable = attr('material', ['wool'], { variationCapable: false });
    const p = baseProduct({
      variantAxes: ['color', 'size', 'material'],
      variants: [variant({ combo: { color: 'ivory', size: 'large', material: 'wool' } })],
    });
    const codes = validateProductVariants(p, [scoped, disabled, notCapable], [p]).map(
      (i) => i.code,
    );
    expect(codes).toContain('axis_out_of_scope');
    expect(codes).toContain('axis_disabled');
    expect(codes).toContain('axis_not_variation_capable');
    const ghost = baseProduct({ variantAxes: ['origin'], variants: [variant({ combo: { origin: 'x' } })] });
    expect(validateProductVariants(ghost, ATTRS, [ghost]).map((i) => i.code)).toContain(
      'axis_unknown',
    );
  });

  it('flags empty SKUs, duplicate SKUs, and duplicate variant ids', () => {
    const vid = 'dup-id';
    const p = baseProduct({
      variantAxes: ['color'],
      variants: [
        variant({ id: vid, sku: '', combo: { color: 'ivory' } }),
        variant({ id: vid, sku: 'TYB-P1', combo: { color: 'sand' } }), // equals product SKU
      ],
    });
    const codes = validateProductVariants(p, ATTRS, [p]).map((i) => i.code);
    expect(codes).toContain('sku_empty');
    expect(codes).toContain('sku_duplicate');
    expect(codes).toContain('variant_id_duplicate');
  });

  it('flags a product SKU that duplicates a variant SKU elsewhere', () => {
    const vp = baseProduct({
      id: 'p9',
      sku: 'TYB-P9',
      variantAxes: ['color'],
      variants: [variant({ sku: 'SHARED-SKU' })],
    });
    const p = baseProduct({ id: 'p10', sku: 'shared-sku' });
    expect(validateProductVariants(p, ATTRS, [vp, p]).map((i) => i.code)).toContain(
      'product_sku_duplicate',
    );
  });

  it('flags invalid prices and compare-at', () => {
    const p = baseProduct({
      variantAxes: ['color'],
      variants: [
        variant({ price: -1, combo: { color: 'ivory' } }),
        variant({ sku: 'V-2', price: 100, compareAtPrice: 100, combo: { color: 'sand' } }),
      ],
    });
    const codes = validateProductVariants(p, ATTRS, [p]).map((i) => i.code);
    expect(codes).toContain('price_invalid');
    expect(codes).toContain('compare_at_invalid');
  });
});

// ---- order reference safety ------------------------------------------------------

describe('order reference safety', () => {
  const p = baseProduct({
    variantAxes: ['color', 'size'],
    variants: [
      variant({ id: 'v-burgundy-large', sku: 'V-BL', combo: { color: 'burgundy', size: 'large' } }),
      variant({ id: 'v-ivory-large', sku: 'V-IL', combo: { color: 'ivory', size: 'large' } }),
    ],
  });

  it('matches order lines to variants through recorded color/size keys', () => {
    const line = orderLine('p1', 'burgundy', 'large');
    expect(
      orderLineMayReferenceVariant(line, p, variantByCombo(p, { color: 'burgundy', size: 'large' })!),
    ).toBe(true);
    expect(
      orderLineMayReferenceVariant(line, p, variantByCombo(p, { color: 'ivory', size: 'large' })!),
    ).toBe(false);
    expect(
      orderLineMayReferenceVariant(orderLine('other', 'burgundy', 'large'), p, p.variants![0]),
    ).toBe(false);
  });

  it('blocks physical deletion only for referenced variants', () => {
    const orders = [order([orderLine('p1', 'burgundy', 'large')])];
    expect(canDeleteVariant(p, 'v-burgundy-large', orders)).toBe(false);
    expect(isVariantReferencedByOrders(p, 'v-burgundy-large', orders)).toBe(true);
    expect(canDeleteVariant(p, 'v-ivory-large', orders)).toBe(true);
    expect(variantOrderReferences(p, 'v-burgundy-large', orders)).toHaveLength(1);
    expect(variantOrderReferences(p, 'missing-variant', orders)).toEqual([]);
  });

  it('conservatively counts lines that record no axis values as references', () => {
    const orders = [order([orderLine('p1', null, null)])];
    expect(isVariantReferencedByOrders(p, 'v-ivory-large', orders)).toBe(true);
  });

  it('ignores recorded values that are not variant axes of the product', () => {
    // Product varies only on size; order lines recording color alone can't
    // disambiguate — matching on the 'size' axis still works.
    const sizeOnly = baseProduct({
      variantAxes: ['size'],
      variants: [variant({ id: 'v-m', combo: { size: 'medium' } })],
    });
    const orders = [order([orderLine('p1', 'burgundy', 'medium')])];
    expect(isVariantReferencedByOrders(sizeOnly, 'v-m', orders)).toBe(true);
    expect(
      isVariantReferencedByOrders(sizeOnly, 'v-m', [order([orderLine('p1', 'ivory', 'small')])]),
    ).toBe(false);
  });

  it('finds product-level references for legacy orders', () => {
    const orders = [order([orderLine('p1', 'burgundy', 'large')]), order([orderLine('px', null, null)])];
    expect(productOrderReferences('p1', orders)).toHaveLength(1);
    expect(productOrderReferences('nope', orders)).toEqual([]);
  });

  it('matches order lines to variants by exact variantId', () => {
    const line = { ...orderLine('p1', 'burgundy', 'large'), variantId: 'v-burgundy-large' };
    expect(
      orderLineMayReferenceVariant(line, p, variantById(p, 'v-burgundy-large')!),
    ).toBe(true);
    expect(
      orderLineMayReferenceVariant(line, p, variantById(p, 'v-ivory-large')!),
    ).toBe(false);
  });

  it('lets exact variantId matching take precedence over the color/size heuristic', () => {
    // The recorded color/size point at v-burgundy-large, but the snapshot id
    // names v-ivory-large — the id is authoritative.
    const line = { ...orderLine('p1', 'burgundy', 'large'), variantId: 'v-ivory-large' };
    expect(
      orderLineMayReferenceVariant(line, p, variantById(p, 'v-ivory-large')!),
    ).toBe(true);
    expect(
      orderLineMayReferenceVariant(line, p, variantById(p, 'v-burgundy-large')!),
    ).toBe(false);
  });

  it('keeps the historical reference after the variant combo changes', () => {
    const line = { ...orderLine('p1', 'burgundy', 'large'), variantId: 'v-bl' };
    const edited: ProductVariant = {
      ...variant({ id: 'v-bl' }),
      combo: { color: 'ivory', size: 'xl' }, // combo edited post-order
    };
    expect(orderLineMayReferenceVariant(line, p, edited)).toBe(true);
    // Without variantId the same line would fall back to the heuristic.
    const legacy = orderLine('p1', 'burgundy', 'large');
    expect(orderLineMayReferenceVariant(legacy, p, edited)).toBe(false);
  });
});

// ---- migration sanitization -------------------------------------------------------

describe('sanitizeVariantFields', () => {
  it('returns undefined for absent fields so simple products stay untouched', () => {
    expect(sanitizeVariantFields({})).toEqual({ variantAxes: undefined, variants: undefined });
  });

  it('preserves valid stored variant data verbatim', () => {
    const v = variant({ price: 900 });
    const out = sanitizeVariantFields({
      variantAxes: ['color', 'size'],
      variants: [v],
    });
    expect(out.variantAxes).toEqual(['color', 'size']);
    expect(out.variants).toEqual([v]);
  });

  it('repairs malformed records without crashing', () => {
    const out = sanitizeVariantFields({
      variantAxes: 'not-an-array',
      variants: [
        null,
        'junk',
        { id: 'ok', sku: 'V-1', combo: { color: 'ivory', bad: 42 }, price: 'nope', stock: 2 },
        { sku: 'V-NO-ID', combo: { color: 'sand' } },
      ],
    });
    expect(out.variantAxes).toBeUndefined();
    const vs = out.variants!;
    expect(vs).toHaveLength(2);
    expect(vs[0]).toMatchObject({
      id: 'ok',
      sku: 'V-1',
      combo: { color: 'ivory' },
      price: null,
    });
    // Legacy numeric stock fields are dropped — no inventory model exists.
    expect('stock' in vs[0]).toBe(false);
    expect(vs[1].sku).toBe('V-NO-ID');
    expect(vs[1].id).toBeTruthy(); // fresh id assigned, record preserved
  });

  it('dedupes stored duplicate variant ids keeping the first record', () => {
    const out = sanitizeVariantFields({
      variants: [
        { id: 'x', sku: 'FIRST', combo: {} },
        { id: 'x', sku: 'SECOND', combo: {} },
      ],
    });
    expect(out.variants!.map((v) => v.sku)).toEqual(['FIRST']);
  });
});

// ---- store-level integration (localStorage-backed modules) -------------------------

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

async function freshModule<T>(path: string): Promise<T> {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  return (await import(path)) as T;
}

beforeEach(() => {
  storage = memoryStorage();
});

describe('catalog store migration', () => {
  it('keeps seeded products valid; only the demo flatweave rug has (size) variants', async () => {
    const store = await freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
    const attrStore = await freshModule<typeof import('./attributeStore')>('./attributeStore.ts');
    const state = store.getCatalog();
    expect(state.products.length).toBe(catalogProducts.length);
    for (const p of state.products) {
      if (p.id === 'p03') {
        expect(p.variantAxes).toEqual(['size']);
        expect(p.variants).toHaveLength(3);
      } else {
        expect(p.variants).toBeUndefined();
        expect(p.variantAxes).toBeUndefined();
      }
      expect(validateProductVariants(p, attrStore.getAttributes(), state.products)).toEqual([]);
    }
  });

  it('seed sizes: every size key resolves, units are cm, and no generic size pattern is shared', async () => {
    const attrStore = await freshModule<typeof import('./attributeStore')>('./attributeStore.ts');
    const sizeAttr = attrStore.getAttributes().find((a) => a.key === 'size');
    const known = new Map((sizeAttr?.values ?? []).map((v) => [v.key, v]));
    const GENERIC = ['small', 'medium', 'large', 'xl'];
    for (const p of catalogProducts) {
      for (const key of p.sizes) {
        expect(known.has(key), `${p.id} ${key}`).toBe(true);
        expect(GENERIC.includes(key), `${p.id} still uses a generic label`).toBe(false);
        expect(known.get(key)?.label.ar, key).toMatch(/سم/);
      }
      // default size is one of the product's sizes (or both are empty)
      expect(p.sizes.includes(p.size) || (p.size === '' && p.sizes.length === 0), p.id).toBe(true);
    }
    // not one repeated size pattern across unrelated product types
    const byCategory = (cat: string) => new Set(catalogProducts.filter((p) => p.category === cat).flatMap((p) => p.sizes));
    const rugs = byCategory('rugs');
    for (const other of ['curtains', 'furnishings', 'accessories']) {
      for (const k of byCategory(other)) expect(rugs.has(k), `${other} reuses a rug size ${k}`).toBe(false);
    }
  });

  it('keeps dimensions unset where they are not known (fitted carpets, sofa cover, candle set)', () => {
    for (const id of ['p07', 'p08', 'p10', 'p16', 'p24']) {
      const p = catalogProducts.find((x) => x.id === id)!;
      expect(p.sizes, id).toEqual([]);
      expect(p.size, id).toBe('');
    }
  });

  it('demo size variants inherit price and availability — nothing invented', () => {
    const p = catalogProducts.find((x) => x.id === 'p03')!;
    for (const v of p.variants ?? []) {
      expect(v.price).toBeNull();
      expect(v.compareAtPrice).toBeNull();
      expect(v.stockQuantity).toBeNull();
      expect(v.availability).toBe(p.availability);
    }
    expect(new Set((p.variants ?? []).map((v) => v.sku)).size).toBe(3);
  });

  it('a saved size attribute gains missing seeded values without losing its own edits', async () => {
    storage.setItem(
      'taybah:attributes',
      JSON.stringify([
        { key: 'size', name: { ar: 'المقاس', en: 'Size' }, display: 'chips', categories: [], required: false, variationCapable: true, filterable: false, enabled: true, order: 1,
          values: [{ key: 'small', label: { ar: 'صغير جدًا (معدّل)', en: '' }, enabled: false, order: 1 }] },
      ]),
    );
    const attrStore = await freshModule<typeof import('./attributeStore')>('./attributeStore.ts');
    const size = attrStore.getAttributes().find((a) => a.key === 'size')!;
    const small = size.values.find((v) => v.key === 'small')!;
    expect(small.label.ar).toBe('صغير جدًا (معدّل)');
    expect(small.enabled).toBe(false);
    expect(size.values.some((v) => v.key === 'rug-160x230')).toBe(true);
  });

  it('survives a localStorage reload with variant data intact', async () => {
    const v = variant({ id: 'v-fixed', sku: 'TYB-V-9', image: 'local:img9' });
    const p = baseProduct({ variantAxes: ['color', 'size'], variants: [v] });
    storage.setItem(
      'taybah:catalog',
      JSON.stringify({ products: [p], categories: [], collections: [] }),
    );

    const store = await freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
    const loaded = store.getCatalog().products[0];
    expect(loaded.variantAxes).toEqual(['color', 'size']);
    expect(loaded.variants).toEqual([v]);

    // Persisting then re-reading preserves the variant record byte-for-byte.
    store.upsertProduct(loaded);
    const raw = JSON.parse(storage.getItem('taybah:catalog')!);
    expect(raw.products[0].variants).toEqual([v]);

    const store2 = await freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
    expect(store2.getCatalog().products[0].variants).toEqual([v]);
  });

  it('does not create variants for legacy products and keeps their fields', async () => {
    const legacy = baseProduct({ id: 'legacy-1' });
    delete legacy.variantAxes;
    delete legacy.variants;
    storage.setItem(
      'taybah:catalog',
      JSON.stringify({ products: [legacy], categories: [], collections: [] }),
    );
    const store = await freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
    const loaded = store.getCatalog().products[0];
    expect(loaded.id).toBe('legacy-1');
    expect(loaded.sku).toBe('TYB-P1');
    expect(loaded.price).toBe(1000);
    expect(loaded.variants).toBeUndefined();
  });

  it('loads malformed variant records without crashing', async () => {
    const p = baseProduct({
      variantAxes: ['color'],
      variants: [undefined, { id: 'w1', sku: 'W-1', combo: { color: 'ivory' } }] as unknown as
        ProductVariant[],
    });
    storage.setItem(
      'taybah:catalog',
      JSON.stringify({ products: [p], categories: [], collections: [] }),
    );
    const store = await freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
    const loaded = store.getCatalog().products[0];
    expect(loaded.variants).toHaveLength(1);
    expect(loaded.variants![0].id).toBe('w1');
  });
});

describe('order snapshots', () => {
  const ordersModule = () =>
    freshModule<typeof import('../checkout/orderStore')>('../checkout/orderStore.ts');

  it('freezes variant identity, Arabic labels, price, and image at purchase', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1', sku: 'V-BL', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 2);
    const lines = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productId: 'p1',
      slug: 'test-rug',
      qty: 2,
      price: 1200, // variant override — not the 1000 base price
      image: 'local:v-img',
      variantId: 'v1',
      variantSku: 'V-BL',
      variantLabel: 'اللون: عنابي · المقاس: كبير',
    });
    expect(lines[0].options).toEqual([
      {
        axis: 'color',
        axisLabel: { ar: 'اللون', en: 'Color' },
        value: 'burgundy',
        valueLabel: { ar: 'عنابي', en: 'Burgundy' },
      },
      {
        axis: 'size',
        axisLabel: { ar: 'المقاس', en: 'Size' },
        value: 'large',
        valueLabel: { ar: 'كبير', en: 'Large' },
      },
    ]);
  });

  it('keeps simple-product lines in the legacy shape', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const p = baseProduct();
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 1);
    const [line] = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    expect(line.price).toBe(1000);
    expect(line.image).toBe('img');
    expect(line.variantId).toBeNull();
    expect(line.variantSku).toBeNull();
    expect(line.variantLabel).toBeNull();
    expect(line.options).toBeUndefined();
  });

  it('inherits the product price when the variant price is null', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1', price: null });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [line] = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    expect(line.price).toBe(1000);
    expect(line.variantId).toBe('v1');
  });

  it('falls back to the product image when the variant has none', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1', image: null });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [line] = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    expect(line.image).toBe('img');
  });

  it('snapshots a custom non-reserved axis with Arabic labels intact', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    // 'material' is seeded («الخامة», wool→صوف) but is not a reserved
    // order-line axis — the snapshot must carry it through options.
    const v = variant({
      id: 'v-wool',
      sku: 'V-WOOL',
      combo: { color: 'burgundy', material: 'wool' },
      price: 1400,
      image: 'local:w-img',
    });
    const p = baseProduct({ variantAxes: ['color', 'material'], variants: [v] });
    cart.addToCart(p, { variant: v }, 1);
    const [line] = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    expect(line.variantId).toBe('v-wool');
    expect(line.variantSku).toBe('V-WOOL');
    expect(line.price).toBe(1400);
    expect(line.image).toBe('local:w-img');
    expect(line.variantLabel).toBe('اللون: عنابي · الخامة: صوف');
    expect(line.options).toEqual([
      {
        axis: 'color',
        axisLabel: { ar: 'اللون', en: 'Color' },
        value: 'burgundy',
        valueLabel: { ar: 'عنابي', en: 'Burgundy' },
      },
      {
        axis: 'material',
        axisLabel: { ar: 'الخامة', en: 'Material' },
        value: 'wool',
        valueLabel: { ar: 'صوف', en: 'Wool' },
      },
    ]);
    // Reserved color/size mirrors: color set, size absent for this axis set.
    expect(line.color).toBe('burgundy');
    expect(line.size).toBeNull();
  });

  it('survives catalog edits — saved lines never re-resolve', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1', sku: 'V-BL', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const orderLines = orders.buildOrderLines(
      store.resolveCartLines(cart.getCartLines(), stateWith([p])),
    );
    await orders.saveOrder(order([orderLines[0]]));

    // Edit everything identifiable about the product/variant afterward.
    const edited: CatalogProduct = {
      ...p,
      name: { ar: 'اسم جديد', en: 'New Name' },
      price: 9999,
      sku: 'RENAMED-SKU',
      image: 'new-img',
      published: false,
      variants: [{ ...v, sku: 'NEW-V-SKU', price: 5555, active: false }],
    };
    const loaded = orders.getOrders()[0];
    expect(loaded.lines[0]).toMatchObject({
      name: { ar: 'سجادة اختبار' },
      price: 1200,
      image: 'local:v-img',
      variantId: 'v1',
      variantSku: 'V-BL',
      variantLabel: 'اللون: عنابي · المقاس: كبير',
    });
    // Re-resolving post-edit must not touch the stored order.
    store.resolveCartLines(cart.getCartLines(), stateWith([edited]));
    expect(orders.getOrders()[0].lines[0].price).toBe(1200);
  });

  it('renders historical orders intact after the product is deleted', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1', sku: 'V-BL', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    await orders.saveOrder(
      order(orders.buildOrderLines(store.resolveCartLines(cart.getCartLines(), stateWith([p])))),
    );
    // Product wiped from the catalog entirely.
    expect(store.resolveCartLines(cart.getCartLines(), stateWith([]))[0].product).toBeUndefined();
    const saved = orders.getOrders()[0].lines[0];
    expect(saved.name.ar).toBe('سجادة اختبار');
    expect(saved.variantLabel).toBe('اللون: عنابي · المقاس: كبير');
    expect(saved.variantSku).toBe('V-BL');
    expect(saved.price).toBe(1200);
    expect(saved.image).toBe('local:v-img');
  });

  it('clears the cart only after the order has been persisted', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const orders = await ordersModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    // submit() order: resolve → validate → save → clear.
    const resolved = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(resolved.every((r) => r.block === null)).toBe(true);
    await orders.saveOrder(order(orders.buildOrderLines(resolved)));
    expect(orders.getOrders()).toHaveLength(1);
    cart.clearCart();
    expect(cart.getCartLines()).toHaveLength(0);
  });

  it('blocks order creation while any line is unavailable', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', availability: 'out_of_stock' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1); // added while it was purchasable
    const resolved = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    // submit() refuses when any line is blocked — the guard path.
    expect(resolved.some((r) => r.block !== null)).toBe(true);
  });
});

describe('cart compatibility', () => {
  it('loads legacy cart lines unchanged, normalizing new fields to null', async () => {
    const stored = [
      { key: 'p1|burgundy|large', productId: 'p1', color: 'burgundy', size: 'large', qty: 2 },
      { key: 'p2||', productId: 'p2', color: null, size: null, qty: 1 },
    ];
    storage.setItem('taybah:cart', JSON.stringify(stored));
    const cart = await freshModule<typeof import('../cart/useCart')>('../cart/useCart.ts');
    expect(cart.getCartLines()).toEqual([
      {
        key: 'p1|burgundy|large',
        productId: 'p1',
        variantId: null,
        color: 'burgundy',
        size: 'large',
        combo: null,
        name: null,
        price: null,
        image: null,
        qty: 2,
      },
      {
        key: 'p2||',
        productId: 'p2',
        variantId: null,
        color: null,
        size: null,
        combo: null,
        name: null,
        price: null,
        image: null,
        qty: 1,
      },
    ]);
  });
});

const cartModule = () =>
  freshModule<typeof import('../cart/useCart')>('../cart/useCart.ts');
const storeModule = () =>
  freshModule<typeof import('./catalogStore')>('./catalogStore.ts');
const stateWith = (products: CatalogProduct[]): CatalogState => ({
  products,
  categories: catalogCategories,
  collections: catalogCollections,
});
const variantProduct = (variants: ProductVariant[]) =>
  baseProduct({ variantAxes: ['color', 'size'], variants });

describe('variant-aware cart', () => {

  it('merges quantity when the same variant is added again', async () => {
    const cart = await cartModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    cart.addToCart(p, { variant: v }, 2);
    const lines = cart.getCartLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(3);
    expect(lines[0].variantId).toBe('v1');
  });

  it('keeps different variants of one product as separate lines', async () => {
    const cart = await cartModule();
    const v1 = variant({ id: 'v1' });
    const v2 = variant({ id: 'v2', combo: { color: 'ivory', size: 'large' }, sku: 'V2' });
    const p = variantProduct([v1, v2]);
    cart.addToCart(p, { variant: v1 }, 1);
    cart.addToCart(p, { variant: v2 }, 1);
    const lines = cart.getCartLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.key)).toEqual(['p1|v:v1', 'p1|v:v2']);
  });

  it('keeps simple-product identity and merges repeated adds', async () => {
    const cart = await cartModule();
    const p = baseProduct();
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 1);
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 2);
    cart.addToCart(p, { color: 'ivory', size: 'large' }, 1);
    const lines = cart.getCartLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ key: 'p1|burgundy|large', variantId: null, qty: 3 });
  });

  it('snapshots combo, name, price, and image on the variant line', async () => {
    const cart = await cartModule();
    const v = variant({ id: 'v1', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [l] = cart.getCartLines();
    expect(l.combo).toEqual(v.combo);
    expect(l.name).toEqual(p.name);
    expect(l.price).toBe(1200);
    expect(l.image).toBe('local:v-img');
    expect(l.color).toBe('burgundy');
    expect(l.size).toBe('large');
  });

  it('resolves override price, and null price inherits the base price', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v1 = variant({ id: 'v1', price: 1200 });
    const v2 = variant({ id: 'v2', combo: { color: 'ivory', size: 'large' }, price: null });
    const p = variantProduct([v1, v2]);
    cart.addToCart(p, { variant: v1 }, 1);
    cart.addToCart(p, { variant: v2 }, 2);
    const resolved = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(resolved[0].unitPrice).toBe(1200);
    expect(resolved[1].unitPrice).toBe(1000);
    expect(resolved.reduce((n, x) => n + x.unitPrice * x.line.qty, 0)).toBe(3200);
  });

  it('recalculates the line subtotal when quantity changes', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', price: 1200 });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    cart.setLineQty('p1|v:v1', 4);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.line.qty).toBe(4);
    expect(r.unitPrice * r.line.qty).toBe(4800);
  });

  it('uses the live catalog price when a variant price changes', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', price: 1200 });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const repriced: CatalogProduct = {
      ...p,
      variants: [{ ...v, price: 1500 }],
    };
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([repriced]));
    expect(r.unitPrice).toBe(1500); // live-price policy — snapshot never wins while data resolves
  });

  it('blocks inactive and out_of_stock variants without any stock dependency', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v1 = variant({ id: 'v1', availability: 'out_of_stock' });
    const v2 = variant({ id: 'v2', combo: { color: 'ivory', size: 'large' }, active: false });
    const v3 = variant({
      id: 'v3',
      combo: { color: 'sand', size: 'large' },
      availability: 'out_of_stock',
    });
    const p = variantProduct([v1, v2, v3]);
    for (const v of [v1, v2, v3]) cart.addToCart(p, { variant: v }, 1);
    expect(store.resolveCartLines(cart.getCartLines(), stateWith([p])).map((x) => x.block)).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
  });

  it('follows manual availability only — no numeric stock involved', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', availability: 'in_stock' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 5); // any qty is fine — no stock cap exists
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBeNull();
  });

  it('blocks a line when its variant flips to out_of_stock after adding', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', availability: 'in_stock' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 5);
    expect(store.resolveCartLines(cart.getCartLines(), stateWith([p]))[0].block).toBeNull();
    const drained: CatalogProduct = {
      ...p,
      variants: [{ ...v, availability: 'out_of_stock' }],
    };
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([drained]));
    expect(r.block).toBe('unavailable');
  });

  it('keeps a deleted variant displayable via its snapshot and blocked', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const emptied: CatalogProduct = { ...p, variants: [] };
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([emptied]));
    expect(r.block).toBe('unavailable');
    expect(r.variant).toBeUndefined();
    expect(r.name?.ar).toBe('سجادة اختبار');
    expect(r.image).toBe('local:v-img');
    expect(r.unitPrice).toBe(1000); // base price — variant.price was null
    expect(r.options).toEqual([
      ['color', 'burgundy'],
      ['size', 'large'],
    ]);
  });

  it('keeps a removed product displayable via snapshot, blocked, and removable', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([]));
    expect(r.product).toBeUndefined();
    expect(r.block).toBe('unavailable');
    expect(r.name?.ar).toBe('سجادة اختبار');
    expect(r.unitPrice).toBe(1000);
    cart.removeLine(r.line.key);
    expect(cart.getCartLines()).toHaveLength(0);
  });

  it('round-trips variant lines through localStorage intact', async () => {
    const cart = await cartModule();
    const v = variant({ id: 'v1', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 2);
    const before = cart.getCartLines();
    const cart2 = await cartModule();
    expect(cart2.getCartLines()).toEqual(before);
    expect(cart2.getCartLines()[0].variantId).toBe('v1');
    expect(cart2.getCartLines()[0].combo).toEqual(v.combo);
  });

  it('resolves legacy lines unchanged and keeps simple products purchasable', async () => {
    const cart = await cartModule();
    const store = await storeModule();
    const p = baseProduct();
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBeNull();
    expect(r.variant).toBeUndefined();
    expect(r.unitPrice).toBe(1000);
    expect(r.options).toEqual([
      ['color', 'burgundy'],
      ['size', 'large'],
    ]);
  });
});

describe('wishlist quick-add cart identity (Step 11A)', () => {
  // WishlistPage's quick-add resolves a variant via singlePurchasableVariant
  // and calls cart.add(product, { variant }, qty) — the EXACT same call
  // ProductInfo makes from the PDP. These tests exercise that same call
  // shape directly to prove the two entry points can never diverge.

  it('adding the resolved single-purchasable variant produces a real variant line (not variantId: null)', async () => {
    const cart = await cartModule();
    const v = variant({ id: 'v1', price: 1200, image: 'local:v-img' });
    const p = variantProduct([v]);
    const resolved = singlePurchasableVariant(p, ATTRS);
    expect(resolved?.id).toBe('v1');
    cart.addToCart(p, { variant: resolved }, 1);
    const [line] = cart.getCartLines();
    expect(line.variantId).toBe('v1');
    expect(line.price).toBe(1200); // variant-specific price preserved
    expect(line.image).toBe('local:v-img'); // variant-specific image preserved
    expect(line.combo).toEqual(v.combo);
  });

  it('quick-adding the same variant twice merges into one line, matching a PDP add of the same variant', async () => {
    const cart = await cartModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    const resolved = singlePurchasableVariant(p, ATTRS);
    cart.addToCart(p, { variant: resolved }, 1); // simulated wishlist quick-add
    cart.addToCart(p, { variant: v }, 2); // simulated PDP add of the identical variant
    const lines = cart.getCartLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe('p1|v:v1');
    expect(lines[0].qty).toBe(3);
  });

  it('never uses singlePurchasableVariant to add when a disabled value makes the only combo unpurchasable', async () => {
    const v = variant({ id: 'v1' }); // combo: { color: 'burgundy', size: 'large' }
    const p = variantProduct([v]);
    const colorBurgundyDisabled = ATTRS.map((a) =>
      a.key === 'color'
        ? { ...a, values: a.values.map((val) => (val.key === 'burgundy' ? { ...val, enabled: false } : val)) }
        : a,
    );
    expect(singlePurchasableVariant(p, colorBurgundyDisabled)).toBeUndefined();
  });

  it('never uses singlePurchasableVariant to add when several combinations are purchasable', async () => {
    const p = variantProduct([
      variant({ id: 'v1' }),
      variant({ id: 'v2', combo: { color: 'ivory', size: 'xl' } }),
    ]);
    expect(singlePurchasableVariant(p, ATTRS)).toBeUndefined();
  });
});

describe('media reference scan', () => {
  it('blocks deletion of an image referenced by a variant', async () => {
    const p = baseProduct({
      variantAxes: ['color'],
      variants: [variant({ image: 'local:asset-9' })],
    });
    storage.setItem(
      'taybah:catalog',
      JSON.stringify({ products: [p], categories: [], collections: [] }),
    );
    const refs = await freshModule<typeof import('../../shared/assets/assetRefs')>(
      '../../shared/assets/assetRefs.ts',
    );
    const hits = refs.imageReferences('asset-9');
    expect(hits.some((h) => h.includes('تنويعة منتج'))).toBe(true);
    expect(refs.imageReferences('nothing')).toEqual([]);
  });
});

// ---- matrix sync ----------------------------------------------------------

describe('syncVariantMatrix', () => {
  const axes = ['color', 'size'];
  const selections = { color: ['burgundy', 'ivory'], size: ['large', 'xl'] };

  const create = (combo: Record<string, string>): ProductVariant =>
    variant({ combo, sku: `NEW-${combo.color}-${combo.size}` });

  it('creates all combos for a fresh matrix', () => {
    const res = syncVariantMatrix(axes, selections, [], create)!;
    expect(res.variants).toHaveLength(4);
    expect(res.added).toHaveLength(4);
    expect(res.retainedInactive).toHaveLength(0);
    expect(res.variants.map((v) => v.combo)).toEqual([
      { color: 'burgundy', size: 'large' },
      { color: 'burgundy', size: 'xl' },
      { color: 'ivory', size: 'large' },
      { color: 'ivory', size: 'xl' },
    ]);
  });

  it('preserves ids and manually edited fields for matching combos', () => {
    const existing = [
      variant({ id: 'keep-1', sku: 'EDITED-SKU', combo: { color: 'burgundy', size: 'large' }, price: 777, image: 'local:img1', active: false }),
      variant({ id: 'keep-2', sku: 'V-IL', combo: { color: 'ivory', size: 'large' } }),
    ];
    const res = syncVariantMatrix(axes, selections, existing, create)!;
    const kept = res.variants.find((v) => v.id === 'keep-1')!;
    expect(kept.sku).toBe('EDITED-SKU');
    expect(kept.price).toBe(777);
    expect(kept.image).toBe('local:img1');
    expect(kept.active).toBe(false); // manual deactivation survives regen
    expect(res.variants.find((v) => v.id === 'keep-2')).toBeDefined();
    // the other two generated combos are new records
    expect(res.added.map((v) => v.combo)).toEqual([
      { color: 'burgundy', size: 'xl' },
      { color: 'ivory', size: 'xl' },
    ]);
  });

  it('assigns fresh ids only to genuinely new combinations', () => {
    const existing = [variant({ id: 'stable-id', combo: { color: 'ivory', size: 'xl' } })];
    const res = syncVariantMatrix(axes, selections, existing, create)!;
    const ids = res.variants.map((v) => v.id);
    expect(ids.filter((id) => id === 'stable-id')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length); // never duplicates
    expect(res.added.every((v) => v.id !== 'stable-id')).toBe(true);
  });

  it('retains dropped combos as inactive — never deletes them', () => {
    const existing = [
      variant({ id: 'gone-1', sku: 'V-GONE', combo: { color: 'sand', size: 'large' } }),
      variant({ id: 'stay-1', combo: { color: 'ivory', size: 'xl' } }),
    ];
    const res = syncVariantMatrix(axes, selections, existing, create)!;
    const orphan = res.variants.find((v) => v.id === 'gone-1')!;
    expect(orphan.active).toBe(false);
    expect(res.retainedInactive.map((v) => v.id)).toEqual(['gone-1']);
    expect(res.variants).toHaveLength(5); // 4 generated + 1 retained
  });

  it('returns null when generation is invalid or over the cap', () => {
    expect(syncVariantMatrix(axes, { color: [], size: ['xl'] }, [], create)).toBeNull();
    expect(
      syncVariantMatrix(
        ['a', 'b', 'c'],
        { a: ['1', '2', '3', '4', '5'], b: ['1', '2', '3', '4'], c: ['1', '2', '3', '4'] },
        [],
        create,
      ),
    ).toBeNull();
  });

  it('does not resurrect duplicate stored combos', () => {
    const existing = [
      variant({ id: 'a', combo: { color: 'ivory', size: 'xl' } }),
      variant({ id: 'b', combo: { size: 'xl', color: 'ivory' } }), // same normalized combo
    ];
    const res = syncVariantMatrix(axes, selections, existing, create)!;
    // first match kept in generated position; second retained inactive
    expect(res.variants.find((v) => v.id === 'a')!.active).toBe(true);
    expect(res.retainedInactive.map((v) => v.id)).toEqual(['b']);
  });
});

describe('deriveAxisSelections', () => {
  it('rebuilds per-axis selections from stored combos', () => {
    const variants = [
      variant({ combo: { color: 'burgundy', size: 'large' } }),
      variant({ combo: { color: 'ivory', size: 'large' } }),
      variant({ combo: { color: 'ivory', size: 'xl' } }),
    ];
    expect(deriveAxisSelections(['color', 'size'], variants)).toEqual({
      color: ['burgundy', 'ivory'],
      size: ['large', 'xl'],
    });
    expect(deriveAxisSelections(['color'], [])).toEqual({ color: [] });
  });
});

describe('axisProductValues / axisValuesForAxes', () => {
  const fields = {
    colors: ['burgundy', 'ivory'],
    materials: ['wool', 'cotton'],
    sizes: ['small', 'medium', 'large'],
    attributes: { weave: ['flat', 'kilim'] },
  };
  const attrs = [
    attr('color', ['burgundy', 'ivory', 'sand']),
    attr('material', ['wool', 'cotton', 'jute'], { variationCapable: false }),
    attr('size', ['small', 'medium', 'large', 'xl']),
    attr('weave', ['flat', 'kilim']),
  ];

  it('sources reserved axes from the product fields — never a second selection', () => {
    expect(axisProductValues('color', fields, attrs[0])).toEqual(['burgundy', 'ivory']);
    expect(axisProductValues('size', fields, attrs[2])).toEqual([
      'small',
      'medium',
      'large',
    ]);
    // material resolves from `materials` like any reserved axis — whether it
    // may BE an axis is governed by variationCapable, not by sourcing.
    expect(axisProductValues('material', fields, attrs[1])).toEqual(['wool', 'cotton']);
  });

  it('sources non-reserved axes from the product attributes map', () => {
    expect(axisProductValues('weave', fields, attrs[3])).toEqual(['flat', 'kilim']);
    expect(axisProductValues('undeclared', fields)).toEqual([]);
  });

  it('keeps only enabled attribute values for generation', () => {
    const withDisabled = attr('color', []);
    withDisabled.values = [
      { key: 'burgundy', label: { ar: 'b', en: 'b' }, enabled: true, order: 1 },
      { key: 'ivory', label: { ar: 'i', en: 'i' }, enabled: false, order: 2 },
    ];
    expect(axisProductValues('color', fields, withDisabled)).toEqual(['burgundy']);
  });

  it('dedupes field values', () => {
    expect(
      axisProductValues('color', { ...fields, colors: ['ivory', 'ivory', 'burgundy'] }),
    ).toEqual(['ivory', 'burgundy']);
  });

  it('axisValuesForAxes resolves every configured axis at once', () => {
    expect(axisValuesForAxes(['color', 'size'], fields, attrs)).toEqual({
      color: ['burgundy', 'ivory'],
      size: ['small', 'medium', 'large'],
    });
  });
});

describe('field-driven regeneration', () => {
  const create = (combo: Record<string, string>): ProductVariant =>
    variant({ combo, sku: `V-${Object.keys(combo).sort().map((k) => combo[k]).join('-')}` });

  it('changing product colors updates generated combos and orphans the rest', () => {
    const product = { colors: ['burgundy', 'ivory'], materials: [], sizes: ['large', 'xl'] };
    const sels1 = axisValuesForAxes(['color', 'size'], product, ATTRS);
    const r1 = syncVariantMatrix(['color', 'size'], sels1, [], create)!;
    expect(r1.variants).toHaveLength(4);

    // Admin removes ivory from the product's colors — generation inputs
    // change automatically, matching variants keep their records, the ivory
    // combos become retained-inactive orphans.
    const sels2 = axisValuesForAxes(['color', 'size'], { ...product, colors: ['burgundy'] }, ATTRS);
    const r2 = syncVariantMatrix(['color', 'size'], sels2, r1.variants, create)!;
    expect(r2.variants.filter((v) => v.active)).toHaveLength(2);
    expect(r2.retainedInactive).toHaveLength(2);
    expect(r2.retainedInactive.every((v) => v.combo.color === 'ivory')).toBe(true);
    // burgundy rows are the SAME records — ids/fields untouched
    expect(r2.variants.filter((v) => v.active)).toEqual(
      r1.variants.filter((v) => v.combo.color === 'burgundy'),
    );
  });

  it('changing product sizes updates generated combos', () => {
    const product = { colors: ['ivory'], materials: [], sizes: ['large', 'xl'] };
    const r1 = syncVariantMatrix(['color', 'size'], axisValuesForAxes(['color', 'size'], product, ATTRS), [], create)!;
    expect(r1.variants).toHaveLength(2);
    const sels2 = axisValuesForAxes(['color', 'size'], { ...product, sizes: ['small'] }, ATTRS);
    const r2 = syncVariantMatrix(['color', 'size'], sels2, r1.variants, create)!;
    // Only the newly-generated combo is active; the old size combos sit
    // behind it as retained-inactive orphans.
    expect(r2.variants.filter((v) => v.active).map((v) => v.combo)).toEqual([
      { color: 'ivory', size: 'small' },
    ]);
    expect(r2.added).toHaveLength(1);
    expect(r2.retainedInactive).toHaveLength(2);
  });

  it('a non-variation-capable material axis is rejected by validation', () => {
    const p = baseProduct({
      variantAxes: ['material'],
      variants: [variant({ combo: { material: 'wool' } })],
    });
    const notCapable = [attr('material', ['wool'], { variationCapable: false })];
    expect(validateProductVariants(p, notCapable, [p]).map((i) => i.code)).toContain(
      'axis_not_variation_capable',
    );
  });
});

describe('suggestVariantSku', () => {
  it('builds deterministic stems and suffixes collisions', () => {
    const never = () => false;
    expect(
      suggestVariantSku('TYB-P1', { color: 'ivory', size: 'xl' }, never),
    ).toBe('TYB-P1-ivory-xl');
    const taken = new Set(['tyb-p1-ivory-xl', 'tyb-p1-ivory-xl-2']);
    expect(
      suggestVariantSku(
        'tyb-p1',
        { color: 'ivory', size: 'xl' },
        (s) => taken.has(normalizeSku(s)),
      ),
    ).toBe('tyb-p1-ivory-xl-3');
    expect(suggestVariantSku('', { color: 'ivory' }, never)).toBe('V-ivory');
  });
});

describe('inactive-variant validation exemption', () => {
  it('skips combo/price/stock checks on inactive variants but enforces SKU identity', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({
          sku: 'V-INACT',
          combo: { color: 'burgundy' }, // incomplete — allowed while inactive
          price: -50,
          active: false,
        }),
        variant({ sku: 'V-OK', combo: { color: 'ivory', size: 'large' } }),
      ],
    });
    const issues = validateProductVariants(p, ATTRS, [p]);
    expect(issues).toEqual([]);
  });

  it('still flags SKU problems on inactive variants', () => {
    const p = baseProduct({
      variantAxes: ['color'],
      variants: [
        variant({ sku: 'TYB-P1', combo: {}, active: false }), // collides with product SKU
        variant({ sku: 'V-2', combo: { color: 'ivory' } }),
      ],
    });
    expect(validateProductVariants(p, ATTRS, [p]).map((i) => i.code)).toContain(
      'sku_duplicate',
    );
  });
});

// ---- storefront selection (PDP) ---------------------------------------------

describe('PDP variant selection', () => {
  // color × size matrix with a deliberate hole: ivory+large missing.
  const p = () =>
    baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1', sku: 'V-BL', combo: { color: 'burgundy', size: 'large' } }),
        variant({ id: 'v2', sku: 'V-BX', combo: { color: 'burgundy', size: 'xl' } }),
        variant({ id: 'v3', sku: 'V-IX', combo: { color: 'ivory', size: 'xl' } }),
        variant({ id: 'v4', sku: 'V-IS', combo: { color: 'ivory', size: 'small' } }),
      ],
    });

  it('lists offered axis values from active variants only', () => {
    expect(activeAxisValues(p(), 'color')).toEqual(['burgundy', 'ivory']);
    expect(activeAxisValues(p(), 'size')).toEqual(['large', 'xl', 'small']);
    const inactiveOnly = baseProduct({
      variantAxes: ['color'],
      variants: [variant({ combo: { color: 'sand' }, active: false })],
    });
    expect(activeAxisValues(inactiveOnly, 'color')).toEqual([]);
  });

  it('exact complete selection resolves the one matching variant', () => {
    const resolved = resolveSelectedVariant(p(), { color: 'ivory', size: 'small' });
    expect(resolved?.id).toBe('v4');
    expect(resolved?.sku).toBe('V-IS');
  });

  it('partial selections never resolve', () => {
    expect(resolveSelectedVariant(p(), { color: 'ivory', size: null })).toBeUndefined();
    expect(resolveSelectedVariant(p(), {})).toBeUndefined();
    expect(selectionComplete(['color', 'size'], { color: 'ivory', size: null })).toBe(false);
  });

  it('missing combinations stay invalid — no first-match fallback', () => {
    // ivory+large is not stored.
    expect(resolveSelectedVariant(p(), { color: 'ivory', size: 'large' })).toBeUndefined();
  });

  it('inactive variants cannot be selected for purchase', () => {
    const q = baseProduct({
      variantAxes: ['color'],
      variants: [
        variant({ combo: { color: 'burgundy' }, active: false }),
        variant({ sku: 'V2', combo: { color: 'ivory' } }),
      ],
    });
    expect(resolveSelectedVariant(q, { color: 'burgundy' })).toBeUndefined();
    expect(resolveSelectedVariant(q, { color: 'ivory' })?.sku).toBe('V2');
    expect(variantPurchasable({ active: false, availability: 'in_stock' })).toBe(false);
  });

  it('progressive filtering disables values with no valid path', () => {
    const prod = p();
    const sel = { color: 'burgundy', size: null };
    expect(axisValueEnabled(prod, sel, 'size', 'large')).toBe(true);
    expect(axisValueEnabled(prod, sel, 'size', 'xl')).toBe(true);
    expect(axisValueEnabled(prod, sel, 'size', 'small')).toBe(false); // hole
    // With size selected, colors keep only reachable values.
    const sel2 = { color: null, size: 'large' };
    expect(axisValueEnabled(prod, sel2, 'color', 'burgundy')).toBe(true);
    expect(axisValueEnabled(prod, sel2, 'color', 'ivory')).toBe(false);
  });

  it('changing an earlier axis clears only the now-impossible dependents', () => {
    const prod = p();
    // Customer just switched color to ivory while size=large is selected —
    // ivory+large doesn't exist. preferAxis=color keeps the new choice and
    // clears the dependent size.
    expect(reconcileSelection(prod, { color: 'ivory', size: 'large' }, 'color')).toEqual(
      { color: 'ivory', size: null },
    );
    // Without a preferred axis the impossible pair clears symmetrically
    // (first axis evaluated yields).
    expect(reconcileSelection(prod, { color: 'ivory', size: 'large' })).toEqual(
      { color: null, size: 'large' },
    );
    // Valid joint selections ride through untouched.
    expect(reconcileSelection(prod, { color: 'burgundy', size: 'xl' }, 'size')).toEqual({
      color: 'burgundy',
      size: 'xl',
    });
  });

  it('reconcile cascades to a fixpoint across axes', () => {
    const prod = baseProduct({
      variantAxes: ['color', 'size', 'material'],
      variants: [
        variant({ combo: { color: 'burgundy', size: 'large', material: 'wool' } }),
        variant({ sku: 'V2', combo: { color: 'ivory', size: 'small', material: 'cotton' } }),
      ],
    });
    // color=burgundy (just changed) forces size=large+material=wool; the
    // picked small+cotton both clear, keeping the new color.
    expect(
      reconcileSelection(
        prod,
        { color: 'burgundy', size: 'small', material: 'cotton' },
        'color',
      ),
    ).toEqual({ color: 'burgundy', size: null, material: null });
  });

  it('initial selection prefills only single-value axes', () => {
    expect(initialVariantSelection(p())).toEqual({ color: null, size: null });
    const singleAxis = baseProduct({
      variantAxes: ['color'],
      variants: [variant({ combo: { color: 'burgundy' } })],
    });
    expect(initialVariantSelection(singleAxis)).toEqual({ color: 'burgundy' });
    expect(resolveSelectedVariant(singleAxis, { color: 'burgundy' })).toBeDefined();
  });

  it('stays safe on malformed stored data', () => {
    const broken = baseProduct({
      variantAxes: ['color'],
      variants: [
        variant({ combo: {} }), // incomplete combo — never matches
        variant({ sku: 'V-OK', combo: { color: 'ivory' } }),
      ],
    });
    expect(resolveSelectedVariant(broken, { color: 'ivory' })?.sku).toBe('V-OK');
    expect(activeAxisValues(broken, 'size')).toEqual([]);
    expect(reconcileSelection(broken, { color: 'ghost' })).toEqual({ color: null });
  });

});

describe('disabled attribute/value storefront safety (10D-3)', () => {
  const colorAttr = (over: Partial<AttributeDef> = {}) => attr('color', ['burgundy', 'ivory', 'sand'], over);
  const sizeAttr = (over: Partial<AttributeDef> = {}) => attr('size', ['small', 'medium', 'large', 'xl'], over);
  const disableValue = (a: AttributeDef, key: string): AttributeDef => ({
    ...a,
    values: a.values.map((v) => (v.key === key ? { ...v, enabled: false } : v)),
  });

  // color × size matrix identical to the PDP fixture above.
  const p = () =>
    baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1', sku: 'V-BL', combo: { color: 'burgundy', size: 'large' } }),
        variant({ id: 'v2', sku: 'V-BX', combo: { color: 'burgundy', size: 'xl' } }),
        variant({ id: 'v3', sku: 'V-IX', combo: { color: 'ivory', size: 'xl' } }),
      ],
    });

  describe('comboValuesEnabled', () => {
    it('is true when every combo axis is a defined, enabled attribute/value', () => {
      expect(comboValuesEnabled({ color: 'burgundy', size: 'large' }, [colorAttr(), sizeAttr()])).toBe(true);
    });

    it('is false once any combo value is disabled', () => {
      const disabled = disableValue(colorAttr(), 'burgundy');
      expect(comboValuesEnabled({ color: 'burgundy', size: 'large' }, [disabled, sizeAttr()])).toBe(false);
    });

    it('is false once the whole attribute is disabled', () => {
      expect(
        comboValuesEnabled({ color: 'burgundy', size: 'large' }, [
          colorAttr({ enabled: false }),
          sizeAttr(),
        ]),
      ).toBe(false);
    });

    it('is false when the axis has no matching attribute at all', () => {
      expect(comboValuesEnabled({ color: 'burgundy' }, [sizeAttr()])).toBe(false);
    });

    it('is vacuously true for an empty combo', () => {
      expect(comboValuesEnabled({}, [])).toBe(true);
    });
  });

  describe('sellableVariantAxes / offeredAxisValues — PDP selectors exclude disabled attrs/values', () => {
    it('drops a disabled attribute from the sellable axis list entirely', () => {
      expect(sellableVariantAxes(['color', 'size'], [colorAttr({ enabled: false }), sizeAttr()])).toEqual([
        'size',
      ]);
    });

    it('offers nothing for a disabled attribute, even with active matching variants', () => {
      expect(offeredAxisValues(p(), 'color', [colorAttr({ enabled: false }), sizeAttr()])).toEqual([]);
    });

    it('drops a disabled value from an otherwise-enabled attribute, even on an active variant', () => {
      // burgundy is disabled; ivory remains and still has an active variant (v3).
      const disabled = disableValue(colorAttr(), 'burgundy');
      expect(offeredAxisValues(p(), 'color', [disabled, sizeAttr()])).toEqual(['ivory']);
    });

    it('keeps every enabled value when nothing is disabled', () => {
      expect(offeredAxisValues(p(), 'size', [colorAttr(), sizeAttr()])).toEqual(['large', 'xl']);
    });
  });

  describe('withoutDisabledSelections', () => {
    it('clears a selection whose value was disabled after being chosen', () => {
      const disabled = disableValue(colorAttr(), 'burgundy');
      expect(
        withoutDisabledSelections({ color: 'burgundy', size: 'large' }, [disabled, sizeAttr()]),
      ).toEqual({ color: null, size: 'large' });
    });

    it('clears a selection whose attribute was disabled entirely', () => {
      expect(
        withoutDisabledSelections({ color: 'burgundy', size: 'large' }, [
          colorAttr({ enabled: false }),
          sizeAttr(),
        ]),
      ).toEqual({ color: null, size: 'large' });
    });

    it('leaves unaffected selections and nulls untouched', () => {
      expect(
        withoutDisabledSelections({ color: 'burgundy', size: null }, [colorAttr(), sizeAttr()]),
      ).toEqual({ color: 'burgundy', size: null });
    });
  });

  describe('reserved attributes (color/material/size) follow the same rules', () => {
    it('a disabled reserved value disappears from offeredAxisValues exactly like a custom one', () => {
      const disabled = disableValue(sizeAttr(), 'xl');
      expect(offeredAxisValues(p(), 'size', [colorAttr(), disabled])).toEqual(['large']);
    });
  });
});

describe('hasPurchasableVariant / singlePurchasableVariant (Step 11A)', () => {
  // Reuses the module-level ATTRS (color: burgundy/ivory/sand, size:
  // small/medium/large/xl, both fully enabled) unless a test overrides it.

  it('hasPurchasableVariant is true with at least one active, in-stock/low-stock variant', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1', availability: 'out_of_stock' }),
        variant({ id: 'v2', combo: { color: 'ivory', size: 'small' }, availability: 'low_stock' }),
      ],
    });
    expect(hasPurchasableVariant(p, ATTRS)).toBe(true);
  });

  it('hasPurchasableVariant is false when every variant is inactive', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1', active: false }),
        variant({ id: 'v2', combo: { color: 'ivory', size: 'small' }, active: false }),
      ],
    });
    expect(hasPurchasableVariant(p, ATTRS)).toBe(false);
  });

  it('hasPurchasableVariant is false when every variant is out of stock', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1', availability: 'out_of_stock' }),
        variant({ id: 'v2', combo: { color: 'ivory', size: 'small' }, availability: 'out_of_stock' }),
      ],
    });
    expect(hasPurchasableVariant(p, ATTRS)).toBe(false);
  });

  it('hasPurchasableVariant respects disabled attributes/values — an active, in-stock variant whose combo touches a disabled value is not purchasable', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [variant({ id: 'v1' })], // combo: { color: 'burgundy', size: 'large' }
    });
    const colorBurgundyDisabled = ATTRS.map((a) =>
      a.key === 'color'
        ? { ...a, values: a.values.map((v) => (v.key === 'burgundy' ? { ...v, enabled: false } : v)) }
        : a,
    );
    expect(hasPurchasableVariant(p, colorBurgundyDisabled)).toBe(false);
  });

  it('singlePurchasableVariant returns undefined for a non-variant (simple) product', () => {
    expect(singlePurchasableVariant(baseProduct(), ATTRS)).toBeUndefined();
  });

  it('singlePurchasableVariant returns the one combo when exactly one is purchasable', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [variant({ id: 'v1' })], // { color: 'burgundy', size: 'large' } — the only axis value each
    });
    expect(singlePurchasableVariant(p, ATTRS)?.id).toBe('v1');
  });

  it('singlePurchasableVariant returns undefined when several combinations are purchasable', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1' }),
        variant({ id: 'v2', combo: { color: 'ivory', size: 'small' } }),
      ],
    });
    expect(singlePurchasableVariant(p, ATTRS)).toBeUndefined();
  });

  it('singlePurchasableVariant returns undefined when nothing is purchasable (all inactive)', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [variant({ id: 'v1', active: false })],
    });
    expect(singlePurchasableVariant(p, ATTRS)).toBeUndefined();
  });

  it('singlePurchasableVariant ignores an incomplete/orphaned combo when picking the lone candidate', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [
        variant({ id: 'v1' }), // complete, purchasable
        variant({ id: 'v2', combo: { color: 'ivory' } }), // missing the size axis
      ],
    });
    expect(singlePurchasableVariant(p, ATTRS)?.id).toBe('v1');
  });

  it('singlePurchasableVariant excludes a candidate whose combo touches a disabled value, even if it is the only active/in-stock one', () => {
    const p = baseProduct({
      variantAxes: ['color', 'size'],
      variants: [variant({ id: 'v1' })], // { color: 'burgundy', size: 'large' }
    });
    const colorBurgundyDisabled = ATTRS.map((a) =>
      a.key === 'color'
        ? { ...a, values: a.values.map((v) => (v.key === 'burgundy' ? { ...v, enabled: false } : v)) }
        : a,
    );
    expect(singlePurchasableVariant(p, colorBurgundyDisabled)).toBeUndefined();
  });
});

describe('cart/order safety when an attribute or value is disabled after purchase (10D-3)', () => {
  const ATTRS_ALL_ENABLED = [
    attr('color', ['burgundy', 'ivory', 'sand']),
    attr('size', ['small', 'medium', 'large', 'xl']),
  ];

  it('comboValuesEnabled: a variant combo stays enabled until the matching value is disabled', () => {
    const combo = { color: 'burgundy', size: 'large' };
    expect(comboValuesEnabled(combo, ATTRS_ALL_ENABLED)).toBe(true);
    const colorDisabled = ATTRS_ALL_ENABLED.map((a) =>
      a.key === 'color'
        ? { ...a, values: a.values.map((v) => (v.key === 'burgundy' ? { ...v, enabled: false } : v)) }
        : a,
    );
    expect(comboValuesEnabled(combo, colorDisabled)).toBe(false);
  });

  it('comboValuesEnabled on a legacy color/size pair mirrors variant combo behavior', () => {
    // Simple (non-variant) cart lines reuse comboValuesEnabled with a
    // synthetic {color, size} combo built from the line's legacy fields.
    expect(comboValuesEnabled({ color: 'burgundy', size: 'large' }, ATTRS_ALL_ENABLED)).toBe(true);
    expect(comboValuesEnabled({}, ATTRS_ALL_ENABLED)).toBe(true); // nothing selected, nothing to block
  });

  // Seeds the shared localStorage-backed attribute store (read internally by
  // resolveCartLines) with a color attribute whose 'burgundy' value is
  // disabled — everything else (size, material) falls back to the normal
  // enabled defaults via attributeStore's own migration.
  const seedDisabledBurgundy = () =>
    storage.setItem(
      'taybah:attributes',
      JSON.stringify([
        {
          key: 'color',
          name: { ar: 'اللون', en: 'Color' },
          display: 'swatch',
          categories: [],
          required: false,
          variationCapable: true,
          filterable: false,
          enabled: true,
          order: 1,
          values: [
            { key: 'burgundy', label: { ar: 'عنابي', en: 'Burgundy' }, enabled: false, order: 1 },
            { key: 'ivory', label: { ar: 'عاجي', en: 'Ivory' }, enabled: true, order: 2 },
          ],
        },
      ]),
    );

  it('blocks a variant cart line once its combo touches a disabled attribute value', async () => {
    seedDisabledBurgundy();
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1' }); // combo: { color: 'burgundy', size: 'large' }
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBe('unavailable');
  });

  it('leaves a variant line unblocked when its combo uses only still-enabled values', async () => {
    seedDisabledBurgundy();
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1', combo: { color: 'ivory', size: 'large' } });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBeNull();
  });

  it('blocks a legacy simple-product cart line once its stored color value is disabled', async () => {
    seedDisabledBurgundy();
    const cart = await cartModule();
    const store = await storeModule();
    const p = baseProduct();
    cart.addToCart(p, { color: 'burgundy', size: 'large' }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBe('unavailable');
  });

  it('keeps a blocked line visible, labeled, and removable rather than deleting it', async () => {
    seedDisabledBurgundy();
    const cart = await cartModule();
    const store = await storeModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const [r] = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    expect(r.block).toBe('unavailable');
    expect(r.name?.ar).toBe(p.name.ar); // still readable/displayable
    expect(r.options).toEqual([
      ['color', 'burgundy'],
      ['size', 'large'],
    ]);
    cart.removeLine(r.line.key);
    expect(cart.getCartLines()).toHaveLength(0); // still removable
  });

  it('never rewrites the product record itself when disabling a color value', async () => {
    seedDisabledBurgundy();
    const store = await storeModule();
    const p = baseProduct({ id: 'p-disabled-check', colors: ['burgundy', 'ivory'] });
    // Disabling a value is purely an attribute-store flag — the product's
    // own stored assignment is untouched (no delete/rewrite anywhere here),
    // even though 'burgundy' is now disabled in the attribute store above.
    store.upsertProduct(p);
    const stored = store.getCatalog().products.find((x) => x.id === 'p-disabled-check');
    expect(stored?.colors).toEqual(['burgundy', 'ivory']);
  });

  it('historical order snapshots keep their saved Arabic labels after the value is later disabled', async () => {
    // buildOrderLines resolves axisLabel/valueLabel from the attribute store
    // AT CHECKOUT TIME — before any later disable. Snapshot labels must not
    // change retroactively once the live attribute changes.
    const os = await freshModule<typeof import('../checkout/orderStore')>(
      '../checkout/orderStore.ts',
    );
    const store = await storeModule();
    const cart = await cartModule();
    const v = variant({ id: 'v1' });
    const p = variantProduct([v]);
    cart.addToCart(p, { variant: v }, 1);
    const resolved = store.resolveCartLines(cart.getCartLines(), stateWith([p]));
    const lines = os.buildOrderLines(resolved);
    expect(lines[0].options?.[0]).toMatchObject({ axis: 'color', value: 'burgundy' });
    expect(lines[0].options?.[0].valueLabel.ar).toBe('عنابي'); // seeded default label

    // Now disable 'burgundy' — the already-built snapshot object is untouched.
    seedDisabledBurgundy();
    expect(lines[0].options?.[0].valueLabel.ar).toBe('عنابي');
  });
});

// ---- misc -------------------------------------------------------------------

describe('isVariantProduct', () => {
  it('distinguishes simple products from variant-bearing ones', () => {
    expect(isVariantProduct(baseProduct())).toBe(false);
    expect(isVariantProduct(baseProduct({ variantAxes: ['color'] }))).toBe(false);
    expect(
      isVariantProduct(baseProduct({ variantAxes: ['color'], variants: [variant()] })),
    ).toBe(true);
  });
});
