import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { navHref } from '../layout/navData';

// Small gold ornament + eyebrow used above the Heritage Atelier headings.
export function GoldEyebrow({ children }: { children: string }) {
  if (!children) return null;
  return (
    <p className="mb-2 flex items-center justify-center gap-3 text-sm font-medium text-gold">
      <span className="h-px w-8 bg-gold/60" aria-hidden="true" />
      {children}
      <span className="h-px w-8 bg-gold/60" aria-hidden="true" />
    </p>
  );
}

// Centered editorial heading with an optional "view all" link on the end side.
export function HomeSectionHeader({
  id,
  eyebrow,
  title,
  subtitle,
  actionLabel,
  actionTo,
  ornament = false,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionTo?: string;
  // Phones: gold divider above the heading and a burgundy heading.
  ornament?: boolean;
}) {
  const locale = useStorefrontLocale();
  return (
    <div className="relative mb-6 text-center sm:mb-8">
      {ornament && <OrnamentDivider align="center" className="mb-3 sm:hidden" />}
      <GoldEyebrow>{eyebrow ?? ''}</GoldEyebrow>
      <h2 id={id} className={`font-display text-[1.7rem] leading-snug sm:text-[1.9rem] ${ornament ? 'text-burgundy sm:text-espresso' : 'text-espresso'}`}>
        {title}
      </h2>
      {subtitle && (
        <p className="mx-auto mt-1.5 max-w-2xl text-[13px] leading-relaxed text-espresso/60 sm:text-sm">{subtitle}</p>
      )}
      {actionLabel && actionTo && (
        <Link
          to={navHref(locale, actionTo)}
          className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-full bg-taupe/35 px-4 py-1.5 text-[13px] font-medium text-espresso sm:bg-transparent sm:px-0 sm:py-0 sm:text-xs sm:text-burgundy transition-colors hover:text-burgundy/75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy sm:absolute sm:end-0 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2"
        >
          <ChevronLeft className="size-3.5 ltr:rotate-180" aria-hidden="true" />
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
