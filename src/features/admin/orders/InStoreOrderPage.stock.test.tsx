// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// Recording an in-store sale when migration 0010 (stock deduction) is modelled — against
// the FAKE backend (client.mock.ts, `inventoryOrders` on). The REAL insert trigger, locks
// and RPCs are verified against Postgres in supabase/tests/inventory.orders.test.ts.

afterEach(cleanup);

async function setup(stock: number | null, extra?: (b: Backend) => void): Promise<Backend> {
  const b = await freshBackend('admin');
  b.inventoryOrders = true;
  seedCatalog(b, [
    product('p1', { price: 1000, name: { ar: 'سجادة كلاسيك', en: 'Classic' } }),
    product('p2', { price: 500, name: { ar: 'مخدة', en: 'Cushion' } }),
  ]);
  if (stock !== null) b.tables.stock_levels.push({ product_id: 'p1', on_hand: stock, low_threshold: 0, product_name: 'سجادة كلاسيك', product_sku: 'SKU-P1' });
  extra?.(b);
  const { InStoreOrderPage } = await import('./InStoreOrderPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={['/admin/orders/new']}>
      <Routes>
        <Route path="/admin/orders/new" element={<InStoreOrderPage />} />
        <Route path="/admin/orders/:orderId" element={<p>صفحة تفاصيل الطلب</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'إضافة طلب' });
  return b;
}

const addBtn = (name: string) => screen.getByRole('button', { name: new RegExp(`^إضافة ${name}`) });
const save = () => screen.getByRole('button', { name: /حفظ الطلب|جارٍ الحفظ/ }) as HTMLButtonElement;
const dlg = () => screen.getByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
const calls = (b: Backend) => b.rpcLog.filter((c) => c.name === 'inventory_create_in_store_order_override');

async function addQty(name: string, qty: number) {
  await userEvent.click(addBtn(name));
  // set the value in one change (clearing the field falls back to 1, so typing would append)
  fireEvent.change(screen.getByLabelText(new RegExp(`الكمية — ${name}`)), { target: { value: String(qty) } });
}

