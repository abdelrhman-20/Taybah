import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { RevealItem } from '../../shared/components/Reveal';
import { ProductCard } from '../components/ProductCard';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
import { productIsPublic, useCatalog } from '../catalog/catalogStore';
import type { CatalogProduct } from '../catalog/catalogData';
import type { HomeContent } from './homeStore';

const allTabKey = '__all__';
// One "page" is two rows of the four-column grid — the prev/next arrows page
// through the curated set rather than scrolling a single-row carousel, so
// the section stays a plain wrapping grid (never a horizontal-scroll strip).
const PAGE_SIZE = 8;

const copy = {
  ar: { prev: 'المنتجات السابقة', next: 'المزيد من المنتجات' },
  en: { prev: 'Previous products', next: 'More products' },
};

export function FeaturedProducts({ content }: { content: HomeContent['products'] }) {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  // Selection order is preserved; hidden/unpublished products never render.
  const featured = content.productIds
    .map((id) => catalog.products.find((p) => p.id === id))
    .filter(
      (p): p is (typeof catalog.products)[number] =>
        Boolean(p) && productIsPublic(p!, catalog),
    );

  // Tabs mirror whichever categories the curated selection actually spans —
  // no separate admin configuration needed. A selection spanning only one
  // category renders as a plain grid (a single tab would be meaningless).
  const presentCategorySlugs = [...new Set(featured.map((p) => p.category))];
  const tabs = presentCategorySlugs
    .map((slug) => catalog.categories.find((c) => c.slug === slug))
    .filter((c): c is (typeof catalog.categories)[number] => Boolean(c) && c!.visible);
  const showTabs = tabs.length > 1;

  const [activeTab, setActiveTab] = useState(allTabKey);
  const visible: CatalogProduct[] =
    showTabs && activeTab !== allTabKey
      ? featured.filter((p) => p.category === activeTab)
      : featured;

  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(visible.length / PAGE_SIZE);
  // Switching tabs can leave `page` pointing past the new (shorter) list —
  // clamp while rendering rather than rendering an empty grid for a tick.
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pageItems = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (featured.length === 0) return null;

  return (
    <section aria-labelledby="featured-products" className="bg-white py-14 sm:py-20">
      <Container>
        <div className="mx-auto mb-8 max-w-xl text-center">
          {content.eyebrow && (
            <p className="mb-3 text-[14px] font-semibold tracking-[0.25em] text-burgundy uppercase">
              {content.eyebrow}
            </p>
          )}
          <h2 id="featured-products" className="font-display text-3xl leading-tight text-espresso sm:text-4xl">
            {emphasizeLastWord(content.title)}
          </h2>
          <OrnamentDivider align="center" className="mt-5" />
        </div>

        {showTabs && (
          <div className="mb-10 flex flex-wrap justify-center gap-x-7 gap-y-2">
            {[
              { slug: allTabKey, name: locale === 'ar' ? 'الكل' : 'All' },
              ...tabs.map((c) => ({ slug: c.slug, name: c.name[locale] })),
            ].map((tab) => {
              const active = activeTab === tab.slug;
              return (
                <button
                  key={tab.slug}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.slug);
                    setPage(0);
                  }}
                  aria-pressed={active}
                  className={`relative border-b-2 pb-2 font-display text-base transition-colors sm:text-lg ${
                    active
                      ? 'border-burgundy text-burgundy'
                      : 'border-transparent text-espresso/55 hover:text-espresso'
                  }`}
                >
                  {tab.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="relative">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {pageItems.map((product, index) => (
              <li key={product.id}>
                <RevealItem variant="up" delay={index * 60} duration={400}>
                  <ProductCard product={product} card />
                </RevealItem>
              </li>
            ))}
          </ul>

          {pageCount > 1 && (
            <>
              {/* Physical left/right, not logical start/end — a single
                  unambiguous icon per button, same convention as the hero
                  slider's arrows: left steps back, right steps forward. */}
              <button
                type="button"
                aria-label={t.prev}
                disabled={safePage === 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
                className="absolute left-0 top-1/3 inline-flex size-9 -translate-x-1/2 items-center justify-center rounded-full text-espresso/40 transition hover:text-burgundy disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t.next}
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                className="absolute right-0 top-1/3 inline-flex size-9 translate-x-1/2 items-center justify-center rounded-full text-espresso/40 transition hover:text-burgundy disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <ChevronRight className="size-6" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </Container>
    </section>
  );
}
