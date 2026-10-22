import { Link } from 'react-router';
import {
  CheckCircle2,
  LayoutDashboard,
  ShoppingCart,
  Timer,
  XCircle,
} from 'lucide-react';
import { useOrders } from '../../storefront/checkout/orderStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { formatPrice } from '../../shared/utils/format';

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function AdminDashboardPage() {
  const orders = useOrders();

  const stats = [
    { label: 'إجمالي الطلبات', value: orders.length, icon: ShoppingCart },
    {
      label: 'قيد الانتظار',
      value: orders.filter((o) => o.status === 'pending').length,
      icon: Timer,
    },
    {
      label: 'مؤكدة',
      value: orders.filter((o) => o.status === 'confirmed').length,
      icon: CheckCircle2,
    },
    {
      label: 'ملغاة',
      value: orders.filter((o) => o.status === 'cancelled').length,
      icon: XCircle,
    },
  ];
  const recent = orders.slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="نظرة عامة"
        description="إحصاءات مباشرة من الطلبات التجريبية المُرسلة عبر إتمام الطلب كضيف. لا تُعرض مقاييس إيرادات أو عملاء أو محاولات — تُحسب الطلبات المُرسلة بنجاح فقط."
      />

      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <li key={label} className="rounded border border-taupe/70 bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-espresso/55">
                {label}
              </span>
              <Icon className="size-4.5 text-burgundy" aria-hidden />
            </div>
            <p className="mt-3 font-display text-3xl text-espresso">{value}</p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="recent-orders" className="mt-10">
        <div className="flex items-center justify-between">
          <h3 id="recent-orders" className="font-display text-xl text-espresso">
            أحدث الطلبات
          </h3>
          <Link
            to="/admin/orders"
            className="text-sm font-medium text-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            كل الطلبات
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded border border-dashed border-taupe bg-white py-14 text-center">
            <LayoutDashboard className="size-7 text-espresso/40" aria-hidden />
            <p className="text-sm text-espresso/60">
              لا توجد طلبات بعد — أرسل طلبًا من صفحة إتمام الطلب في المتجر ليظهر هنا.
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-taupe/60 rounded border border-taupe/70 bg-white">
            {recent.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/admin/orders/${o.id}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4 transition hover:bg-porcelain/60 focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <span className="font-mono text-sm font-medium text-espresso" dir="ltr">
                    {o.ref}
                  </span>
                  <span className="text-sm text-espresso/70">{o.contact.name}</span>
                  <span className="text-xs text-espresso/50">{dateOf(o.createdAt)}</span>
                  <span className="text-xs text-espresso/50">
                    {o.lines.reduce((n, l) => n + l.qty, 0)} عناصر
                  </span>
                  <span className="text-sm font-semibold text-espresso">
                    {formatPrice(o.total, 'ar')}
                  </span>
                  <span className="ms-auto">
                    <OrderStatusBadge status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
