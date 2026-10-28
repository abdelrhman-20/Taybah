import { describe, expect, it } from 'vitest';
import { freshBackend, product, reloadWith, seedCatalog, type Backend } from '../../../test/harness';
import type { OrderLine } from './orderStore';

// In-store order persistence against the FAKE backend (client.mock.ts — a mock
// of migration 0008; the real RLS / trigger SQL is verified in
// supabase/tests/in-store-orders.test.ts).

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  productId: 'p1',
  slug: 'slug-p1',
  name: { ar: 'منتج p1', en: 'Product p1' },
  color: null,
  size: null,
  qty: 2,
  price: 1000,
  image: '',
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  id: 'is-1',
  ref: 'TYB-IS-1',
  customerName: 'زبون',
  customerPhone: '01000000000',
  note: 'دفع نقدًا',
  lines: [line()],
  ...over,
});

async function setup(role: 'admin' | 'user' | 'anon' = 'admin'): Promise<Backend> {
  const b = await freshBackend(role);
  seedCatalog(b, [product('p1', { price: 1000 }), product('p2', { price: 500, availability: 'out_of_stock' })]);
  return b;
}

describe('statusesForSource', () => {
  it('in-store orders may only be sold/cancelled; online orders never offer sold', async () => {
    await freshBackend('admin');
    const { statusesForSource, ORDER_STATUSES, ORDER_STATUS_LABELS_AR } = await import('./orderStore');
    expect(statusesForSource('in_store')).toEqual(['sold', 'cancelled']);
    expect(statusesForSource('online')).toEqual(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']);
    expect(ORDER_STATUSES).toContain('sold');
    expect(ORDER_STATUS_LABELS_AR.sold).toBe('تم البيع');
    // existing labels are untouched
    expect(ORDER_STATUS_LABELS_AR.delivered).toBe('تم الاستلام');
    expect(ORDER_STATUS_LABELS_AR.cancelled).toBe('ملغٍ');
  });
});

describe('createInStoreOrder', () => {
  it('an admin creates a persisted in-store sale: source, status, retail totals, note', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    const saved = await store.createInStoreOrder(input());
    expect(saved).toMatchObject({ source: 'in_store', status: 'sold', subtotal: 2000, total: 2000, note: 'دفع نقدًا' });
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.orders[0]).toMatchObject({ source: 'in_store', status: 'sold', total: 2000, delivery: { method: 'in_store' } });
    expect(store.getOrders()[0].id).toBe('is-1');
  });

  it('the total is the sum of the lines at retail price (several lines, quantities)', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    await store.createInStoreOrder(
      input({ lines: [line({ qty: 3 }), line({ productId: 'p2', price: 500, qty: 2 })] }),
    );
    expect(b.tables.orders[0]).toMatchObject({ subtotal: 4000, total: 4000 });
  });

  it('allows selling an out-of-stock product', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    await store.createInStoreOrder(input({ lines: [line({ productId: 'p2', price: 500, qty: 1 })] }));
    expect(b.tables.orders).toHaveLength(1);
  });

  it('no wholesale value is stored in the order', async () => {
    const b = await setup();
    b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 777 });
    const store = await import('./orderStore');
    await store.createInStoreOrder(input());
    expect(JSON.stringify(b.tables.orders[0])).not.toMatch(/777|wholesale/i);
  });

  it('a non-admin is rejected as UNAUTHORIZED and nothing is stored', async () => {
    const b = await setup('user');
    const store = await import('./orderStore');
    await expect(store.createInStoreOrder(input())).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.tables.orders).toHaveLength(0);
    expect(store.getOrders()).toHaveLength(0);
  });

  it('a signed-out visitor is rejected too', async () => {
    const b = await setup('anon');
    const store = await import('./orderStore');
    await expect(store.createInStoreOrder(input())).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.tables.orders).toHaveLength(0);
  });

  it('a price that is not the current retail price is rejected by the database', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    await expect(store.createInStoreOrder(input({ lines: [line({ price: 720 })] }))).rejects.toMatchObject({
      code: 'invalid',
      detail: 'price_mismatch',
    });
    expect(b.tables.orders).toHaveLength(0);
  });

  it('a network failure is reported and leaves nothing behind (no false success)', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    b.failNext('from:orders:insert', new TypeError('Failed to fetch'), { reject: true });
    await expect(store.createInStoreOrder(input())).rejects.toMatchObject({ code: 'network' });
    expect(b.tables.orders).toHaveLength(0);
    expect(store.getOrders()).toHaveLength(0);
  });

  it('an insert that "succeeds" but cannot be read back is NOT reported as success', async () => {
    await setup();
    const store = await import('./orderStore');
    const b = (await import('../../../lib/supabase/client')) as unknown as { backend: Backend };
    b.backend.respondNext('from:orders:select', []);
    await expect(store.createInStoreOrder(input())).rejects.toMatchObject({ code: 'verify_failed' });
    expect(store.getOrders()).toHaveLength(0);
  });

  it('LOST RESPONSE: retrying the same sale does not create a second order', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    b.loseResponseNext('from:orders:insert');
    await expect(store.createInStoreOrder(input())).rejects.toMatchObject({ code: 'network' });
    expect(b.tables.orders).toHaveLength(1);
    await expect(store.createInStoreOrder(input())).resolves.toMatchObject({ id: 'is-1', source: 'in_store' });
    expect(b.tables.orders).toHaveLength(1);
  });

  it('persists: after a reload the sale is still there with its source and note', async () => {
    const b = await setup();
    const store = await import('./orderStore');
    await store.createInStoreOrder(input());
    const b2 = await reloadWith(b, 'admin');
    const fresh = await import('./orderStore');
    await fresh.reloadOrders();
    expect(b2.tables.orders).toHaveLength(1);
    expect(fresh.getOrders()[0]).toMatchObject({ id: 'is-1', source: 'in_store', status: 'sold', note: 'دفع نقدًا' });
  });
});

