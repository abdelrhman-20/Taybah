import { AssetImage } from '../../shared/components/AssetImage';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Heart, ShoppingBag, X } from 'lucide-react';
import type { CatalogProduct } from '../catalog/catalogData';
import { useAttributes } from '../catalog/attributeStore';
import { useCatalog } from '../catalog/catalogStore';
import { resolveQuickAdd } from '../catalog/quickAdd';
import { useCart } from '../cart/useCart';
import { useWishlist } from '../wishlist/useWishlist';
import { navHref } from '../layout/navData';
import { formatPrice } from '../../shared/utils/format';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: {
    close: 'إغلاق',
    addToCart: 'أضف إلى السلة',
    chooseOptions: 'اختر الخيارات',
    viewDetails: 'عرض تفاصيل المنتج',
    added: 'تمت الإضافة إلى السلة',
    outOfStock: 'نفدت الكمية',
    wishlistAdd: 'أضف إلى المفضلة',
    wishlistRemove: 'إزالة من المفضلة',
  },
  en: {
    close: 'Close',
    addToCart: 'Add to cart',
    chooseOptions: 'Choose options',
    viewDetails: 'View full details',
    added: 'Added to cart',
    outOfStock: 'Out of stock',
    wishlistAdd: 'Add to wishlist',
    wishlistRemove: 'Remove from wishlist',
  },
};

const loc: StorefrontLocale = 'ar';

export function QuickViewModal({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const t = copy[loc];
  const navigate = useNavigate();
  const attrs = useAttributes();
  const catalog = useCatalog();
  const cart = useCart();
  const wishlist = useWishlist();
  const wishlisted = wishlist.has(product.id);
  const categoryName = catalog.categories.find((c) => c.slug === product.category)?.name[loc];
  const closeRef = useRef<HTMLButtonElement>(null);
  const [added, setAdded] = useState(false);
  const productHref = navHref('ar', `/products/${product.slug}`);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const { out, options } = resolveQuickAdd(product, attrs);

  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-espresso/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={product.name[loc]}
    >
      <button type="button" aria-label={t.close} onClick={onClose} className="absolute inset-0" />
      <div className="relative grid max-h-[85vh] w-full max-w-2xl grid-cols-1 overflow-y-auto bg-white shadow-xl sm:grid-cols-2">
        <button
          ref={closeRef}
          type="button"
          aria-label={t.close}
          onClick={onClose}
          className="absolute end-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-espresso shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="size-4" />
        </button>

        <AssetImage src={product.image} alt={product.name[loc]} className="aspect-[4/5] w-full object-cover sm:aspect-auto sm:h-full" />

        <div className="flex flex-col p-6 sm:p-7">
          {categoryName && <p className="text-xs tracking-wide text-espresso/55">{categoryName}</p>}
          <h3 className="mt-1 font-display text-2xl text-espresso">{product.name[loc]}</h3>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-lg font-semibold ${product.compareAtPrice ? 'text-burgundy' : 'text-espresso'}`}>
              {formatPrice(product.price, loc)}
            </span>
            {product.compareAtPrice && (
              <span className="text-sm text-espresso/45 line-through" dir="ltr">
                {formatPrice(product.compareAtPrice, loc)}
              </span>
            )}
          </div>
          {product.description?.[loc] && (
            <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-espresso/70">{product.description[loc]}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {out ? (
              <span className="text-sm text-espresso/50">{t.outOfStock}</span>
            ) : options ? (
              <button
                type="button"
                onClick={() => {
                  cart.add(product, options, 1);
                  setAdded(true);
                }}
                className="inline-flex items-center gap-2 rounded-[27px] bg-burgundy px-6 py-3 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <ShoppingBag className="size-4" aria-hidden="true" />
                {added ? t.added : t.addToCart}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate(productHref)}
                className="inline-flex items-center gap-2 border border-burgundy px-6 py-3 text-sm font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.chooseOptions}
              </button>
            )}
            <button
              type="button"
              onClick={() => wishlist.toggle(product.id)}
              aria-pressed={wishlisted}
              aria-label={wishlisted ? t.wishlistRemove : t.wishlistAdd}
              className={`inline-flex size-11 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                wishlisted
                  ? 'border-burgundy bg-burgundy text-white'
                  : 'border-espresso/15 text-espresso/70 hover:border-burgundy hover:text-burgundy'
              }`}
            >
              <Heart className={`size-4 ${wishlisted ? 'fill-current' : ''}`} />
            </button>
          </div>

          <Link to={productHref} onClick={onClose} className="mt-5 text-sm text-espresso/60 underline underline-offset-4 transition hover:text-burgundy">
            {t.viewDetails}
          </Link>
        </div>
      </div>
    </div>
  );
}
