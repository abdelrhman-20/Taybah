import { useParams } from 'react-router';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { NotFoundPage } from '../../shared/components/NotFoundPage';
import { navHref } from '../layout/navData';
import { ProductListing } from './ProductListing';
import { publicProducts, useCatalog } from './catalogStore';

const copy = {
  ar: { home: 'الرئيسية', collections: 'المجموعات' },
  en: { home: 'Home', collections: 'Collections' },
};

export function CollectionPage() {
  const { slug } = useParams();
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  const collection = catalog.collections.find((c) => c.slug === slug);

  if (!collection || !collection.visible) return <NotFoundPage />;

  return (
    <ProductListing
      products={publicProducts(catalog).filter((p) => p.collection === collection.slug)}
      title={collection.name[locale]}
      description={collection.description[locale]}
      banner={collection.image}
      breadcrumb={[
        { label: t.home, to: navHref(locale, '/') },
        { label: t.collections, to: navHref(locale, '/collections') },
        { label: collection.name[locale] },
      ]}
    />
  );
}
