import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { useCatalog } from './catalogStore';

const copy = {
  ar: { home: 'الرئيسية', title: 'المجموعات', action: 'تصفح المجموعة' },
  en: { home: 'Home', title: 'Collections', action: 'Browse collection' },
};

export function CollectionsPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  const collections = catalog.collections
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order);

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />
      <h1 className="mt-6 font-display text-3xl text-burgundy sm:text-4xl">{t.title}</h1>
      <div className="mt-10 space-y-14">
        {collections.map((collection, i) => (
          <section
            key={collection.slug}
            className={`grid items-center gap-8 md:grid-cols-2 ${i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}
          >
            <div className="overflow-hidden bg-taupe/30">
              <AssetImage
                src={collection.image}
                alt={collection.name[locale]}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition duration-700 hover:scale-[1.03]"
              />
            </div>
            <div>
              <h2 className="font-display text-2xl text-espresso sm:text-3xl">
                {collection.name[locale]}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-espresso/65">
                {collection.description[locale]}
              </p>
              <Link
                to={navHref(locale, `/collection/${collection.slug}`)}
                className="mt-6 inline-block rounded-[27px] border border-espresso/25 px-7 py-2.5 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.action}
              </Link>
            </div>
          </section>
        ))}
      </div>
    </Container>
  );
}
