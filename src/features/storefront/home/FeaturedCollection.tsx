import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { RevealItem } from '../../shared/components/Reveal';
import { SectionHeading } from '../../shared/components/SectionHeading';
import { navHref } from '../layout/navData';
import { useTransitionClick } from '../layout/useTransitionClick';
import { useCatalog } from '../catalog/catalogStore';
import type { HomeContent } from './homeStore';

export function FeaturedCollection({ content }: { content: HomeContent['collection'] }) {
  const locale = useStorefrontLocale();
  const { collections } = useCatalog();
  const collection = collections.find((c) => c.slug === content.slug);
  const to = navHref(locale, `/collection/${content.slug}`);
  const transitionClick = useTransitionClick(to, collection?.name[locale] ?? '');
  // A hidden or deleted collection hides the whole section publicly.
  if (!collection || !collection.visible) return null;
  return (
    <section aria-labelledby="featured-collection" className="py-14 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow={content.eyebrow}
          title={collection.name[locale]}
          description={collection.description[locale]}
        />
        <Link
          to={to}
          onClick={transitionClick}
          className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
        >
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <RevealItem variant="up" duration={550}>
              <AssetImage
                src={content.image1}
                alt={`${collection.name[locale]} — قطعة أولى`}
                loading="lazy"
                className="aspect-[3/4] w-full rounded-sm object-cover shadow-[0_24px_48px_-22px_rgba(41,34,30,0.3)] transition-transform duration-500 group-hover:scale-[1.02]"
              />
            </RevealItem>
            <RevealItem variant="up" delay={140} duration={550}>
              <AssetImage
                src={content.image2}
                alt={`${collection.name[locale]} — قطعة ثانية`}
                loading="lazy"
                className="mt-8 aspect-[3/4] w-full rounded-sm object-cover shadow-[0_24px_48px_-22px_rgba(41,34,30,0.3)] transition-transform duration-500 group-hover:scale-[1.02] sm:mt-14"
              />
            </RevealItem>
          </div>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-espresso transition-colors group-hover:text-burgundy">
            {content.actionLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </span>
        </Link>
      </Container>
    </section>
  );
}
