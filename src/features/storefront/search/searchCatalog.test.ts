import { describe, expect, it } from 'vitest';
import type { CatalogCategory, CatalogCollection, CatalogProduct } from '../catalog/catalogData';
import type { CatalogState } from '../catalog/catalogStore';
import { normalizeQuery, searchProducts } from './searchCatalog';

// Dedicated coverage for client-side search: query normalization, AND-token
// matching across name/SKU/taxonomy/option labels, empty-query handling,
// and the "published products only" boundary (search must never leak
// hidden/unpublished catalog data, matching productIsPublic's own rule).

const category = (over: Partial<CatalogCategory> = {}): CatalogCategory => ({
  slug: 'rugs',
  name: { ar: 'سجاد', en: 'Rugs' },
  description: { ar: '', en: '' },
  image: 'img',
  visible: true,
  order: 1,
  ...over,
});

const collection = (over: Partial<CatalogCollection> = {}): CatalogCollection => ({
  slug: 'diwan',
  name: { ar: 'ديوان', en: 'Diwan' },
  description: { ar: '', en: '' },
  image: 'img',
  visible: true,
  order: 1,
  ...over,
});

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p1',
  slug: 'burgundy-rug',
  sku: 'TYB-P1',
  name: { ar: 'سجادة عنابية', en: 'Burgundy Rug' },
  description: { ar: 'وصف', en: 'desc' },
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

const stateWith = (products: CatalogProduct[]): CatalogState => ({
  products,
  categories: [category()],
  collections: [collection()],
});

describe('normalizeQuery', () => {
  it('trims, lowercases, and collapses internal whitespace', () => {
    expect(normalizeQuery('  Burgundy   RUG  ')).toBe('burgundy rug');
  });

  it('strips Arabic diacritics and tatweel', () => {
    expect(normalizeQuery('سَجّادَة')).toBe(normalizeQuery('سجادة'));
  });

  it('normalizes alef variants (أ/إ/آ/ٱ) to bare alef', () => {
    expect(normalizeQuery('أحمر')).toBe(normalizeQuery('احمر'));
    expect(normalizeQuery('إحمر')).toBe(normalizeQuery('احمر'));
  });

  it('normalizes taa marbuta (ة) to haa (ه)', () => {
    expect(normalizeQuery('سجادة')).toBe(normalizeQuery('سجاده'));
  });

  it('normalizes alef maksura (ى) to yaa (ي)', () => {
    expect(normalizeQuery('كبرى')).toBe(normalizeQuery('كبري'));
  });
});