describe('order source on load and online checkout (regression)', () => {
  it('historical orders without a source (before migration 0008) load as online', async () => {
    const b = await setup();
    b.legacyOrdersSchema = true;
    b.tables.orders.push({
      id: 'old',
      ref: 'TYB-OLD',
      created_at: '2025-01-01T00:00:00Z',
      status: 'delivered',
      contact: { name: 'a', phone: '1', email: 'a@b.co' },
      address: {},
      delivery: { method: 'standard' },
      lines: [],
      subtotal: 1,
      total: 1,
    });
    const store = await import('./orderStore');
    await store.reloadOrders();
    expect(store.getOrdersLoadState().status).toBe('ready');
    expect(store.getOrders()[0]).toMatchObject({ id: 'old', source: 'online', note: null });
  });

  it('online checkout still creates a pending ONLINE order and never sends a source or note', async () => {
    const b = await setup('anon');
    const store = await import('./orderStore');
    await store.saveOrder({
      id: 'g1',
      ref: 'TYB-G1',
      createdAt: '2026-01-01T00:00:00Z',
      status: 'pending',
      contact: { name: 'عميل', phone: '010', email: 'c@example.com' },
      address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
      delivery: { method: 'standard' },
      lines: [line()],
      subtotal: 2000,
      total: 2000,
    });
    expect(b.tables.orders[0]).toMatchObject({ status: 'pending', source: 'online' });
    expect(b.log.filter((l) => l === 'from:orders:insert')).toHaveLength(1);
  });

  it('a guest cannot create an in-store order by inserting directly', async () => {
    const b = await setup('anon');
    const { supabase } = await import('../../../lib/supabase/client');
    const { error } = await supabase.from('orders').insert({
      id: 'x',
      ref: 'X',
      status: 'sold',
      source: 'in_store',
      contact: {},
      address: {},
      delivery: { method: 'in_store' },
      lines: [],
      subtotal: 0,
      total: 0,
    });
    expect(error).toMatchObject({ code: '42501' });
    expect(b.tables.orders).toHaveLength(0);
  });
});
