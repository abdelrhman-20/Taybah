import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { Boxes, Coins, PackageOpen, Plus, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { canViewProfit, useSessionEmail } from '../auth/profitAccess';
import { LoadingState } from '../../shared/components/LoadingState';
import { formatPrice } from '../../shared/utils/format';
import { reloadOrders, useOrders, useOrdersLoadState } from '../../storefront/checkout/orderStore';
import { describePersistenceError } from '../../../lib/persistence/errors';
import { fetchAllWholesalePrices } from '../catalog/internalPricing';
import { PERIOD_LABELS, buildProfitReport, periodStart, type Period } from './profitReport';

// «الأرباح» — what sold, what it cost, what the shop made. Written for a
// shop owner, not an accountant: one big profit number, three small ones and
// one plain table where the biggest earners stand out at a glance.

const periods = Object.keys(PERIOD_LABELS) as Period[];
const money = (n: number) => formatPrice(n, 'ar');

function MiniCard({
  icon,
  label,
  value,
  hint,
  wide,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-taupe/60 bg-white p-4 shadow-sm sm:p-5 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-gold/15 text-gold">{icon}</span>
        <p className="text-sm text-espresso/60">{label}</p>
      </div>
      <p className="mt-3 font-display text-2xl text-espresso sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-espresso/50">{hint}</p>}
    </div>
  );
}

// Only the profit account gets the page; for anyone else the wholesale prices are
// not even fetched.
export function AdminProfitPage() {
  const email = useSessionEmail();
  if (email === undefined) return <LoadingState />;
  if (!canViewProfit(email)) return <Navigate to="/admin" replace />;
  return <ProfitContent />;
}

