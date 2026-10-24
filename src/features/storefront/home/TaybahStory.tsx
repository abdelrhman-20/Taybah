import { AssetImage } from '../../shared/components/AssetImage';
import { ButtonLink } from '../../shared/components/Button';
import { Container } from '../../shared/components/Container';
import { RevealItem } from '../../shared/components/Reveal';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { GoldEyebrow } from './HomeSectionHeader';
import type { HomeContent } from './homeStore';

// Full-bleed band: the image fills the end side and fades into the porcelain
// background behind the text block (stacks image-over-text below `lg`).
export function TaybahStory({ content }: { content: HomeContent['story'] }) {
  const locale = useStorefrontLocale();
  return (
    <section
      aria-labelledby="taybah-story"
      className="relative mt-6 overflow-hidden bg-[#f4efe7] sm:mt-7 lg:h-[clamp(15rem,19.7vw,21rem)]"
    >
      <RevealItem
        variant="scale"
        duration={600}
        className="relative h-52 sm:h-64 lg:absolute lg:inset-y-0 lg:end-0 lg:h-auto lg:w-[64%]"
      >
        <AssetImage
          src={content.image}
          alt={content.title}
          loading="lazy"
          className="size-full object-cover lg:[mask-image:linear-gradient(to_right,#000_55%,transparent)] lg:ltr:[mask-image:linear-gradient(to_left,#000_55%,transparent)]"
        />
      </RevealItem>
      <Container className="relative lg:flex lg:h-full lg:items-center">
        <RevealItem
          variant="up"
          delay={150}
          duration={550}
          className="flex flex-col items-center py-8 text-center lg:w-[36%] lg:py-6"
        >
          <GoldEyebrow>{content.eyebrow}</GoldEyebrow>
          <h2 id="taybah-story" className="font-display text-2xl leading-snug text-espresso sm:text-[1.9rem]">
            {content.title}
          </h2>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-espresso/70 sm:text-sm">
            {content.body}
          </p>
          {content.ctaLabel && (
            <div className="mt-4">
              <ButtonLink to={navHref(locale, content.ctaTo)} size="md">
                {content.ctaLabel}
              </ButtonLink>
            </div>
          )}
        </RevealItem>
      </Container>
    </section>
  );
}
