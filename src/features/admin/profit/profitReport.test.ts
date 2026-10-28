import { describe, expect, it } from 'vitest';
import type { GuestOrder, OrderLine } from '../../storefront/checkout/orderStore';
import { buildProfitReport, countsAsSold, periodStart } from './profitReport';

const line = (productId: string, qty: number, price: number): OrderLine => ({
  productId,
  slug: productId,
  name: { ar: productId, en: productId },
  color: null,
  size: null,
  qty,
  price,
  image: '',
});

const order = (over: Partial<GuestOrder>): GuestOrder =>
  ({
    id: 'o',
    ref: 'r',
    createdAt: '2026-10-20T10:00:00Z',
    status: 'delivered',
    source: 'online',
    lines: [],
    ...over,
  }) as GuestOrder;

describe('profit report', () => {
  it('3 pieces sold at 600 with wholesale 500 = 1800 revenue, 300 profit', () => {
    const r = buildProfitReport([order({ lines: [line('a', 3, 600)] })], new Map([['a', 500]]), null);
    expect(r.pieces).toBe(3);
    expect(r.revenue).toBe(1800);
    expect(r.cost).toBe(1500);
    expect(r.profit).toBe(300);
  });

  it('counts delivered online orders and in-store sales only', () => {
    expect(countsAsSold({ source: 'online', status: 'delivered' })).toBe(true);
    expect(countsAsSold({ source: 'in_store', status: 'sold' })).toBe(true);
    expect(countsAsSold({ source: 'online', status: 'pending' })).toBe(false);
    expect(countsAsSold({ source: 'online', status: 'cancelled' })).toBe(false);
    expect(countsAsSold({ source: 'in_store', status: 'cancelled' })).toBe(false);
  });

  it('merges orders per product and ranks by profit; unknown cost goes last and is flagged', () => {
    const r = buildProfitReport(
      [
        order({ lines: [line('a', 1, 600), line('nocost', 2, 100)] }),
        order({ source: 'in_store', status: 'sold', lines: [line('a', 2, 600), line('b', 1, 1000)] }),
      ],
      new Map([['a', 500], ['b', 100]]),
      null,
    );
    expect(r.rows.map((x) => x.productId)).toEqual(['b', 'a', 'nocost']);
    expect(r.rows[1]).toMatchObject({ qty: 3, revenue: 1800, profit: 300 });
    expect(r.missingCost).toBe(1);
    expect(r.profit).toBe(1200);
    expect(r.revenue).toBe(1800 + 1000 + 200);
  });

  it('filters by period start', () => {
    const old = order({ createdAt: '2026-09-01T10:00:00Z', lines: [line('a', 1, 600)] });
    const recent = order({ createdAt: '2026-10-20T10:00:00Z', lines: [line('a', 1, 600)] });
    const from = periodStart('month', new Date(2026, 9, 28));
    expect(buildProfitReport([old, recent], new Map([['a', 500]]), from).pieces).toBe(1);
  });
});
