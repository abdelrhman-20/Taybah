import { AssetImage } from '../../shared/components/AssetImage';
import { useState } from 'react';
import { Link } from 'react-router';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { useCart } from './useCart';
import { attributeByKey, attributeValueLabel } from '../catalog/attributeStore';
import { resolveCartLines, useCatalog, type ResolvedCartLine } from '../catalog/catalogStore';
import { formatPrice } from '../../shared/utils/format';
import { navHref } from '../layout/navData';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'سلة التسوق',
    empty: 'سلتك فارغة',
    emptyDesc: 'لم تضف أي قطع بعد — تصفح المتجر واختر ما يناسب بيتك.',
    browse: 'تصفح المنتجات',
    remove: 'إزالة',
    increase: 'زيادة الكمية',
    decrease: 'إنقاص الكمية',
    clear: 'إفراغ السلة',
    clearConfirm: 'هل تريد إفراغ السلة بالكامل؟',
    confirm: 'نعم، أفرغها',
    cancel: 'إلغاء',
    summary: 'ملخص الطلب',
    subtotal: 'الإجمالي الفرعي',
    shipping: 'الشحن',
    shippingNote: 'يُحسب عند إتمام الطلب',
    total: 'الإجمالي',
    checkout: 'إتمام الطلب',
    checkoutNote: 'الدفع والتوصيل الفعليان يتطلبان ربط الخادم — الطلب التجريبي لا يُرسل لخادم حقيقي.',
    blockedHidden: 'مخفي — أُزيل من المتجر ولا يمكن شراؤه حاليًا',
    blockedUnavailable: 'غير متوفر — نفد من المخزون ولا يمكن شراؤه حاليًا',
    blockedRemoved: 'هذه التركيبة لم تعد متوفرة — أزلها أو اختر تركيبة أخرى',
    blockedNote: 'أزل المنتجات المحظورة من السلة لإتمام الطلب.',
    continue: 'متابعة التسوق',
    items: (n: number) => (n === 1 ? 'قطعة واحدة' : n === 2 ? 'قطعتان' : `${n} قطع`),
  },
  en: {
    home: 'Home',
    title: 'Shopping Cart',
    empty: 'Your cart is empty',
    emptyDesc: 'Nothing added yet — browse the shop and pick pieces for your home.',
    browse: 'Browse products',
    remove: 'Remove',
    increase: 'Increase quantity',
    decrease: 'Decrease quantity',
    clear: 'Clear cart',
    clearConfirm: 'Empty the entire cart?',
    confirm: 'Yes, clear it',
    cancel: 'Cancel',
    summary: 'Order summary',
    subtotal: 'Subtotal',
    shipping: 'Shipping',
    shippingNote: 'Calculated at checkout',
    total: 'Total',
    checkout: 'Proceed to checkout',
    checkoutNote: 'Live payment & delivery require the backend phase — the demo order is not sent to a real server.',
    blockedHidden: 'Hidden — removed from the storefront and cannot be purchased',
    blockedUnavailable: 'Unavailable — out of stock and cannot be purchased',
    blockedRemoved: 'This combination is no longer available — remove it or choose another',
    blockedNote: 'Remove blocked items from the cart to check out.',
    continue: 'Continue shopping',
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
  },
};