describe('searchProducts — matching', () => {
  it('returns an empty array for an empty or whitespace-only query', () => {
    const state = stateWith([product()]);
    expect(searchProducts('', state)).toEqual([]);
    expect(searchProducts('   ', state)).toEqual([]);
  });

  it('matches by Arabic product name', () => {
    const state = stateWith([product()]);
    expect(searchProducts('عنابية', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('matches by English product name', () => {
    const state = stateWith([product()]);
    expect(searchProducts('burgundy', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('matches by SKU', () => {
    const state = stateWith([product()]);
    expect(searchProducts('TYB-P1', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('matches by category and collection name', () => {
    const state = stateWith([product()]);
    expect(searchProducts('سجاد', state).map((p) => p.id)).toEqual(['p1']);
    expect(searchProducts('ديوان', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('matches by an assigned option label (color/material), not the raw technical key', () => {
    const state = stateWith([product({ colors: ['burgundy'], materials: ['wool'] })]);
    expect(searchProducts('عنابي', state).map((p) => p.id)).toEqual(['p1']); // color label
    expect(searchProducts('صوف', state).map((p) => p.id)).toEqual(['p1']); // material label
  });

  it('applies AND semantics across multiple tokens, even across different fields', () => {
    const state = stateWith([product()]);
    expect(searchProducts('عنابي سجاد', state).map((p) => p.id)).toEqual(['p1']); // color + category
    expect(searchProducts('عنابي nonexistent-token', state)).toEqual([]);
  });

  it('returns no matches for an unrelated query', () => {
    const state = stateWith([product()]);
    expect(searchProducts('no such thing here', state)).toEqual([]);
  });

  it('handles leading/trailing spaces and internal double spaces the same as a clean query', () => {
    const state = stateWith([product()]);
    expect(searchProducts('  burgundy  ', state).map((p) => p.id)).toEqual(['p1']);
    expect(searchProducts('عنابي   سجاد', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('is diacritic/spelling-variant tolerant end to end', () => {
    const state = stateWith([product({ name: { ar: 'سجادة', en: 'Rug' } })]);
    expect(searchProducts('سجاده', state).map((p) => p.id)).toEqual(['p1']); // ة vs ه
  });
});

// Regression: a short query like "sa" previously matched ~40% of the real
// catalog (verified directly against the seeded mock data before this fix)
// purely because `.includes()` matched "sa" buried in the MIDDLE of
// unrelated English words in product descriptions that are never even
// shown in the Arabic-only UI (e.g. "reuSAble", "eaSy-care") — a 2-letter
// query stood a very high chance of appearing SOMEWHERE in any sufficiently
// long paragraph. Switching to per-word prefix matching keeps every
// legitimate case (a query that is the actual start of a real word) while
// eliminating these incidental substring matches.
describe('searchProducts — word-prefix matching (search-feels-broken regression)', () => {
  it('does not match a query that only appears in the MIDDLE of an unrelated word', () => {
    const state = stateWith([
      product({
        name: { ar: 'سجادة', en: 'Rug' },
        description: {
          ar: 'سجادة عملية',
          en: 'A reusable, easy-care rug for everyday spaces.',
        },
        colors: [],
      }),
    ]);
    // "sa" is a substring of "reuSAble" and "eaSy-care" and "SpaceS" but is
    // not the START of any word in this description — must not match.
    expect(searchProducts('sa', state)).toEqual([]);
  });

  it('still matches a query that is the actual prefix of a real word', () => {
    const state = stateWith([product({ colors: ['sand'] })]);
    expect(searchProducts('sa', state).map((p) => p.id)).toEqual(['p1']); // "sand" starts with "sa"
  });

  it('matches a mid-name word by its own prefix, not by a substring elsewhere in the name', () => {
    const state = stateWith([product({ name: { ar: 'سجادة هندسية', en: 'Modern Geometric Rug' } })]);
    expect(searchProducts('geo', state).map((p) => p.id)).toEqual(['p1']); // "Geometric" starts with "geo"
    expect(searchProducts('metric', state)).toEqual([]); // mid-word "metric" no longer matches "Geometric"
  });

  it('still finds a product by a partial, hyphen-separated SKU segment', () => {
    const state = stateWith([product({ sku: 'TYB-P24' })]);
    expect(searchProducts('p24', state).map((p) => p.id)).toEqual(['p1']);
  });

  it('tokenizes a hyphenated query the same way product fields are tokenized', () => {
    const state = stateWith([product({ sku: 'TYB-P1' })]);
    expect(searchProducts('TYB-P1', state).map((p) => p.id)).toEqual(['p1']);
  });
});

describe('searchProducts — published-only boundary', () => {
  it('never matches an unpublished product', () => {
    const state = stateWith([product({ published: false })]);
    expect(searchProducts('burgundy', state)).toEqual([]);
  });

  it('never matches a product whose category is hidden', () => {
    const state: CatalogState = {
      products: [product()],
      categories: [category({ visible: false })],
      collections: [collection()],
    };
    expect(searchProducts('burgundy', state)).toEqual([]);
  });

  it('never matches a product whose collection is hidden', () => {
    const state: CatalogState = {
      products: [product()],
      categories: [category()],
      collections: [collection({ visible: false })],
    };
    expect(searchProducts('burgundy', state)).toEqual([]);
  });
});
