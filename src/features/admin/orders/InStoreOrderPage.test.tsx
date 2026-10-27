// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// «إضافة طلب» form against the FAKE backend (client.mock.ts — a mock of
// migration 0008; the real SQL is verified in supabase/tests). Focus: retail
// totals, the unavailable-product warning, and that success is only ever
// shown/navigated after the database stored the order.

afterEach(cleanup);

async function mount(role: 'admin' | 'user' = 'admin'): Promise<Backend> {
  const b = await freshBackend(role);
  seedCatalog(b, [
    product('p1', { price: 1000, name: { ar: 'سجادة كلاسيك', en: 'Classic' } }),
    product('p2', { price: 500, availability: 'out_of_stock', name: { ar: 'مخدة نافدة', en: 'Cushion' } }),
  ]);
  b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 123.45 });
  const { InStoreOrderPage } = await import('./InStoreOrderPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={['/admin/orders/new']}>
      <Routes>
        <Route path="/admin/orders/new" element={<InStoreOrderPage />} />
        <Route path="/admin/orders/:orderId" element={<p>صفحة تفاصيل الطلب</p>} />
        <Route path="/admin/orders" element={<p>قائمة الطلبات</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'إضافة طلب' });
  return b;
}

const addBtn = (name: string) => screen.getByRole('button', { name: new RegExp(`^إضافة ${name}`) });
const total = () => screen.getByTestId('in-store-total').textContent ?? '';
const save = () => screen.getByRole('button', { name: /حفظ الطلب|جارٍ الحفظ/ }) as HTMLButtonElement;

describe('in-store order form', () => {
  it('totals use the retail price × quantity and update when the quantity changes', async () => {
    await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    expect(total()).toContain('1,000');
    await userEvent.click(screen.getByRole('button', { name: 'زيادة الكمية' }));
    expect(total()).toContain('2,000');
    await userEvent.click(addBtn('سجادة كلاسيك')); // adding the same item again bumps its quantity
    expect(total()).toContain('3,000');
  });

  it('never shows or fetches the wholesale price', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    expect(document.body.textContent).not.toContain('123');
    expect(b.calls('from:product_internal_pricing:select')).toBe(0);
  });

  it('an out-of-stock product can be added, with a clear warning', async () => {
    await mount();
    expect(screen.getAllByText('هذا المنتج غير متوفر في المتجر الإلكتروني').length).toBeGreaterThan(0);
    await userEvent.click(addBtn('مخدة نافدة'));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('تنبيه');
    expect(status.textContent).toContain('غير متوفر في المتجر الإلكتروني');
    expect(total()).toContain('500');
  });

  it('SUCCESS: saves an in-store sale (source, status, total, customer, note) and only then opens it', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    await userEvent.type(screen.getByLabelText('الاسم'), 'أحمد');
    await userEvent.type(screen.getByLabelText('الهاتف'), '01012345678');
    await userEvent.type(screen.getByLabelText('ملاحظة'), 'تسليم فوري');
    await userEvent.click(save());
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.orders[0]).toMatchObject({
      source: 'in_store',
      status: 'sold',
      total: 1000,
      note: 'تسليم فوري',
      contact: { name: 'أحمد', phone: '01012345678', email: '' },
      delivery: { method: 'in_store' },
    });
  });

  it('customer details are optional', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    await userEvent.click(save());
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.tables.orders[0]).toMatchObject({ contact: { name: '', phone: '' }, note: null });
  });

  it('refuses an empty order and a bad phone number without calling the server', async () => {
    const b = await mount();
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('أضف منتجًا واحدًا على الأقل');
    await userEvent.click(addBtn('سجادة كلاسيك'));
    await userEvent.type(screen.getByLabelText('الهاتف'), 'abc');
    await userEvent.click(save());
    expect((await screen.findByText('رقم الهاتف غير صالح.')).textContent).toBeTruthy();
    expect(b.calls('from:orders:insert')).toBe(0);
  });

  it('FAILURE: shows the error, stays on the form with its data, and saves nothing', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    await userEvent.type(screen.getByLabelText('الاسم'), 'أحمد');
    b.failNext('from:orders:insert', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(screen.queryByText('صفحة تفاصيل الطلب')).toBeNull();
    expect(b.tables.orders).toHaveLength(0);
    expect((screen.getByLabelText('الاسم') as HTMLInputElement).value).toBe('أحمد');
    expect(save().disabled).toBe(false);
    await userEvent.click(save()); // retry works
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
  });

  it('a price changed on the server meanwhile is refused with an explanation, never saved', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    (b.tables.catalog_docs.find((d) => d.id === 'p1')!.data as { price: number }).price = 1200;
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('تغيّر سعر أحد المنتجات');
    expect(b.tables.orders).toHaveLength(0);
  });

  it('a non-admin session is told it is not allowed and nothing is stored', async () => {
    const b = await mount('user');
    await userEvent.click(addBtn('سجادة كلاسيك'));
    await userEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect(b.tables.orders).toHaveLength(0);
  });

  it('DUPLICATE CLICK: a second click while saving sends only one insert', async () => {
    const b = await mount();
    await userEvent.click(addBtn('سجادة كلاسيك'));
    const gate = b.hold('from:orders:insert');
    await userEvent.click(save());
    await waitFor(() => expect(save().disabled).toBe(true));
    await userEvent.click(save());
    gate.release();
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.calls('from:orders:insert')).toBe(1);
    expect(b.tables.orders).toHaveLength(1);
  });

  it('search narrows the product list', async () => {
    await mount();
    await userEvent.type(screen.getByLabelText('البحث في المنتجات'), 'مخدة');
    const list = screen.getAllByRole('list')[0];
    expect(within(list).queryByText('سجادة كلاسيك')).toBeNull();
    expect(within(list).getByText('مخدة نافدة')).toBeTruthy();
  });
});