describe('in-store sale with stock deduction', () => {
  it('with enough stock the sale is saved, deducts atomically, and no override is offered', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 3);
    await userEvent.click(save());
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.stock_levels[0].on_hand).toBe(7);
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'sale', quantity: 3, override: false });
    expect(calls(b)).toHaveLength(0);
  });

  it('a stock shortage creates NOTHING and opens the explicit override dialog with the shortfall', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    const d = await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    const row = within(d).getByText('سجادة كلاسيك').closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['سجادة كلاسيك', '12', '10', '2', '-2']);
    expect(b.tables.orders).toHaveLength(0);
    expect(b.tables.stock_levels[0].on_hand).toBe(10);
    expect(screen.queryByText('صفحة تفاصيل الطلب')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the override needs a 5+ character reason and an explicit tick, then records the sale and goes negative', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    const confirm = () => within(dlg()).getByRole('button', { name: 'تسجيل البيع رغم النقص' });
    await userEvent.type(within(dlg()).getByLabelText(/سبب التجاوز/), 'abcd');
    await userEvent.click(confirm());
    expect(within(dlg()).getByRole('alert').textContent).toContain('اكتب سببًا من 5 أحرف على الأقل');
    await userEvent.type(within(dlg()).getByLabelText(/سبب التجاوز/), 'e');
    await userEvent.click(confirm());
    expect(within(dlg()).getByRole('alert').textContent).toContain('أكّد صراحةً');
    expect(calls(b)).toHaveLength(0);
    await userEvent.click(within(dlg()).getByRole('checkbox', { name: /أؤكد المتابعة/ }));
    await userEvent.click(confirm());
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.orders[0]).toMatchObject({ source: 'in_store', status: 'sold', total: 12000 });
    expect(b.tables.stock_levels[0].on_hand).toBe(-2);
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'sale', override: true, shortfall: 2, qty_after: -2 });
    const sent = calls(b)[0].args;
    expect(sent.p_reason).toBe('abcde');
    expect(sent.p_confirmed_shortfall).toEqual([{ product_id: 'p1', requested: 12, available: 10, shortfall: 2 }]);
    expect(sent.p_attempt_key).toMatch(/^[0-9a-f-]{36}$/);
    expect((sent.p_order as { id: string; total: number }).total).toBe(12000);
  });

  it('LOST RESPONSE: the retry reuses the attempt key, does not create a second sale, and deducts once', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    await userEvent.type(within(dlg()).getByLabelText(/سبب التجاوز/), 'العميل دفع والبضاعة وصلت');
    await userEvent.click(within(dlg()).getByRole('checkbox', { name: /أؤكد المتابعة/ }));
    b.loseResponseNext('rpc:inventory_create_in_store_order_override');
    await userEvent.click(within(dlg()).getByRole('button', { name: 'تسجيل البيع رغم النقص' }));
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(b.tables.orders).toHaveLength(1); // it did go through
    expect(screen.queryByText('صفحة تفاصيل الطلب')).toBeNull(); // but the page does not claim it yet
    await userEvent.click(within(dlg()).getByRole('button', { name: 'تسجيل البيع رغم النقص' }));
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    expect(calls(b)).toHaveLength(2);
    expect(calls(b)[0].args.p_attempt_key).toBe(calls(b)[1].args.p_attempt_key);
    expect(b.tables.orders).toHaveLength(1);
    expect(b.tables.stock_levels[0].on_hand).toBe(-2);
    expect(b.tables.stock_movements.filter((m) => m.kind === 'sale')).toHaveLength(1);
  });

  it('stock that moved since the admin looked (IS007) shows the fresh numbers and needs a new confirmation', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    b.tables.stock_levels[0].on_hand = 8;
    await userEvent.type(within(dlg()).getByLabelText(/سبب التجاوز/), 'العميل دفع والبضاعة وصلت');
    await userEvent.click(within(dlg()).getByRole('checkbox', { name: /أؤكد المتابعة/ }));
    await userEvent.click(within(dlg()).getByRole('button', { name: 'تسجيل البيع رغم النقص' }));
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('تغيّر المخزون منذ آخر عرض');
    const row = within(dlg()).getByText('سجادة كلاسيك').closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['سجادة كلاسيك', '12', '8', '4', '-4']);
    expect(b.tables.orders).toHaveLength(0);
    expect((within(dlg()).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('cancelling the dialog keeps the form and creates nothing', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    await userEvent.click(within(dlg()).getByRole('button', { name: 'إلغاء' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText(/الكمية — سجادة كلاسيك/) as HTMLInputElement).value).toBe('12');
    expect(save().disabled).toBe(false);
    expect(b.tables.orders).toHaveLength(0);
    expect(calls(b)).toHaveLength(0);
  });

  it('an uninitialized product blocks the sale with a clear message, naming it — no override is offered', async () => {
    const b = await setup(null); // p1 has no opening balance
    await addQty('سجادة كلاسيك', 1);
    await userEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('لا رصيد افتتاحي للمنتجات التالية — سجادة كلاسيك');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.tables.orders).toHaveLength(0);
  });

  it('the override does not bypass the price validation (a price changed on the server is still refused)', async () => {
    const b = await setup(10);
    await addQty('سجادة كلاسيك', 12);
    await userEvent.click(save());
    await screen.findByRole('dialog', { name: 'المخزون غير كافٍ لهذا البيع' });
    (b.tables.catalog_docs.find((d) => d.id === 'p1')!.data as { price: number }).price = 1200;
    await userEvent.type(within(dlg()).getByLabelText(/سبب التجاوز/), 'العميل دفع والبضاعة وصلت');
    await userEvent.click(within(dlg()).getByRole('checkbox', { name: /أؤكد المتابعة/ }));
    await userEvent.click(within(dlg()).getByRole('button', { name: 'تسجيل البيع رغم النقص' }));
    expect((await within(dlg()).findByRole('alert')).textContent).toContain('تغيّر سعر أحد المنتجات');
    expect(b.tables.orders).toHaveLength(0);
    expect(b.tables.stock_levels[0].on_hand).toBe(10);
  });
});

describe('before migration 0010 is applied', () => {
  it('the sale is saved exactly as before: stock untouched, the override RPC never involved', async () => {
    const b = await freshBackend('admin'); // inventoryOrders stays OFF
    seedCatalog(b, [product('p1', { price: 1000, name: { ar: 'سجادة كلاسيك', en: 'C' } })]);
    b.tables.stock_levels.push({ product_id: 'p1', on_hand: 1, low_threshold: 0, product_name: 'x', product_sku: 'y' });
    const { InStoreOrderPage } = await import('./InStoreOrderPage');
    const docs = await import('../../storefront/catalog/catalogDocs');
    await docs.whenDocsSettled();
    render(
      <MemoryRouter initialEntries={['/admin/orders/new']}>
        <Routes>
          <Route path="/admin/orders/new" element={<InStoreOrderPage />} />
          <Route path="/admin/orders/:orderId" element={<p>صفحة تفاصيل الطلب</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'إضافة طلب' });
    await addQty('سجادة كلاسيك', 5);
    await userEvent.click(save());
    expect(await screen.findByText('صفحة تفاصيل الطلب')).toBeTruthy();
    await waitFor(() => expect(b.tables.orders).toHaveLength(1));
    expect(b.tables.stock_levels[0].on_hand).toBe(1);
    expect(b.rpcLog.filter((c) => c.name.startsWith('inventory_'))).toHaveLength(0);
  });
});
