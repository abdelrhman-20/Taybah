import { AssetImage } from '../../shared/components/AssetImage';
import { RevealItem } from '../../shared/components/Reveal';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { ButtonLink } from '../../shared/components/Button';
import { navHref } from '../layout/navData';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
import type { HomeContent } from './homeStore';

export function EditorialBanner({ content }: { content: HomeContent['editorial'] }) {
  const locale = useStorefrontLocale();
  return (
    <section aria-labelledby="editorial-banner">
      <div className="grid overflow-hidden lg:grid-cols-2">
        <RevealItem
          variant="start"
          duration={550}
          className="bg-espresso px-6 py-14 text-porcelain sm:px-10 lg:px-16 lg:py-24"
        >
          <div className="mx-auto max-w-md lg:ms-auto lg:me-0">
            <p className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.3em] text-gold uppercase">
              <span className="h-px w-5 bg-gold" aria-hidden="true" />
              {content.eyebrow}
            </p>
            <h2
              id="editorial-banner"
              className="font-display text-3xl leading-tight sm:text-4xl"
            >
              {emphasizeLastWord(content.title, 'text-gold')}
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-porcelain/70 sm:text-base">
              {content.body}
            </p>
            <div className="mt-8">
              <ButtonLink
                to={navHref(locale, content.ctaTo)}
                variant="outline"
                size="lg"
                className="border-porcelain/40 text-porcelain hover:border-porcelain"
              >
                {content.ctaLabel}
              </ButtonLink>
            </div>
          </div>
        </RevealItem>
        <AssetImage
          src={content.image}
          alt="مجموعة طيبة التحريرية"
          loading="lazy"
          className="h-full w-full object-cover max-lg:aspect-[16/10]"
        />
      </div>
    </section>
  );
}
