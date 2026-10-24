import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Container } from '../../shared/components/Container';
import { buttonStyles } from '../../shared/components/buttonStyles';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { useTransitionClick } from '../layout/useTransitionClick';
import { useCatalog } from '../catalog/catalogStore';
import type { CatalogCollection } from '../catalog/catalogData';
import { RevealItem } from '../../shared/components/Reveal';
import { HomeSectionHeader } from './HomeSectionHeader';
import type { CollectionCard as CollectionCardConfig, HomeContent } from './homeStore';

function CollectionCard({
  card,
  collection,
  ctaLabel,
}: {
  card: CollectionCardConfig;
  collection: CatalogCollection;
  ctaLabel: string;
}) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, `/collection/${collection.slug}`);
  const title = card.title.trim() || collection.name[locale];
  const description = card.description.trim() || collection.description[locale];
  const transitionClick = useTransitionClick(to, title);
  const image = card.image.trim() || collection.image;
  return (
    <article className="group relative isolate flex min-h-[230px] overflow-hidden rounded-md bg-espresso shadow-[0_18px_36px_-22px_rgba(41,34,30,0.5)] lg:aspect-[2.05/1] lg:min-h-0">
      <AssetImage
        src={image}
        alt=""
        loading="lazy"
        sizes="(max-width: 640px) 84vw, (max-width: 1024px) 60vw, 33vw"
        className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <div
        className="absolute inset-0 -z-10 bg-linear-to-t from-espresso/85 via-espresso/45 to-espresso/10"
        aria-hidden="true"
      />
      <div className="my-auto flex w-full flex-col items-start p-5 sm:p-6 pt-20">
        <h3 className="font-display text-2xl leading-tight text-white sm:text-3xl">{title}</h3>
        <p className="mt-2 line-clamp-3 max-w-[34ch] text-[13px] leading-relaxed text-white/80">
          {description}
        </p>
        <Link
          to={to}
          onClick={transitionClick}
          className={`${buttonStyles('primary', 'sm')} mt-4 after:absolute after:inset-0 focus-visible:outline-white`}
        >
          <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden="true" />
          {ctaLabel}
          <span className="sr-only"> — {title}</span>
        </Link>
      </div>
    </article>
  );
}

export function CuratedCollections({ content }: { content: HomeContent['collections'] }) {
  const { collections } = useCatalog();
  const items = content.cards.flatMap((card) => {
    const collection = collections.find((c) => c.slug === card.slug);
    return collection && collection.visible ? [{ card, collection }] : [];
  });
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="curated-collections" className="py-6 sm:py-7">
      <Container>
        <HomeSectionHeader
          id="curated-collections"
          eyebrow={content.eyebrow}
          title={content.title}
          subtitle={content.subtitle}
          actionLabel={content.actionLabel}
          actionTo={content.actionTo}
        />
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible">
          {items.map(({ card, collection }, index) => (
            <li key={collection.slug} className="w-[84%] shrink-0 snap-start sm:w-[60%] lg:w-auto">
              <RevealItem variant="start" delay={Math.min(index, 5) * 90} duration={500}>
                <CollectionCard card={card} collection={collection} ctaLabel={content.ctaLabel} />
              </RevealItem>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