function ProfitContent() {
  const orders = useOrders();
  const loadState = useOrdersLoadState();
  const [period, setPeriod] = useState<Period>('month');
  const [wholesale, setWholesale] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchAllWholesalePrices()
      .then((m) => live && setWholesale(m))
      .catch((e: unknown) => live && setError(describePersistenceError(e)));
    return () => {
      live = false;
    };
  }, []);

  const report = useMemo(
    () => (wholesale ? buildProfitReport(orders, wholesale, periodStart(period)) : null),
    [orders, wholesale, period],
  );

  const ordersFailed = loadState.status === 'error';
  const waiting = !error && !ordersFailed && (!report || loadState.status === 'loading');
  const showReport = report && !error && !ordersFailed && loadState.status !== 'loading';

  // Margin over the products whose cost is known: profit / what they sold for.
  const knownSales = report ? report.cost + report.profit : 0;
  const margin = knownSales > 0 ? Math.round((report!.profit / knownSales) * 100) : null;
  const topProfit = report ? Math.max(0, ...report.rows.map((r) => r.profit ?? 0)) : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl text-espresso">الأرباح</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-espresso/60">
            بتتحسب أوردرات الموقع اللي حالتها «تم الاستلام» والبيع من المحل «تم البيع». الملغي واللي لسه ماوصلش مش بيتحسب.
          </p>
        </div>
        <div role="group" aria-label="الفترة" className="flex w-full rounded-full border border-taupe/70 bg-white p-1 shadow-sm sm:w-auto">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`h-10 flex-1 whitespace-nowrap rounded-full px-2 text-[13px] transition sm:flex-none sm:px-4 sm:text-sm ${
                period === p ? 'bg-espresso text-gold shadow' : 'text-espresso/65 hover:text-espresso'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      {error && <p role="alert" className="mb-4 text-sm text-burgundy">{error}</p>}
      {ordersFailed && (
        <p role="alert" className="mb-4 text-sm text-burgundy">
          تعذّر تحميل الطلبات.{' '}
          <button type="button" onClick={() => void reloadOrders()} className="underline">
            إعادة المحاولة
          </button>
        </p>
      )}
      {waiting && <LoadingState />}

      {showReport && (
        <>
          <section
            aria-label="الربح"
            className="relative overflow-hidden rounded-lg border border-gold/40 bg-espresso p-5 text-porcelain shadow-md sm:p-7"
          >
            <TrendingUp className="absolute -bottom-4 -start-2 size-32 text-gold/10" aria-hidden />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-porcelain/65">صافي الربح — {PERIOD_LABELS[period]}</p>
                <p
                  className={`mt-2 font-display text-4xl sm:text-5xl ${report.profit >= 0 ? 'text-gold' : 'text-red-300'}`}
                >
                  {money(report.profit)}
                </p>
              </div>
              {margin !== null && (
                <span className="rounded-full border border-gold/50 px-4 py-1.5 text-sm text-gold">
                  هامش الربح {margin}%
                </span>
              )}
            </div>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <MiniCard icon={<Boxes className="size-5" aria-hidden />} label="اتباع" value={`${report.pieces} قطعة`} />
            <MiniCard
              icon={<Wallet className="size-5" aria-hidden />}
              label="المبيعات"
              value={money(report.revenue)}
              hint="اللي دخل المحل"
            />
            <MiniCard
              icon={<Coins className="size-5" aria-hidden />}
              label="التكلفة"
              value={money(report.cost)}
              hint="سعر الجملة"
              wide
            />
          </div>

          {report.missingCost > 0 && (
            <p className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              فيه {report.missingCost} منتج اتباع من غير سعر جملة، فربحهم مش محسوب. دوس «أضف سعر الجملة» جنبهم تحت.
            </p>
          )}

          <section className="mt-6 overflow-hidden rounded-lg border border-taupe/60 bg-white shadow-sm">
            {report.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-espresso/50">
                <PackageOpen className="size-10" aria-hidden />
                <p className="text-sm">مفيش مبيعات في الفترة دي.</p>
              </div>
            ) : (
              <>
              <ul className="divide-y divide-taupe/40 md:hidden">
                {report.rows.map((r) => (
                  <li key={r.productId} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-medium leading-6 text-espresso">{r.name}</p>
                      <span className="shrink-0 rounded-full bg-espresso/5 px-3 py-0.5 text-sm">{r.qty} قطعة</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <dt className="text-[11px] text-espresso/50">سعر الجملة</dt>
                        <dd className="mt-0.5 text-sm text-espresso/80">{r.wholesale === null ? '—' : money(r.wholesale)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-espresso/50">سعر البيع</dt>
                        <dd className="mt-0.5 text-sm text-espresso/80">{money(r.revenue / r.qty)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-espresso/50">الربح</dt>
                        <dd className={`mt-0.5 text-sm font-semibold ${r.profit === null ? 'text-espresso/40' : r.profit >= 0 ? 'text-emerald-700' : 'text-burgundy'}`}>
                          {r.profit === null ? '—' : money(r.profit)}
                        </dd>
                      </div>
                    </dl>
                    {r.profit !== null && r.profit > 0 && topProfit > 0 && (
                      <div className="mt-3 h-1.5 rounded-full bg-espresso/5" aria-hidden>
                        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(6, (r.profit / topProfit) * 100)}%` }} />
                      </div>
                    )}
                    {r.wholesale === null && (
                      <Link
                        to={`/admin/products/${r.productId}/edit`}
                        className="mt-3 flex h-11 items-center justify-center gap-1.5 rounded-full border border-burgundy text-sm text-burgundy active:bg-burgundy active:text-white"
                      >
                        <Plus className="size-4" aria-hidden />
                        أضف سعر الجملة
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[40rem] text-start">
                  <thead className="bg-porcelain/60 text-sm text-espresso/60">
                    <tr>
                      <th className="px-5 py-3 text-start font-medium">المنتج</th>
                      <th className="px-3 py-3 text-start font-medium">اتباع</th>
                      <th className="px-3 py-3 text-start font-medium">سعر الجملة</th>
                      <th className="px-3 py-3 text-start font-medium">سعر البيع</th>
                      <th className="px-3 py-3 text-start font-medium">الربح</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr
                        key={r.productId}
                        className="border-t border-taupe/40 text-base text-espresso transition hover:bg-porcelain/40"
                      >
                        <td className="px-5 py-4 font-medium">{r.name}</td>
                        <td className="px-3 py-4">
                          <span className="rounded-full bg-espresso/5 px-3 py-0.5 text-sm">{r.qty} قطعة</span>
                        </td>
                        <td className="px-3 py-4 text-espresso/70">{r.wholesale === null ? '—' : money(r.wholesale)}</td>
                        <td className="px-3 py-4 text-espresso/70">{money(r.revenue / r.qty)}</td>
                        <td className="px-3 py-4">
                          {r.profit === null ? (
                            <span className="text-sm text-espresso/40">مفيش سعر جملة</span>
                          ) : (
                            <div className="min-w-28">
                              <span className={`font-semibold ${r.profit >= 0 ? 'text-emerald-700' : 'text-burgundy'}`}>
                                {money(r.profit)}
                              </span>
                              {r.profit > 0 && topProfit > 0 && (
                                <div className="mt-1.5 h-1.5 rounded-full bg-espresso/5" aria-hidden>
                                  <div
                                    className="h-full rounded-full bg-gold"
                                    style={{ width: `${Math.max(6, (r.profit / topProfit) * 100)}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-end">
                          {r.wholesale === null && (
                            <Link
                              to={`/admin/products/${r.productId}/edit`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-burgundy px-3 py-1.5 text-sm text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-2 focus-visible:outline-burgundy"
                            >
                              <Plus className="size-3.5" aria-hidden />
                              أضف سعر الجملة
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
