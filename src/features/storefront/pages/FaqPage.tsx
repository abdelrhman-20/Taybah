import { Link } from 'react-router';
import {
  ChevronDown,
  ChevronLeft,
  CreditCard,
  Headphones,
  Mail,
  Package,
  Phone,
  ShoppingBag,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { buttonStyles } from '../../shared/components/buttonStyles';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { HOTLINE_NUMBER } from '../layout/storeContact';
import { faqContent, faqImages, type FaqCategory, type FaqIcon } from './faqContent';

const homeLabel = { ar: 'الرئيسية', en: 'Home' };

const ICONS: Record<FaqIcon, LucideIcon> = {
  products: Package,
  orders: ShoppingBag,
  payment: CreditCard,
  shipping: Truck,
};

// A destination is only offered when it is really configured — the hotline from
// storeContact (the same number the header links to) and the existing contact page.
const hotline = HOTLINE_NUMBER.trim();

function CategoryCard({
  category,
  pendingTag,
  questionsCount,
}: {
  category: FaqCategory;
  pendingTag: string;
  questionsCount: (n: number) => string;
}) {
  const Icon = ICONS[category.icon];
  return (
    <details className="group overflow-hidden rounded-xl border border-taupe/70 bg-white/70 shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)] transition-colors open:bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-4 p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-burgundy sm:p-5 [&::-webkit-details-marker]:hidden">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-taupe/35 text-burgundy sm:size-16" aria-hidden>
          <Icon className="size-7" strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl text-espresso">{category.title}</span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-espresso/60">{category.description}</span>
          <span className="mt-1 block text-xs text-espresso/45">{questionsCount(category.items.length)}</span>
        </span>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-taupe bg-porcelain text-espresso/70 transition group-open:bg-burgundy group-open:text-white"
          aria-hidden
        >
          <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </span>
      </summary>
      <div className="divide-y divide-espresso/10 border-t border-taupe/60 px-4 sm:px-5">
        {category.items.map((item) => (
          <details key={item.q} className="group/q">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold text-espresso transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                className="size-4 shrink-0 text-espresso/45 transition-transform duration-200 group-open/q:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <div className="pb-5 pe-6">
              <p className="text-sm leading-7 text-espresso/70">{item.a}</p>
              {item.pending && (
                <span className="mt-2 inline-block rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-[11px] font-medium text-espresso/70">
                  {pendingTag}
                </span>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

export function FaqPage() {
  const locale = useStorefrontLocale();
  const t = faqContent[locale];
  const contactTo = navHref(locale, '/contact');

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-[1360px]">
        {/* Hero: text on the start side over a soft porcelain fade, photo on the end side */}
        <section
          aria-labelledby="faq-title"
          className="relative isolate overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain"
        >
          <AssetImage
            src={faqImages.hero}
            alt=""
            className="absolute inset-0 -z-20 size-full object-cover object-[30%_60%]"
          />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/80 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/90 sm:to-porcelain/0 sm:via-45% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
            <div className="max-w-xl">
              <Breadcrumb items={[{ label: homeLabel[locale], to: navHref(locale, '/') }, { label: t.title }]} />
              <h1 id="faq-title" className="mt-5 font-display text-4xl text-burgundy sm:text-5xl">
                {t.title}
              </h1>
              <p className="mt-3 max-w-md text-sm leading-7 text-espresso/75 sm:text-base">{t.intro}</p>
              <OrnamentDivider className="mt-5" />
            </div>
          </div>
        </section>

        <p className="mt-5 border-s-2 border-gold bg-taupe/25 px-4 py-3 text-xs leading-6 text-espresso/65">
          {t.notice}
        </p>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8">
          <div className="space-y-4">
            {t.categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                pendingTag={t.pendingTag}
                questionsCount={t.questionsCount}
              />
            ))}
          </div>

          <aside
            aria-labelledby="faq-support"
            className="rounded-xl border border-taupe/70 bg-white/70 p-6 text-center shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)] lg:sticky lg:top-6"
          >
            <Headphones className="mx-auto size-12 text-gold" strokeWidth={1.3} aria-hidden />
            <h2 id="faq-support" className="mt-3 font-display text-2xl text-espresso">
              {t.support.heading}
            </h2>
            <p className="mt-2 text-sm leading-7 text-espresso/65">{t.support.body}</p>
            {hotline && (
              <a href={`tel:${hotline}`} className={`${buttonStyles('primary', 'md')} mt-5 w-full rounded-md`}>
                <Phone className="size-4" aria-hidden />
                {t.support.call}
                <span dir="ltr">{hotline}</span>
              </a>
            )}
            <Link
              to={contactTo}
              className="mt-4 flex items-center gap-3 rounded-md border border-taupe/70 bg-porcelain px-4 py-3 text-start transition hover:border-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              <Mail className="size-5 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-espresso">{t.support.contactLink}</span>
                <span className="block text-xs text-espresso/55">{t.support.contactHint}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-espresso/40 ltr:rotate-180" aria-hidden />
            </Link>
          </aside>
        </div>

        {/* Contact banner */}
        <section
          aria-labelledby="faq-banner"
          className="relative isolate mt-8 overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain"
        >
          <AssetImage
            src={faqImages.banner}
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/85 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/92 sm:to-porcelain/10 sm:via-55% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
            <div className="max-w-md">
              <h2 id="faq-banner" className="font-display text-2xl text-espresso sm:text-3xl">
                {t.banner.heading}
              </h2>
              <p className="mt-1.5 text-sm leading-7 text-espresso/70">{t.banner.body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {hotline && (
                <a href={`tel:${hotline}`} className={`${buttonStyles('primary', 'md')} rounded-md`}>
                  <Phone className="size-4" aria-hidden />
                  {t.banner.call}
                  <span dir="ltr">{hotline}</span>
                </a>
              )}
              <Link to={contactTo} className={`${buttonStyles('outline', 'md')} rounded-md bg-white/70`}>
                <Mail className="size-4" aria-hidden />
                {t.banner.contact}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Container>
  );
}
