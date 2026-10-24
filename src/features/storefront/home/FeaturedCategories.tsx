import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { RevealItem } from '../../shared/components/Reveal';
import { navHref } from '../layout/navData';
import { useTransitionClick } from '../layout/useTransitionClick';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
import { useCatalog } from '../catalog/catalogStore';
import type { CatalogCategory } from '../catalog/catalogData';
import type { HomeContent } from './homeStore';

// Cycle of image aspect ratios that gives the grid its asymmetric, masonry
// rhythm (tall / short / square) — repeats if there are more tiles than
// ratios, so any admin-picked set of categories still reads as a masonry.
const TILE_RATIOS = ['aspect-[3/4.2]', 'aspect-[4/5]', 'aspect-[4/3.4]', 'aspect-[3/4.8]', 'aspect-square'];

function CategoryTile({ category, ratio }: { category: CatalogCategory; ratio: string }) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, `/category/${category.slug}`);
  const transitionClick = useTransitionClick(to, category.name[locale]);
  return (
    <Link
      to={to}
      onClick={transitionClick}
      className="group mb-4 block break-inside-avoid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy sm:mb-6"
    >
      <div className="relative overflow-hidden rounded-[14px] bg-taupe/40 shadow-[0_18px_36px_-20px_rgba(41,34,30,0.3)] ring-1 ring-espresso/5 transition-shadow duration-[400ms] group-hover:shadow-[0_26px_48px_-16px_rgba(41,34,30,0.45)]">
        <AssetImage
          src={category.image}
          alt={category.name[locale]}
          loading="lazy"
          className={`${ratio} w-full object-cover transition-transform duration-[400ms] ease-out group-hover:scale-[1.06]`}
        />
        {/* Flush full-width glass bar, anchored directly to the card's own
            edges — the parent's `overflow-hidden` + rounded corners clip it,
            rather than giving the panel its own inset margin/radius, so it
            reads as part of the image instead of a card floating on it. */}
        <div className="absolute inset-x-0 bottom-0 border-t border-white/15 bg-espresso/45 px-4 py-3 backdrop-blur-sm transition-colors duration-[400ms] group-hover:bg-espresso/65">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-base text-white transition-transform duration-[400ms] group-hover:-translate-y-0.5 sm:text-lg">
              {category.name[locale]}
            </h3>
            <ArrowRight
              className="size-4 shrink-0 text-gold transition-transform duration-300 rtl:-scale-x-100 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function FeaturedCategories({ content }: { content: HomeContent['categories'] }) {
  const { categories } = useCatalog();
  const list = content.slugs
    .map((slug) => categories.find((c) => c.slug === slug))
    .filter((c): c is (typeof categories)[number] => Boolean(c) && c!.visible);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="featured-categories" className="py-14 sm:py-20">
      <Container>
        <div className="mx-auto mb-10 max-w-xl text-center">
          {content.eyebrow && (
            <p className="mb-3 text-[14px] font-semibold tracking-[0.25em] text-burgundy uppercase">
              {content.eyebrow}
            </p>
          )}
          <h2 id="featured-categories" className="font-display text-3xl leading-tight text-espresso sm:text-4xl">
            {emphasizeLastWord(content.title)}
          </h2>
          <OrnamentDivider align="center" className="mt-5" />
        </div>
        <div className="columns-2 gap-4 sm:columns-3 sm:gap-6 lg:columns-4">
          {list.map((category, index) => (
            <RevealItem
              key={category.slug}
              variant="up"
              delay={Math.min(index, 6) * 80}
              duration={500}
              className="break-inside-avoid"
            >
              <CategoryTile category={category} ratio={TILE_RATIOS[index % TILE_RATIOS.length]} />
            </RevealItem>
          ))}
        </div>
      </Container>
    </section>
  );
}
