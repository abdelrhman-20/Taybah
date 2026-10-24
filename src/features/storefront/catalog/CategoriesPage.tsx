import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { LayoutGrid } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { EmptyState } from '../../shared/components/EmptyState';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { publicProducts, useCatalog } from './catalogStore';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'الأقسام',
    count: (n: number) => `${n} منتجًا`,
    // "No categories configured" (an empty catalog) and "categories exist
    // but none are currently visible" (all hidden by Admin) are different
    // states — neither invents a fake category, each just names what's
    // actually true.
    emptyNone: 'لا توجد أقسام',
    emptyNoneDesc: 'لم تتم إضافة أي قسم إلى الكتالوج بعد.',
    emptyHidden: 'لا توجد أقسام ظاهرة حاليًا',
    emptyHiddenDesc: 'جميع الأقسام الحالية مخفية مؤقتًا من واجهة المتجر.',
  },
  en: {
    home: 'Home',
    title: 'Categories',
    count: (n: number) => `${n} products`,
    emptyNone: 'No categories yet',
    emptyNoneDesc: 'No category has been added to the catalog yet.',
    emptyHidden: 'No categories are currently visible',
    emptyHiddenDesc: 'Every existing category is currently hidden from the storefront.',
  },
};

export function CategoriesPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  const categories = catalog.categories.filter((c) => c.visible).sort((a, b) => a.order - b.order);
  const visible = publicProducts(catalog);

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />
      <h1 className="mt-6 font-display text-3xl text-burgundy sm:text-4xl">{t.title}</h1>
      {categories.length === 0 ? (
        catalog.categories.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid className="size-6" aria-hidden />}
            title={t.emptyNone}
            description={t.emptyNoneDesc}
          />
        ) : (
          <EmptyState
            icon={<LayoutGrid className="size-6" aria-hidden />}
            title={t.emptyHidden}
            description={t.emptyHiddenDesc}
          />
        )
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                to={navHref(locale, `/category/${category.slug}`)}
                className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
              >
                <div className="relative overflow-hidden bg-taupe/40">
                  <AssetImage
                    src={category.image}
                    alt={category.name[locale]}
                    loading="lazy"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-espresso/75 to-transparent p-4 pt-12">
                    <h2 className="font-display text-lg text-white sm:text-xl">{category.name[locale]}</h2>
                    <p className="mt-0.5 text-[11px] tracking-wide text-white/70">
                      {t.count(visible.filter((p) => p.category === category.slug).length)}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
