import { describe, expect, it } from 'vitest';
import type { CatalogProduct, ProductVariant } from './catalogData';
import type { AttributeDef } from './attributeStore';
import {
  activeFilterCount,
  applyFilters,
  defaultFilters,
  discountPercent,
  effectivePrice,
  isPurchasable,
  parseFilters,
  productColors,
  type FilterState,
  type FilterValueSets,
} from './useProductFilters';

// Dedicated coverage for the pure filter/sort functions behind
// useProductFilters (the hook itself needs a Router context to test
// directly — these are the functions it's built from): URL round-tripping,
// combined filters, sorting, empty results, and disabled-attribute/value
// handling in the URL-compatibility layer.

const valueSets = (over: Partial<FilterValueSets> = {}): FilterValueSets => ({
  colors: new Set(['burgundy', 'ivory']),
  materials: new Set(['wool']),
  sizes: new Set(['small', 'large']),
  customFacets: [],
  customValues: {},
  ...over,
});

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p1',
  slug: 'rug',
  sku: 'TYB-P1',
  name: { ar: 'سجادة', en: 'Rug' },
  description: { ar: '', en: '' },
  category: 'rugs',
  collection: 'diwan',
  price: 1000,
  compareAtPrice: null,
  availability: 'in_stock',
  colors: ['burgundy'],
  materials: ['wool'],
  size: 'large',
  sizes: ['large'],
  createdAt: '2025-01-01',
  featured: false,
  published: true,
  isNew: false,
  image: 'img',
  imageHover: 'img',
  images: ['img'],
  ...over,
});

describe('parseFilters', () => {
  it('returns defaultFilters-equivalent for an empty query string', () => {
    const f = parseFilters(new URLSearchParams(), new Set(['rugs']), valueSets());
    expect(f).toEqual(defaultFilters);
  });

  it('parses a combination of category, color, size, price, and stock filters together', () => {
    const params = new URLSearchParams('cat=rugs&color=burgundy&size=large&price=1000-3000&stock=1');
    const f = parseFilters(params, new Set(['rugs']), valueSets());
    expect(f).toMatchObject({
      categories: ['rugs'],
      colors: ['burgundy'],
      sizes: ['large'],
      priceBucket: '1000-3000',
      inStockOnly: true,
    });
  });

  it('drops a color/size value the valueSets don\'t recognize, rather than crashing', () => {
    const params = new URLSearchParams('color=not-a-real-color,burgundy');
    const f = parseFilters(params, new Set(), valueSets());
    expect(f.colors).toEqual(['burgundy']);
  });

  it('accepts a disabled-but-still-known value — URL compatibility for pre-disable links', () => {
    // valueSets intentionally includes disabled values too (see
    // useProductFilters.ts comment) — only the UI hides them as options.
    const sets = valueSets({ colors: new Set(['burgundy', 'disabled-color']) });
    const f = parseFilters(new URLSearchParams('color=disabled-color'), new Set(), sets);
    expect(f.colors).toEqual(['disabled-color']);
  });

  it('parses custom attribute facets via attr_<key> params, restricted to that facet\'s own enabled values', () => {
    const sets = valueSets({
      customFacets: [
        {
          key: 'weave',
          name: { ar: 'النسيج', en: 'Weave' },
          display: 'chips',
          categories: [],
          required: false,
          variationCapable: false,
          filterable: true,
          enabled: true,
          order: 1,
          values: [],
        },
      ],
      customValues: { weave: new Set(['flat']) },
    });
    const f = parseFilters(new URLSearchParams('attr_weave=flat,hand-knotted'), new Set(), sets);
    expect(f.custom).toEqual({ weave: ['flat'] }); // hand-knotted isn't in this facet's enabled set
  });

  it('falls back to the default sort for an invalid sort value', () => {
    const f = parseFilters(new URLSearchParams('sort=not-a-real-sort'), new Set(), valueSets());
    expect(f.sort).toBe('featured');
  });

  it('ignores an unrecognized category key', () => {
    const f = parseFilters(new URLSearchParams('cat=ghost-category'), new Set(['rugs']), valueSets());
    expect(f.categories).toEqual([]);
  });
});

describe('activeFilterCount', () => {
  it('is zero for defaultFilters', () => {
    expect(activeFilterCount(defaultFilters)).toBe(0);
  });

  it('sums every active filter across categories/colors/sizes/materials/price/stock/custom', () => {
    const f: FilterState = {
      categories: ['rugs'],
      colors: ['burgundy', 'ivory'],
      materials: [],
      sizes: ['large'],
      custom: { weave: ['flat', 'hand-knotted'] },
      priceBucket: '1000-3000',
      inStockOnly: true,
      newOnly: true,
      offersOnly: true,
      sort: 'newest', // sorting is not a filter
    };
    expect(activeFilterCount(f)).toBe(1 + 2 + 1 + 2 + 1 + 1 + 1 + 1);
  });
});

