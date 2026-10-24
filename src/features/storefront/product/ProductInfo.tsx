import { useState } from 'react';
import { Link } from 'react-router';
import { Heart, ShoppingBag } from 'lucide-react';
import type { CatalogProduct, ProductVariant } from '../catalog/catalogData';
import {
  attributeByKey,
  attributeValueHex,
  attributeValueLabel,
  enabledValues,
  useAttributes,
} from '../catalog/attributeStore';
import { useCatalog } from '../catalog/catalogStore';
import {
  axisValueEnabled,
  hasPurchasableVariant,
  isVariantProduct,
  offeredAxisValues,
  sellableVariantAxes,
  variantAvailability,
  variantCompareAtPrice,
  variantPrice,
  variantPurchasable,
  type VariantSelection,
} from '../catalog/variants';
import { useWishlist } from '../wishlist/useWishlist';
import { useCart } from '../cart/useCart';
import { formatPrice } from '../../shared/utils/format';
import { navHref } from '../layout/navData';
import { QuantityStepper } from './QuantityStepper';
import { ColorSwatches } from './ColorSwatches';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: {
    sku: 'رمز المنتج',
    color: 'اللون',
    size: 'المقاس',
    material: 'الخامة',
    collection: 'المجموعة',
    chooseColor: 'اختر اللون',
    chooseSize: 'اختر المقاس',
    quantity: 'الكمية',
    add: 'أضف إلى السلة',
    outOfStock: 'نفدت الكمية',
    inStock: 'متوفر',
    lowStock: 'باقي قطع قليلة — اطلبها الآن',
    pickOptions: 'حدّد خياراتك لمعرفة التوفر',
    chooseAxes: 'اختر',
    comboUnavailable: 'هذه التركيبة غير متوفرة حاليًا',


    wishlistAdd: 'أضف إلى المفضلة',
    wishlistRemove: 'إزالة من المفضلة',
    discount: 'خصم',
    addedToCart: 'تمت إضافة المنتج إلى السلة',
    addedToWishlist: 'أُضيف إلى المفضلة',
    removedFromWishlist: 'أُزيل من المفضلة',
  },
  en: {
    sku: 'SKU',
    color: 'Color',
    size: 'Size',
    material: 'Material',
    collection: 'Collection',
    chooseColor: 'Select a color',
    chooseSize: 'Select a size',
    quantity: 'Quantity',
    add: 'Add to cart',
    outOfStock: 'Out of stock',
    inStock: 'In stock',
    lowStock: 'Only a few pieces left — order now',
    pickOptions: 'Pick your options to check availability',
    chooseAxes: 'Select',
    comboUnavailable: 'This combination is currently unavailable',


    wishlistAdd: 'Add to wishlist',
    wishlistRemove: 'Remove from wishlist',
    discount: 'off',
    addedToCart: 'Added to cart',
    addedToWishlist: 'Added to wishlist',
    removedFromWishlist: 'Removed from wishlist',
  },
};

