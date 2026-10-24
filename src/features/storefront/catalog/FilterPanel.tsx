import { Check, ChevronDown } from 'lucide-react';
import { priceBuckets, type CatalogProduct } from './catalogData';
import {
  enabledValues,
  useAttributes,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeDef,
} from './attributeStore';
import { useCatalog } from './catalogStore';
import { activeFilterCount, productColors, type SortKey, type useProductFilters } from './useProductFilters';
import type { StorefrontLocale } from '../../shared/utils/locale';

export type FilterControls = ReturnType<typeof useProductFilters>;

const copy = {
  ar: {
    filters: 'الفلاتر',
    clearAll: 'مسح الكل',
    sort: 'ترتيب حسب',
    category: 'القسم',
    price: 'السعر',
    color: 'اللون',
    material: 'الخامة',
    size: 'المقاس',
    quick: 'تصفية سريعة',
    inStock: 'المتوفر فقط',
    newArrivals: 'وصل حديثًا',
    offers: 'عروض وخصومات',
    anyPrice: 'كل الأسعار',
    sortOptions: {
      featured: 'المميزة',
      'best-selling': 'الأكثر مبيعًا',
      newest: 'وصل حديثًا',
      'price-asc': 'السعر: من الأقل للأعلى',
      'price-desc': 'السعر: من الأعلى للأقل',
      discount: 'أكبر خصم',
    } as Record<SortKey, string>,
  },
  en: {
    filters: 'Filters',
    clearAll: 'Clear all',
    sort: 'Sort by',
    category: 'Category',
    price: 'Price',
    color: 'Color',
    material: 'Material',
    size: 'Size',
    quick: 'Quick filters',
    inStock: 'In stock only',
    newArrivals: 'New arrivals',
    offers: 'Offers & discounts',
    anyPrice: 'All prices',
    sortOptions: {
      featured: 'Featured',
      'best-selling': 'Best selling',
      newest: 'Newest',
      'price-asc': 'Price: low to high',
      'price-desc': 'Price: high to low',
      discount: 'Biggest discount',
    } as Record<SortKey, string>,
  },
};

// Order shown to customers. "Best selling" is offered only when real sales
// data exists (see salesData.ts); "Featured" is the store's own manual order.
const SORT_ORDER: SortKey[] = ['featured', 'best-selling', 'newest', 'price-asc', 'price-desc', 'discount'];

// Collapsible group (native <details>: keyboard and screen-reader friendly).
function Group({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-espresso/10 pt-4 first:border-t-0 first:pt-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 pb-3 font-display text-base text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 text-espresso/50 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 pb-1">{children}</div>
    </details>
  );
}

const checkRow =
  'flex w-full cursor-pointer items-center gap-2.5 py-1 text-sm text-espresso/75 transition hover:text-espresso has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-burgundy';
const checkBox = (on: boolean) =>
  `flex size-4 shrink-0 items-center justify-center rounded-[3px] border transition ${
    on ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30 bg-transparent'
  }`;
const radioDot = (on: boolean) =>
  `size-4 shrink-0 rounded-full border transition ${on ? 'border-[5px] border-burgundy' : 'border-espresso/30'}`;

