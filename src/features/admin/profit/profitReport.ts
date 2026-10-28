import type { GuestOrder } from '../../storefront/checkout/orderStore';

// PROFIT REPORT — pure maths for the «الأرباح» page. Profit of a piece =
// the price it was sold at (frozen on the order line) − its wholesale price.
// Wholesale prices are admin-only data; this module only ever runs in the admin.

export type Period = 'today' | 'week' | 'month' | 'all';

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'اليوم',
  week: 'آخر 7 أيام',
  month: 'هذا الشهر',
  all: 'الكل',
};

// null = no lower bound.
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return day;
  if (period === 'week') return new Date(day.getFullYear(), day.getMonth(), day.getDate() - 6);
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

// A sale counts once the goods have left the shop: an online order that was
// delivered, or an in-store sale. Pending / in-progress / cancelled do not.
export function countsAsSold(o: Pick<GuestOrder, 'source' | 'status'>): boolean {
  return (o.source === 'online' && o.status === 'delivered') || (o.source === 'in_store' && o.status === 'sold');
}

export interface ProfitRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  // null = this product has no wholesale price, so cost / profit are unknown
  wholesale: number | null;
  cost: number | null;
  profit: number | null;
}

export interface ProfitReport {
  rows: ProfitRow[];
  pieces: number;
  revenue: number;
  // cost / profit of the products that HAVE a wholesale price
  cost: number;
  profit: number;
  missingCost: number; // how many sold products have no wholesale price
}

export function buildProfitReport(
  orders: GuestOrder[],
  wholesale: ReadonlyMap<string, number>,
  from: Date | null,
): ProfitReport {
  const byProduct = new Map<string, ProfitRow>();
  for (const o of orders) {
    if (!countsAsSold(o)) continue;
    if (from && new Date(o.createdAt) < from) continue;
    for (const l of o.lines) {
      const row =
        byProduct.get(l.productId) ??
        { productId: l.productId, name: l.name.ar, qty: 0, revenue: 0, wholesale: wholesale.get(l.productId) ?? null, cost: null, profit: null };
      row.qty += l.qty;
      row.revenue += l.price * l.qty;
      byProduct.set(l.productId, row);
    }
  }

  const rows = [...byProduct.values()];
  const report: ProfitReport = { rows, pieces: 0, revenue: 0, cost: 0, profit: 0, missingCost: 0 };
  for (const r of rows) {
    report.pieces += r.qty;
    report.revenue += r.revenue;
    if (r.wholesale === null) {
      report.missingCost += 1;
    } else {
      r.cost = r.wholesale * r.qty;
      r.profit = r.revenue - r.cost;
      report.cost += r.cost;
      report.profit += r.profit;
    }
  }
  // Biggest profit first; products with unknown profit last.
  rows.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  return report;
}
