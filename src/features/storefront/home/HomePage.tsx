import { Fragment } from 'react';
import { HeroSection } from './HeroSection';
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
          ) : (
            <Reveal key={s.key}>{render(s.key)}</Reveal>
          ),
        )}
    </>
  );
}
