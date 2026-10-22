import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from './catalogData';
import {
  activeFilterCount,
  applyFilters,
  defaultFilters,
  parseFilters,
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
      sort: 'featured',
    };
    expect(activeFilterCount(f)).toBe(1 + 2 + 1 + 2 + 1 + 1);
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
