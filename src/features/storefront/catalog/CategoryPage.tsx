import { useParams } from 'react-router';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { NotFoundPage } from '../../shared/components/NotFoundPage';
import { navHref } from '../layout/navData';
import { ProductListing } from './ProductListing';
import { publicProducts, useCatalog } from './catalogStore';

const copy = {
  ar: { home: 'الرئيسية', categories: 'الأقسام' },
  en: { home: 'Home', categories: 'Categories' },
};

export function CategoryPage() {
  const { slug } = useParams();
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  const category = catalog.categories.find((c) => c.slug === slug);

  if (!category || !category.visible) return <NotFoundPage />;

  return (
    <ProductListing
      products={publicProducts(catalog).filter((p) => p.category === category.slug)}
      title={category.name[locale]}
      description={category.description[locale]}
      banner={category.image}
      breadcrumb={[
        { label: t.home, to: navHref(locale, '/') },
        { label: t.categories, to: navHref(locale, '/categories') },
        { label: category.name[locale] },
      ]}
    />
  );
}