function CartLineRow({ r, locale }: { r: ResolvedCartLine; locale: StorefrontLocale }) {
  const t = copy[locale];
  const cart = useCart();
  const { line, product, block } = r;
  const opts = r.options
    .map(
      ([k, v]) =>
        `${attributeByKey(k)?.name[locale] ?? k}: ${attributeValueLabel(k, v, locale)}`,
    )
    .join(' · ');
  const thumb = (
    <AssetImage src={r.image} alt={r.name?.[locale] ?? ''} className="h-28 w-24 object-cover sm:h-32 sm:w-28" />
  );
  const nameEl = product ? (
    <Link
      to={navHref(locale, `/products/${product.slug}`)}
      className="text-sm font-medium text-espresso transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:text-base"
    >
      {r.name?.[locale]}
    </Link>
  ) : (
    <p className="text-sm font-medium text-espresso sm:text-base">{r.name?.[locale]}</p>
  );

  return (
    <li className="flex gap-4 py-6 sm:gap-6">
      {product ? (
        <Link
          to={navHref(locale, `/products/${product.slug}`)}
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {thumb}
        </Link>
      ) : (
        <span className="shrink-0">{thumb}</span>
      )}
      <div className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            {nameEl}
            {opts && <p className="mt-1 text-xs text-espresso/55">{opts}</p>}
            {r.sku && (
              <p className="mt-1 text-xs text-espresso/55" dir="ltr">
                {r.sku}
              </p>
            )}
            {block && (
              <p className="mt-2 inline-flex w-fit items-center border border-burgundy/40 bg-burgundy/5 px-2.5 py-1 text-xs font-medium text-burgundy">
                {block === 'hidden'
                  ? t.blockedHidden
                  : line.variantId !== null && product
                    ? t.blockedRemoved
                    : t.blockedUnavailable}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => cart.remove(line.key)}
            aria-label={t.remove}
            title={t.remove}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-espresso/50 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className={`inline-flex items-center border border-espresso/20 ${block ? 'opacity-40' : ''}`}>
            <button
              type="button"
              aria-label={t.decrease}
              disabled={line.qty <= 1 || Boolean(block)}
              onClick={() => cart.setQty(line.key, line.qty - 1)}
              className="inline-flex size-9 items-center justify-center text-espresso/70 transition hover:text-burgundy disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-10 text-center text-sm font-semibold" aria-live="polite">
              {line.qty}
            </span>
            <button
              type="button"
              aria-label={t.increase}
              disabled={Boolean(block)}
              onClick={() => cart.setQty(line.key, line.qty + 1)}
              className="inline-flex size-9 items-center justify-center text-espresso/70 transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="text-end">
            <p className="text-sm font-semibold text-espresso">{formatPrice(r.unitPrice * line.qty, locale)}</p>
            <p className="text-xs text-espresso/50">
              {formatPrice(r.unitPrice, locale)} × {line.qty}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}

export function CartPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const cart = useCart();
  const [confirmClear, setConfirmClear] = useState(false);

  const catalog = useCatalog();
  const lines = resolveCartLines(cart.lines, catalog).filter((x) => x.name !== null);
  const hasBlocked = lines.some((x) => x.block !== null);
  const subtotal = lines.reduce((n, x) => n + x.unitPrice * x.line.qty, 0);

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-espresso sm:text-4xl">
          {locale === 'ar' ? (
            <><span className="text-burgundy">سلة</span> التسوق</>
          ) : (
            <><span className="text-burgundy">Shopping</span> Cart</>
          )}
        </h1>
        {lines.length > 0 && (
          <span className="text-sm text-espresso/55">{t.items(cart.count)}</span>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-20 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-taupe text-espresso/50">
            <ShoppingBag className="size-7" aria-hidden />
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
        <div className="mt-10 gap-12 lg:grid lg:grid-cols-[1fr_360px]">
          <div>
            <ul className="divide-y divide-espresso/10 border-y border-espresso/10">
              {lines.map((r) => (
                <CartLineRow key={r.line.key} r={r} locale={locale} />
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <Link
                to={navHref(locale, '/products')}
                className="text-sm font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.continue}
              </Link>
              {confirmClear ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-espresso/70">{t.clearConfirm}</span>
                  <button
                    type="button"
                    onClick={() => { cart.clear(); setConfirmClear(false); }}
                    className="border border-burgundy px-4 py-1.5 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {t.confirm}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-xs text-espresso/60 underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {t.cancel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-xs text-espresso/55 underline-offset-4 transition hover:text-burgundy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  {t.clear}
                </button>
              )}
            </div>
          </div>

          <aside className="mt-10 lg:mt-0">
            <div className="border border-espresso/10 bg-white p-6 lg:sticky lg:top-28">
              <h2 className="font-display text-xl text-espresso">{t.summary}</h2>
              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-espresso/60">{t.subtotal}</dt>
                  <dd className="font-medium text-espresso">{formatPrice(subtotal, locale)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-espresso/60">{t.shipping}</dt>
                  <dd className="text-espresso/50">{t.shippingNote}</dd>
                </div>
                <div className="flex justify-between border-t border-espresso/10 pt-3">
                  <dt className="font-medium text-espresso">{t.total}</dt>
                  <dd className="font-display text-lg font-medium text-espresso">
                    {formatPrice(subtotal, locale)}
                  </dd>
                </div>
              </dl>
              {hasBlocked ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="mt-6 block w-full cursor-not-allowed bg-espresso/25 px-8 py-3 text-center text-sm font-medium tracking-wide text-white"
                  >
                    {t.checkout}
                  </button>
                  <p className="mt-3 text-xs font-medium leading-5 text-burgundy">{t.blockedNote}</p>
                </>
              ) : (
                <Link
                  to={navHref(locale, '/checkout')}
                  className="mt-6 block w-full rounded-[27px] bg-burgundy px-8 py-3 text-center text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  {t.checkout}
                </Link>
              )}
              <p className="mt-3 text-xs leading-5 text-espresso/50">{t.checkoutNote}</p>
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}
