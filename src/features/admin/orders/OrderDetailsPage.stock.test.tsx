// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// Delivering an online order when migration 0010 (stock deduction) is modelled — against
// the FAKE backend (client.mock.ts, `inventoryOrders` on). The REAL triggers, locks and
// RPCs are verified against Postgres in supabase/tests/inventory.orders.test.ts; these
// tests prove the CLIENT: it never reports a delivery the database refused, it only offers
// the audited override for a stock shortage, and it never sends an override unconfirmed.

afterEach(cleanup);

type Row = Record<string, unknown>;

const order = (lines: Row[], status = 'pending'): Row => ({
  id: 'o1',
  ref: 'TYB-2026-STK',
  created_at: '2026-01-01T10:00:00Z',
  status,
  source: 'online',
  note: null,
  contact: { name: 'منى أحمد', phone: '01000000000', email: 'mona@example.com' },
  address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
  delivery: { method: 'standard' },
  lines,
  subtotal: 1000,
  total: 1000,
});
const ln = (pid: string, qty: number): Row => ({ productId: pid, slug: pid, name: { ar: `منتج ${pid}`, en: pid }, color: null, size: null, qty, price: 1000, image: '' });

async function setup(opts: { stock?: number; lines?: Row[] } = {}): Promise<Backend> {
  const b = await freshBackend('admin');
  b.inventoryOrders = true;
  seedCatalog(b, [product('p1', { price: 1000 })]);
  b.tables.stock_levels.push({ product_id: 'p1', on_hand: opts.stock ?? 10, low_threshold: 0, product_name: 'منتج p1', product_sku: 'SKU-P1' });
  b.tables.orders.push(order(opts.lines ?? [ln('p1', 12)]));
  const { OrderDetailsPage } = await import('./OrderDetailsPage');
  const store = await import('../../storefront/checkout/orderStore');
  await store.reloadOrders();
  render(
    <MemoryRouter initialEntries={['/admin/orders/o1']}>
      <Routes>
        <Route path="/admin/orders/:orderId" element={<OrderDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('TYB-2026-STK');
  return b;
}

const statusSelect = () => screen.getByLabelText('تحديث الحالة') as HTMLSelectElement;
const applyDelivered = async () => {
  await userEvent.selectOptions(statusSelect(), 'تم التسليم');
  await userEvent.click(screen.getByRole('button', { name: 'تطبيق' }));
};
const dlg = () => screen.getByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
const reasonInput = () => within(dlg()).getByLabelText(/سبب التجاوز/);
const tick = () => userEvent.click(within(dlg()).getByRole('checkbox', { name: /أؤكد المتابعة/ }));
const confirmBtn = () => within(dlg()).getByRole('button', { name: 'تسليم الطلب رغم النقص' });
const overrideCalls = (b: Backend) => b.rpcLog.filter((c) => c.name === 'inventory_deliver_order_override');
const bal = (b: Backend) => b.tables.stock_levels[0].on_hand;

describe('order delivery with stock deduction', () => {
  it('with enough stock the delivery just works and the page shows the deduction in the ledger only (no dialog)', async () => {
    const b = await setup({ stock: 20 });
    await applyDelivered();
    await waitFor(() => expect(b.tables.orders[0].status).toBe('delivered'));
    expect(bal(b)).toBe(8);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(overrideCalls(b)).toHaveLength(0);
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'sale', order_id: 'o1', quantity: 12 });
  });

  it('a stock shortage opens the explicit override dialog and changes NOTHING yet', async () => {
    const b = await setup();
    await applyDelivered();
    const d = await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    const row = within(d).getByText('منتج p1').closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['منتج p1', '12', '10', '2', '-2']);
    expect(b.tables.orders[0].status).toBe('pending');
    expect(bal(b)).toBe(10);
    expect(screen.queryByText('تم تسليم الطلب')).toBeNull();
    expect(overrideCalls(b)).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull(); // not shown as a failure: the admin can proceed explicitly
  });

  it('refuses to send an override without a reason of at least 5 characters, or without the explicit tick', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    await tick();
    for (const reason of ['', '    ', 'abcd', ' ab ']) {
      await userEvent.clear(reasonInput());
      if (reason) await userEvent.type(reasonInput(), reason);
      await userEvent.click(confirmBtn());
      expect(within(dlg()).getByRole('alert').textContent).toContain('اكتب سببًا من 5 أحرف على الأقل');
    }
    await userEvent.clear(reasonInput());
    await userEvent.type(reasonInput(), 'سبب كافٍ');
    await tick(); // un-tick
    await userEvent.click(confirmBtn());
    expect(within(dlg()).getByRole('alert').textContent).toContain('أكّد صراحةً');
    expect(overrideCalls(b)).toHaveLength(0);
    expect(b.tables.orders[0].status).toBe('pending');
  });

  it('on explicit confirmation the override delivers the order and the balance goes negative, audited', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    await userEvent.type(reasonInput(), 'العميل دفع والبضاعة وصلت');
    await tick();
    await userEvent.click(confirmBtn());
    expect(await screen.findByText(/تم تسليم الطلب مع تجاوز موثَّق لنقص المخزون/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(b.tables.orders[0].status).toBe('delivered');
    expect(bal(b)).toBe(-2);
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'sale', override: true, shortfall: 2, qty_before: 10, qty_after: -2 });
    const sent = overrideCalls(b)[0].args;
    expect(sent).toMatchObject({
      p_order_id: 'o1',
      p_expected_status: 'pending',
      p_reason: 'العميل دفع والبضاعة وصلت',
      p_confirmed_shortfall: [{ product_id: 'p1', requested: 12, available: 10, shortfall: 2 }],
    });
    expect(sent.p_attempt_key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(statusSelect().value).toBe('delivered'));
  });

  it('the stock moved since the admin looked (IS007): fresh numbers are shown, the tick is reset and a NEW key is used', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    b.tables.stock_levels[0].on_hand = 9; // someone withdrew a unit meanwhile
    await userEvent.type(reasonInput(), 'العميل دفع والبضاعة وصلت');
    await tick();
    await userEvent.click(confirmBtn());
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('تغيّر المخزون منذ آخر عرض');
    const row = within(dlg()).getByText('منتج p1').closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['منتج p1', '12', '9', '3', '-3']);
    expect((within(dlg()).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(b.tables.orders[0].status).toBe('pending');
    expect(bal(b)).toBe(9);
    await tick();
    await userEvent.click(confirmBtn());
    await screen.findByText(/تم تسليم الطلب مع تجاوز موثَّق/);
    const calls = overrideCalls(b);
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_attempt_key).not.toBe(calls[1].args.p_attempt_key);
    expect(bal(b)).toBe(-3);
  });

  it('LOST RESPONSE: the retry of the identical request reuses its attempt key and deducts once', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    await userEvent.type(reasonInput(), 'العميل دفع والبضاعة وصلت');
    await tick();
    b.loseResponseNext('rpc:inventory_deliver_order_override');
    await userEvent.click(confirmBtn());
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(b.tables.orders[0].status).toBe('delivered'); // it did go through
    expect(screen.queryByText(/تم تسليم الطلب مع تجاوز موثَّق/)).toBeNull(); // but the page does not claim it yet
    await userEvent.click(confirmBtn()); // plain retry
    await screen.findByText(/تم تسليم الطلب مع تجاوز موثَّق/);
    const calls = overrideCalls(b);
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_attempt_key).toBe(calls[1].args.p_attempt_key);
    expect(bal(b)).toBe(-2);
    expect(b.tables.stock_movements.filter((m) => m.kind === 'sale')).toHaveLength(1);
  });

  it('a failed override keeps the dialog and every typed value, and claims nothing', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    await userEvent.type(reasonInput(), 'العميل دفع والبضاعة وصلت');
    await tick();
    b.failNext('rpc:inventory_deliver_order_override', { code: '42501', message: 'forbidden' });
    await userEvent.click(confirmBtn());
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect((reasonInput() as HTMLInputElement).value).toBe('العميل دفع والبضاعة وصلت');
    expect((within(dlg()).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(b.tables.orders[0].status).toBe('pending');
    expect(bal(b)).toBe(10);
  });

  it('cancelling the dialog leaves the order and the stock untouched', async () => {
    const b = await setup();
    await applyDelivered();
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لتسليم هذا الطلب' });
    await userEvent.click(within(dlg()).getByRole('button', { name: 'إلغاء' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.tables.orders[0].status).toBe('pending');
    expect(bal(b)).toBe(10);
    expect(overrideCalls(b)).toHaveLength(0);
  });

  it('an uninitialized product blocks the delivery with a clear message and NO override is offered', async () => {
    const b = await setup({ lines: [ln('p1', 1), ln('p9', 1)] });
    await applyDelivered();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('لا رصيد افتتاحي للمنتجات التالية — منتج p9');
    expect(alert.textContent).toContain('هيّئ رصيدها من صفحة المخزون');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.tables.orders[0].status).toBe('pending');
    expect(bal(b)).toBe(10);
  });

  it.each([
    ['IS003', 'legacy_order_decision_required', 'يحتاج قرار تسوية صريحًا'],
    ['IS004', 'order_lines_locked', 'لا يمكن تعديل أسطر هذا الطلب'],
    ['IS006', 'order_lines_invalid', 'أسطر هذا الطلب غير صالحة'],
  ])('%s is explained in Arabic and offers no override', async (code, message, expected) => {
    const b = await setup({ stock: 20 });
    b.failNext('from:orders:update', { code, message, details: 'order TYB' });
    await applyDelivered();
    expect((await screen.findByRole('alert')).textContent).toContain(expected);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.tables.orders[0].status).toBe('pending');
  });

  it('a malformed shortage detail never opens a blank override dialog (shown as a plain refusal)', async () => {
    const b = await setup({ stock: 20 });
    b.failNext('from:orders:update', { code: 'IS002', message: 'insufficient_stock', details: 'not json' });
    await applyDelivered();
    expect((await screen.findByRole('alert')).textContent).toContain('المخزون غير كافٍ لهذه العملية');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the override is only offered for delivery — a stock refusal on another status is just an error', async () => {
    const b = await setup({ stock: 20 });
    b.failNext('from:orders:update', { code: 'IS002', message: 'insufficient_stock', details: '[{"product_id":"p1","requested":1,"available":0,"shortfall":1}]' });
    await userEvent.selectOptions(statusSelect(), 'مؤكد');
    await userEvent.click(screen.getByRole('button', { name: 'تطبيق' }));
    expect((await screen.findByRole('alert')).textContent).toContain('المخزون غير كافٍ');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('before migration 0010 is applied', () => {
  it('delivering works exactly as before: no stock is touched and the override RPC is never involved', async () => {
    const b = await freshBackend('admin'); // inventoryOrders stays OFF
    seedCatalog(b, [product('p1')]);
    b.tables.stock_levels.push({ product_id: 'p1', on_hand: 1, low_threshold: 0, product_name: 'x', product_sku: 'y' });
    b.tables.orders.push(order([ln('p1', 12)]));
    const { OrderDetailsPage } = await import('./OrderDetailsPage');
    const store = await import('../../storefront/checkout/orderStore');
    await store.reloadOrders();
    render(
      <MemoryRouter initialEntries={['/admin/orders/o1']}>
        <Routes>
          <Route path="/admin/orders/:orderId" element={<OrderDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('TYB-2026-STK');
    await applyDelivered();
    await waitFor(() => expect(b.tables.orders[0].status).toBe('delivered'));
    expect(b.tables.stock_levels[0].on_hand).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.rpcLog.filter((c) => c.name.startsWith('inventory_'))).toHaveLength(0);
  });
});