describe('applyFilters', () => {
  it('returns every product, featured-first, when no filters are active', () => {
    const list = [product({ id: 'a', featured: false }), product({ id: 'b', featured: true })];
    const result = applyFilters(list, defaultFilters);
    expect(result.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('combines multiple simultaneous filters with AND semantics', () => {
    // applyFilters' size facet checks the product's singular default `size`
    // field (not the `sizes[]` array) — set both consistently here.
    const list = [
      product({ id: 'a', colors: ['burgundy'], size: 'large', price: 1500 }),
      product({ id: 'b', colors: ['burgundy'], size: 'small', price: 1500 }),
      product({ id: 'c', colors: ['ivory'], size: 'large', price: 1500 }),
    ];
    const f: FilterState = {
      ...defaultFilters,
      colors: ['burgundy'],
      sizes: ['large'],
    };
    expect(applyFilters(list, f).map((p) => p.id)).toEqual(['a']);
  });

  it('filters by price bucket range (min inclusive, max exclusive)', () => {
    const list = [product({ id: 'a', price: 999 }), product({ id: 'b', price: 1000 }), product({ id: 'c', price: 2999 })];
    const f: FilterState = { ...defaultFilters, priceBucket: '1000-3000' };
    expect(applyFilters(list, f).map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('filters out-of-stock products when inStockOnly is set', () => {
    const list = [
      product({ id: 'a', availability: 'out_of_stock' }),
      product({ id: 'b', availability: 'in_stock' }),
    ];
    const f: FilterState = { ...defaultFilters, inStockOnly: true };
    expect(applyFilters(list, f).map((p) => p.id)).toEqual(['b']);
  });

  it('filters by a custom attribute value against the product\'s generic attributes map', () => {
    const list = [
      product({ id: 'a', attributes: { weave: ['flat'] } }),
      product({ id: 'b', attributes: { weave: ['hand-knotted'] } }),
    ];
    const f: FilterState = { ...defaultFilters, custom: { weave: ['flat'] } };
    expect(applyFilters(list, f).map((p) => p.id)).toEqual(['a']);
  });

  it('returns an empty array when no product matches the combined filters', () => {
    const list = [product({ id: 'a', colors: ['burgundy'] })];
    const f: FilterState = { ...defaultFilters, colors: ['ivory'] };
    expect(applyFilters(list, f)).toEqual([]);
  });

  it('sorts by price ascending and descending', () => {
    const list = [product({ id: 'a', price: 300 }), product({ id: 'b', price: 100 }), product({ id: 'c', price: 200 })];
    expect(applyFilters(list, { ...defaultFilters, sort: 'price-asc' }).map((p) => p.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(applyFilters(list, { ...defaultFilters, sort: 'price-desc' }).map((p) => p.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('sorts by newest first', () => {
    const list = [
      product({ id: 'a', createdAt: '2025-01-01' }),
      product({ id: 'b', createdAt: '2025-06-01' }),
    ];
    expect(applyFilters(list, { ...defaultFilters, sort: 'newest' }).map((p) => p.id)).toEqual([
      'b',
      'a',
    ]);
  });
});

// ---- colours, availability, new arrivals, offers, price, sorting -----------

const attr = (key: string, values: string[]): AttributeDef => ({
  key,
  name: { ar: key, en: key },
  display: 'chips',
  categories: [],
  required: false,
  variationCapable: true,
  filterable: true,
  enabled: true,
  order: 1,
  values: values.map((k, i) => ({ key: k, label: { ar: k, en: k }, enabled: true, order: i + 1 })),
});
const ATTRS = [attr('color', ['burgundy', 'ivory', 'sand']), attr('size', ['s', 'm', 'l'])];

const variant = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'v1',
  sku: 'TYB-V1',
  combo: { size: 's' },
  price: null,
  compareAtPrice: null,
  availability: 'in_stock',
  stockQuantity: null,
  image: null,
  active: true,
  ...over,
});
const withVariants = (variants: ProductVariant[], over: Partial<CatalogProduct> = {}) =>
  product({ variantAxes: ['size'], variants, ...over });

const ids = (list: CatalogProduct[]) => list.map((p) => p.id);

describe('colour filter', () => {
  const list = [
    product({ id: 'a', colors: ['burgundy', 'ivory'] }),
    product({ id: 'b', colors: ['ivory'] }),
    product({ id: 'c', colors: ['sand'] }),
    product({ id: 'd', colors: [] }), // no colour data
  ];

  it('matches a product that has at least one selected colour (OR between colours)', () => {
    expect(ids(applyFilters(list, { ...defaultFilters, colors: ['burgundy'] }))).toEqual(['a']);
    expect(ids(applyFilters(list, { ...defaultFilters, colors: ['burgundy', 'sand'] })).sort()).toEqual(['a', 'c']);
  });

  it('never assigns a colour to products without colour data', () => {
    const all = applyFilters(list, { ...defaultFilters, colors: ['burgundy', 'ivory', 'sand'] });
    expect(ids(all)).not.toContain('d');
  });

  it('normalizes case and whitespace in stored and selected values', () => {
    const odd = [product({ id: 'x', colors: [' Burgundy '] })];
    expect(ids(applyFilters(odd, { ...defaultFilters, colors: ['burgundy'] }))).toEqual(['x']);
    expect(ids(applyFilters([product({ id: 'y', colors: ['ivory'] })], { ...defaultFilters, colors: ['IVORY'] }))).toEqual(['y']);
  });

  it('also matches the colour of a buyable variant, but not an inactive or sold-out one', () => {
    const p = withVariants(
      [
        variant({ id: 'v1', combo: { size: 's', color: 'sand' } }),
        variant({ id: 'v2', combo: { size: 'm', color: 'ivory' }, active: false }),
        variant({ id: 'v3', combo: { size: 'l', color: 'burgundy' }, availability: 'out_of_stock' }),
      ],
      { id: 'vp', colors: [] },
    );
    expect(productColors(p)).toEqual(new Set(['sand']));
    expect(ids(applyFilters([p], { ...defaultFilters, colors: ['sand'] }))).toEqual(['vp']);
    expect(ids(applyFilters([p], { ...defaultFilters, colors: ['ivory'] }))).toEqual([]);
  });
});

describe('availability filter', () => {
  it('uses the same purchasability rule as the product card (simple products)', () => {
    const list = [product({ id: 'a', availability: 'out_of_stock' }), product({ id: 'b', availability: 'low_stock' })];
    expect(ids(applyFilters(list, { ...defaultFilters, inStockOnly: true }, { attrs: ATTRS }))).toEqual(['b']);
  });

  it('judges variant products by their buyable variants, not the product-level flag', () => {
    const soldOut = withVariants([variant({ availability: 'out_of_stock' })], { id: 'so', availability: 'in_stock' });
    const oneLeft = withVariants(
      [variant({ id: 'x', availability: 'out_of_stock' }), variant({ id: 'y', combo: { size: 'm' }, availability: 'low_stock' })],
      { id: 'ol', availability: 'out_of_stock' },
    );
    expect(isPurchasable(soldOut, ATTRS)).toBe(false);
    expect(isPurchasable(oneLeft, ATTRS)).toBe(true);
    expect(ids(applyFilters([soldOut, oneLeft], { ...defaultFilters, inStockOnly: true }, { attrs: ATTRS }))).toEqual(['ol']);
  });
});

describe('new arrivals filter', () => {
  it('uses the explicit isNew flag — never the date or the array position', () => {
    const list = [
      product({ id: 'old', isNew: false, createdAt: '2099-01-01' }), // recent date, not flagged
      product({ id: 'flagged', isNew: true, createdAt: '2020-01-01' }),
    ];
    expect(ids(applyFilters(list, { ...defaultFilters, newOnly: true }))).toEqual(['flagged']);
  });
});

describe('offers and discounts filter', () => {
  const list = [
    product({ id: 'sale', price: 800, compareAtPrice: 1000 }),
    product({ id: 'none', price: 800, compareAtPrice: null }),
    product({ id: 'bogus', price: 800, compareAtPrice: 800 }), // not a real discount
    product({ id: 'higher', price: 900, compareAtPrice: 500 }), // compare-at below price: invalid
    product({ id: 'tiny', price: 9990, compareAtPrice: 10000 }), // rounds to 0%: card shows no discount
  ];

  it('keeps only products with a valid, active discount', () => {
    expect(ids(applyFilters(list, { ...defaultFilters, offersOnly: true }))).toEqual(['sale']);
  });

  it('agrees with the percentage the card shows', () => {
    expect(discountPercent(list[0])).toBe(20);
    expect(discountPercent(list[2])).toBe(0);
    expect(discountPercent(list[4])).toBe(0);
  });

  it('uses variant-level prices for variant products', () => {
    const p = withVariants([variant({ price: 700, compareAtPrice: 1000 })], { id: 'vv', price: 1000, compareAtPrice: null });
    expect(discountPercent(p)).toBe(30);
    expect(ids(applyFilters([p], { ...defaultFilters, offersOnly: true }))).toEqual(['vv']);
  });
});

describe('price range boundaries and discounted prices', () => {
  const bucketOf = (key: string, ps: CatalogProduct[]) =>
    ids(applyFilters(ps, { ...defaultFilters, priceBucket: key }));
  const edge = [
    product({ id: 'p999', price: 999 }),
    product({ id: 'p1000', price: 1000 }),
    product({ id: 'p2999', price: 2999 }),
    product({ id: 'p3000', price: 3000 }),
    product({ id: 'p6999', price: 6999 }),
    product({ id: 'p7000', price: 7000 }),
  ];

  it('puts every boundary price in exactly one bucket (no gaps, no overlap)', () => {
    const buckets = ['under-1000', '1000-3000', '3000-7000', 'over-7000'];
    for (const prod of edge) {
      const hits = buckets.filter((b) => bucketOf(b, [prod]).length === 1);
      expect(hits, prod.id).toHaveLength(1);
    }
    expect(bucketOf('under-1000', edge)).toEqual(['p999']);
    expect(bucketOf('1000-3000', edge)).toEqual(['p1000', 'p2999']);
    expect(bucketOf('3000-7000', edge)).toEqual(['p3000', 'p6999']);
    expect(bucketOf('over-7000', edge)).toEqual(['p7000']);
  });

  it('filters on the discounted selling price, not the original price', () => {
    const p = product({ id: 'disc', price: 950, compareAtPrice: 2000 });
    expect(bucketOf('under-1000', [p])).toEqual(['disc']);
    expect(bucketOf('1000-3000', [p])).toEqual([]);
  });

  it('uses the lowest buyable variant price for variant products', () => {
    const p = withVariants(
      [variant({ price: 2500 }), variant({ id: 'v2', combo: { size: 'm' }, price: 900 }), variant({ id: 'v3', combo: { size: 'l' }, price: 400, availability: 'out_of_stock' })],
      { id: 'vp', price: 2500 },
    );
    expect(effectivePrice(p)).toBe(900);
    expect(bucketOf('under-1000', [p])).toEqual(['vp']);
  });
});

describe('combined filters', () => {
  const list = [
    product({ id: 'ok', colors: ['burgundy'], price: 800, compareAtPrice: 1200, isNew: true }),
    product({ id: 'wrongColor', colors: ['ivory'], price: 800, compareAtPrice: 1200, isNew: true }),
    product({ id: 'soldOut', colors: ['burgundy'], price: 800, compareAtPrice: 1200, isNew: true, availability: 'out_of_stock' }),
    product({ id: 'noOffer', colors: ['burgundy'], price: 800, isNew: true }),
    product({ id: 'pricey', colors: ['burgundy'], price: 5000, compareAtPrice: 6000, isNew: true }),
    product({ id: 'notNew', colors: ['burgundy'], price: 800, compareAtPrice: 1200, isNew: false }),
  ];

  it('returns only products that satisfy every selected group at once', () => {
    const f: FilterState = {
      ...defaultFilters,
      colors: ['burgundy'],
      inStockOnly: true,
      offersOnly: true,
      newOnly: true,
      priceBucket: 'under-1000',
    };
    expect(ids(applyFilters(list, f, { attrs: ATTRS }))).toEqual(['ok']);
  });

  it('removing one filter widens the result without touching the others', () => {
    const f: FilterState = { ...defaultFilters, colors: ['burgundy'], inStockOnly: true, offersOnly: true, priceBucket: 'under-1000' };
    expect(ids(applyFilters(list, f, { attrs: ATTRS })).sort()).toEqual(['notNew', 'ok']);
  });

  it('sorts the filtered set (not the whole catalog)', () => {
    const f: FilterState = { ...defaultFilters, colors: ['burgundy'], offersOnly: true, sort: 'price-desc' };
    expect(ids(applyFilters(list, f, { attrs: ATTRS }))).toEqual(['pricey', 'notNew', 'ok', 'soldOut']) // equal prices tie-break by id;
  });

  it('paginates the final filtered + sorted set', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      product({ id: `m${String(i).padStart(2, '0')}`, colors: i % 2 ? ['burgundy'] : ['ivory'], price: 100 + i }),
    );
    const results = applyFilters(many, { ...defaultFilters, colors: ['burgundy'], sort: 'price-desc' });
    expect(results).toHaveLength(5);
    expect(ids(results.slice(0, 2))).toEqual(['m09', 'm07']); // page 1 of the final set
    expect(ids(results.slice(2, 4))).toEqual(['m05', 'm03']); // load more continues it
  });

  it('reset (defaultFilters) restores the full list and zero active filters', () => {
    expect(applyFilters(list, defaultFilters, { attrs: ATTRS })).toHaveLength(list.length);
    expect(activeFilterCount(defaultFilters)).toBe(0);
  });

  it('gives an empty result when nothing matches', () => {
    expect(applyFilters(list, { ...defaultFilters, colors: ['sand'] }, { attrs: ATTRS })).toEqual([]);
  });
});

describe('sorting modes', () => {
  const list = [
    product({ id: 'a', price: 900, compareAtPrice: 1000, createdAt: '2025-03-01' }), // 10%
    product({ id: 'b', price: 500, compareAtPrice: 1000, createdAt: '2025-01-01' }), // 50%
    product({ id: 'c', price: 700, compareAtPrice: null, createdAt: '2025-06-01', featured: true }),
    product({ id: 'd', price: 300, compareAtPrice: 400, createdAt: '2025-05-01' }), // 25%
  ];

  it('newest uses createdAt, newest first', () => {
    expect(ids(applyFilters(list, { ...defaultFilters, sort: 'newest' }))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('price sorts use the selling price', () => {
    expect(ids(applyFilters(list, { ...defaultFilters, sort: 'price-asc' }))).toEqual(['d', 'b', 'c', 'a']);
    expect(ids(applyFilters(list, { ...defaultFilters, sort: 'price-desc' }))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('largest discount ranks by real percentage and puts undiscounted products last', () => {
    expect(ids(applyFilters(list, { ...defaultFilters, sort: 'discount' }))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('best-selling falls back to the featured order when there is no real sales data', () => {
    const fallback = ids(applyFilters(list, { ...defaultFilters, sort: 'best-selling' }));
    expect(fallback).toEqual(ids(applyFilters(list, defaultFilters)));
    expect(fallback[0]).toBe('c'); // featured first
  });

  it('best-selling ranks by real sales counts when they are supplied', () => {
    const sales = { a: 5, b: 40, d: 12 };
    expect(ids(applyFilters(list, { ...defaultFilters, sort: 'best-selling' }, { salesCounts: sales }))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('keeps the established default sort (featured first, then id)', () => {
    expect(ids(applyFilters(list, defaultFilters))).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('URL round-trip for the new controls', () => {
  it('parses new, offers and the new sort keys', () => {
    const f = parseFilters(new URLSearchParams('new=1&offers=1&stock=1&sort=discount'), new Set(), valueSets());
    expect(f.newOnly).toBe(true);
    expect(f.offersOnly).toBe(true);
    expect(f.inStockOnly).toBe(true);
    expect(f.sort).toBe('discount');
    expect(parseFilters(new URLSearchParams('sort=best-selling'), new Set(), valueSets()).sort).toBe('best-selling');
  });
});

describe('older product records with missing optional fields', () => {
  it('filters and sorts without throwing', () => {
    const legacy = {
      id: 'old',
      slug: 'old',
      sku: 'OLD',
      name: { ar: 'قديم', en: 'Old' },
      description: { ar: '', en: '' },
      category: 'rugs',
      collection: 'diwan',
      price: 500,
      availability: 'in_stock',
      size: '',
      sizes: [],
      image: 'i',
      imageHover: 'i',
      images: ['i'],
    } as unknown as CatalogProduct; // no colors/materials/createdAt/isNew/featured/compareAtPrice
    const all: FilterState[] = [
      { ...defaultFilters, colors: ['burgundy'] },
      { ...defaultFilters, offersOnly: true },
      { ...defaultFilters, newOnly: true },
      { ...defaultFilters, inStockOnly: true },
      { ...defaultFilters, materials: ['wool'] },
      { ...defaultFilters, priceBucket: 'under-1000' },
    ];
    for (const f of all) expect(() => applyFilters([legacy, product()], f, { attrs: ATTRS })).not.toThrow();
    for (const sort of ['featured', 'best-selling', 'newest', 'price-asc', 'price-desc', 'discount'] as const) {
      expect(applyFilters([legacy, product()], { ...defaultFilters, sort })).toHaveLength(2);
    }
    expect(ids(applyFilters([legacy], { ...defaultFilters, priceBucket: 'under-1000' }))).toEqual(['old']);
  });
});
