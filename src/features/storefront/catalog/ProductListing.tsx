import { AssetImage } from '../../shared/components/AssetImage';
import { useMemo, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb, type BreadcrumbItem } from '../../shared/components/Breadcrumb';
import { EmptyState } from '../../shared/components/EmptyState';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { ProductCard } from '../components/ProductCard';
import {
  applyFilters,
  activeFilterCount,
  useProductFilters,
} from './useProductFilters';
import { type CatalogProduct } from './catalogData';
import { useCatalog } from './catalogStore';
import { useAttributes } from './attributeStore';
import { getSalesCounts } from './salesData';
import { FilterPanel } from './FilterPanel';
import { FilterChips } from './FilterChips';
import { FilterSheet } from './FilterSheet';

const copy = {
  ar: {
    filters: 'الفلاتر',
    emptyTitle: 'لا توجد منتجات مطابقة',
    emptyDesc: 'جرّب تعديل الفلاتر أو مسحها لعرض نتائج أخرى.',
    clear: 'مسح الفلاتر',
    loadMore: 'عرض المزيد',
    showing: (v: number, t: number) => `عرض ${v} من ${t}`,
    count: (n: number) =>
      n === 1 ? 'منتج واحد' : n === 2 ? 'منتجَان' : n <= 10 ? `${n} منتجات` : `${n} منتجًا`,
  },
  en: {
    filters: 'Filters',
    emptyTitle: 'No products match',
    emptyDesc: 'Try adjusting or clearing your filters to see more results.',
    clear: 'Clear filters',
    loadMore: 'Load more',
    showing: (v: number, t: number) => `Showing ${v} of ${t}`,
    count: (n: number) => `${n} product${n === 1 ? '' : 's'}`,
  },
};

const PAGE_SIZE = 8;

// Reusable listing engine — drives /products, /category/:slug and /collection/:slug.
// All filtering is client-side over the mock catalog; filter state lives in the
// URL query string so filtered listings are shareable.
export function ProductListing({
  products,
  title,
  description,
  breadcrumb,
  banner,
  showCategory = false,
  headerSlot,
  emptyTitle,
  emptyDesc,
  emptyAction,
}: {
  products: CatalogProduct[];
  title: string;
  description?: string;
  breadcrumb: BreadcrumbItem[];
  banner?: string;
  showCategory?: boolean;
  headerSlot?: ReactNode;
  emptyTitle?: string;
  emptyDesc?: string;
  emptyAction?: ReactNode;
}) {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const { categories } = useCatalog();
  const attrs = useAttributes();
  const categoryKeys = categories.filter((c) => c.visible).map((c) => c.slug);
  const ctrl = useProductFilters(categoryKeys);
  const { filters } = ctrl;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Real sales data, when any exists — otherwise "best selling" is hidden/falls
  // back to the featured order (see salesData.ts).
  const salesCounts = getSalesCounts();
  const results = useMemo(
    () => applyFilters(products, filters, { attrs, salesCounts }),
    [products, filters, attrs, salesCounts],
  );
  const filterKey = JSON.stringify(filters);
  const [appliedKey, setAppliedKey] = useState(filterKey);
  if (appliedKey !== filterKey) {
    setAppliedKey(filterKey);
    setLimit(PAGE_SIZE);
  }

  const visible = results.slice(0, limit);
  const activeCount = activeFilterCount(filters);

  // Custom attribute facets — enabled+filterable attributes scoped to the
  // categories present in this listing (empty scope = applies everywhere).
  // Facets with no enabled values are dropped.
  const listingCats = useMemo(
    () => new Set(products.map((p) => p.category)),
    [products],
  );
  const facets = useMemo(
    () =>
      attrs.filter(
        (a) =>
          a.enabled &&
          a.filterable &&
          a.values.some((v) => v.enabled) &&
          (a.categories.length === 0 || a.categories.some((c) => listingCats.has(c))),
      ),
    [attrs, listingCats],
  );

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={breadcrumb} />

      <header className="mt-6">
        <h1 className="font-display text-3xl text-espresso sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-7 text-espresso/65">{description}</p>
        )}
        {headerSlot}
      </header>

      {banner && (
        <AssetImage
          src={banner}
          alt=""
          loading="lazy"
          sizes="100vw"
          className="mt-8 h-44 w-full object-cover sm:h-64 lg:h-80"
        />
      )}

      <div className="mt-8 flex items-center justify-between gap-3 border-y border-espresso/10 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex items-center gap-2 border border-espresso/20 bg-white px-3.5 py-2 text-sm text-espresso transition hover:border-espresso/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold md:hidden"
          >
            <SlidersHorizontal className="size-4" />
            {t.filters}
            {activeCount > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-burgundy text-[10px] font-semibold text-white">
                {activeCount}
              </span>
            )}
          </button>
          <p className="text-xs tracking-wide text-espresso/55">{t.count(results.length)}</p>
        </div>
      </div>

      {activeCount > 0 && (
        <div className="mt-4">
          <FilterChips ctrl={ctrl} locale={locale} showCategory={showCategory} />
        </div>
      )}

      <div className="mt-8 md:flex md:items-start md:gap-10">
        <aside className="hidden w-56 shrink-0 md:block lg:w-64">
          <FilterPanel
            ctrl={ctrl}
            locale={locale}
            showCategory={showCategory}
            facets={facets}
            products={products}
            salesAvailable={salesCounts !== undefined}
            showHeader
          />
        </aside>

        <div className="flex-1">
          {visible.length > 0 ? (
            <>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((product) => (
                  <li key={product.id}>
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
              {results.length > limit && (
                <div className="mt-12 flex flex-col items-center gap-3">
                  <p className="text-xs tracking-wide text-espresso/55">
                    {t.showing(visible.length, results.length)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE_SIZE)}
                    className="border border-espresso/25 bg-white px-8 py-2.5 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {t.loadMore}
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title={emptyTitle ?? t.emptyTitle}
              description={emptyDesc ?? t.emptyDesc}
              action={
                emptyAction !== undefined ? emptyAction : (
                  <button
                    type="button"
                    onClick={ctrl.clearAll}
                    className="border border-burgundy px-6 py-2.5 text-sm font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {t.clear}
                  </button>
                )
              }
            />
          )}
        </div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        ctrl={ctrl}
        locale={locale}
        showCategory={showCategory}
        resultCount={results.length}
        facets={facets}
        products={products}
        salesAvailable={salesCounts !== undefined}
      />
    </Container>
  );
}
