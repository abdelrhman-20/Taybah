import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { ProductListing } from './ProductListing';
import { publicProducts, useCatalog } from './catalogStore';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'كل المنتجات',
    description: 'تصفح التشكيلة الكاملة — سجاد وموكيت وستائر ومفروشات وإكسسوارات مختارة بعناية.',
  },
  en: {
    home: 'Home',
    title: 'All Products',
    description: 'Browse the full selection — rugs, carpets, curtains, furnishings, and home accessories.',
  },
};

export function ProductsPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  return (
    <ProductListing
      products={publicProducts(catalog)}
      title={t.title}
      description={t.description}
      showCategory
      breadcrumb={[
        { label: t.home, to: navHref(locale, '/') },
        { label: t.title },
      ]}
    />
  );
}
