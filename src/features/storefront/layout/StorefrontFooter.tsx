import { Link } from 'react-router';
import { LayoutGrid, Link2 } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { BrandMark } from '../../shared/components/BrandMark';
import { navHref } from './navData';
import { SOCIAL_LINKS } from './storeContact';
import { useNavigation, type StorefrontNavItem } from './navStore';
import { useCatalog } from '../catalog/catalogStore';

const copy = {
  ar: {
    home: 'الرئيسية',
    collections: 'المجموعات',
    links: 'روابط مهمة',
    privacy: 'سياسة الخصوصية',
    terms: 'الشروط والأحكام',
    rights: 'جميع الحقوق محفوظة.',
  },
  en: {
    home: 'Home',
    collections: 'Collections',
    links: 'Important links',
    privacy: 'Privacy policy',
    terms: 'Terms & conditions',
    rights: 'All rights reserved.',
  },
};

const footerLinkCls =
  'inline-flex min-h-9 items-center text-sm text-espresso/70 transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy';

const columnHeadingCls = 'mb-1.5 flex items-center gap-2 font-display text-lg font-bold text-burgundy';

const bottomLinkCls =
  'inline-flex min-h-6 items-center transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy';

function FooterNavLink({ item, locale }: { item: StorefrontNavItem; locale: 'ar' }) {
  if (item.kind === 'external') {
    return (
      <a href={item.path} target="_blank" rel="noopener noreferrer" className={footerLinkCls}>
        {item.label}
      </a>
    );
  }
  return (
    <Link to={navHref(locale, item.path)} className={footerLinkCls}>
      {item.label}
    </Link>
  );
}

// Only platforms with a real configured URL (placeholders are '#').
const realSocials = SOCIAL_LINKS.filter((l) => l.href.trim() !== '' && l.href.trim() !== '#');

export function StorefrontFooter() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const nav = useNavigation();
  const catalog = useCatalog();
  const importantLinks: StorefrontNavItem[] = [
    { id: 'home', label: t.home, kind: 'internal', path: '/', visible: true },
    ...nav.footer.filter((i) => i.visible),
  ];
  const collections = catalog.collections.filter((c) => c.visible).sort((a, b) => a.order - b.order);

  return (
    <footer className="mt-6 bg-[#f7f2e9] text-espresso">
      <span className="block h-px bg-gold/40" aria-hidden="true" />
      <Container className="pb-3 pt-5 sm:pt-6">
        <div className="grid items-center gap-5 lg:grid-cols-[auto_1fr] lg:gap-14">
          <Link to={`/${locale}`} aria-label="طيبة — الصفحة الرئيسية" className="mx-auto block w-fit">
            <BrandMark className="h-20 w-auto object-contain sm:h-24 lg:h-28" />
          </Link>

          <div className="relative mx-auto grid w-full max-w-xl grid-cols-2 gap-x-6 lg:max-w-2xl">
            {collections.length > 0 && (
              <span className="absolute inset-y-1 start-1/2 w-px bg-gold/30" aria-hidden="true" />
            )}
            {collections.length > 0 && (
              <nav aria-label={t.collections} className="pe-4">
                <h3 className={columnHeadingCls}>
                  <LayoutGrid className="size-5 text-gold" aria-hidden />
                  {t.collections}
                </h3>
                <ul className="flex flex-col">
                  {collections.map((collection) => (
                    <li key={collection.slug}>
                      <Link to={navHref(locale, `/collection/${collection.slug}`)} className={footerLinkCls}>
                        {collection.name[locale]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <nav aria-label={t.links} className={collections.length > 0 ? 'ps-4' : 'col-span-2'}>
              <h3 className={columnHeadingCls}>
                <Link2 className="size-5 text-gold" aria-hidden />
                {t.links}
              </h3>
              <ul className="flex flex-col">
                {importantLinks.map((item) => (
                  <li key={item.id}>
                    <FooterNavLink item={item} locale={locale} />
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-3 flex flex-col items-center gap-3 border-t border-gold/30 pt-3 text-center text-xs text-espresso/60 sm:flex-row sm:justify-between sm:text-start">
          {realSocials.length > 0 && (
            <ul className="flex items-center gap-2.5 sm:order-last" aria-label="التواصل الاجتماعي">
              {realSocials.map(({ id, label, href, icon: Icon }) => (
                <li key={id}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className="inline-flex size-10 items-center justify-center rounded-full bg-gold/15 text-gold transition-colors hover:bg-gold/25 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
                  >
                    <Icon className="size-[18px]" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <p>طيبة © {new Date().getFullYear()}. {t.rights}</p>
            <div className="flex items-center gap-3">
              <Link to={navHref(locale, '/privacy')} className={bottomLinkCls}>{t.privacy}</Link>
              <span className="text-gold/60" aria-hidden="true">|</span>
              <Link to={navHref(locale, '/terms')} className={bottomLinkCls}>{t.terms}</Link>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
