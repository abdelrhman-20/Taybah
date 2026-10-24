import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { BrandMark } from '../../shared/components/BrandMark';
import { ChevronDown } from 'lucide-react';
import { navHref } from './navData';
import { SOCIAL_LINKS } from './storeContact';
import { useNavigation, type StorefrontNavItem } from './navStore';
import { productIsPublic, useCatalog } from '../catalog/catalogStore';
import { formatPrice } from '../../shared/utils/format';

const copy = {
  ar: {
    home: 'الرئيسية',
    collections: 'المجموعات',
    links: 'روابط هامة',
    products: 'منتجاتنا',
    privacy: 'سياسة الخصوصية',
    terms: 'الشروط والأحكام',
    rights: 'جميع الحقوق محفوظة.',
  },
  en: {
    home: 'Home',
    collections: 'Collections',
    links: 'Important links',
    products: 'Our products',
    privacy: 'Privacy policy',
    terms: 'Terms & conditions',
    rights: 'All rights reserved.',
  },
};

const footerLinkCls =
  'text-sm text-espresso/70 transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy';

const columnHeadingCls = 'mb-4 text-base font-bold text-espresso';

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

// Compact accordion group for phones (native <details>: keyboard + screen-reader friendly).
function FooterGroup({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-b border-taupe/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 font-display text-base text-espresso focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-burgundy [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 text-espresso/50 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
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
  const products = catalog.products.filter((p) => productIsPublic(p, catalog)).slice(0, 3);

  return (
    <footer className="mt-6 bg-[#f4efe7] text-espresso">
      <span className="block h-px bg-taupe/70" aria-hidden="true" />
      {/* Phones: compact brand + accordion groups (no product list). */}
      <Container className="py-6 sm:hidden">
        <Link to={`/${locale}`} aria-label="طيبة — الصفحة الرئيسية" className="mx-auto block w-fit">
          <BrandMark className="h-24 w-auto object-contain" />
        </Link>
        <div className="mt-4 border-t border-taupe/60">
          {collections.length > 0 && (
            <FooterGroup title={t.collections}>
              <ul className="flex flex-col gap-2.5">
                {collections.map((collection) => (
                  <li key={collection.slug}>
                    <Link to={navHref(locale, `/collection/${collection.slug}`)} className={`block py-1 ${footerLinkCls}`}>
                      {collection.name[locale]}
                    </Link>
                  </li>
                ))}
              </ul>
            </FooterGroup>
          )}
          <FooterGroup title={t.links}>
            <ul className="flex flex-col gap-2.5">
              {importantLinks.map((item) => (
                <li key={item.id} className="py-1">
                  <FooterNavLink item={item} locale={locale} />
                </li>
              ))}
            </ul>
          </FooterGroup>
        </div>
        {realSocials.length > 0 && (
          <ul className="mt-5 flex items-center justify-center gap-3" aria-label="التواصل الاجتماعي">
            {realSocials.map(({ id, label, href, icon: Icon }) => (
              <li key={id}>
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="inline-flex size-10 items-center justify-center rounded-full border border-taupe text-espresso/75 transition-colors hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy">
                  <Icon className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Container>

      <Container className="hidden py-8 sm:block sm:py-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-4 sm:gap-8">
          <div className="col-span-2 flex sm:order-last sm:col-span-1">
            <Link to={`/${locale}`} aria-label="طيبة — الصفحة الرئيسية" className="flex h-full items-center">
              <BrandMark className="h-full max-h-40 w-auto object-contain" />
            </Link>
          </div>

          {collections.length > 0 && (
            <div>
              <h3 className={columnHeadingCls}>{t.collections}</h3>
              <ul>
                {collections.map((collection) => (
                  <li key={collection.slug} className="border-b border-taupe/60 py-2.5 first:pt-0 last:border-b-0">
                    <Link to={navHref(locale, `/collection/${collection.slug}`)} className={footerLinkCls}>
                      {collection.name[locale]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <nav aria-label={t.links}>
            <h3 className={columnHeadingCls}>{t.links}</h3>
            <ul className="flex flex-col gap-2.5">
              {importantLinks.map((item) => (
                <li key={item.id}>
                  <FooterNavLink item={item} locale={locale} />
                </li>
              ))}
            </ul>
          </nav>

          {products.length > 0 && (
            <div>
              <h3 className={columnHeadingCls}>{t.products}</h3>
              <ul>
                {products.map((product) => (
                  <li key={product.id} className="flex items-center gap-3 border-b border-taupe/60 py-3 first:pt-0 last:border-b-0">
                    <Link to={navHref(locale, `/products/${product.slug}`)} className="shrink-0">
                      <AssetImage src={product.image} alt="" className="size-14 object-cover" />
                    </Link>
                    <div className="min-w-0">
                      <Link to={navHref(locale, `/products/${product.slug}`)} className={`block truncate ${footerLinkCls}`}>
                        {product.name[locale]}
                      </Link>
                      <div className="mt-1 flex items-baseline gap-1.5 text-xs" dir="ltr">
                        <span className="text-burgundy">{formatPrice(product.price, locale)}</span>
                        {product.compareAtPrice && (
                          <span className="text-espresso/40 line-through">
                            {formatPrice(product.compareAtPrice, locale)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Container>

      <div className="border-t border-taupe/60">
        <Container className="flex flex-col items-center gap-3 pb-16 pt-4 text-center text-xs sm:pb-4 text-espresso/55 sm:flex-row sm:justify-between">
          <p>طيبة — Taybah © {new Date().getFullYear()}. {t.rights}</p>
          <div className="flex items-center gap-5">
            <Link
              to={navHref(locale, '/privacy')}
              className="transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              {t.privacy}
            </Link>
            <Link
              to={navHref(locale, '/terms')}
              className="transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
            >
              {t.terms}
            </Link>
          </div>
        </Container>
      </div>
    </footer>
  );
}
