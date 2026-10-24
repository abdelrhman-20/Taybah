import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Clock, HelpCircle, MapPin, Mail, Phone, RotateCcw, Wallet, type LucideIcon } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { buttonStyles } from '../../shared/components/buttonStyles';
import { Container } from '../../shared/components/Container';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { HOTLINE_NUMBER } from '../layout/storeContact';
import { PageHero } from './PageHero';
import { shippingReturnsContent, shippingReturnsImages, type PolicyIcon } from './shippingReturnsContent';

const homeLabel = { ar: 'الرئيسية', en: 'Home' };

const ICONS: Record<PolicyIcon, LucideIcon> = {
  zones: MapPin,
  timelines: Clock,
  fees: Wallet,
  returns: RotateCcw,
};

// Only configured destinations are offered: the hotline (the same number the
// header links to) and the existing contact and FAQ pages.
const hotline = HOTLINE_NUMBER.trim();

const Tag = ({ children }: { children: string }) => (
  <span className="inline-block rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-[11px] font-medium text-espresso/70">
    {children}
  </span>
);

export function ShippingReturnsPage() {
  const locale = useStorefrontLocale();
  const t = shippingReturnsContent[locale];
  const pendingIds = new Set(t.sections.flatMap((s) => s.items.filter((i) => i.pending).map((i) => i.id)));

  const titleNode =
    locale === 'ar' ? (
      <>
        <span className="text-burgundy">الشحن</span> والإرجاع
      </>
    ) : (
      <>
        <span className="text-burgundy">Shipping</span> &amp; Returns
      </>
    );

  // A summary card jumps to its policy row, opening it first.
  const jumpTo = (target: string) => (e: MouseEvent) => {
    e.preventDefault();
    const row = document.getElementById(`sr-${target}`) as HTMLDetailsElement | null;
    if (!row) return;
    row.open = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    row.querySelector('summary')?.focus({ preventScroll: true });
  };

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-[1360px]">
        <PageHero
          id="sr-title"
          title={titleNode}
          intro={t.intro}
          image={shippingReturnsImages.hero}
          breadcrumb={[{ label: homeLabel[locale], to: navHref(locale, '/') }, { label: t.title }]}
        />

        <p className="mt-5 border-s-2 border-gold bg-taupe/25 px-4 py-3 text-xs leading-6 text-espresso/65">{t.notice}</p>

        {/* Summary cards */}
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {t.summary.map((card) => {
            const Icon = ICONS[card.icon];
            return (
              <li key={card.id}>
                <a
                  href={`#sr-${card.target}`}
                  onClick={jumpTo(card.target)}
                  className="flex h-full flex-col items-center gap-2 rounded-xl border border-taupe/70 bg-white/70 p-5 text-center shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)] transition hover:border-burgundy/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
                >
                  <span className="flex size-12 items-center justify-center rounded-full border border-gold/50 bg-porcelain text-burgundy">
                    <Icon className="size-6" strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="font-display text-lg text-espresso">{card.title}</span>
                  <span className="text-[13px] leading-relaxed text-espresso/60">{card.text}</span>
                  {pendingIds.has(card.target) && <Tag>{t.pendingTag}</Tag>}
                </a>
              </li>
            );
          })}
        </ul>

        {/* Detailed policies */}
        <div className="mt-10 space-y-10">
          {t.sections.map((section) => (
            <section key={section.id} aria-labelledby={`sr-h-${section.id}`}>
              <h2 id={`sr-h-${section.id}`} className="font-display text-2xl text-espresso sm:text-3xl">
                {section.title}
              </h2>
              <div className="mt-4 divide-y divide-espresso/10 overflow-hidden rounded-xl border border-taupe/70 bg-white/70">
                {section.items.map((item) => (
                  <details key={item.id} id={`sr-${item.id}`} open className="group scroll-mt-24 px-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-espresso transition hover:text-burgundy focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-burgundy [&::-webkit-details-marker]:hidden">
                      {item.title}
                      <ChevronDown
                        className="size-4 shrink-0 text-espresso/45 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                        aria-hidden
                      />
                    </summary>
                    <div className="pb-5 pe-6">
                      <p className="text-sm leading-7 text-espresso/70">{item.text}</p>
                      {item.pending && (
                        <div className="mt-2">
                          <Tag>{t.pendingTag}</Tag>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Support */}
        <section aria-labelledby="sr-contact" className="relative isolate mt-10 overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain">
          <AssetImage src={shippingReturnsImages.banner} alt="" loading="lazy" className="absolute inset-0 -z-20 size-full object-cover" />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/85 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/92 sm:to-porcelain/10 sm:via-55% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
            <div className="max-w-md">
              <h2 id="sr-contact" className="font-display text-2xl text-espresso sm:text-3xl">
                {t.contact.heading}
              </h2>
              <p className="mt-1.5 text-sm leading-7 text-espresso/70">{t.contact.body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {hotline && (
                <a href={`tel:${hotline}`} className={`${buttonStyles('primary', 'md')} rounded-md`}>
                  <Phone className="size-4" aria-hidden />
                  {t.contact.call}
                  <span dir="ltr">{hotline}</span>
                </a>
              )}
              <Link to={navHref(locale, '/contact')} className={`${buttonStyles('outline', 'md')} rounded-md bg-white/70`}>
                <Mail className="size-4" aria-hidden />
                {t.contact.contact}
              </Link>
              <Link to={navHref(locale, '/faq')} className={`${buttonStyles('outline', 'md')} rounded-md bg-white/70`}>
                <HelpCircle className="size-4" aria-hidden />
                {t.contact.faq}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Container>
  );
}
