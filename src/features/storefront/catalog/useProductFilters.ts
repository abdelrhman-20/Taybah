import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { priceBuckets, type CatalogProduct } from './catalogData';
import {
  useAttributes,
  productAxisValues,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeDef,
} from './attributeStore';
import {
  hasPurchasableVariant,
  isVariantProduct,
  variantCompareAtPrice,
  variantPrice,
  variantPurchasable,
} from './variants';

// Client-side filtering/sorting over the catalog. Filter state lives in the
// URL query string so a filtered listing is shareable (FEATURES.md §filter-state).
// Later this maps to the same params sent to product_listing_summary queries.

export type SortKey =
  | 'featured'
  | 'best-selling'
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'discount';

export interface FilterState {
  categories: string[];
  colors: string[];
  materials: string[];
  sizes: string[];
  // Custom attribute facets — attrKey -> selected valueKeys (URL: attr_<key>=…)
  custom: Record<string, string[]>;
  priceBucket: string | null;
  inStockOnly: boolean;
  // Admin-flagged new arrivals (`isNew`) only.
  newOnly: boolean;
  // Products with a valid, active discount only.
  offersOnly: boolean;
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
  newOnly: false,
  offersOnly: false,
  sort: 'featured',
};

const SORT_KEYS: SortKey[] = ['featured', 'best-selling', 'newest', 'price-asc', 'price-desc', 'discount'];
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
    newOnly: params.get('new') === '1',
    offersOnly: params.get('offers') === '1',
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
  if (f.newOnly) p.set('new', '1');
  if (f.offersOnly) p.set('offers', '1');
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
    (f.newOnly ? 1 : 0) +
    (f.offersOnly ? 1 : 0) +
    Object.values(f.custom).reduce((n, v) => n + v.length, 0)
  );
}

// ---- product facts used by filters and sorts -------------------------------
// One definition each, so the filter, the sort and what the card shows agree.
// All tolerate older records that lack optional fields.

// Variants a customer could actually buy; none for simple products.
function buyableVariants(p: CatalogProduct) {
  return (p.variants ?? []).filter((v) => variantPurchasable(v));
}

// The price the customer pays now. `price` is already the selling price (the
// original price lives in `compareAtPrice`), so a discounted product is
// filtered and sorted by what it actually costs. Variant products use their
// lowest buyable variant price (variants inherit the product price by default).
export function effectivePrice(p: CatalogProduct): number {
  const buyable = buyableVariants(p);
  if (buyable.length === 0) return p.price;
  return Math.min(...buyable.map((v) => variantPrice(v, p)));
}

// Whole-percent discount shown on the card (0 = no valid discount). A discount
// is valid only when the original price really exceeds the selling price and
// rounds to at least 1%.
export function discountPercent(p: CatalogProduct): number {
  const best = (price: number, compareAt: number | null) =>
    compareAt !== null && compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0;
  const buyable = buyableVariants(p);
  if (buyable.length === 0) return best(p.price, p.compareAtPrice ?? null);
  return Math.max(...buyable.map((v) => best(variantPrice(v, p), variantCompareAtPrice(v, p))));
}

// The product card's "out of stock" rule (see resolveQuickAdd), reproduced
// without its other assumptions so it also works for older records: variant
// products are purchasable when some variant is buyable, simple products when
// not marked out of stock. "Available only" therefore never contradicts a card.
export function isPurchasable(p: CatalogProduct, attrs?: AttributeDef[]): boolean {
  if (isVariantProduct(p)) return attrs ? hasPurchasableVariant(p, attrs) : buyableVariants(p).length > 0;
  return p.availability !== 'out_of_stock';
}

const norm = (s: string) => s.trim().toLowerCase();

// Normalized color keys a product genuinely has: its own assigned colors plus
// the color of any buyable variant. Nothing is inferred (never from images).
export function productColors(p: CatalogProduct): Set<string> {
  const out = new Set<string>();
  for (const c of productAxisValues({ ...p, colors: p.colors ?? [] }, 'color')) out.add(norm(c));
  for (const v of buyableVariants(p)) {
    const c = v.combo?.['color'];
    if (c) out.add(norm(c));
  }
  return out;
}

export interface FilterContext {
  // Needed to apply the exact availability rule to variant products.
  attrs?: AttributeDef[];
  // REAL sales counts per product id. Absent = no reliable sales data, in
  // which case "best-selling" falls back to the store's featured order.
  salesCounts?: Record<string, number>;
}

const byFeatured = (a: CatalogProduct, b: CatalogProduct) =>
  Number(b.featured === true) - Number(a.featured === true) || a.id.localeCompare(b.id);

export function applyFilters(
  products: CatalogProduct[],
  f: FilterState,
  ctx: FilterContext = {},
): CatalogProduct[] {
  const bucket = f.priceBucket ? priceBuckets.find((b) => b.key === f.priceBucket) : null;
  const wantedColors = f.colors.map(norm);
  const filtered = products.filter((p) => {
    if (f.categories.length && !f.categories.includes(p.category)) return false;
    if (wantedColors.length) {
      const have = productColors(p);
      if (!wantedColors.some((c) => have.has(c))) return false; // OR between colors
    }
    if (f.materials.length && !(p.materials ?? []).some((m) => f.materials.includes(m))) return false;
    if (f.sizes.length && !f.sizes.includes(p.size)) return false;
    if (f.inStockOnly && !isPurchasable(p, ctx.attrs)) return false;
    if (f.newOnly && p.isNew !== true) return false;
    if (f.offersOnly && discountPercent(p) === 0) return false;
    if (bucket) {
      const price = effectivePrice(p);
      if (price < bucket.min || (bucket.max !== null && price >= bucket.max)) return false;
    }
    for (const [attrKey, selected] of Object.entries(f.custom)) {
      if (!selected.length) continue;
      const assigned = productAxisValues(p, attrKey);
      if (!selected.some((v) => assigned.includes(v))) return false;
    }
    return true; // every active group must pass (AND between groups)
  });
  switch (f.sort) {
    case 'price-asc':
      return [...filtered].sort((a, b) => effectivePrice(a) - effectivePrice(b) || byFeatured(a, b));
    case 'price-desc':
      return [...filtered].sort((a, b) => effectivePrice(b) - effectivePrice(a) || byFeatured(a, b));
    case 'newest':
      return [...filtered].sort(
        (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || byFeatured(a, b),
      );
    case 'discount':
      // Undiscounted products (0%) naturally rank below every discounted one.
      return [...filtered].sort((a, b) => discountPercent(b) - discountPercent(a) || byFeatured(a, b));
    case 'best-selling': {
      const sales = ctx.salesCounts;
      if (!sales) return [...filtered].sort(byFeatured); // no real data → store order
      return [...filtered].sort((a, b) => (sales[b.id] ?? 0) - (sales[a.id] ?? 0) || byFeatured(a, b));
    }
    default:
      return [...filtered].sort(byFeatured);
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

  // Every setter patches only its own field, so changing one filter never
  // resets the others (or the sort).
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
    setNewOnly: (v: boolean) => set({ newOnly: v }),
    setOffersOnly: (v: boolean) => set({ offersOnly: v }),
    setSort: (sort: SortKey) => set({ sort }),
    // Resets every filter AND the sort, keeping only the search query (see update).
    clearAll: () => update(defaultFilters),
  };
}
