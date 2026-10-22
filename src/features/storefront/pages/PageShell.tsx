import type { ReactNode } from 'react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';

const homeLabel = { ar: 'الرئيسية', en: 'Home' };

// Shared shell for informational pages — breadcrumb, title, intro, and an
// optional gold-edged notice strip used to mark placeholder/draft content.
export function PageShell({
  title,
  titleNode,
  intro,
  notice,
  children,
}: {
  title: string;
  // Rendered in the h1 instead of the plain `title` string when given — lets
  // a page emphasize its single most important word (e.g. in burgundy)
  // without affecting the breadcrumb, which always uses the plain `title`.
  titleNode?: ReactNode;
  intro?: string;
  notice?: string;
  children: ReactNode;
}) {
  const locale = useStorefrontLocale();
  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: homeLabel[locale], to: navHref(locale, '/') }, { label: title }]} />
      <h1 className="mt-6 font-display text-3xl text-espresso sm:text-4xl">{titleNode ?? title}</h1>
      {intro && <p className="mt-4 max-w-2xl text-sm leading-7 text-espresso/65">{intro}</p>}
      {notice && (
        <p className="mt-6 border-s-2 border-gold bg-taupe/25 px-4 py-3 text-xs leading-6 text-espresso/60">
          {notice}
        </p>
      )}
      <div className="mt-10">{children}</div>
    </Container>
  );
}
