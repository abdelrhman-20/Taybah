import { Link } from 'react-router';
import {
  Award,
  Gem,
  Home,
  Languages,
  LayoutGrid,
  Leaf,
  Mail,
  Ruler,
  type LucideIcon,
} from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { buttonStyles } from '../../shared/components/buttonStyles';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { aboutContent, aboutImages, type DiffIcon, type ValueIcon } from './aboutContent';

const homeLabel = { ar: 'الرئيسية', en: 'Home' };

const VALUE_ICONS: Record<ValueIcon, LucideIcon> = {
  authenticity: Home,
  quality: Award,
  calm: Leaf,
  transparency: Gem,
};
const DIFF_ICONS: Record<DiffIcon, LucideIcon> = {
  curated: LayoutGrid,
  arabic: Languages,
  documented: Ruler,
};

export function AboutPage() {
  const locale = useStorefrontLocale();
  const t = aboutContent[locale];
  const titleNode =
    locale === 'ar' ? (
      <>
        من <span className="text-burgundy">نحن</span>
      </>
    ) : (
      <>
        About <span className="text-burgundy">Us</span>
      </>
    );

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-[1360px]">
        {/* Hero: text on the start side, workshop photo on the end side fading into it */}
        <section
          aria-labelledby="about-title"
          className="overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
        >
          <div className="flex items-center px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
            <div className="max-w-lg">
              <Breadcrumb items={[{ label: homeLabel[locale], to: navHref(locale, '/') }, { label: t.title }]} />
              <h1 id="about-title" className="mt-5 font-display text-4xl text-espresso sm:text-5xl">
                {titleNode}
              </h1>
              <p className="mt-3 text-sm leading-7 text-espresso/75 sm:text-base">{t.intro}</p>
              <OrnamentDivider className="mt-5" />
            </div>
          </div>
          <div className="order-first h-56 sm:h-64 lg:order-none lg:h-72">
            <AssetImage
              src={aboutImages.hero}
              alt={t.title}
              className="size-full object-cover object-[50%_45%] lg:[mask-image:linear-gradient(to_right,#000_72%,transparent)] lg:ltr:[mask-image:linear-gradient(to_left,#000_72%,transparent)]"
            />
          </div>
        </section>

        <p className="mt-5 border-s-2 border-gold bg-taupe/25 px-4 py-3 text-xs leading-6 text-espresso/65">{t.note}</p>

        {/* Values strip */}
        <section aria-labelledby="about-values" className="mt-6">
          <h2 id="about-values" className="sr-only">
            {t.valuesH}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {t.values.map((v) => {
              const Icon = VALUE_ICONS[v.id];
              return (
                <li
                  key={v.id}
                  className="flex flex-col items-center gap-2 rounded-xl border border-taupe/70 bg-white/70 p-5 text-center shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)]"
                >
                  <Icon className="size-8 text-gold" strokeWidth={1.4} aria-hidden />
                  <h3 className="font-display text-lg text-espresso">{v.h}</h3>
                  <p className="text-[13px] leading-6 text-espresso/60">{v.p}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Story */}
        <section aria-labelledby="about-story" className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <div>
            <h2 id="about-story" className="font-display text-3xl text-espresso sm:text-4xl">
              <span className="text-burgundy">{t.storyH}</span>
            </h2>
            <OrnamentDivider className="mt-4" />
            {t.story.map((p, i) => (
              <p key={i} className="mt-5 max-w-xl text-sm leading-8 text-espresso/75 sm:text-base">
                {p}
              </p>
            ))}
            <Link to={navHref(locale, '/products')} className={`${buttonStyles('primary', 'md')} mt-7 rounded-md`}>
              {t.browse}
            </Link>
          </div>
          <AssetImage
            src={aboutImages.story}
            alt=""
            loading="lazy"
            className="aspect-[4/3] w-full rounded-2xl border border-taupe/60 object-cover shadow-[0_18px_36px_-24px_rgba(41,34,30,0.4)]"
          />
        </section>

        {/* "What makes Taybah different" — the numeric statistics strip is omitted on
            purpose (no verified figures exist); this keeps the same strip rhythm. */}
        <section aria-labelledby="about-diff" className="mt-12 text-center">
          <h2 id="about-diff" className="font-display text-3xl text-espresso sm:text-4xl">
            {locale === 'ar' ? (
              <>
                ما يميز <span className="text-burgundy">طيبة</span>
              </>
            ) : (
              t.diffH
            )}
          </h2>
          <OrnamentDivider align="center" className="mt-4" />
          <ul className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-x-reverse sm:divide-espresso/10">
            {t.diffs.map((d) => {
              const Icon = DIFF_ICONS[d.id];
              return (
                <li key={d.id} className="flex flex-col items-center gap-3 px-6">
                  <Icon className="size-9 text-gold" strokeWidth={1.4} aria-hidden />
                  <p className="max-w-xs text-sm leading-7 text-espresso/75">{d.text}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Contact CTA */}
        <section aria-labelledby="about-cta" className="relative isolate mt-12 overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain">
          <AssetImage src={aboutImages.banner} alt="" loading="lazy" className="absolute inset-0 -z-20 size-full object-cover" />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/85 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/92 sm:to-porcelain/10 sm:via-55% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
            <div className="max-w-md">
              <h2 id="about-cta" className="font-display text-2xl text-espresso sm:text-3xl">
                {t.cta.heading}
              </h2>
              <p className="mt-1.5 text-sm leading-7 text-espresso/70">{t.cta.body}</p>
            </div>
            <Link
              to={navHref(locale, '/contact')}
              className={`${buttonStyles('primary', 'md')} self-start rounded-md sm:self-auto`}
            >
              <Mail className="size-4" aria-hidden />
              {t.cta.button}
            </Link>
          </div>
        </section>
      </div>
    </Container>
  );
}
