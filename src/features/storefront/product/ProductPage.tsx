import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronLeft, Gem, Layers, Palette, Ruler } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { SectionHeading } from '../../shared/components/SectionHeading';
import { AssetImage } from '../../shared/components/AssetImage';
import { NotFoundPage } from '../../shared/components/NotFoundPage';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import type { CatalogProduct } from '../catalog/catalogData';
import {
  attributesForCategory,
  attributeValueLabel,
  attributeValueHex,
  useAttributes,
  visibleAssignedValues,
} from '../catalog/attributeStore';
import {
  productIsPublic,
  publicProducts,
  useCatalog,
  type CatalogState,
} from '../catalog/catalogStore';
import {
  initialVariantSelection,
  isVariantProduct,
  reconcileSelection,
  resolveSelectedVariant,
  withoutDisabledSelections,
  type VariantSelection,
} from '../catalog/variants';
import { navHref } from '../layout/navData';
import type { StorefrontLocale } from '../../shared/utils/locale';
import { ProductCard } from '../components/ProductCard';
import { ProductGallery } from './ProductGallery';
import { ProductInfo } from './ProductInfo';
import { ProductTabs, type ProductTab } from './ProductTabs';
import { pushRecentlyViewed, useRecentlyViewed } from './useRecentlyViewed';