// Compact on/off switch for the quick filters.
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-3 py-1.5 text-sm text-espresso/80 transition hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
    >
      <span>{label}</span>
      <span
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none ${
          checked ? 'justify-end bg-burgundy' : 'justify-start bg-espresso/20'
        }`}
        aria-hidden
      >
        <span className="size-4 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

export function FilterPanel({
  ctrl,
  locale,
  showCategory = false,
  facets = [],
  products,
  salesAvailable = false,
  showHeader = false,
}: {
  ctrl: FilterControls;
  locale: StorefrontLocale;
  showCategory?: boolean;
  // Enabled+filterable custom attributes applicable to this listing.
  facets?: AttributeDef[];
  // The listing's own products — color swatches offered are the colors these
  // products really have (no dead swatches).
  products?: CatalogProduct[];
  // Whether real sales data exists for the "best selling" sort.
  salesAvailable?: boolean;
  // Heading row with the reset action (desktop sidebar; the mobile sheet has its own).
  showHeader?: boolean;
}) {
  const t = copy[locale];
  const f = ctrl.filters;
  const { categories, products: allProducts } = useCatalog();
  const attrs = useAttributes();
  const activeCount = activeFilterCount(f);
  // Facet visibility is decided by the listing's `facets` prop (enabled +
  // filterable + category-scoped + has enabled values) — that predicate is the
  // single source of truth and applies identically to the reserved
  // color/material/size attributes and custom attributes. Reserved groups
  // keep their bespoke UIs but render only when their attribute qualifies.
  const attr = (k: string) => attrs.find((a) => a.key === k);
  const facetKeys = new Set(facets.map((a) => a.key));
  const listing = products ?? allProducts;
  const usedColors = new Set(listing.flatMap((p) => [...productColors(p)]));
  const colors = enabledValues('color').filter(
    (c) => usedColors.has(c.key.toLowerCase()) || f.colors.includes(c.key),
  );
  const materials = enabledValues('material');
  // Only sizes at least one product carries — the registry now spans every
  // product type, so unused values would just be dead filter options.
  const usedSizes = new Set(allProducts.flatMap((p) => p.sizes));
  const sizes = enabledValues('size').filter((s) => usedSizes.has(s.key));

  return (
    <div className="space-y-5">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-espresso">{t.filters}</h2>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={ctrl.clearAll}
              className="text-sm font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              {t.clearAll}
            </button>
          )}
        </div>
      )}

      <Group title={t.sort}>
        {SORT_ORDER.filter((k) => k !== 'best-selling' || salesAvailable).map((k) => {
          const on = f.sort === k || (f.sort === 'best-selling' && !salesAvailable && k === 'featured');
          return (
            <label key={k} className={checkRow}>
              <input
                type="radio"
                name="listing-sort"
                className="sr-only"
                checked={on}
                onChange={() => ctrl.setSort(k)}
              />
              <span className={radioDot(on)} aria-hidden />
              {t.sortOptions[k]}
            </label>
          );
        })}
      </Group>

      <Group title={t.quick}>
        <Toggle label={t.inStock} checked={f.inStockOnly} onChange={ctrl.setInStockOnly} />
        <Toggle label={t.newArrivals} checked={f.newOnly} onChange={ctrl.setNewOnly} />
        <Toggle label={t.offers} checked={f.offersOnly} onChange={ctrl.setOffersOnly} />
      </Group>

      {showCategory && (
        <Group title={t.category}>
          {categories.filter((c) => c.visible).map((c) => {
            const on = f.categories.includes(c.slug);
            return (
              <label key={c.slug} className={checkRow}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => ctrl.toggleCategory(c.slug)}
                />
                <span className={checkBox(on)} aria-hidden>
                  {on && <Check className="size-3" />}
                </span>
                {c.name[locale]}
              </label>
            );
          })}
        </Group>
      )}

      <Group title={t.price}>
        <label className={checkRow}>
          <input
            type="radio"
            name="price-bucket"
            className="sr-only"
            checked={f.priceBucket === null}
            onChange={() => ctrl.setPriceBucket(null)}
          />
          <span className={radioDot(f.priceBucket === null)} aria-hidden />
          {t.anyPrice}
        </label>
        {priceBuckets.map((b) => {
          const on = f.priceBucket === b.key;
          return (
            <label key={b.key} className={checkRow}>
              <input
                type="radio"
                name="price-bucket"
                className="sr-only"
                checked={on}
                onChange={() => ctrl.setPriceBucket(b.key)}
              />
              <span className={radioDot(on)} aria-hidden />
              {b.label[locale]}
            </label>
          );
        })}
      </Group>

      {facetKeys.has('color') && colors.length > 0 && (
        <Group title={attr('color')?.name[locale] ?? t.color}>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const on = f.colors.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => ctrl.toggleColor(c.key)}
                  aria-pressed={on}
                  title={c.label[locale]}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                    on
                      ? 'border-burgundy bg-burgundy/5 font-semibold text-espresso'
                      : 'border-espresso/15 text-espresso/70 hover:border-espresso/40'
                  }`}
                >
                  <span
                    className="size-3.5 rounded-full border border-espresso/20"
                    style={{ backgroundColor: c.hex }}
                    aria-hidden
                  />
                  {c.label[locale]}
                </button>
              );
            })}
          </div>
        </Group>
      )}

      {facetKeys.has('material') && materials.length > 0 && (
        <Group title={attr('material')?.name[locale] ?? t.material}>
          {materials.map((m) => {
            const on = f.materials.includes(m.key);
            return (
              <label key={m.key} className={checkRow}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => ctrl.toggleMaterial(m.key)}
                />
                <span className={checkBox(on)} aria-hidden>
                  {on && <Check className="size-3" />}
                </span>
                {m.label[locale]}
              </label>
            );
          })}
        </Group>
      )}

      {facetKeys.has('size') && sizes.length > 0 && (
        <Group title={attr('size')?.name[locale] ?? t.size}>
          {sizes.map((s) => {
            const on = f.sizes.includes(s.key);
            return (
              <label key={s.key} className={checkRow}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => ctrl.toggleSize(s.key)}
                />
                <span className={checkBox(on)} aria-hidden>
                  {on && <Check className="size-3" />}
                </span>
                {s.label[locale]}
              </label>
            );
          })}
        </Group>
      )}

      {facets.filter((a) => !(RESERVED_ATTRIBUTE_KEYS as readonly string[]).includes(a.key)).map((a) => {
        const values = a.values.filter((v) => v.enabled).sort((x, y) => x.order - y.order);
        if (values.length === 0) return null;
        const selected = f.custom[a.key] ?? [];
        return (
          <Group key={a.key} title={a.name[locale]}>
            {a.display === 'swatch' ? (
              <div className="flex flex-wrap gap-2">
                {values.map((v) => {
                  const on = selected.includes(v.key);
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => ctrl.toggleAttrValue(a.key, v.key)}
                      aria-pressed={on}
                      title={v.label[locale]}
                      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                        on
                          ? 'border-burgundy bg-burgundy/5 text-espresso'
                          : 'border-espresso/15 text-espresso/70 hover:border-espresso/40'
                      }`}
                    >
                      {v.hex && (
                        <span
                          className="size-3.5 rounded-full border border-espresso/15"
                          style={{ backgroundColor: v.hex }}
                          aria-hidden
                        />
                      )}
                      {v.label[locale]}
                    </button>
                  );
                })}
              </div>
            ) : (
              values.map((v) => {
                const on = selected.includes(v.key);
                return (
                  <label key={v.key} className={checkRow}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => ctrl.toggleAttrValue(a.key, v.key)}
                    />
                    <span className={checkBox(on)} aria-hidden>
                      {on && <Check className="size-3" />}
                    </span>
                    {v.label[locale]}
                  </label>
                );
              })
            )}
          </Group>
        );
      })}
    </div>
  );
}
