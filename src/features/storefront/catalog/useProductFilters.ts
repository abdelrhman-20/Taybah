import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { priceBuckets, type CatalogProduct } from './catalogData';
import {
  useAttributes,
  productAxisValues,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeDef,
} from './attributeStore';

// Client-side filtering/sorting over the mock catalog. Filter state lives in the
// URL query string so a filtered listing is shareable (FEATURES.md §filter-state).
// Later this maps to the same params sent to product_listing_summary queries.

export type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'newest';

export interface FilterState {
  categories: string[];
  colors: string[];
  materials: string[];
  sizes: string[];
  // Custom attribute facets — attrKey -> selected valueKeys (URL: attr_<key>=…)
  custom: Record<string, string[]>;
  priceBucket: string | null;
  inStockOnly: boolean;
  sort: SortKey;
}

export const defaultFilters: FilterState = {
  categories: [],
  colors: [],
  materials: [],
  sizes: [],
  custom: {},
  priceBucket: null,
  inStockOnly: false,
  sort: 'featured',
};

const SORT_KEYS: SortKey[] = ['featured', 'price-asc', 'price-desc', 'newest'];
const PRICE_KEYS = new Set(priceBuckets.map((b) => b.key));

// Option facets validate against the attribute store — the param names stay
// 'color'/'material'/'size' (the seeded attribute keys) so existing filtered
// URLs remain compatible.
export interface FilterValueSets {
  colors: Set<string>;
  materials: Set<string>;
  sizes: Set<string>;
  // Enabled + filterable custom attributes → enabled value keys (new
  // selections only; disabled attrs/values can't be picked). Reserved seeded
  // attributes are excluded — they keep their legacy color/material/size
  // params rather than gaining attr_<key> aliases.
  customFacets: AttributeDef[];
  customValues: Record<string, Set<string>>;
}

function listParam(params: URLSearchParams, key: string, allowed: Set<string>): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(',').filter((v) => allowed.has(v));
}

export function parseFilters(
  params: URLSearchParams,
  categoryKeys: Set<string>,
  valueSets: FilterValueSets,
): FilterState {
  const sort = params.get('sort');
  const price = params.get('price');
  return {
    categories: listParam(params, 'cat', categoryKeys),
    colors: listParam(params, 'color', valueSets.colors),
    materials: listParam(params, 'material', valueSets.materials),
    sizes: listParam(params, 'size', valueSets.sizes),
    custom: Object.fromEntries(
      valueSets.customFacets
        .map((a) => [
          a.key,
          listParam(params, `attr_${a.key}`, valueSets.customValues[a.key] ?? new Set<string>()),
        ])
        .filter(([, v]) => (v as string[]).length > 0),
    ) as Record<string, string[]>,
    priceBucket: price && PRICE_KEYS.has(price) ? price : null,
    inStockOnly: params.get('stock') === '1',
    sort: sort && SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : 'featured',
  };
}

function toSearchParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.categories.length) p.set('cat', f.categories.join(','));
  if (f.colors.length) p.set('color', f.colors.join(','));
  if (f.materials.length) p.set('material', f.materials.join(','));
  if (f.sizes.length) p.set('size', f.sizes.join(','));
  for (const [k, vals] of Object.entries(f.custom)) {
    if (vals.length) p.set(`attr_${k}`, vals.join(','));
  }
  if (f.priceBucket) p.set('price', f.priceBucket);
  if (f.inStockOnly) p.set('stock', '1');
  if (f.sort !== 'featured') p.set('sort', f.sort);
  return p;
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function activeFilterCount(f: FilterState): number {
  return (
    f.categories.length +
    f.colors.length +
    f.materials.length +
    f.sizes.length +
    (f.priceBucket ? 1 : 0) +
    (f.inStockOnly ? 1 : 0) +
    Object.values(f.custom).reduce((n, v) => n + v.length, 0)
  );
}

export function applyFilters(products: CatalogProduct[], f: FilterState): CatalogProduct[] {
  const bucket = f.priceBucket ? priceBuckets.find((b) => b.key === f.priceBucket) : null;
  const filtered = products.filter((p) => {
    if (f.categories.length && !f.categories.includes(p.category)) return false;
    if (f.colors.length && !p.colors.some((c) => f.colors.includes(c))) return false;
    if (f.materials.length && !p.materials.some((m) => f.materials.includes(m))) return false;
    if (f.sizes.length && !f.sizes.includes(p.size)) return false;
    if (f.inStockOnly && p.availability === 'out_of_stock') return false;
    if (bucket && (p.price < bucket.min || (bucket.max !== null && p.price >= bucket.max))) return false;
    for (const [attrKey, selected] of Object.entries(f.custom)) {
      if (!selected.length) continue;
      const assigned = productAxisValues(p, attrKey);
      if (!selected.some((v) => assigned.includes(v))) return false;
    }
    return true;
  });
  switch (f.sort) {
    case 'price-asc':
      return [...filtered].sort((a, b) => a.price - b.price);
    case 'price-desc':
      return [...filtered].sort((a, b) => b.price - a.price);
    case 'newest':
      return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      return [...filtered].sort(
        (a, b) => Number(b.featured) - Number(a.featured) || a.id.localeCompare(b.id),
      );
  }
}

export function useProductFilters(categoryKeys: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const keySet = useMemo(() => new Set(categoryKeys), [categoryKeys]);
  const attrs = useAttributes();
  const valueSets = useMemo<FilterValueSets>(() => {
    const keys = (k: string) => new Set(attrs.find((a) => a.key === k)?.values.map((v) => v.key) ?? []);
    const customFacets = attrs.filter(
      (a) =>
        a.enabled &&
        a.filterable &&
        !(RESERVED_ATTRIBUTE_KEYS as readonly string[]).includes(a.key),
    );
    return {
      colors: keys('color'),
      materials: keys('material'),
      sizes: keys('size'),
      customFacets,
      customValues: Object.fromEntries(
        customFacets.map((a) => [
          a.key,
          new Set(a.values.filter((v) => v.enabled).map((v) => v.key)),
        ]),
      ),
    };
  }, [attrs]);
  const filters = useMemo(
    () => parseFilters(searchParams, keySet, valueSets),
    [searchParams, keySet, valueSets],
  );

  const update = useCallback(
    (next: FilterState) => {
      const p = toSearchParams(next);
      const q = searchParams.get('q');
      if (q) p.set('q', q);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const set = useCallback(
    (patch: Partial<FilterState>) => update({ ...filters, ...patch }),
    [filters, update],
  );

  const toggleAttrValue = useCallback(
    (attrKey: string, valueKey: string) =>
      set({
        custom: {
          ...filters.custom,
          [attrKey]: toggle(filters.custom[attrKey] ?? [], valueKey),
        },
      }),
    [filters, set],
  );

  return {
    filters,
    set,
    toggleCategory: (key: string) => set({ categories: toggle(filters.categories, key) }),
    toggleColor: (key: string) => set({ colors: toggle(filters.colors, key) }),
    toggleMaterial: (key: string) => set({ materials: toggle(filters.materials, key) }),
    toggleSize: (key: string) => set({ sizes: toggle(filters.sizes, key) }),
    toggleAttrValue,
    setPriceBucket: (key: string | null) => set({ priceBucket: key }),
    setInStockOnly: (v: boolean) => set({ inStockOnly: v }),
    setSort: (sort: SortKey) => set({ sort }),
    clearAll: () => update(defaultFilters),
  };
}
