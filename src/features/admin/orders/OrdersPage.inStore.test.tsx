// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, type Backend } from '../../../test/harness';

// Orders list + order details for in-store sales, against the FAKE backend
// (client.mock.ts). Real SQL: supabase/tests/in-store-orders.test.ts.

afterEach(cleanup);

const base = {
  address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
  lines: [
    { productId: 'p1', slug: 'p1', name: { ar: 'سجادة كلاسيك', en: 'Classic' }, color: null, size: null, qty: 2, price: 1000, image: '' },
  ],
  subtotal: 2000,
  total: 2000,
};

const online = {
  ...base,
  id: 'on1',
  ref: 'TYB-ONLINE',
  created_at: '2026-01-02T10:00:00Z',
  status: 'pending',
  source: 'online',
  note: null,
  contact: { name: 'منى أحمد', phone: '01000000001', email: 'mona@example.com' },
  delivery: { method: 'standard' },
};
const inStore = {
  ...base,
  id: 'is1',
  ref: 'TYB-INSTORE',
  created_at: '2026-01-03T10:00:00Z',
  status: 'sold',
  source: 'in_store',
  note: 'دفع نقدًا',
  contact: { name: '', phone: '', email: '' },
  delivery: { method: 'in_store' },
};
// an order saved before migration 0008 (no source / note columns at all)
const legacy = {
  ...base,
  id: 'old1',
  ref: 'TYB-LEGACY',
  created_at: '2025-12-01T10:00:00Z',
  status: 'delivered',
  contact: { name: 'قديم', phone: '01000000002', email: 'old@example.com' },
  delivery: { method: 'standard' },
};

async function mountList(b: Backend) {
  b.tables.orders.push({ ...online }, { ...inStore }, { ...legacy });
  const { OrdersPage } = await import('./OrdersPage');
  const store = await import('../../storefront/checkout/orderStore');
  await store.reloadOrders();
  render(
    <MemoryRouter initialEntries={['/admin/orders']}>
      <Routes>
        <Route path="/admin/orders" element={<OrdersPage />} />
        <Route path="/admin/orders/new" element={<p>نموذج إضافة طلب</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findAllByText('TYB-ONLINE');
}

const table = () => screen.getByRole('table');
const rowOf = (ref: string) => within(table()).getByText(ref).closest('tr') as HTMLElement;

describe('Orders page — in-store sales', () => {
  it('has a prominent «إضافة طلب» button that opens the form', async () => {
    const b = await freshBackend('admin');
    await mountList(b);
    await userEvent.click(screen.getByRole('link', { name: 'إضافة طلب' }));
    expect(await screen.findByText('نموذج إضافة طلب')).toBeTruthy();
  });

  it('shows the persisted source and the «تم البيع» status; historical orders show as online', async () => {
    const b = await freshBackend('admin');
    await mountList(b);
    const sale = rowOf('TYB-INSTORE');
    expect(within(sale).getByText('من المتجر')).toBeTruthy();
    expect(within(sale).getByText('تم البيع')).toBeTruthy();
    expect(within(sale).getByText('عميل المتجر')).toBeTruthy(); // no customer entered
    expect(within(sale).getByText('استلام من المتجر')).toBeTruthy();
    expect(within(rowOf('TYB-ONLINE')).getByText('أونلاين')).toBeTruthy();
    expect(within(rowOf('TYB-LEGACY')).getByText('أونلاين')).toBeTruthy();
    expect(within(rowOf('TYB-LEGACY')).getByText('تم التسليم')).toBeTruthy(); // meaning unchanged
  });

  it('filters by source and by the new status together with the old statuses', async () => {
    const b = await freshBackend('admin');
    await mountList(b);
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب المصدر'), 'من المتجر');
    expect(within(table()).queryByText('TYB-ONLINE')).toBeNull();
    expect(within(table()).getByText('TYB-INSTORE')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب المصدر'), 'كل المصادر');
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب الحالة'), 'تم البيع');
    expect(within(table()).getAllByRole('row')).toHaveLength(2); // header + the sale
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب الحالة'), 'تم التسليم');
    expect(within(table()).getByText('TYB-LEGACY')).toBeTruthy();
    expect(within(table()).queryByText('TYB-INSTORE')).toBeNull();
  });
});

describe('Order details — in-store sale', () => {
  async function mountDetails(b: Backend, row: Record<string, unknown>) {
    b.tables.orders.push({ ...row });
    const { OrderDetailsPage } = await import('./OrderDetailsPage');
    const store = await import('../../storefront/checkout/orderStore');
    await store.reloadOrders();
    render(
      <MemoryRouter initialEntries={[`/admin/orders/${row.id}`]}>
        <Routes>
          <Route path="/admin/orders/:orderId" element={<OrderDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(String(row.ref));
  }
  const statusOptions = () =>
    Array.from((screen.getByLabelText('تحديث الحالة') as HTMLSelectElement).options).map((o) => o.textContent);

  it('shows source, «تم البيع», note and items; no delivery section, no e-mail log', async () => {
    const b = await freshBackend('admin');
    await mountDetails(b, inStore);
    expect(screen.getAllByText('من المتجر').length).toBeGreaterThan(0);
    expect(screen.getAllByText('تم البيع').length).toBeGreaterThan(0);
    expect(screen.getByText('دفع نقدًا')).toBeTruthy();
    expect(screen.getByText('سجادة كلاسيك')).toBeTruthy();
    expect(screen.queryByText('رسوم التوصيل')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'التوصيل' })).toBeNull();
    expect(screen.getByText(/لا تُرسل إشعارات بريدية/)).toBeTruthy();
    expect(b.calls('from:order_email_outbox:select')).toBe(0);
  });

  it('offers only «تم البيع» and «ملغٍ» as statuses', async () => {
    const b = await freshBackend('admin');
    await mountDetails(b, inStore);
    expect(statusOptions()).toEqual(['تم البيع', 'ملغٍ']);
  });

  it('an in-store sale can be cancelled (with confirmation) and the change is stored', async () => {
    const b = await freshBackend('admin');
    await mountDetails(b, inStore);
    await userEvent.selectOptions(screen.getByLabelText('تحديث الحالة'), 'ملغٍ');
    await userEvent.click(await screen.findByRole('button', { name: 'تأكيد الإلغاء' }));
    await screen.findAllByText('ملغٍ');
    expect(b.tables.orders[0].status).toBe('cancelled');
  });

  it('online orders keep the existing statuses and never offer «تم البيع»', async () => {
    const b = await freshBackend('admin');
    await mountDetails(b, online);
    expect(statusOptions()).toEqual(['قيد الانتظار', 'مؤكد', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'ملغٍ']);
    expect(screen.getAllByText('أونلاين').length).toBeGreaterThan(0);
    expect(screen.getByText('رسوم التوصيل')).toBeTruthy();
  });
});
