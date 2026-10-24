// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, type Backend } from '../../../test/harness';

// Order-status workflow through the real admin page against the FAKE backend
// (client.mock.ts — a mock; real RLS is covered by supabase/tests). Focus: the
// UI never claims a status changed unless the database confirmed it.

afterEach(cleanup);

const order = (status = 'pending') => ({
  id: 'o1',
  ref: 'TYB-2026-ABC',
  created_at: '2026-01-01T10:00:00Z',
  status,
  contact: { name: 'منى أحمد', phone: '01000000000', email: 'mona@example.com' },
  address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
  delivery: { method: 'standard' },
  lines: [],
  subtotal: 500,
  total: 500,
});

async function mount(b: Backend, row = order()) {
  b.tables.orders.push(row);
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
  await screen.findByText('TYB-2026-ABC');
  return store;
}

const statusSelect = () => screen.getByLabelText('تحديث الحالة') as HTMLSelectElement;
const applyBtn = () => screen.getByRole('button', { name: /تطبيق|جارٍ التطبيق/ }) as HTMLButtonElement;
const dbStatus = (b: Backend) => b.tables.orders[0].status;

async function choose(label: string) {
  await userEvent.selectOptions(statusSelect(), label);
}

describe('order status change (admin)', () => {
  it('applies the new status only after the database confirmed it', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await choose('قيد التجهيز');
    await userEvent.click(applyBtn());
    await waitFor(() => expect(dbStatus(b)).toBe('processing'));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(statusSelect().value).toBe('processing'));
  });

  it('FAILURE (not authorized): the page says so and keeps the OLD status — it never pretends the change happened', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    // RLS silently filtered the update to zero rows; the role check says "not admin"
    b.respondNext('from:orders:update', []);
    b.respondNext('rpc:is_admin', false);
    await choose('تم الشحن');
    await userEvent.click(applyBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ليست لديك صلاحية');
    expect(dbStatus(b)).toBe('pending');
    // the badge in the header still shows the real status
    expect(screen.getAllByText('قيد الانتظار').length).toBeGreaterThan(0);
  });

  it('CONFLICT: if someone else changed the status meanwhile it refuses, explains, and shows the server value', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    b.tables.orders[0].status = 'shipped'; // changed elsewhere after this page loaded
    await choose('ملغٍ');
    // cancellation goes through its own confirmation step (no plain «تطبيق»)
    await userEvent.click(await screen.findByRole('button', { name: 'تأكيد الإلغاء' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('تم تعديل هذا السجل من مكان آخر');
    expect(dbStatus(b)).toBe('shipped'); // not overwritten
    await waitFor(() => expect(screen.getAllByText('تم الشحن').length).toBeGreaterThan(0)); // reloaded from the server
  });

  it('network failure is reported as such and leaves the status untouched', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    b.failNext('from:orders:update', new TypeError('Failed to fetch'), { reject: true });
    await choose('مؤكد');
    await userEvent.click(applyBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(dbStatus(b)).toBe('pending');
  });

  it('DUPLICATE CLICK: while the update is in flight the controls are disabled and only one update is sent', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    const gate = b.hold('from:orders:update');
    await choose('قيد التجهيز');
    await userEvent.click(applyBtn());
    await waitFor(() => expect(applyBtn().disabled).toBe(true));
    expect(applyBtn().textContent).toContain('جارٍ التطبيق');
    expect(statusSelect().disabled).toBe(true);
    await userEvent.click(applyBtn());
    gate.release();
    await waitFor(() => expect(dbStatus(b)).toBe('processing'));
    expect(b.calls('from:orders:update')).toBe(1);
  });

  it('cancelling needs an explicit confirmation and sends nothing until confirmed', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await choose('ملغٍ');
    expect(screen.getByRole('button', { name: 'تأكيد الإلغاء' })).toBeTruthy();
    expect(b.calls('from:orders:update')).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'الإبقاء على الطلب' }));
    expect(b.calls('from:orders:update')).toBe(0);
    expect(dbStatus(b)).toBe('pending');
  });
});

describe('order page loading states', () => {
  it('a failed order load is shown as a load failure with a retry — not as "order not found"', async () => {
    const b = await freshBackend('admin');
    b.tables.orders.push(order());
    b.failNext('from:orders:select', new TypeError('Failed to fetch'), { reject: true });
    const { OrderDetailsPage } = await import('./OrderDetailsPage');
    const store = await import('../../storefront/checkout/orderStore');
    // the store starts its own load at import; wait for THAT (failed) load to settle
    await waitFor(() => expect(store.getOrdersLoadState().status).toBe('error'));
    render(
      <MemoryRouter initialEntries={['/admin/orders/o1']}>
        <Routes>
          <Route path="/admin/orders/:orderId" element={<OrderDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('تعذّر تحميل الطلب')).toBeTruthy();
    expect(screen.queryByText('الطلب غير موجود')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('TYB-2026-ABC')).toBeTruthy();
  });

  it('a genuinely unknown order id is reported as not found', async () => {
    const b = await freshBackend('admin');
    const { OrderDetailsPage } = await import('./OrderDetailsPage');
    const store = await import('../../storefront/checkout/orderStore');
    await store.reloadOrders();
    render(
      <MemoryRouter initialEntries={['/admin/orders/missing']}>
        <Routes>
          <Route path="/admin/orders/:orderId" element={<OrderDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('الطلب غير موجود')).toBeTruthy();
    void b;
  });
});
