import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, MailWarning, Search } from 'lucide-react';
import {
  ORDER_STATUS_LABELS_AR,
  ORDER_STATUSES,
  reloadOrders,
  useOrders,
  useOrdersLoadState,
} from '../../storefront/checkout/orderStore';
import { deliveryMethods } from '../../storefront/checkout/checkoutData';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { fetchOrderIdsWithFailedEmails } from './orderEmailStore';
import { formatPrice } from '../../shared/utils/format';

type SortKey = 'newest' | 'oldest' | 'total-desc' | 'total-asc';

function EmailFailedMark() {
  return (
    <span title="تعذّر إرسال إشعار بريدي لهذا الطلب" className="inline-flex text-burgundy">
      <MailWarning className="size-4" aria-label="تعذّر إرسال إشعار بريدي" />
    </span>
  );
}

const selectCls =
  'border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy';

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function OrdersPage() {
  const orders = useOrders();
  const loadState = useOrdersLoadState();
  const [emailFailed, setEmailFailed] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Best-effort: if the outbox isn't readable (migration not applied, not
    // an admin) the list simply shows no markers.
    fetchOrderIdsWithFailedEmails().then(setEmailFailed, () => {});
  }, [orders]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : null;
    const list = orders.filter((o) => {
      if (q) {
        const hay = `${o.ref} ${o.contact.name} ${o.contact.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (status !== 'all' && o.status !== status) return false;
      if (method !== 'all' && o.delivery.method !== method) return false;
      const ts = new Date(o.createdAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      return true;
    });
    switch (sort) {
      case 'oldest':
        return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case 'total-desc':
        return [...list].sort((a, b) => b.total - a.total);
      case 'total-asc':
        return [...list].sort((a, b) => a.total - b.total);
      default:
        return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }, [orders, query, status, method, from, to, sort]);

  const hasFilters = query || status !== 'all' || method !== 'all' || from || to;

  const clear = () => {
    setQuery('');
    setStatus('all');
    setMethod('all');
    setFrom('');
    setTo('');
  };

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader
        title="الطلبات"
        description="الطلبات المُرسلة من الضيوف فقط — لا تُتتبَّع محاولات إتمام الطلب أو السلات المتروكة."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم الطلب أو الاسم أو الهاتف"
            aria-label="البحث في الطلبات"
            className="w-full border border-taupe bg-white py-2 pe-3 ps-10 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="التصفية حسب الحالة" className={selectCls}>
          <option value="all">كل الحالات</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{ORDER_STATUS_LABELS_AR[s]}</option>
          ))}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="التصفية حسب طريقة التوصيل" className={selectCls}>
          <option value="all">كل طرق التوصيل</option>
          {deliveryMethods.map((m) => (
            <option key={m.key} value={m.key}>{m.label.ar}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" className={selectCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" className={selectCls} />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="ترتيب الطلبات" className={selectCls}>
          <option value="newest">الأحدث أولًا</option>
          <option value="oldest">الأقدم أولًا</option>
          <option value="total-desc">الأعلى سعرًا</option>
          <option value="total-asc">الأقل سعرًا</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            className="text-xs font-medium text-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            مسح
          </button>
        )}
      </div>

      {loadState.status === 'error' && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso"
        >
          <span className="flex-1 leading-6">
            تعذّر تحميل الطلبات من الخادم ({loadState.code}) — القائمة أدناه قد تكون ناقصة أو قديمة، وليست دليلًا على عدم وجود طلبات.
          </span>
          <button
            type="button"
            onClick={() => void reloadOrders()}
            className="rounded border border-espresso/25 px-4 py-1.5 text-xs font-medium text-espresso transition hover:border-espresso"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <p className="mt-4 text-xs tracking-wide text-espresso/55">
        {filtered.length} من {orders.length} طلب
      </p>

      {loadState.status === 'loading' && orders.length === 0 ? (
        <p className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center text-sm text-espresso/60">
          جارٍ تحميل الطلبات…
        </p>
      ) : filtered.length === 0 ? (
        <div className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center">
          <p className="text-sm text-espresso/60">
            {orders.length === 0
              ? loadState.status === 'error'
                ? 'تعذّر تحميل الطلبات — راجع الرسالة أعلاه.'
                : 'لا توجد طلبات بعد — أرسل طلبًا من صفحة إتمام الطلب في المتجر.'
              : 'لا توجد طلبات تطابق البحث أو عوامل التصفية الحالية.'}
          </p>
        </div>
      ) : (
        <>
          {/* desktop table */}
          <div className="mt-5 hidden overflow-x-auto rounded border border-taupe/70 bg-white md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-taupe/60 text-start text-xs tracking-wide text-espresso/50">
                  <th className="px-4 py-3 text-start font-medium">المرجع</th>
                  <th className="px-4 py-3 text-start font-medium">العميل</th>
                  <th className="px-4 py-3 text-start font-medium">الهاتف</th>
                  <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-start font-medium">العناصر</th>
                  <th className="px-4 py-3 text-start font-medium">التوصيل</th>
                  <th className="px-4 py-3 text-end font-medium">الإجمالي</th>
                  <th className="px-4 py-3 text-start font-medium">الحالة</th>
                  <th className="px-4 py-3" aria-label="إجراءات" />
                </tr>
              </thead>
              <tbody className="divide-y divide-taupe/50">
                {filtered.map((o) => (
                  <tr key={o.id} className="transition hover:bg-porcelain/50">
                    <td className="px-4 py-3 font-mono font-medium text-espresso" dir="ltr">
                      {o.ref}
                    </td>
                    <td className="px-4 py-3 text-espresso/80">{o.contact.name}</td>
                    <td className="px-4 py-3 text-espresso/70" dir="ltr">{o.contact.phone}</td>
                    <td className="px-4 py-3 text-espresso/60">{dateOf(o.createdAt)}</td>
                    <td className="px-4 py-3 text-espresso/70">
                      {o.lines.reduce((n, l) => n + l.qty, 0)}
                    </td>
                    <td className="px-4 py-3 text-espresso/60">
                      {deliveryMethods.find((m) => m.key === o.delivery.method)?.label.ar ??
                        o.delivery.method}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold text-espresso">
                      {formatPrice(o.total, 'ar')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <OrderStatusBadge status={o.status} />
                        {emailFailed.has(o.id) && <EmailFailedMark />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        to={`/admin/orders/${o.id}`}
                        aria-label={`عرض الطلب ${o.ref}`}
                        className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <ChevronLeft className="size-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <ul className="mt-5 space-y-3 md:hidden">
            {filtered.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/admin/orders/${o.id}`}
                  className="block rounded border border-taupe/70 bg-white p-4 transition hover:border-burgundy/40 focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-medium text-espresso" dir="ltr">
                      {o.ref}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      {emailFailed.has(o.id) && <EmailFailedMark />}
                      <OrderStatusBadge status={o.status} />
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-espresso/80">{o.contact.name}</p>
                  <p className="mt-0.5 text-xs text-espresso/55" dir="ltr">{o.contact.phone}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-espresso/55">
                    <span>
                      {dateOf(o.createdAt)} · {o.lines.reduce((n, l) => n + l.qty, 0)} عناصر
                    </span>
                    <span className="text-sm font-semibold text-espresso">
                      {formatPrice(o.total, 'ar')}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
