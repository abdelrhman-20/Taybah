import { describe, expect, it } from 'vitest';
import type { GuestOrder } from './orderStore';
import { freshBackend, type Backend } from '../../../test/harness';

// Order persistence against the FAKE backend (client.mock.ts — a mock that
// reproduces RLS "denied update matches zero rows" and role visibility). The
// real RLS/trigger SQL is covered by supabase/tests/migrations.test.ts.

const row = (id: string, status = 'pending') => ({
  id,
  ref: `TYB-${id}`,
  created_at: '2026-01-01T00:00:00Z',
  status,
  contact: { name: 'عميل', phone: '010', email: 'c@example.com' },
  address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
  delivery: { method: 'standard' },
  lines: [],
  subtotal: 100,
  total: 100,
});

async function load(b: Backend, orders: ReturnType<typeof row>[] = []) {
  for (const o of orders) b.tables.orders.push({ ...o });
  const store = await import('./orderStore');
  await store.reloadOrders();
  return store;
}

describe('order list loading', () => {
  it('does not query orders at all for a signed-out visitor', async () => {
    const b = await freshBackend('anon');
    const store = await load(b, [row('o1')]);
    expect(store.getOrders()).toEqual([]);
    expect(store.getOrdersLoadState().status).toBe('idle');
    expect(b.calls('from:orders:select')).toBe(0);
  });

  it('an admin sees the orders and a ready state', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1'), row('o2')]);
    expect(store.getOrders().map((o) => o.id).sort()).toEqual(['o1', 'o2']);
    expect(store.getOrdersLoadState().status).toBe('ready');
  });

  it('a failed load is an ERROR state, not an empty list — and earlier data is kept', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    b.failNext('from:orders:select', { message: 'Failed to fetch' }, { reject: true });
    await store.reloadOrders();
    expect(store.getOrdersLoadState()).toMatchObject({ status: 'error', code: 'network' });
    expect(store.getOrders()).toHaveLength(1); // not wiped
    await store.reloadOrders(); // retry works
    expect(store.getOrdersLoadState().status).toBe('ready');
  });

  it('signing out clears staff data; signing in loads it', async () => {
    const b = await freshBackend('anon');
    const store = await load(b, [row('o1')]);
    b.signIn('admin');
    await store.reloadOrders();
    expect(store.getOrders()).toHaveLength(1);
    b.signIn('anon');
    await store.reloadOrders();
    expect(store.getOrders()).toEqual([]);
    expect(store.getOrdersLoadState().status).toBe('idle');
  });
});

describe('updateOrderStatus', () => {
  it('persists the new status, returns only after confirmation, and updates the list', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    await store.updateOrderStatus('o1', 'processing', 'pending');
    expect(b.tables.orders[0].status).toBe('processing');
    expect(store.getOrders()[0].status).toBe('processing');
  });

  it('is rejected as UNAUTHORIZED for a non-admin and changes nothing (zero rows ≠ success)', async () => {
    const b = await freshBackend('user');
    const store = await load(b, [row('o1')]);
    await expect(store.updateOrderStatus('o1', 'delivered')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.tables.orders[0].status).toBe('pending');
  });

  it('a silently RLS-filtered update (0 rows, no error) is still reported as a failure', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    // the update "succeeds" with no rows; the role check then reveals why
    b.respondNext('from:orders:update', []);
    b.respondNext('rpc:is_admin', false);
    await expect(store.updateOrderStatus('o1', 'shipped', 'pending')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(store.getOrders()[0].status).toBe('pending'); // UI state not advanced
  });

  it('refuses to overwrite a status someone else changed meanwhile (conflict)', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    b.tables.orders[0].status = 'shipped'; // changed elsewhere
    await expect(store.updateOrderStatus('o1', 'cancelled', 'pending')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(b.tables.orders[0].status).toBe('shipped');
  });

  it('is idempotent: re-applying the status that already holds is a success (double click)', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    await store.updateOrderStatus('o1', 'processing', 'pending');
    await expect(store.updateOrderStatus('o1', 'processing', 'pending')).resolves.toBeUndefined();
    expect(b.tables.orders[0].status).toBe('processing');
  });

  it('reports a missing order as not_found', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, []);
    await expect(store.updateOrderStatus('nope', 'shipped')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('classifies a network failure and leaves the list unchanged', async () => {
    const b = await freshBackend('admin');
    const store = await load(b, [row('o1')]);
    b.failNext('from:orders:update', new TypeError('Failed to fetch'), { reject: true });
    await expect(store.updateOrderStatus('o1', 'shipped', 'pending')).rejects.toMatchObject({
      code: 'network',
    });
    expect(store.getOrders()[0].status).toBe('pending');
  });
});

describe('checkout order creation (guest)', () => {
  const order = (over: Partial<GuestOrder> = {}): GuestOrder => ({
    ...(row('g1') as unknown as GuestOrder),
    id: 'g1',
    ref: 'TYB-G1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'pending',
    ...over,
  });

  it('a guest can create a PENDING order', async () => {
    const b = await freshBackend('anon');
    const store = await load(b);
    await store.saveOrder(order());
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.orders[0].status).toBe('pending');
  });

  it('a guest cannot create an order in a privileged status', async () => {
    const b = await freshBackend('anon');
    const store = await load(b);
    await expect(store.saveOrder(order({ status: 'delivered' }))).rejects.toMatchObject({ code: '42501' });
    expect(b.tables.orders).toHaveLength(0);
    expect(store.getOrders()).toEqual([]); // not added locally on failure
  });
});
