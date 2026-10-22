import { AssetImage } from '../../shared/components/AssetImage';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { useCart } from './useCart';
import { attributeByKey, attributeValueLabel } from '../catalog/attributeStore';
import { resolveCartLines, useCatalog } from '../catalog/catalogStore';
import { formatPrice } from '../../shared/utils/format';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';

const copy = {
  ar: {
    title: 'سلة التسوق',
    empty: 'سلتك فارغة',
    emptyDesc: 'أضف قطعًا من المتجر لتظهر هنا.',
    browse: 'تصفح المنتجات',
    subtotal: 'الإجمالي الفرعي',
    note: 'إتمام الطلب تجريبي حاليًا — لا يُرسل الطلب لخادم حقيقي في هذه المرحلة.',
    viewCart: 'عرض صفحة السلة',
    remove: 'إزالة',
    increase: 'زيادة الكمية',
    decrease: 'إنقاص الكمية',
    blockedHidden: 'مخفي — لا يمكن شراؤه حاليًا',
    blockedUnavailable: 'غير متوفر — نفد من المخزون',
    blockedRemoved: 'لم تعد متوفرة في المتجر',
    close: 'إغلاق السلة',
  },
  en: {
    title: 'Shopping Cart',
    empty: 'Your cart is empty',
    emptyDesc: 'Add pieces from the shop and they will appear here.',
    browse: 'Browse products',
    subtotal: 'Subtotal',
    note: 'Checkout is a demo for now — the order is not sent to a real backend in this phase.',
    viewCart: 'View cart page',
    remove: 'Remove',
    increase: 'Increase quantity',
    decrease: 'Decrease quantity',
    blockedHidden: 'Hidden — cannot be purchased',
    blockedUnavailable: 'Unavailable — out of stock',
    blockedRemoved: 'No longer available in the store',
    close: 'Close cart',
  },
};

export function CartDrawer() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const cart = useCart();
  const catalog = useCatalog();
  const { drawerOpen, setDrawer } = cart;

  useEffect(() => {
    if (!drawerOpen) return;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen, setDrawer]);

  if (!cart.drawerOpen) return null;

  // Missing-product lines only render when a snapshot keeps them displayable;
  // legacy lines without snapshots keep the old drop-from-view behavior.
  const lines = resolveCartLines(cart.lines, catalog).filter((x) => x.name !== null);
  const subtotal = lines.reduce((n, x) => n + x.unitPrice * x.line.qty, 0);

  const optionLabel = (attrKey: string, key: string) =>
    `${attributeByKey(attrKey)?.name[locale] ?? attrKey}: ${attributeValueLabel(attrKey, key, locale)}`;

  return (
    <div className="fixed inset-0 z-70" role="dialog" aria-modal="true" aria-label={t.title}>
      <button
        type="button"
        aria-label={t.close}
        onClick={() => cart.setDrawer(false)}
        className="absolute inset-0 bg-espresso/50"
      />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-porcelain shadow-2xl">
        <div className="flex items-center justify-between border-b border-espresso/10 px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-lg text-espresso">
            <ShoppingBag className="size-5" aria-hidden />
            {t.title}
            <span className="text-sm font-normal text-espresso/50">({cart.count})</span>
          </h2>
          <button
            type="button"
            onClick={() => cart.setDrawer(false)}
            aria-label={t.close}
            className="inline-flex size-9 items-center justify-center rounded-full text-espresso/70 transition hover:bg-espresso/5 hover:text-espresso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="font-display text-xl text-espresso">{t.empty}</p>
              <p className="text-sm text-espresso/60">{t.emptyDesc}</p>
              <Link
                to={navHref(locale, '/products')}
                onClick={() => cart.setDrawer(false)}
                className="border border-burgundy px-6 py-2.5 text-sm font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.browse}
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-espresso/10">
              {lines.map((r) => {
                const { line, product, block } = r;
                const opts = r.options.map(([k, v]) => optionLabel(k, v)).join(' · ');
                return (
                  <li key={line.key} className="flex gap-4 py-5">
                    <AssetImage
                      src={r.image}
                      alt={r.name![locale]}
                      className="size-20 shrink-0 object-cover"
                    />
                    <div className="flex flex-1 flex-col">
                      {product ? (
                        <Link
                          to={navHref(locale, `/products/${product.slug}`)}
                          onClick={() => cart.setDrawer(false)}
                          className="text-sm font-medium text-espresso transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                          {r.name![locale]}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-espresso">{r.name![locale]}</p>
                      )}
                      {opts && <p className="mt-0.5 text-xs text-espresso/55">{opts}</p>}
                      {block && (
                        <p className="mt-1 inline-flex w-fit items-center border border-burgundy/40 bg-burgundy/5 px-2 py-0.5 text-[11px] font-medium text-burgundy">
                          {block === 'hidden'
                            ? t.blockedHidden
                            : line.variantId !== null && product
                              ? t.blockedRemoved
                              : t.blockedUnavailable}
                        </p>
                      )}
                      <p className="mt-1 text-sm font-semibold text-espresso">
                        {formatPrice(r.unitPrice, locale)}
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                        <div className={`inline-flex items-center border border-espresso/20 ${block ? 'opacity-40' : ''}`}>
                          <button
                            type="button"
                            aria-label={t.decrease}
                            onClick={() => cart.setQty(line.key, line.qty - 1)}
                            disabled={line.qty <= 1 || Boolean(block)}
                            className="inline-flex size-8 items-center justify-center text-espresso/70 transition hover:text-burgundy disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">{line.qty}</span>
                          <button
                            type="button"
                            aria-label={t.increase}
                            onClick={() => cart.setQty(line.key, line.qty + 1)}
                            disabled={Boolean(block)}
                            className="inline-flex size-8 items-center justify-center text-espresso/70 transition hover:text-burgundy disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => cart.remove(line.key)}
                          className="text-xs text-espresso/55 underline-offset-4 transition hover:text-burgundy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        >
                          {t.remove}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-espresso/10 px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-espresso/65">{t.subtotal}</span>
              <span className="font-display text-lg font-medium text-espresso">
                {formatPrice(subtotal, locale)}
              </span>
            </div>
            <Link
              to={navHref(locale, '/cart')}
              onClick={() => cart.setDrawer(false)}
              className="mt-3 block border border-espresso/25 py-2.5 text-center text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {t.viewCart}
            </Link>
            <p className="mt-2 text-xs leading-5 text-espresso/50">{t.note}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
