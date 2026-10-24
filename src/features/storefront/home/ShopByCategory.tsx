import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Container } from '../../shared/components/Container';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { useTransitionClick } from '../layout/useTransitionClick';
import { useCatalog } from '../catalog/catalogStore';
import type { CatalogCategory } from '../catalog/catalogData';
import { RevealItem } from '../../shared/components/Reveal';
import { HomeSectionHeader } from './HomeSectionHeader';
import type { HomeContent, ShopCategoryCard } from './homeStore';

function CategoryCard({ card, category }: { card: ShopCategoryCard; category: CatalogCategory }) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, `/category/${category.slug}`);
  const title = card.title.trim() || category.name[locale];
  const transitionClick = useTransitionClick(to, title);
  const image = card.image.trim() || category.image;
  return (
    <Link
      to={to}
      onClick={transitionClick}
      className="group relative block overflow-hidden rounded-md bg-taupe/40 shadow-[0_14px_30px_-20px_rgba(41,34,30,0.45)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
    >
      <AssetImage
        src={image}
        alt=""
        loading="lazy"
        sizes="(max-width: 640px) 42vw, 20vw"
        className="aspect-[5/6] w-full object-cover transition-transform sm:aspect-[4/3] duration-500 ease-out group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100 lg:aspect-[13/10]"
      />
      <div
        className="absolute inset-0 bg-linear-to-t from-espresso/80 via-espresso/15 to-transparent"
        aria-hidden="true"
      />
      <span
        className="absolute bottom-3 start-3 inline-flex size-6 max-sm:hidden items-center justify-center rounded-full bg-white/90 text-espresso transition-colors group-hover:bg-white sm:size-7"
        aria-hidden="true"
      >
        <ChevronLeft className="size-4 ltr:rotate-180" />
      </span>
      <div className="absolute inset-x-3 bottom-3 text-end">
        <h3 className="font-display text-lg leading-tight text-white sm:text-xl lg:text-2xl">{title}</h3>
        {card.subtitle && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-white/75 sm:text-xs">{card.subtitle}</p>
        )}
      </div>
    </Link>
  );
}

export function ShopByCategory({ content }: { content: HomeContent['shopCategories'] }) {
  const { categories } = useCatalog();
  const items = content.cards.flatMap((card) => {
    const category = categories.find((c) => c.slug === card.slug);
    return category && category.visible ? [{ card, category }] : [];
  });
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="shop-by-category" className="py-6 sm:py-7">
      <Container>
        <HomeSectionHeader
          id="shop-by-category"
          eyebrow={content.eyebrow}
          title={content.title}
          subtitle={content.subtitle}
        />
        {/* Phones: a swipe row (next card peeks in); from sm up: the grid. */}
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-5">
          {items.map(({ card, category }, index) => (
            <li key={category.slug} className="w-[42%] shrink-0 snap-start sm:w-auto">
              <RevealItem variant="lift" delay={Math.min(index, 6) * 70}>
                <CategoryCard card={card} category={category} />
              </RevealItem>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
