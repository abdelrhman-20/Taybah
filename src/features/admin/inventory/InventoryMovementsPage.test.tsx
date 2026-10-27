// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// The movement-history page against the FAKE backend (client.mock.ts; the real
// ledger — append-only, constrained, RLS-protected — is verified against Postgres in
// supabase/tests/inventory*.test.ts). The page is read-only.

afterEach(cleanup);

type Row = Record<string, unknown>;

let seq = 0;
const move = (over: Row = {}): Row => {
  seq += 1;
  return {
    id: `mv-${seq}`,
    seq,
    product_id: 'p1',
    product_name: 'منتج p1',
    product_sku: 'SKU-P1',
    kind: 'receipt',
    quantity: 5,
    qty_delta: 5,
    qty_before: 10,
    qty_after: 15,
    reason: 'استلام مخزون',
    reference: null,
    order_id: null,
    override: false,
    shortfall: 0,
    actor: '00000000-0000-0000-0000-0000000000a1',
    actor_email: 'admin@example.test',
    created_at: '2026-01-02T12:00:00Z',
    ...over,
  };
};

async function mount(b: Backend, route = '/admin/inventory/movements') {
  void b; // the backend is seeded by the caller before the page's modules are imported
  const { InventoryMovementsPage } = await import('./InventoryMovementsPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/admin/inventory/movements" element={<InventoryMovementsPage />} />
        <Route path="/admin/inventory" element={<p>صفحة المخزون</p>} />
        <Route path="/admin/orders/:orderId" element={<p>صفحة الطلب</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const table = () => screen.getByRole('table');
const body = () => within(table()).getAllByRole('row').slice(1);

async function ready(b: Backend, rows: Row[], route?: string) {
  seedCatalog(b, [product('p1'), product('p2')]);
  b.tables.stock_levels.push(
    { product_id: 'p1', on_hand: 15, low_threshold: 0, product_name: 'منتج p1', product_sku: 'SKU-P1' },
    { product_id: 'p2', on_hand: 4, low_threshold: 0, product_name: 'منتج p2', product_sku: 'SKU-P2' },
  );
  b.tables.stock_movements.push(...rows);
  await mount(b, route);
  // an empty ledger renders no table, only its empty state
  if (rows.length > 0) await screen.findByRole('table');
  else await screen.findByText('لا توجد حركات مخزون بعد.');
}

// rows currently shown (waits for the page to settle on the expected count)
const expectRows = (n: number) => waitFor(() => expect(body()).toHaveLength(n));

describe('movement history page', () => {
  it('shows time, product, kind, change, before → after, reason, reference, actor — newest first', async () => {
    const b = await freshBackend('admin');
    await ready(b, [
      move({ kind: 'opening', quantity: 10, qty_delta: 10, qty_before: 0, qty_after: 10, reason: 'رصيد افتتاحي', created_at: '2026-01-01T12:00:00Z' }),
      move({ reference: 'فاتورة 114' }),
    ]);
    const rows = body();
    expect(rows).toHaveLength(2);
    // newest first: the receipt, then the opening
    expect(within(rows[0]).getByText('وارد')).toBeTruthy();
    expect(within(rows[0]).getByText('+5')).toBeTruthy();
    expect(within(rows[0]).getByText('10 → 15')).toBeTruthy();
    expect(within(rows[0]).getByText('استلام مخزون')).toBeTruthy();
    expect(within(rows[0]).getByText('مرجع: فاتورة 114')).toBeTruthy();
    expect(within(rows[0]).getByText('admin@example.test')).toBeTruthy();
    expect(within(rows[0]).getByText('منتج p1')).toBeTruthy();
    expect(within(rows[0]).getByText('SKU-P1')).toBeTruthy();
    expect(within(rows[1]).getByText('رصيد افتتاحي', { selector: 'span' })).toBeTruthy();
    expect(within(rows[1]).getByText('0 → 10')).toBeTruthy();
  });

  it('shows every kind with its own Arabic label, and a damaged return as a zero change that still records the units', async () => {
    const b = await freshBackend('admin');
    await ready(b, [
      move({ kind: 'adjustment', quantity: 3, qty_delta: -3, qty_before: 15, qty_after: 12, reason: 'جرد فعلي' }),
      move({ kind: 'return_restock', quantity: 2, qty_delta: 2, qty_before: 12, qty_after: 14, reason: 'مرتجع سليم' }),
      move({ kind: 'return_damaged', quantity: 4, qty_delta: 0, qty_before: 14, qty_after: 14, reason: 'تالف' }),
      move({ kind: 'sale', quantity: 1, qty_delta: -1, qty_before: 14, qty_after: 13, reason: 'بيع', order_id: null }),
      move({ kind: 'sale_accounted', quantity: 2, qty_delta: 0, qty_before: 13, qty_after: 13, reason: 'محتسب' }),
    ]);
    for (const label of ['تعديل', 'مرتجع سليم', 'مرتجع تالف', 'بيع', 'بيع محتسب مسبقًا']) {
      expect(within(table()).getAllByText(label, { selector: 'span' }).length).toBeGreaterThan(0);
    }
    const damaged = body().find((r) => /مرتجع تالف/.test(r.textContent ?? ''))!;
    expect(damaged.textContent).toContain('0');
    expect(damaged.textContent).toContain('4 وحدة، بلا تغيير في الرصيد');
    expect(within(damaged).getByText('14 → 14')).toBeTruthy();
    expect(within(body().find((r) => /تعديل/.test(r.textContent ?? ''))!).getByText('-3')).toBeTruthy();
  });

  it('links the order reference when there is one', async () => {
    const b = await freshBackend('admin');
    b.tables.orders.push({
      id: 'o-1', ref: 'TYB-2026-ABC', created_at: '2026-01-02T10:00:00Z', status: 'delivered', source: 'online', note: null,
      contact: { name: 'x', phone: '1', email: 'x@y.co' }, address: {}, delivery: { method: 'standard' },
      lines: [{ productId: 'p1', qty: 2 }], subtotal: 1, total: 1,
    });
    await ready(b, [move({ kind: 'return_restock', quantity: 1, qty_delta: 1, order_id: 'o-1' }), move({ order_id: null })]);
    const link = within(table()).getByRole('link', { name: 'TYB-2026-ABC' });
    expect(link.getAttribute('href')).toBe('/admin/orders/o-1');
    // newest first: the unlinked movement is the first row, the linked one the second
    expect(within(body()[0]).getByText('—', { selector: 'span' })).toBeTruthy();
    expect(within(body()[1]).getByRole('link', { name: 'TYB-2026-ABC' })).toBeTruthy();
  });

  it('marks a movement of a product removed from the catalog from its stored snapshot', async () => {
    const b = await freshBackend('admin');
    await ready(b, [move({ product_id: 'gone', product_name: 'منتج قديم', product_sku: 'OLD-1' })]);
    expect(within(table()).getByText('منتج قديم')).toBeTruthy();
    expect(within(table()).getByText('محذوف من الكتالوج')).toBeTruthy();
  });

  it('filters by product, by kind and by date range, and clears the filters', async () => {
    const b = await freshBackend('admin');
    await ready(b, [
      move({ product_id: 'p1', kind: 'receipt', created_at: '2026-01-01T12:00:00Z' }),
      move({ product_id: 'p2', product_name: 'منتج p2', product_sku: 'SKU-P2', kind: 'adjustment', quantity: 1, qty_delta: -1, qty_before: 5, qty_after: 4, created_at: '2026-01-02T12:00:00Z' }),
      move({ product_id: 'p1', kind: 'return_damaged', quantity: 1, qty_delta: 0, created_at: '2026-01-03T12:00:00Z' }),
    ]);
    expect(body()).toHaveLength(3);

    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب المنتج'), 'p2');
    await expectRows(1);
    expect(within(body()[0]).getByText('منتج p2')).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب المنتج'), 'كل المنتجات');
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب نوع الحركة'), 'مرتجع تالف');
    await expectRows(1);
    expect(within(body()[0]).getByText(/1 وحدة، بلا تغيير في الرصيد/)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب نوع الحركة'), 'كل الأنواع');
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-01-02' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-01-02' } });
    await expectRows(1);
    expect(within(body()[0]).getByText('منتج p2')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'مسح' }));
    await expectRows(3);
  });

  it('opens already filtered to one product from the inventory page link (?product=)', async () => {
    const b = await freshBackend('admin');
    await ready(
      b,
      [move({ product_id: 'p1' }), move({ product_id: 'p2', product_name: 'منتج p2', product_sku: 'SKU-P2' })],
      '/admin/inventory/movements?product=p2',
    );
    expect(body()).toHaveLength(1);
    expect(within(body()[0]).getByText('منتج p2')).toBeTruthy();
    expect((screen.getByLabelText('التصفية حسب المنتج') as HTMLSelectElement).value).toBe('p2');
  });

  it('pages 25 at a time, newest page first, with next/previous', async () => {
    const b = await freshBackend('admin');
    const rows = Array.from({ length: 30 }, (_, i) => move({ reason: `حركة ${i + 1}` }));
    await ready(b, rows);
    expect(body()).toHaveLength(25);
    expect(within(body()[0]).getByText('حركة 30')).toBeTruthy(); // newest
    expect(screen.getByText('صفحة 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /الأحدث/ }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /الأقدم/ }));
    expect(await screen.findByText('صفحة 2')).toBeTruthy();
    expect(body()).toHaveLength(5);
    expect(within(body()[0]).getByText('حركة 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: /الأقدم/ }).hasAttribute('disabled')).toBe(true);
  });

  it('is READ-ONLY: no edit or delete control, and no write is ever sent', async () => {
    const b = await freshBackend('admin');
    await ready(b, [move()]);
    expect(within(table()).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /حذف|تعديل|تراجع/ })).toBeNull();
    expect(b.log.filter((l) => /:(insert|update|upsert|delete)$/.test(l))).toEqual([]);
    expect(b.rpcLog.filter((c) => c.name !== 'is_admin')).toEqual([]);
  });

  it('empty states: no movements yet, and no movements for the current filters', async () => {
    const b = await freshBackend('admin');
    await ready(b, []);
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب نوع الحركة'), 'وارد');
    expect(await screen.findByText('لا توجد حركات تطابق عوامل التصفية.')).toBeTruthy();
  });
});

describe('movement history page — access and failures', () => {
  it('a NON-admin gets a refusal, never an empty "no movements" list', async () => {
    const b = await freshBackend('user');
    seedCatalog(b, [product('p1')]);
    b.tables.stock_movements.push(move());
    await mount(b);
    expect((await screen.findByText(/ليست لديك صلاحية عرض سجل المخزون/)).textContent).toBeTruthy();
    expect(screen.queryByText('لا توجد حركات مخزون بعد.')).toBeNull();
    expect(b.calls('from:stock_movements:select')).toBe(0);
  });

  it('explains a missing migration 0009 instead of showing an empty history', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    delete (b.tables as Record<string, unknown>).stock_movements;
    delete (b.tables as Record<string, unknown>).stock_levels;
    await mount(b);
    expect((await screen.findByText(/جداول المخزون غير موجودة/)).textContent).toContain('0009_inventory.sql');
    expect(screen.queryByText('لا توجد حركات مخزون بعد.')).toBeNull();
  });

  it('a failed load is an error with a retry, and retry works', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    b.tables.stock_movements.push(move());
    b.failNext('from:stock_movements:select', new TypeError('Failed to fetch'), { reject: true });
    await mount(b);
    expect((await screen.findByText(/تعذّر تحميل السجل/)).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await screen.findByRole('table');
    expect(body()).toHaveLength(1);
  });

  it('renders a card list for narrow screens with the same facts', async () => {
    const b = await freshBackend('admin');
    await ready(b, [move({ reason: 'سبب ظاهر' })]);
    const card = screen.getAllByRole('listitem').find((li) => /سبب ظاهر/.test(li.textContent ?? ''))!;
    expect(within(card).getByText('10 → 15')).toBeTruthy();
    expect(within(card).getByText('وارد')).toBeTruthy();
  });
});
