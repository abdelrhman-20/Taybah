import { AssetImage } from '../../shared/components/AssetImage';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import {
  ORDER_STATUS_LABELS_AR,
  ORDER_STATUSES,
  useOrder,
  useOrdersLoadState,
  reloadOrders,
  updateOrderStatus,
  type OrderStatus,
} from '../../storefront/checkout/orderStore';
import { checkoutCountries, deliveryMethods, egyptGovernorates } from '../../storefront/checkout/checkoutData';
import { attributeValueLabel } from '../../storefront/catalog/attributeStore';
import { describePersistenceError } from '../../../lib/persistence/errors';
import { LoadingState } from '../../shared/components/LoadingState';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { OrderEmailLog } from './OrderEmailLog';
import { formatPrice } from '../../shared/utils/format';

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const dtCls = 'w-28 shrink-0 text-xs tracking-wide text-espresso/50';

export function OrderDetailsPage() {
  const { orderId } = useParams();
  const order = useOrder(orderId);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const loadState = useOrdersLoadState();
  const [statusError, setStatusError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Resolves only when the database confirmed the change (a zero-row update
  // is an error, not a success). Passing the status this screen is showing
  // makes the update conditional: if someone else changed it meanwhile the
  // save is refused instead of silently overwriting.
  const applyStatus = (status: OrderStatus) => {
    if (applying || !order) return;
    setStatusError(null);
    setApplying(true);
    updateOrderStatus(order.id, status, order.status)
      .then(() => setPendingStatus(null))
      .catch((e: unknown) => {
        console.error('Order status update failed:', e instanceof Error ? e.message : e);
        setStatusError(describePersistenceError(e));
        void reloadOrders();
      })
      .finally(() => setApplying(false));
  };

  if (!order && (loadState.status === 'loading' || loadState.status === 'idle')) {
    return <LoadingState label="جارٍ تحميل الطلب…" />;
  }

  if (!order && loadState.status === 'error') {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title="تعذّر تحميل الطلب" />
        <p role="alert" className="text-sm text-burgundy">
          لم نتمكن من تحميل الطلبات من الخادم — هذا لا يعني أن الطلب غير موجود.
        </p>
        <button
          type="button"
          onClick={() => void reloadOrders()}
          className="mt-4 rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title="الطلب غير موجود" />
        <p className="text-sm text-espresso/60">
          لا يوجد طلب بهذا المرجع.
        </p>
        <Link
          to="/admin/orders"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى الطلبات
        </Link>
      </div>
    );
  }

  const countryLabel =
    checkoutCountries.find((c) => c.code === order.address.country)?.label.ar ?? order.address.country;
  const govLabel =
    order.address.country === 'EG'
      ? egyptGovernorates.find((g) => g.en === order.address.governorate)?.ar ?? order.address.governorate
      : order.address.governorate;
  const methodLabel =
    deliveryMethods.find((m) => m.key === order.delivery.method)?.label.ar ?? order.delivery.method;
  const opt = (attrKey: string, key: string | null) =>
    attributeValueLabel(attrKey, key, 'ar');
  const address = [
    order.address.street,
    order.address.building && `مبنى ${order.address.building}`,
    order.address.apartment,
    order.address.city,
    govLabel,
    countryLabel,
  ]
    .filter(Boolean)
    .join('، ');

  const confirmCancel = pendingStatus === 'cancelled';

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/admin/orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> الطلبات
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-mono font-display text-2xl tracking-wide text-espresso" dir="ltr">
            {order.ref}
          </h2>
          <p className="mt-1 text-xs text-espresso/55">أُرسل في {dateTime(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* status management */}
      <section aria-label="تحديث حالة الطلب" className="mt-6 rounded border border-taupe/70 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="od-status" className="text-sm font-medium text-espresso">
            تحديث الحالة
          </label>
          <select
            id="od-status"
            value={pendingStatus ?? order.status}
            onChange={(e) => setPendingStatus(e.target.value as OrderStatus)}
            disabled={applying}
            className="border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABELS_AR[s]}</option>
            ))}
          </select>
          {pendingStatus && pendingStatus !== order.status && !confirmCancel && (
            <button
              type="button"
              onClick={() => applyStatus(pendingStatus)}
              disabled={applying}
              className="rounded bg-burgundy px-5 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              {applying ? 'جارٍ التطبيق…' : 'تطبيق'}
            </button>
          )}
        </div>
        {statusError && (
          <p role="alert" className="mt-3 text-xs font-medium text-burgundy">
            {statusError}
          </p>
        )}
        {confirmCancel && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3">
            <TriangleAlert className="size-4 shrink-0 text-burgundy" aria-hidden />
            <p className="text-xs leading-5 text-espresso/75">
              إلغاء هذا الطلب؟ سيبقى في قائمة الطلبات بحالة «ملغٍ» — لن يُحذف شيء.
            </p>
            <div className="ms-auto flex gap-2">
              <button
                type="button"
                onClick={() => applyStatus('cancelled')}
                disabled={applying}
                className="rounded bg-burgundy px-4 py-1.5 text-xs font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                {applying ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
              </button>
              <button
                type="button"
                onClick={() => setPendingStatus(null)}
                className="rounded border border-espresso/25 px-4 py-1.5 text-xs font-medium text-espresso transition hover:border-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                الإبقاء على الطلب
              </button>
            </div>
          </div>
        )}
      </section>

      <OrderEmailLog orderId={order.id} status={order.status} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="od-contact" className="rounded border border-taupe/70 bg-white p-5">
          <h3 id="od-contact" className="font-display text-lg text-espresso">العميل</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-3"><dt className={dtCls}>الاسم</dt><dd className="text-espresso">{order.contact.name}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>الهاتف</dt><dd className="text-espresso" dir="ltr">{order.contact.phone}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>البريد الإلكتروني</dt><dd className="text-espresso" dir="ltr">{order.contact.email}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="od-delivery" className="rounded border border-taupe/70 bg-white p-5">
          <h3 id="od-delivery" className="font-display text-lg text-espresso">التوصيل</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-3"><dt className={dtCls}>العنوان</dt><dd className="text-espresso">{address}</dd></div>
            {order.address.instructions && (
              <div className="flex gap-3"><dt className={dtCls}>تعليمات</dt><dd className="text-espresso">{order.address.instructions}</dd></div>
            )}
            <div className="flex gap-3"><dt className={dtCls}>الطريقة</dt><dd className="text-espresso">{methodLabel}</dd></div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="od-items" className="mt-6 rounded border border-taupe/70 bg-white p-5">
        <h3 id="od-items" className="font-display text-lg text-espresso">المنتجات</h3>
        <ul className="mt-4 divide-y divide-taupe/50">
          {order.lines.map((line, i) => {
            // Variant lines render the purchase-time Arabic label; legacy
            // lines keep the live-attribute color/size lookup.
            const opts = line.variantId
              ? (line.variantLabel ??
                (line.options ?? [])
                  .map((o) => `${o.axisLabel.ar}: ${o.valueLabel.ar}`)
                  .join(' · '))
              : [opt('color', line.color), opt('size', line.size)]
                  .filter(Boolean)
                  .join(' · ');
            return (
              <li key={`${line.productId}-${line.variantId ?? `${line.color}-${line.size}`}-${i}`} className="flex items-center gap-4 py-4">
                <AssetImage src={line.image} alt={line.name.ar} className="size-14 shrink-0 object-cover" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-espresso">{line.name.ar}</p>
                  {opts && <p className="mt-0.5 text-xs text-espresso/55">{opts}</p>}
                  {line.variantSku && (
                    <p className="mt-0.5 text-xs text-espresso/55" dir="ltr">
                      {line.variantSku}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-espresso/55">
                    {formatPrice(line.price, 'ar')} × {line.qty}
                  </p>
                </div>
                <p className="text-sm font-semibold text-espresso">
                  {formatPrice(line.price * line.qty, 'ar')}
                </p>
              </li>
            );
          })}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-taupe/60 pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-espresso/60">المجموع الفرعي</dt>
            <dd className="font-medium text-espresso">{formatPrice(order.subtotal, 'ar')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-espresso/60">رسوم التوصيل</dt>
            <dd className="text-espresso/50">يُحدَّد لاحقًا</dd>
          </div>
          <div className="flex justify-between border-t border-taupe/60 pt-3">
            <dt className="font-medium text-espresso">الإجمالي</dt>
            <dd className="font-display text-lg font-medium text-espresso">
              {formatPrice(order.total, 'ar')}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
