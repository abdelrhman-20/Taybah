import { AssetImage } from '../../shared/components/AssetImage';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { RevealItem } from '../../shared/components/Reveal';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
import type { HomeContent } from './homeStore';

export function BrandIntro({ content }: { content: HomeContent['brand'] }) {
  return (
    <section aria-labelledby="brand-intro" className="py-14 sm:py-24">
      <Container className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
        <RevealItem variant="start" duration={600} className="relative lg:col-span-5 lg:order-2">
          <div
            className="absolute -inset-3 -z-10 rounded-sm border border-gold/30 sm:-inset-4"
            aria-hidden="true"
          />
          <AssetImage
            src={content.image}
            alt="تفاصيل حِرفة طيبة"
            loading="lazy"
            sizes="(max-width: 1024px) 100vw, 40vw"
            className="aspect-[5/6] w-full rounded-sm object-cover shadow-[0_28px_56px_-22px_rgba(41,34,30,0.32)]"
          />
        </RevealItem>
        <RevealItem variant="up" delay={160} duration={550} className="lg:col-span-7 lg:order-1">
          <p className="mb-10 flex items-center gap-2.5 text-[18px] font-semibold tracking-[0.3em] text-burgundy uppercase">
            <span className="h-px w-5 bg-burgundy" aria-hidden="true" />
            {content.eyebrow}
          </p>
          <h2
            id="brand-intro"
            className="font-display text-3xl leading-tight text-espresso sm:text-4xl lg:text-5xl"
          >
            {emphasizeLastWord(content.title)}
          </h2>
          <p className="mt-7 max-w-2xl font-display text-lg leading-relaxed text-espresso/80">
            {content.body1}
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-espresso/65 sm:text-base">
            {content.body2}
          </p>
          <OrnamentDivider className="mt-8" />
        </RevealItem>
      </Container>
    </section>
  );
}
