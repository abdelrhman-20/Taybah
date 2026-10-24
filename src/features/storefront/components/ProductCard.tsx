import { AssetImage } from '../../shared/components/AssetImage';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Heart, Search, ShoppingCart } from 'lucide-react';
import type { CatalogProduct, Localized } from '../catalog/catalogData';
import { useAttributes } from '../catalog/attributeStore';
import { useCatalog } from '../catalog/catalogStore';
import { isVariantProduct } from '../catalog/variants';
import { resolveQuickAdd } from '../catalog/quickAdd';
import { useCart } from '../cart/useCart';
import { useWishlist } from '../wishlist/useWishlist';
import { navHref } from '../layout/navData';
import { formatPrice } from '../../shared/utils/format';
import type { StorefrontLocale } from '../../shared/utils/locale';
import { QuickViewModal } from './QuickViewModal';

const availabilityLabel: Record<CatalogProduct['availability'], Localized> = {
  in_stock: { ar: 'متوفر', en: 'In stock' },
  low_stock: { ar: 'باقي قطع قليلة', en: 'Low stock' },
  out_of_stock: { ar: 'نفدت الكمية', en: 'Out of stock' },
};

const toolbarCopy = {
  added: 'تمت إضافة المنتج إلى السلة',
  quickView: 'عرض سريع',
  addToCart: 'أضف إلى السلة',
  chooseOptions: 'اختر الخيارات',
};

