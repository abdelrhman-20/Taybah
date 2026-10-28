import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { formatPrice } from '../../shared/utils/format';
import { useOrders, useOrdersLoadState } from '../../storefront/checkout/orderStore';
import { fetchAllWholesalePrices } from '../catalog/internalPricing';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { OWNER_NAME } from '../auth/profitAccess';
import { buildProfitReport, periodStart } from './profitReport';

// Dashboard welcome for the profit account only (the dashboard decides who
// renders it): today's numbers at a glance, then a door to the full page.

const money = (n: number) => formatPrice(n, 'ar');
const pieces = (n: number) => `${n} قطعة`;

export function OwnerSummaryCard() {
  const orders = useOrders();
  const loadState = useOrdersLoadState();
  const [wholesale, setWholesale] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let live = true;
    fetchAllWholesalePrices().then(
      (m) => live && setWholesale(m),
      () => {}, // the card just stays on dashes; the full page explains errors
    );
    return () => {
      live = false;
    };
  }, []);

  const today = useMemo(
    () => (wholesale ? buildProfitReport(orders, wholesale, periodStart('today')) : null),
    [orders, wholesale],
  );
  const ready = today !== null && loadState.status === 'ready';

  const stats = [
    { label: 'مبيعات النهاردة', value: today?.revenue ?? 0, format: money },
    { label: 'ربح النهاردة', value: today?.profit ?? 0, format: money, big: true },
    { label: 'اتباع النهاردة', value: today?.pieces ?? 0, format: pieces },
  ];

  return (
    <section
      aria-label="ملخص اليوم"
      className="animate-fade-up relative mb-8 overflow-hidden rounded-lg border border-gold/40 bg-espresso px-4 py-7 text-center sm:px-6 sm:py-8 text-porcelain shadow-lg"
    >
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-gold/15 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        <span className="inline-block rounded-full border border-gold/50 px-3 py-0.5 text-[11px] font-semibold tracking-widest text-gold">
          المالك
        </span>
        <h3 className="mt-3 font-display text-3xl">أهلًا، {OWNER_NAME}</h3>

        <dl className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-x-2 gap-y-5 sm:mt-7 sm:grid-cols-3 sm:gap-0">
          {stats.map((s, i) => (
            <div key={s.label} className={`animate-fade-up px-2 sm:px-4 ${s.big ? 'order-first col-span-2 sm:order-none sm:col-span-1' : ''} ${i > 0 ? 'sm:border-s sm:border-gold/20' : ''}`} style={{ animationDelay: `${150 + i * 120}ms` }}>
              <dt className="text-xs text-porcelain/60">{s.label}</dt>
              <dd className={`mt-1 font-display ${s.big ? 'text-5xl text-gold sm:text-4xl' : 'text-xl sm:text-2xl'}`}>
                {ready ? <AnimatedNumber value={s.value} format={s.format} /> : '—'}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          to="/admin/profit"
          className="group mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-gold px-6 sm:mt-8 sm:w-auto text-sm text-gold transition hover:bg-gold hover:text-espresso focus-visible:outline-2 focus-visible:outline-gold"
        >
          تفاصيل الأرباح
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-1" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
