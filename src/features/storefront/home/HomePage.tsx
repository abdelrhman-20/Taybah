import { Fragment } from 'react';
import { HeroSection } from './HeroSection';
import { ShopByCategory } from './ShopByCategory';
import { CuratedCollections } from './CuratedCollections';
import { BestSellers } from './BestSellers';
import { TaybahStory } from './TaybahStory';
import { FeaturedCategories } from './FeaturedCategories';
import { FeaturedProducts } from './FeaturedProducts';
import { BrandIntro } from './BrandIntro';
import { EditorialBanner } from './EditorialBanner';
import { FeaturedCollection } from './FeaturedCollection';
import { NewsletterSection } from './NewsletterSection';
import { Reveal } from '../../shared/components/Reveal';
import { useHomeContent, type HomeSectionKey } from './homeStore';

export function HomePage() {
  const home = useHomeContent();
  const render = (key: HomeSectionKey) => {
    switch (key) {
      case 'hero':
        // The hero is above the fold on load — it animates in immediately
        // (see HeroSection) rather than waiting for a scroll-triggered reveal.
        return <HeroSection content={home.hero} />;
      case 'shopCategories':
        return <ShopByCategory content={home.shopCategories} />;
      case 'collections':
        return <CuratedCollections content={home.collections} />;
      case 'bestSellers':
        return <BestSellers content={home.bestSellers} />;
      case 'story':
        return <TaybahStory content={home.story} />;
      case 'categories':
        return <FeaturedCategories content={home.categories} />;
      case 'products':
        return <FeaturedProducts content={home.products} />;
      case 'brand':
        return <BrandIntro content={home.brand} />;
      case 'editorial':
        return <EditorialBanner content={home.editorial} />;
      case 'collection':
        return <FeaturedCollection content={home.collection} />;
      case 'newsletter':
        return <NewsletterSection content={home.newsletter} />;
    }
  };
  return (
    <>
      {home.sections
        .filter((s) => s.visible)
        .map((s) =>
          s.key === 'hero' ? (
            <Fragment key={s.key}>{render(s.key)}</Fragment>
          ) : s.key === 'newsletter' ? (
            // Newsletter is a compact band — a short lift reads better than
            // the ambient section fade.
            <Reveal key={s.key} variant="lift" duration={500}>
              {render(s.key)}
            </Reveal>
          ) : (
            // A soft whole-section fade underneath each section's own
            // staggered RevealItems keeps the motion layered but quiet.
            <Reveal key={s.key} variant="fade" duration={600}>
              {render(s.key)}
            </Reveal>
          ),
        )}
    </>
  );
}