export function ProductInfo({
  product,
  locale,
  selection,
  onSelectAxis,
  resolved,
}: {
  product: CatalogProduct;
  locale: StorefrontLocale;
  // Variant products: selection/resolved are computed in ProductPage so the
  // gallery shares the resolved variant's image. Undefined for simple
  // products — the legacy color/size path below applies unchanged.
  selection?: VariantSelection;
  onSelectAxis?: (axis: string, value: string) => void;
  resolved?: ProductVariant;
}) {
  const t = copy[locale];
  const wishlist = useWishlist();
  const cart = useCart();
  const wishlisted = wishlist.has(product.id);
  const attrs = useAttributes(); // selectors + labels resolve option definitions from the store

  const isVariant = isVariantProduct(product);
  const axes = product.variantAxes ?? [];
  // Axes whose attribute is still enabled — a disabled attribute's whole
  // selector disappears rather than offering a dead-end choice.
  const sellableAxes = sellableVariantAxes(axes, attrs);

  // Only enabled option values are selectable — a value the admin disabled
  // can't be picked, though the product record keeps its stored keys.
  const colorOpts = enabledValues('color').filter((o) => product.colors.includes(o.key));
  const sizeOpts = enabledValues('size').filter((o) => product.sizes.includes(o.key));
  const needsColor = !isVariant && colorOpts.length > 1;
  const needsSize = !isVariant && sizeOpts.length > 1;
  const [color, setColor] = useState<string | null>(needsColor ? null : (colorOpts[0]?.key ?? null));
  const [size, setSize] = useState<string | null>(needsSize ? null : (sizeOpts[0]?.key ?? null));
  const [qty, setQty] = useState(1);
  // sr-only live region — announces the add-to-cart/wishlist result since
  // neither action otherwise produces feedback a screen reader would catch
  // (the cart drawer opening and the heart's aria-pressed change are visual).
  const [announcement, setAnnouncement] = useState('');

  // Effective display values: product base until a variant resolves, then
  // the variant's inherited/override pricing and availability.
  const effPrice = resolved ? variantPrice(resolved, product) : product.price;
  const effCompareAt = resolved
    ? variantCompareAtPrice(resolved, product)
    : product.compareAtPrice;
  const anyPurchasable = isVariant
    ? hasPurchasableVariant(product, attrs)
    : product.availability !== 'out_of_stock';
  const effAvailability = resolved
    ? variantAvailability(resolved)
    : anyPurchasable
      ? null // unresolved — neutral prompt instead of a misleading status
      : 'out_of_stock';
  const out = effAvailability === 'out_of_stock';
  const discount = effCompareAt ? Math.round((1 - effPrice / effCompareAt) * 100) : null;

  // Variant purchase gating: an exact active variant must be resolved and
  // purchasable — any axis combination is addable via variantId identity.
  const sel = selection ?? {};
  const missingAxes = isVariant ? sellableAxes.filter((a) => sel[a] == null) : [];
  const purchasable = resolved !== undefined && variantPurchasable(resolved);
  const canAdd = isVariant
    ? purchasable
    : !out && (!needsColor || color !== null) && (!needsSize || size !== null);

  const catalog = useCatalog();
  const category = catalog.categories.find((c) => c.slug === product.category);

  const axisName = (axis: string) => attributeByKey(axis)?.name[locale] ?? axis;

  return (
    <div>
      {category && (
        <Link
          to={navHref(locale, `/category/${category.slug}`)}
          className="text-xs font-medium uppercase tracking-[0.2em] text-burgundy transition hover:text-espresso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {category.name[locale]}
        </Link>
      )}
      <h1 className="mt-2 font-display text-[1.9rem] leading-snug text-espresso sm:text-4xl">{product.name[locale]}</h1>
      {product.description[locale] && (
        <p className="mt-3 max-w-xl text-sm leading-7 text-espresso/70 sm:text-base">{product.description[locale]}</p>
      )}

      <div className="mt-5 flex flex-wrap items-baseline gap-3">
        <span className={`font-display text-3xl ${discount ? 'text-burgundy' : 'text-espresso'}`}>
          {formatPrice(effPrice, locale)}
        </span>
        {effCompareAt && (
          <span className="text-base text-espresso/45 line-through" dir="ltr">
            {formatPrice(effCompareAt, locale)}
          </span>
        )}
        {discount && (
          <span className="rounded-full bg-burgundy/10 px-3 py-0.5 text-xs font-semibold text-burgundy">
            {discount}% {t.discount}
          </span>
        )}
      </div>

      <p
        className={`mt-3 flex items-center gap-2 text-sm ${
          out
            ? 'text-espresso/50'
            : effAvailability === 'low_stock'
              ? 'text-burgundy'
              : effAvailability === 'in_stock'
                ? 'text-espresso/70'
                : 'text-espresso/50'
        }`}
      >
        <span
          className={`size-2 rounded-full ${
            out
              ? 'bg-espresso/30'
              : effAvailability === 'low_stock'
                ? 'bg-burgundy'
                : effAvailability === 'in_stock'
                  ? 'bg-gold'
                  : 'bg-espresso/30'
          }`}
          aria-hidden
        />
        {effAvailability === null
          ? t.pickOptions
          : out
            ? t.outOfStock
            : effAvailability === 'low_stock'
              ? t.lowStock
              : t.inStock}
      </p>

      {/* Variant selectors — one control per configured axis, values sourced
          from stored variant combos and filtered progressively so impossible
          combinations can never be picked. */}
      {isVariant &&
        sellableAxes.map((axis) => {
          const attr = attributeByKey(axis);
          const chosen = sel[axis] ?? null;
          const options = offeredAxisValues(product, axis, attrs);
          // The colour axis always renders as visual swatches (never text chips),
          // whatever display style the attribute is configured with.
          if (axis === 'color') {
            return (
              <ColorSwatches
                key={axis}
                className="mt-7"
                label={axisName(axis)}
                options={options.map((value) => ({
                  key: value,
                  label: attributeValueLabel(axis, value, locale) ?? value,
                  hex: attributeValueHex(axis, value),
                  disabled: !axisValueEnabled(product, sel, axis, value),
                }))}
                selected={chosen}
                onSelect={(value) => onSelectAxis?.(axis, value)}
                emptyText={t.comboUnavailable}
              />
            );
          }
          const swatch = attr?.display === 'swatch';
          return (
            <div key={axis} className={swatch ? 'mt-7' : 'mt-6'}>
              <p className="mb-2.5 text-base font-semibold text-espresso">
                {axisName(axis)}
                {chosen && (
                  <span className="ms-2 font-normal text-espresso/55">
                    {attributeValueLabel(axis, chosen, locale)}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2.5">
                {options.map((value) => {
                  const on = chosen === value;
                  const enabled = axisValueEnabled(product, sel, axis, value);
                  const label = attributeValueLabel(axis, value, locale) ?? value;
                  if (swatch) {
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!enabled}
                        onClick={() => onSelectAxis?.(axis, value)}
                        aria-pressed={on}
                        aria-label={`${axisName(axis)}: ${label}`}
                        title={label}
                        className={`size-9 rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-30 ${
                          on
                            ? 'border-burgundy ring-2 ring-burgundy/25'
                            : 'border-espresso/15 hover:border-espresso/40'
                        }`}
                        style={{ backgroundColor: attributeValueHex(axis, value) }}
                      />
                    );
                  }
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={!enabled}
                      onClick={() => onSelectAxis?.(axis, value)}
                      aria-pressed={on}
                      className={`min-w-[5.5rem] rounded-sm border px-4 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through ${
                        on
                          ? 'border-burgundy bg-burgundy text-white'
                          : 'border-espresso/20 text-espresso/75 hover:border-espresso/50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                {options.length === 0 && (
                  <p className="text-xs text-espresso/50">{t.comboUnavailable}</p>
                )}
              </div>
            </div>
          );
        })}

      {/* Legacy simple-product selectors — unchanged for non-variant items. */}
      {!isVariant && colorOpts.length > 0 && (
        <ColorSwatches
          className="mt-7"
          label={t.color}
          options={colorOpts.map((o) => ({ key: o.key, label: o.label[locale], hex: o.hex }))}
          selected={color}
          onSelect={needsColor ? setColor : undefined}
        />
      )}

      {needsSize && (
        <div className="mt-6">
          <p className="mb-2.5 text-base font-semibold text-espresso">
            {t.size}
            {size && <span className="ms-2 font-normal text-espresso/55">{attributeValueLabel('size', size, locale)}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {sizeOpts.map((o) => {
              const key = o.key;
              const on = size === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSize(key)}
                  aria-pressed={on}
                  className={`min-w-[5.5rem] rounded-sm border px-4 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                    on
                      ? 'border-burgundy bg-burgundy text-white'
                      : 'border-espresso/20 text-espresso/75 hover:border-espresso/50'
                  }`}
                >
                  {o.label[locale]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8">
        <p className="mb-2.5 text-base font-semibold text-espresso">{t.quantity}</p>
        <QuantityStepper value={qty} onChange={setQty} locale={locale} />
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            if (!canAdd) return;
            if (isVariant && resolved) cart.add(product, { variant: resolved }, qty);
            else cart.add(product, { color, size }, qty);
            setAnnouncement(t.addedToCart);
          }}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-burgundy px-8 py-3.5 text-base font-semibold tracking-wide text-white shadow-[0_10px_24px_-12px_rgba(104,29,32,0.6)] transition hover:bg-burgundy/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          <ShoppingBag className="size-4" aria-hidden />
          {out ? t.outOfStock : t.add}
        </button>
        <button
          type="button"
          onClick={() => {
            setAnnouncement(wishlisted ? t.removedFromWishlist : t.addedToWishlist);
            wishlist.toggle(product.id);
          }}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? t.wishlistRemove : t.wishlistAdd}
          title={wishlisted ? t.wishlistRemove : t.wishlistAdd}
          className={`inline-flex size-[3.25rem] shrink-0 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
            wishlisted
              ? 'border-burgundy bg-burgundy text-white'
              : 'border-espresso/25 text-espresso/70 hover:border-burgundy hover:text-burgundy'
          }`}
        >
          <Heart className={`size-5 ${wishlisted ? 'fill-current' : ''}`} />
        </button>
      </div>
      {/* Selection guidance — variant products name the missing axes; simple
          products keep the legacy color/size prompts. */}
      {isVariant ? (
        missingAxes.length > 0 ? (
          <p className="mt-2 text-xs text-burgundy">
            {t.chooseAxes}: {missingAxes.map(axisName).join(locale === 'ar' ? '، ' : ', ')}
          </p>
        ) : !resolved ? (
          <p className="mt-2 text-xs text-burgundy">{t.comboUnavailable}</p>
        ) : null
      ) : (needsColor && !color) || (needsSize && !size) ? (
        <p className="mt-2 text-xs text-burgundy">
          {needsColor && !color ? t.chooseColor : t.chooseSize}
        </p>
      ) : null}

      <dl className="mt-7 border-t border-espresso/10 pt-4 text-sm">
        <div className="flex gap-3">
          <dt className="shrink-0 text-espresso/50">{t.sku}</dt>
          <dd className="text-espresso" dir="ltr">{resolved?.sku ?? product.sku}</dd>
        </div>
      </dl>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
