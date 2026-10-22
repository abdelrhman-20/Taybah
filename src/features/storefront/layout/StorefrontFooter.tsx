import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { BrandMark } from '../../shared/components/BrandMark';
import { navHref } from './navData';
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
  'text-sm text-porcelain/65 transition-colors hover:text-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

const columnHeadingCls = 'mb-5 text-[13px] font-semibold tracking-[0.2em] text-gold uppercase';

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
    <footer className="bg-espresso text-porcelain">
      <span className="block h-px bg-gold/50" aria-hidden="true" />
      <Container className="py-14 sm:py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-4 sm:gap-8">
          <div className="col-span-2 flex sm:col-span-1">
            <Link to={`/${locale}`} aria-label="طيبة — الصفحة الرئيسية" className="flex h-full items-center">
              <BrandMark className="h-full max-h-64 w-auto object-contain" />
            </Link>
          </div>

          {collections.length > 0 && (
            <div>
              <h3 className={columnHeadingCls}>{t.collections}</h3>
              <ul>
                {collections.map((collection) => (
                  <li key={collection.slug} className="border-b border-porcelain/10 py-2.5 first:pt-0 last:border-b-0">
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
                  <li key={product.id} className="flex items-center gap-3 border-b border-porcelain/10 py-3 first:pt-0 last:border-b-0">
                    <Link to={navHref(locale, `/products/${product.slug}`)} className="shrink-0">
                      <AssetImage src={product.image} alt="" className="size-14 object-cover" />
                    </Link>
                    <div className="min-w-0">
                      <Link to={navHref(locale, `/products/${product.slug}`)} className={`block truncate ${footerLinkCls}`}>
                        {product.name[locale]}
                      </Link>
                      <div className="mt-1 flex items-baseline gap-1.5 text-xs" dir="ltr">
                        <span className="text-gold">{formatPrice(product.price, locale)}</span>
                        {product.compareAtPrice && (
                          <span className="text-porcelain/40 line-through">
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

      <div className="border-t border-porcelain/10">
        <Container className="flex flex-col items-center gap-3 py-5 text-xs text-porcelain/45 sm:flex-row sm:justify-between">
          <p>طيبة — Taybah © {new Date().getFullYear()}. {t.rights}</p>
          <div className="flex items-center gap-5">
            <Link
              to={navHref(locale, '/privacy')}
              className="transition-colors hover:text-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {t.privacy}
            </Link>
            <Link
              to={navHref(locale, '/terms')}
              className="transition-colors hover:text-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {t.terms}
            </Link>
          </div>
        </Container>
      </div>
    </footer>
  );
}