export function ProductCard({
  product,
  card = false,
  compact = false,
}: {
  product: CatalogProduct;
  // Wraps the image + info in one unified white bordered card instead of
  // the default "floating image, info below" look — opt-in per listing
  // surface (currently just FeaturedProducts' "تشكيل لأفضل منتجاتنا") so
  // every other product grid keeps its existing appearance untouched.
  card?: boolean;
  // Homepage best-sellers layout (implies `card`): landscape image, no
  // on-image pills, and a labelled add-to-cart button under the price.
  compact?: boolean;
}) {
  const { locale = 'ar' } = useParams();
  const loc: StorefrontLocale = 'ar';
  const wishlist = useWishlist();
  const wishlisted = wishlist.has(product.id);
  const attrs = useAttributes();
  const cart = useCart();
  const catalog = useCatalog();
  const categoryName = catalog.categories.find((c) => c.slug === product.category)?.name[loc];
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  // One shared sr-only live region per card announces wishlist/cart actions —
  // each button's aria-pressed already communicates ITS own new state, but
  // naming the product matters since a card sits in a grid of many.
  const [announcement, setAnnouncement] = useState('');
  const toggleWishlist = () => {
    setAnnouncement(
      wishlisted ? `أُزيل «${product.name.ar}» من المفضلة` : `أُضيف «${product.name.ar}» إلى المفضلة`,
    );
    wishlist.toggle(product.id);
  };
  const productHref = navHref(locale as StorefrontLocale, `/products/${product.slug}`);

  // Variant products are unavailable only when NO variant can currently be
  // bought (active, in-stock/low-stock, no disabled attribute/value in its
  // combo) — mirrors ProductInfo's PDP check so every listing surface
  // (catalog, category, collection, search, wishlist, related, homepage)
  // agrees with the PDP about purchasability. Simple products keep their
  // existing product-level availability check unchanged.
  const isVariant = isVariantProduct(product);
  const { out, options: quickAddOptions } = resolveQuickAdd(product, attrs);
  // No single per-product stock signal exists across variants — once at
  // least one is purchasable, the label falls back to the generic in-stock
  // state rather than guessing at low-stock; simple products keep their own
  // stored availability text unchanged.
  const displayAvailability: CatalogProduct['availability'] = out
    ? 'out_of_stock'
    : isVariant
      ? 'in_stock'
      : product.availability;

  const handleCartIcon = () => {
    if (!quickAddOptions) {
      // No single resolvable combination — open the quick-view modal so the
      // shopper can see enough to decide, rather than guessing a variant.
      setQuickViewOpen(true);
      return;
    }
    cart.add(product, quickAddOptions, 1);
    setAnnouncement(toolbarCopy.added);
  };
  const discountPercent = product.compareAtPrice
    ? Math.round((1 - product.price / product.compareAtPrice) * 100)
    : null;

  return (
    <article
      className={`group relative ${compact ? 'flex h-full flex-col' : ''} ${out ? 'opacity-70' : ''} ${
        card
          ? 'overflow-hidden rounded-[11px] border border-espresso/10 bg-white shadow-none transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-12px_rgba(222,98,27,0.25)]'
          : ''
      }`}
    >
      <div
        className={
          card
            ? 'relative overflow-hidden bg-taupe/20'
            : 'relative overflow-hidden rounded-sm bg-taupe/20 shadow-[0_16px_32px_-20px_rgba(41,34,30,0.28)] ring-1 ring-espresso/5 transition-shadow duration-500 group-hover:shadow-[0_20px_40px_-18px_rgba(41,34,30,0.38)]'
        }
      >
        <Link to={productHref} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold max-h-[270px]">
          <AssetImage
            src={product.image}
            alt={product.name[loc]}
            loading="lazy"
            sizes="(max-width: 640px) 48vw, 25vw"
            className={`${compact ? 'aspect-[3/2] sm:aspect-[2/1]' : 'aspect-[4/5]'} w-full object-cover transition duration-700 group-hover:scale-105`}
          />
          <AssetImage
            src={product.imageHover}
            alt=""
            loading="lazy"
            aria-hidden
            sizes="(max-width: 640px) 48vw, 25vw"
            className={`absolute inset-0 ${compact ? 'aspect-[3/2] sm:aspect-[2/1]' : 'aspect-[4/5]'} w-full object-cover opacity-0 transition duration-700 group-hover:opacity-100`}
          />
          {/* Dark tint — a flat overlay transitions reliably everywhere,
              unlike animating a gradient's own color stops. */}
          <span className="pointer-events-none absolute inset-0 bg-espresso/0 transition-colors duration-[400ms] group-hover:bg-espresso/25" />
        </Link>

        {discountPercent !== null && (
          <span className="absolute start-3 top-3 flex size-11 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white shadow-sm">
            -{discountPercent}%
          </span>
        )}
        <button
          type="button"
          onClick={toggleWishlist}
          aria-pressed={wishlisted}
          aria-label={loc === 'ar' ? 'أضف إلى المفضلة' : 'Add to wishlist'}
          className={`absolute end-3 top-3 inline-flex size-9 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
            wishlisted
              ? 'border-burgundy bg-burgundy text-white'
              : 'border-espresso/15 bg-white/90 text-espresso/70 hover:border-burgundy hover:text-burgundy'
          }`}
        >
          <Heart className={`size-4 ${wishlisted ? 'fill-current' : ''}`} />
        </button>

        {/* Category + availability pills pinned to the image's bottom edge
            (card variant only — other listings keep them as plain text
            lines under the title). pointer-events-none so taps still land
            on the product link underneath. */}
        {card && !compact && (
          <div className="pointer-events-none absolute bottom-3 start-3 flex items-center gap-2">
            {categoryName && (
              <span className="rounded-md bg-burgundy px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                {categoryName}
              </span>
            )}
            <span
              className={`rounded-md px-3 py-1 text-[11px] font-semibold text-white shadow-sm ${
                displayAvailability === 'in_stock'
                  ? 'bg-gold'
                  : displayAvailability === 'low_stock'
                    ? 'bg-burgundy'
                    : 'bg-espresso/70'
              }`}
            >
              {availabilityLabel[displayAvailability][loc]}
            </span>
          </div>
        )}

        {/* Centered action toolbar — fades/scales in on hover/focus, and
            stays visible on touch (`hover: none`) devices instead of needing
            a hover that doesn't exist there. Sits above the card link so
            each icon's own click never falls through to the image link
            underneath it. The card variant moves these actions into the
            info area next to the price instead. */}
        {!card && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 scale-95 items-center gap-2 rounded-full bg-white px-3 py-2 opacity-0 shadow-md transition-all duration-[400ms] group-hover:scale-100 group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100 [@media(hover:none)]:scale-100 [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={() => setQuickViewOpen(true)}
              aria-label={toolbarCopy.quickView}
              title={toolbarCopy.quickView}
              className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full text-espresso/60 transition hover:bg-burgundy hover:text-white"
            >
              <Search className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleCartIcon}
              aria-label={quickAddOptions ? toolbarCopy.addToCart : toolbarCopy.chooseOptions}
              title={quickAddOptions ? toolbarCopy.addToCart : toolbarCopy.chooseOptions}
              disabled={out}
              className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full text-espresso/60 transition hover:bg-burgundy hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <ShoppingCart className="size-4" />
            </button>
          </div>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      {quickViewOpen && <QuickViewModal product={product} onClose={() => setQuickViewOpen(false)} />}
      <div className={compact ? 'flex flex-1 flex-col px-3.5 pb-3.5 pt-2.5' : card ? 'px-4 pb-4 pt-3' : 'pt-4'}>
        <Link
          to={productHref}
          className={`text-[17px] ${compact ? "" : "block"} font-display text-espresso transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
            // Phones: reserve exactly 3 title lines and clamp longer titles, so every card in a row
            // has the same title block. From sm up, cards in a row are equalised by the flex layout.
            compact ? 'line-clamp-3 min-h-[3.125em] text-base font-bold leading-snug sm:min-h-0 sm:text-[15px] sm:font-normal' : card ? 'text-base' : ''
          }`}
        >
          {product.name[loc]}
        </Link>
        {/* Card variant shows category + availability as on-image pills
            instead of these text lines. */}
        {!card && categoryName && <p className="mt-1 text-xs text-espresso/55">{categoryName}</p>}
        <div className={`mt-1.5 flex gap-2 ${compact ? 'items-start justify-between max-sm:min-h-11' : card ? 'items-center justify-between' : 'items-baseline'}`}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`whitespace-nowrap text-sm font-semibold ${product.compareAtPrice ? 'text-burgundy' : 'text-espresso'}`}>
              {formatPrice(product.price, loc)}
            </span>
            {product.compareAtPrice && (
              <span className="whitespace-nowrap text-xs text-espresso/45 line-through" dir="ltr">
                {formatPrice(product.compareAtPrice, loc)}
              </span>
            )}
          </div>
          {compact && (
            <button
              type="button"
              onClick={() => setQuickViewOpen(true)}
              aria-label={toolbarCopy.quickView}
              title={toolbarCopy.quickView}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-porcelain text-espresso/55 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy sm:hidden"
            >
              <Search className="size-3.5" />
            </button>
          )}
          {/* Card variant: same quick-view/cart actions as the on-image
              toolbar, rendered smaller inline next to the price. */}
          {card && !compact && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setQuickViewOpen(true)}
                aria-label={toolbarCopy.quickView}
                title={toolbarCopy.quickView}
                className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-porcelain hover:text-burgundy"
              >
                <Search className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCartIcon}
                aria-label={quickAddOptions ? toolbarCopy.addToCart : toolbarCopy.chooseOptions}
                title={quickAddOptions ? toolbarCopy.addToCart : toolbarCopy.chooseOptions}
                disabled={out}
                className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-porcelain hover:text-burgundy disabled:pointer-events-none disabled:opacity-40"
              >
                <ShoppingCart className="size-3.5" />
              </button>
            </div>
          )}
        </div>
        {compact && (
          <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
            <button
              type="button"
              onClick={() => setQuickViewOpen(true)}
              aria-label={toolbarCopy.quickView}
              title={toolbarCopy.quickView}
              className="hidden size-8 items-center justify-center sm:inline-flex rounded-full text-espresso/50 transition hover:bg-porcelain hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Search className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCartIcon}
              disabled={out}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-burgundy px-2.5 text-[13px] sm:h-8 sm:w-auto sm:px-3.5 sm:text-[12px] font-semibold text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy disabled:pointer-events-none disabled:opacity-50"
            >
              <ShoppingCart className="size-3.5" aria-hidden />
              {out ? availabilityLabel.out_of_stock[loc] : quickAddOptions ? toolbarCopy.addToCart : toolbarCopy.chooseOptions}
            </button>
          </div>
        )}
        {!card && (
          <p
            className={`mt-1 text-[11px] tracking-wide ${
              displayAvailability === 'low_stock'
                ? 'text-burgundy'
                : out
                  ? 'text-espresso/45'
                  : 'text-espresso/55'
            }`}
          >
            {availabilityLabel[displayAvailability][loc]}
          </p>
        )}
      </div>
    </article>
  );
}