const copy = {
  ar: {
    home: 'الرئيسية',
    specs: 'تفاصيل المنتج',
    related: 'منتجات مشابهة',
    viewAll: 'عرض الكل',
    tabsLabel: 'معلومات المنتج',
    tabDescription: 'الوصف',
    tabSpecs: 'المواصفات',
    descHeading: 'وصف المنتج',
    recently: 'شاهدت مؤخرًا',
    labels: {
      sku: 'رمز المنتج',
      category: 'القسم',
      collection: 'المجموعة',
      material: 'الخامة',
      color: 'الألوان المتاحة',
      size: 'المقاسات المتاحة',
      sizeOne: 'المقاس',
      availability: 'التوفر',
      added: 'تاريخ الإضافة',
    },
    availability: { in_stock: 'متوفر', low_stock: 'باقي قطع قليلة', out_of_stock: 'نفدت الكمية' },
  },
  en: {
    home: 'Home',
    specs: 'Product details',
    related: 'Related products',
    viewAll: 'View all',
    tabsLabel: 'Product information',
    tabDescription: 'Description',
    tabSpecs: 'Specifications',
    descHeading: 'About this product',
    recently: 'Recently viewed',
    labels: {
      sku: 'SKU',
      category: 'Category',
      collection: 'Collection',
      material: 'Material',
      color: 'Available colors',
      size: 'Available sizes',
      sizeOne: 'Size',
      availability: 'Availability',
      added: 'Added',
    },
    availability: { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' },
  },
};

// A spec row value may carry hex swatches — rendered as color dots before
// each label.
interface SpecValue {
  text: string;
  hexes?: (string | undefined)[];
}

function specRows(
  product: CatalogProduct,
  locale: StorefrontLocale,
  catalog: CatalogState,
): { term: string; value: SpecValue }[] {
  const t = copy[locale];
  // Enabled-only: a disabled attribute or disabled value never surfaces as
  // live product information, even though the product keeps the raw
  // assignment in storage (see visibleAssignedValues).
  const join = (keys: string[], attrKey: string) =>
    visibleAssignedValues(attrKey, keys)
      .map((k) => attributeValueLabel(attrKey, k, locale))
      .filter(Boolean)
      .join(' · ');
  // Custom attributes — enabled, scoped to the product's category, and
  // resolved from the store. Reserved seeded keys keep their fixed rows.
  const custom = attributesForCategory(product.category).flatMap((a) => {
    if (a.key === 'color' || a.key === 'material' || a.key === 'size') return [];
    const keys = visibleAssignedValues(a.key, (product.attributes ?? {})[a.key] ?? []);
    if (keys.length === 0) return [];
    return [
      {
        term: a.name[locale],
        value: {
          text: keys
            .map((k) => attributeValueLabel(a.key, k, locale))
            .filter(Boolean)
            .join(' · '),
          hexes:
            a.display === 'swatch' ? keys.map((k) => attributeValueHex(a.key, k)) : undefined,
        },
      },
    ];
  });
  const rows: { term: string; value: SpecValue }[] = [
    { term: t.labels.sku, value: { text: product.sku } },
    {
      term: t.labels.category,
      value: {
        text:
          catalog.categories.find((c) => c.slug === product.category)?.name[locale] ??
          product.category,
      },
    },
    {
      term: t.labels.collection,
      value: {
        text:
          catalog.collections.find((c) => c.slug === product.collection)?.name[locale] ??
          product.collection,
      },
    },
    { term: t.labels.material, value: { text: join(product.materials, 'material') } },
    { term: t.labels.color, value: { text: join(product.colors, 'color') } },
    {
      term: visibleAssignedValues('size', product.sizes).length === 1 ? t.labels.sizeOne : t.labels.size,
      value: { text: join(product.sizes, 'size') },
    },
    ...custom,
    { term: t.labels.availability, value: { text: t.availability[product.availability] } },
    { term: t.labels.added, value: { text: product.createdAt } },
  ];
  return rows;
}

export function ProductPage() {
  const { slug } = useParams();
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const catalog = useCatalog();
  const attrs = useAttributes(); // spec labels resolve from the attribute store
  const product = catalog.products.find((p) => p.slug === slug);
  const recentlyIds = useRecentlyViewed();

  // Variant selection lives here (not in ProductInfo) so the resolved variant
  // can drive BOTH the option selectors and the gallery's primary image.
  // For simple products the selection stays empty and ProductInfo keeps its
  // legacy color/size behavior.
  const variantProduct = product !== undefined && isVariantProduct(product);
  const [selection, setSelection] = useState<VariantSelection>(() =>
    variantProduct && product
      ? withoutDisabledSelections(initialVariantSelection(product), attrs)
      : {},
  );
  // Product or attribute data can change under the open page (cross-tab
  // storage sync, admin edits) — reconcile drops choices that lost every
  // active variant, and withoutDisabledSelections drops choices whose
  // attribute/value was disabled even though the combo still exists.
  // Render-phase adjust on the product record's or attribute list's identity.
  const [seenProduct, setSeenProduct] = useState(product);
  const [seenAttrs, setSeenAttrs] = useState(attrs);
  if (seenProduct !== product || seenAttrs !== attrs) {
    setSeenProduct(product);
    setSeenAttrs(attrs);
    if (product && variantProduct) {
      setSelection((s) => withoutDisabledSelections(reconcileSelection(product, s), attrs));
    }
  }
  const resolved = useMemo(
    () => (product && variantProduct ? resolveSelectedVariant(product, selection) : undefined),
    [variantProduct, product, selection],
  );
  const galleryImages = useMemo(
    () =>
      product && resolved?.image
        ? [resolved.image, ...product.images.filter((i) => i !== resolved.image)]
        : (product?.images ?? []),
    [product, resolved],
  );

  useEffect(() => {
    if (product && productIsPublic(product, catalog)) pushRecentlyViewed(product.id);
  }, [product, catalog]);

  // Hidden/unpublished products resolve gracefully — the product still exists
  // internally, it just isn't a public page.
  if (!product || !productIsPublic(product, catalog)) return <NotFoundPage />;

  const category = catalog.categories.find((c) => c.slug === product.category);
  const others = publicProducts(catalog).filter((p) => p.id !== product.id);
  const related = [
    ...others.filter((p) => p.category === product.category),
    ...others.filter((p) => p.category !== product.category && p.collection === product.collection),
  ].slice(0, 5);

  // Highlights come only from the product's own enabled attribute values.
  const labelsOf = (keys: string[], attrKey: string) =>
    visibleAssignedValues(attrKey, keys)
      .map((k) => attributeValueLabel(attrKey, k, locale))
      .filter(Boolean)
      .join(' · ');
  const collection = catalog.collections.find((c) => c.slug === product.collection);
  const highlights = [
    { icon: Layers, label: t.labels.material, value: labelsOf(product.materials, 'material') },
    { icon: Gem, label: t.labels.collection, value: collection?.name[locale] ?? '' },
    {
      icon: Ruler,
      label: visibleAssignedValues('size', product.sizes).length === 1 ? t.labels.sizeOne : t.labels.size,
      value: labelsOf(product.sizes, 'size'),
    },
    { icon: Palette, label: t.labels.color, value: labelsOf(product.colors, 'color') },
  ].filter((h) => h.value);
  const description = product.description[locale];
  const spareImage = product.images.length > 1 ? product.images[product.images.length - 1] : '';
  const specs = specRows(product, locale, catalog).filter((r) => r.value.text);

  const tabs: ProductTab[] = [
    ...(description || highlights.length
      ? [
          {
            id: 'description',
            label: t.tabDescription,
            content: (
              <div className={spareImage ? 'grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12' : ''}>
                <div>
                  <h2 className="font-display text-2xl text-espresso">{t.descHeading}</h2>
                  {description && <p className="mt-4 max-w-2xl text-sm leading-8 text-espresso/75 sm:text-base">{description}</p>}
                  {highlights.length > 0 && (
                    <ul className="mt-8 grid grid-cols-2 gap-y-6 sm:grid-cols-4 sm:divide-x sm:divide-x-reverse sm:divide-espresso/10">
                      {highlights.map(({ icon: Icon, label, value }) => (
                        <li key={label} className="flex flex-col items-center gap-2 px-3 text-center">
                          <Icon className="size-8 text-gold" strokeWidth={1.4} aria-hidden />
                          <span className="text-sm font-semibold text-espresso">{value}</span>
                          <span className="text-xs text-espresso/55">{label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {spareImage && (
                  <AssetImage
                    src={spareImage}
                    alt={product.name[locale]}
                    loading="lazy"
                    className="aspect-[16/10] w-full self-start rounded-md object-cover lg:aspect-[4/3]"
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
    {
      id: 'specs',
      label: t.tabSpecs,
      content: (
        <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {specs.map(({ term, value }) => (
            <div key={term} className="flex gap-4 border-b border-espresso/10 pb-3">
              <dt className="w-32 shrink-0 text-sm text-espresso/50">{term}</dt>
              <dd className="text-sm text-espresso">
                {value.hexes && value.hexes.length > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                    {value.text.split(' · ').map((lbl, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5">
                        {value.hexes?.[i] && (
                          <span
                            className="size-3.5 rounded-full border border-espresso/15"
                            style={{ backgroundColor: value.hexes[i] }}
                            aria-hidden
                          />
                        )}
                        {lbl}
                      </span>
                    ))}
                  </span>
                ) : (
                  value.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      ),
    },
  ];
  const recently = recentlyIds
    .filter((id) => id !== product.id)
    .map((id) => catalog.products.find((p) => p.id === id))
    .filter((p): p is CatalogProduct => Boolean(p) && productIsPublic(p as CatalogProduct, catalog))
    .slice(0, 4);

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-[1360px]">
        <Breadcrumb
          items={[
            { label: t.home, to: navHref(locale, '/') },
            category
              ? { label: category.name[locale], to: navHref(locale, `/category/${category.slug}`) }
              : { label: product.name[locale] },
            { label: product.name[locale] },
          ]}
        />

        {/* Purchase panel first in the DOM so it sits on the right in RTL; the
            gallery leads on small screens. */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-12">
          <div className="order-2 lg:order-1">
            <ProductInfo
              product={product}
              locale={locale}
              selection={variantProduct ? selection : undefined}
              onSelectAxis={(axis, value) =>
                setSelection((s) =>
                  withoutDisabledSelections(
                    reconcileSelection(product, { ...s, [axis]: value }, axis),
                    attrs,
                  ),
                )
              }
              resolved={resolved}
            />
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <ProductGallery images={galleryImages} alt={product.name[locale]} locale={locale} />
          </div>
        </div>

        <section aria-label={t.tabsLabel} className="mt-12 sm:mt-16">
          <ProductTabs tabs={tabs} label={t.tabsLabel} />
        </section>

        {related.length > 0 && (
          <section aria-labelledby="related-products" className="mt-14 sm:mt-16">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 id="related-products" className="font-display text-2xl text-espresso sm:text-3xl">
                {t.related}
              </h2>
              {category && (
                <Link
                  to={navHref(locale, `/category/${category.slug}`)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-burgundy transition-colors hover:text-burgundy/75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
                >
                  <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden />
                  {t.viewAll}
                </Link>
              )}
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
              {related.map((p) => (
                <li key={p.id} className="h-full">
                  <ProductCard product={p} card compact />
                </li>
              ))}
            </ul>
          </section>
        )}

      {recently.length > 0 && (
        <section aria-labelledby="recently-viewed" className="mt-16">
          <SectionHeading title={t.recently} />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {recently.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </Container>
  );
}
