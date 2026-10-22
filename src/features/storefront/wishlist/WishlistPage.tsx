import { useState } from 'react';
import { Link } from 'react-router';
import { Heart, ShoppingBag } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { useWishlist } from './useWishlist';
import { useCart } from '../cart/useCart';
import { useAttributes } from '../catalog/attributeStore';
import { useCatalog } from '../catalog/catalogStore';
import { hasPurchasableVariant, isVariantProduct, singlePurchasableVariant } from '../catalog/variants';
import { ProductCard } from '../components/ProductCard';
import { navHref } from '../layout/navData';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'المفضلة',
    empty: 'لا توجد قطع في المفضلة',
    emptyDesc: 'احفظ القطع التي تعجبك بالضغط على القلب لتجدها هنا.',
    browse: 'تصفح المنتجات',
    remove: 'إزالة من المفضلة',
    addToCart: 'أضف إلى السلة',
    choose: 'اختر الخيارات',
    items: (n: number) => (n === 1 ? 'قطعة واحدة' : n === 2 ? 'قطعتان' : `${n} قطع`),
    addedToCart: 'تمت إضافة المنتج إلى السلة',
    removed: 'أُزيل من المفضلة',
  },
  en: {
    home: 'Home',
    title: 'Wishlist',
    empty: 'No saved pieces yet',
    emptyDesc: 'Tap the heart on any product you love and it will appear here.',
    browse: 'Browse products',
    remove: 'Remove from wishlist',
    addToCart: 'Add to cart',
    choose: 'Choose options',
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    addedToCart: 'Added to cart',
    removed: 'Removed from wishlist',
  },
};

export function WishlistPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const wishlist = useWishlist();
  const cart = useCart();
  const attrs = useAttributes();
  // One page-level sr-only live region — avoids one per grid item while
  // still announcing quick-add/remove outcomes for screen reader users.
  const [announcement, setAnnouncement] = useState('');

  const { products: catalog } = useCatalog();
  const products = [...wishlist.ids]
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is (typeof catalog)[number] => Boolean(p));

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-burgundy sm:text-4xl">{t.title}</h1>
        {products.length > 0 && (
          <span className="text-sm text-espresso/55">{t.items(products.length)}</span>
        )}
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-20 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-taupe text-espresso/50">
            <Heart className="size-7" aria-hidden />
          </span>
          <h2 className="font-display text-2xl text-espresso">{t.empty}</h2>
          <p className="max-w-sm text-sm leading-relaxed text-espresso/60">{t.emptyDesc}</p>
          <Link
            to={navHref(locale, '/products')}
            className="mt-2 rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.browse}
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
          {products.map((product) => {
            const isVariant = isVariantProduct(product);
            // Variant products: quick-add only when exactly one combination
            // is currently purchasable — never guess between several, and
            // never fall through to the legacy color/size path (that would
            // silently create a variantId: null line for a product that
            // actually needs a real variant). Simple products keep their
            // exact previous behavior untouched.
            const quickAddVariant = isVariant ? singlePurchasableVariant(product, attrs) : undefined;
            const anyPurchasable = isVariant
              ? hasPurchasableVariant(product, attrs)
              : product.availability !== 'out_of_stock';
            const simpleSingleOptions =
              !isVariant && product.colors.length <= 1 && product.sizes.length <= 1;
            return (
              <li key={product.id} className="flex flex-col">
                <ProductCard product={product} />
                <div className="mt-3 flex items-center gap-3">
                  {anyPurchasable ? (
                    isVariant ? (
                      quickAddVariant ? (
                        <button
                          type="button"
                          onClick={() => {
                            cart.add(product, { variant: quickAddVariant }, 1);
                            setAnnouncement(t.addedToCart);
                          }}
                          className="inline-flex flex-1 items-center justify-center gap-2 border border-burgundy px-4 py-2 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                          <ShoppingBag className="size-3.5" aria-hidden />
                          {t.addToCart}
                        </button>
                      ) : (
                        <Link
                          to={navHref(locale, `/products/${product.slug}`)}
                          className="inline-flex flex-1 items-center justify-center gap-2 border border-burgundy px-4 py-2 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                          {t.choose}
                        </Link>
                      )
                    ) : simpleSingleOptions ? (
                      <button
                        type="button"
                        onClick={() => {
                          cart.add(product, { color: product.colors[0] ?? null, size: product.sizes[0] ?? null }, 1);
                          setAnnouncement(t.addedToCart);
                        }}
                        className="inline-flex flex-1 items-center justify-center gap-2 border border-burgundy px-4 py-2 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      >
                        <ShoppingBag className="size-3.5" aria-hidden />
                        {t.addToCart}
                      </button>
                    ) : (
                      <Link
                        to={navHref(locale, `/products/${product.slug}`)}
                        className="inline-flex flex-1 items-center justify-center gap-2 border border-burgundy px-4 py-2 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      >
                        {t.choose}
                      </Link>
                    )
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      wishlist.toggle(product.id);
                      setAnnouncement(t.removed);
                    }}
                    className="text-xs text-espresso/55 underline-offset-4 transition hover:text-burgundy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {t.remove}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Container>
  );
}
