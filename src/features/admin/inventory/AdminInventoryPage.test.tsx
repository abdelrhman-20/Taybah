// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { category, freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// The admin inventory page against the FAKE backend (client.mock.ts). That mock
// models the migration-0009 RPCs the page calls; the REAL SQL (constraints, locks,
// RLS, ACLs) is verified against Postgres in supabase/tests/inventory*.test.ts.
// These tests prove the CLIENT: what it shows, what it sends (RPCs only, never a
// direct write), and that it never reports a change the database did not confirm.
// They do NOT prove a real database has migration 0009 applied, and they say
// nothing about concurrent requests (unverified; see docs/INVENTORY_SETUP.md).

afterEach(cleanup);

type Row = Record<string, unknown>;

const lvl = (b: Backend, id: string, onHand: number, low = 0) =>
  b.tables.stock_levels.push({
    product_id: id,
    on_hand: onHand,
    low_threshold: low,
    product_name: `منتج ${id}`,
    product_sku: `SKU-${id}`.toUpperCase(),
  });

const order = (id: string, ref: string, lines: Row[], status = 'delivered'): Row => ({
  id,
  ref,
  created_at: '2026-01-02T10:00:00Z',
  status,
  source: 'online',
  note: null,
  contact: { name: 'عميل', phone: '010', email: 'c@example.com' },
  address: { country: 'EG', governorate: 'Cairo', city: 'c', street: 's', building: '1', apartment: '', instructions: '' },
  delivery: { method: 'standard' },
  lines,
  subtotal: 1,
  total: 1,
});

async function mount(b: Backend, route = '/admin/inventory') {
  const { AdminInventoryPage } = await import('./AdminInventoryPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/admin/inventory" element={<AdminInventoryPage />} />
        <Route path="/admin/inventory/movements" element={<p>صفحة الحركات</p>} />
        <Route path="/admin/migration" element={<p>صفحة الترحيل</p>} />
      </Routes>
    </MemoryRouter>,
  );
  void b;
}

const table = () => screen.getByRole('table');
const rowFor = (name: string) => within(table()).getByText(name).closest('tr') as HTMLElement;
const onHandOf = (id: string) => screen.getByTestId(`onhand-${id}`).textContent;
const dialog = (name: string) => screen.getByRole('dialog', { name });
const click = (el: HTMLElement) => userEvent.click(el);
const inRow = (name: string, button: string) => within(rowFor(name)).getByRole('button', { name: button });

async function ready(b: Backend, products = [product('p1', { price: 1000 })], setup?: (b: Backend) => void) {
  seedCatalog(b, products);
  setup?.(b);
  await mount(b);
  await screen.findByRole('table');
}

const rpcCalls = (b: Backend, name?: string) => b.rpcLog.filter((c) => !name || c.name === name);
const directWrites = (b: Backend) =>
  b.log.filter((l) => /^from:(stock_|inventory_)[a-z_]+:(insert|update|upsert|delete)$/.test(l));

// ===========================================================================
describe('inventory page — display', () => {
  it('shows image, name, SKU, retail price, admin-only wholesale price, quantity, threshold and status', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1', { price: 1000 })], (x) => {
      lvl(x, 'p1', 10, 3);
      x.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 720 });
    });
    const row = rowFor('منتج p1');
    expect(within(row).getByText('SKU-P1')).toBeTruthy();
    expect(within(row).getByText('1,000 ج.م')).toBeTruthy();
    expect(within(row).getByText('720 ج.م')).toBeTruthy();
    expect(row.querySelector('img') ?? within(row).queryByRole('img')).toBeTruthy(); // the product image
    expect(onHandOf('p1')).toBe('10');
    expect(within(row).getByText('3')).toBeTruthy(); // threshold
    expect(within(row).getByText('متوفر')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /سعر الجملة \(للأدمن\)/ })).toBeTruthy();
  });

  it('a product without a wholesale price says so; an unreadable private price list shows a dash and a note, and the page still works', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1'), product('p2')], (x) => {
      lvl(x, 'p1', 5);
      lvl(x, 'p2', 5);
      x.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 700 });
    });
    expect(within(rowFor('منتج p2')).getByText('لم يُحدَّد')).toBeTruthy();
    cleanup();

    const b2 = await freshBackend('admin');
    b2.failNext('from:product_internal_pricing:select', { code: '42P01', message: 'relation does not exist' });
    await ready(b2, [product('p1')], (x) => lvl(x, 'p1', 5));
    expect(within(rowFor('منتج p1')).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/تعذّر تحميل أسعار الجملة/)).toBeTruthy();
    expect(onHandOf('p1')).toBe('5');
  });

  it('tells the admin that automatic deduction from orders is not active yet', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 5));
    expect(screen.getByRole('note', { name: '' }).textContent ?? '').toContain('غير مُفعَّل بعد');
  });

  it('distinguishes an explicit zero ("نفد") from an uninitialized product, and offers initialization only for the latter', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1'), product('p2')], (x) => lvl(x, 'p1', 0));
    expect(within(rowFor('منتج p1')).getByText('نفد')).toBeTruthy();
    expect(within(rowFor('منتج p2')).getByText('غير مُهيَّأ')).toBeTruthy();
    expect(within(rowFor('منتج p2')).getByRole('button', { name: 'تهيئة الرصيد' })).toBeTruthy();
    expect(within(rowFor('منتج p1')).queryByRole('button', { name: 'تهيئة الرصيد' })).toBeNull();
    expect(within(rowFor('منتج p1')).getByRole('button', { name: 'تعديل الكمية' })).toBeTruthy();
    expect(onHandOf('p2')).toBe('—');
  });

  it('lists a product removed from the catalog from its stored snapshot, without actions to initialize it', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => {
      lvl(x, 'p1', 4);
      x.tables.stock_levels.push({ product_id: 'gone', on_hand: 2, low_threshold: 0, product_name: 'منتج قديم', product_sku: 'OLD-1' });
    });
    const row = rowFor('منتج قديم');
    expect(within(row).getByText('محذوف من الكتالوج')).toBeTruthy();
    expect(within(row).getByText('OLD-1')).toBeTruthy();
    expect(onHandOf('gone')).toBe('2');
  });
});

// ===========================================================================
describe('inventory page — alerts and conflicts', () => {
  async function alerts() {
    const b = await freshBackend('admin');
    await ready(
      b,
      [
        product('neg', { availability: 'in_stock' }),
        product('out', { availability: 'in_stock' }),
        product('low', { availability: 'in_stock' }),
        product('ok', { availability: 'in_stock' }),
        product('uni', { availability: 'in_stock' }),
        product('mout', { availability: 'out_of_stock' }),
      ],
      (x) => {
        lvl(x, 'neg', -2, 5);
        lvl(x, 'out', 0, 5);
        lvl(x, 'low', 3, 5);
        lvl(x, 'ok', 50, 5);
        lvl(x, 'mout', 9, 2);
      },
    );
    return b;
  }

  it('summarizes out-of-stock, negative and low products in an alert and in counters', async () => {
    await alerts();
    const alert = screen.getAllByRole('alert').find((a) => /تنبيهات المخزون/.test(a.textContent ?? ''))!;
    expect(alert.textContent).toMatch(/1 بمخزون سالب/);
    expect(alert.textContent).toMatch(/1 نفدت كميته/);
    expect(alert.textContent).toMatch(/1 منخفض/);
    const tile = (name: RegExp) => screen.getByRole('button', { name });
    expect(tile(/مخزون سالب/).textContent).toContain('1');
    expect(tile(/نفدت الكمية/).textContent).toContain('1');
    expect(tile(/^منخفض/).textContent).toContain('1');
    expect(tile(/غير مُهيَّأ/).textContent).toContain('1');
    expect(tile(/تعارض مع المتجر/).textContent).toContain('4'); // neg, out, low (listed as available) + mout (marked out but stocked)
  });

  it('warns when the manual storefront availability conflicts with the real stock — and changes nothing', async () => {
    const b = await alerts();
    const warn = (name: string) => within(rowFor(name)).queryByText(/تحذير:/)?.textContent ?? null;
    expect(warn('منتج out')).toMatch(/المخزون صفر أو سالب لكن المتجر يعرض المنتج «متوفر»/);
    expect(warn('منتج neg')).toMatch(/المخزون صفر أو سالب/);
    expect(warn('منتج low')).toMatch(/المخزون منخفض والمتجر يعرض المنتج «متوفر»/);
    expect(warn('منتج mout')).toMatch(/يوجد مخزون لكن المتجر يعرض المنتج «نفدت الكمية»/);
    expect(warn('منتج ok')).toBeNull();
    expect(warn('منتج uni')).toBeNull();
    // purely advisory: no write of any kind happened
    expect(b.log.filter((l) => /:(insert|update|upsert|delete)$/.test(l))).toEqual([]);
    expect(rpcCalls(b).filter((c) => c.name !== 'is_admin')).toEqual([]);
    expect(b.tables.catalog_docs.find((d) => d.id === 'out')!.data).toMatchObject({ availability: 'in_stock' });
  });

  it('a tile filters the list and a second click clears it', async () => {
    await alerts();
    await click(screen.getByRole('button', { name: /نفدت الكمية/ }));
    expect(within(table()).queryByText('منتج ok')).toBeNull();
    expect(within(table()).getByText('منتج out')).toBeTruthy();
    await click(screen.getByRole('button', { name: /تعارض مع المتجر/ }));
    expect(within(table()).getByText('منتج mout')).toBeTruthy();
    expect(within(table()).queryByText('منتج ok')).toBeNull();
    await click(screen.getByRole('button', { name: /تعارض مع المتجر/ }));
    expect(within(table()).getByText('منتج ok')).toBeTruthy();
  });

  it('shows no alert when everything is healthy', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 20, 3));
    expect(screen.queryByText(/تنبيهات المخزون/)).toBeNull();
  });
});

// ===========================================================================
describe('inventory page — search, filters, sorting and pagination', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => product(`p${String(i + 1).padStart(2, '0')}`, { price: 100 + i }));

  it('searches by name and by SKU', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1'), product('p2')], (x) => {
      lvl(x, 'p1', 5);
      lvl(x, 'p2', 5);
    });
    await userEvent.type(screen.getByLabelText('البحث في المخزون'), 'p2');
    expect(within(table()).queryByText('منتج p1')).toBeNull();
    expect(within(table()).getByText('منتج p2')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('البحث في المخزون'));
    await userEvent.type(screen.getByLabelText('البحث في المخزون'), 'SKU-P1');
    expect(within(table()).getByText('منتج p1')).toBeTruthy();
    expect(within(table()).queryByText('منتج p2')).toBeNull();
  });

  it('filters by status and by category, and clears the filters', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1'), product('p2', { category: 'curtains' }), product('p3')]);
    b.putDoc('category', 'curtains', category('curtains'), { slug: 'curtains', sort_order: 2 });
    lvl(b, 'p1', 0);
    lvl(b, 'p2', 9);
    lvl(b, 'p3', 9);
    await mount(b);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب حالة المخزون'), 'نفد');
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب حالة المخزون'), 'كل الحالات');
    await userEvent.selectOptions(screen.getByLabelText('التصفية حسب التصنيف'), 'curtains');
    expect(within(table()).getByText('منتج p2')).toBeTruthy();
    expect(within(table()).queryByText('منتج p1')).toBeNull();
    await click(screen.getByRole('button', { name: 'مسح' }));
    expect(within(table()).getAllByRole('row')).toHaveLength(4);
  });

  it('sorts by urgency (default), by quantity and by name', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('a'), product('b'), product('c')], (x) => {
      lvl(x, 'a', 50);
      lvl(x, 'b', 0);
      lvl(x, 'c', 7);
    });
    const names = () => within(table()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].querySelector('p')?.textContent ?? '');
    expect(names()[0]).toBe('منتج b'); // out of stock first
    await userEvent.selectOptions(screen.getByLabelText('ترتيب المخزون'), 'الأقل كمية');
    expect(names()).toEqual(['منتج b', 'منتج c', 'منتج a']);
    await userEvent.selectOptions(screen.getByLabelText('ترتيب المخزون'), 'الأكثر كمية');
    expect(names()).toEqual(['منتج a', 'منتج c', 'منتج b']);
    await userEvent.selectOptions(screen.getByLabelText('ترتيب المخزون'), 'الاسم');
    expect(names()).toEqual(['منتج a', 'منتج b', 'منتج c']);
  });

  it('paginates 25 per page with previous/next and returns to the first page when a filter changes', async () => {
    const b = await freshBackend('admin');
    await ready(b, many(30), (x) => many(30).forEach((p) => lvl(x, p.id, 10)));
    expect(within(table()).getAllByRole('row')).toHaveLength(26); // header + 25
    expect(screen.getByText('صفحة 1 من 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /السابق/ }).hasAttribute('disabled')).toBe(true);
    await click(screen.getByRole('button', { name: /التالي/ }));
    expect(screen.getByText('صفحة 2 من 2')).toBeTruthy();
    expect(within(table()).getAllByRole('row')).toHaveLength(6); // header + 5
    expect(screen.getByRole('button', { name: /التالي/ }).hasAttribute('disabled')).toBe(true);
    await userEvent.type(screen.getByLabelText('البحث في المخزون'), 'p01');
    expect(screen.getByText('صفحة 1 من 1')).toBeTruthy();
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
  });

  it('shows an empty state when nothing matches', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 5));
    await userEvent.type(screen.getByLabelText('البحث في المخزون'), 'zzzz');
    expect(screen.getByText(/لا توجد منتجات تطابق/)).toBeTruthy();
  });

  it('renders a card list for narrow screens alongside the table (both carry the data and the actions)', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 8, 2));
    const cards = screen.getAllByRole('listitem').find((li) => /منتج p1/.test(li.textContent ?? ''))!;
    expect(within(cards).getByText('SKU-P1')).toBeTruthy();
    expect(within(cards).getByRole('button', { name: 'وارد' })).toBeTruthy();
    expect(within(cards).getByRole('link', { name: 'الحركات' })).toBeTruthy();
  });
});

// ===========================================================================
describe('inventory actions — every change goes through the RPCs', () => {
  const setup = async (b: Backend, extra?: (b: Backend) => void) =>
    ready(b, [product('p1', { price: 1000 }), product('p2')], (x) => {
      lvl(x, 'p1', 10, 3);
      extra?.(x);
    });
  const submit = (d: HTMLElement, name: RegExp | string) => userEvent.click(within(d).getByRole('button', { name }));

  it('initializes an opening balance (zero is allowed) and shows the database result', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p2', 'تهيئة الرصيد'));
    const d = dialog('تهيئة الرصيد الافتتاحي');
    await userEvent.type(within(d).getByLabelText(/الرصيد الافتتاحي/), '0');
    await submit(d, 'تهيئة الرصيد');
    expect(await screen.findByText(/تمت تهيئة الرصيد الافتتاحي \(0\)/)).toBeTruthy();
    expect(rpcCalls(b, 'inventory_set_opening')[0].args).toEqual({ p_product_id: 'p2', p_quantity: 0, p_reason: 'رصيد افتتاحي' });
    await waitFor(() => expect(onHandOf('p2')).toBe('0'));
    expect(within(rowFor('منتج p2')).getByText('نفد')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never overwrites: if the balance already exists the page says so and shows the unchanged value', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p2', 'تهيئة الرصيد'));
    // someone else initializes it while the dialog is open
    lvl(b, 'p2', 6);
    const d = dialog('تهيئة الرصيد الافتتاحي');
    await userEvent.type(within(d).getByLabelText(/الرصيد الافتتاحي/), '99');
    await submit(d, 'تهيئة الرصيد');
    expect(await screen.findByText(/الرصيد مُهيَّأ مسبقًا ويساوي 6 — لم يتغيّر \(المطلوب 99\)/)).toBeTruthy();
    await waitFor(() => expect(onHandOf('p2')).toBe('6'));
  });

  it('adjusts to the counted quantity with a required reason and a live preview', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    const qty = within(d).getByLabelText(/الكمية المعدودة فعليًا/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '7');
    expect(within(d).getByText(/الرصيد 10 ← 7 \(الفرق -3\)/)).toBeTruthy();
    await submit(d, 'حفظ التعديل');
    expect(within(d).getByRole('alert').textContent).toContain('اكتب سببًا');
    expect(rpcCalls(b, 'inventory_adjust')).toHaveLength(0); // refused client-side, nothing sent
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    await submit(d, 'حفظ التعديل');
    expect(await screen.findByText(/تم تعديل الرصيد من 10 إلى 7 \(-3\)/)).toBeTruthy();
    await waitFor(() => expect(onHandOf('p1')).toBe('7'));
    const sent = rpcCalls(b, 'inventory_adjust')[0].args;
    expect(sent).toMatchObject({ p_product_id: 'p1', p_counted: 7, p_reason: 'جرد فعلي' });
    expect(sent.p_idempotency_key).toMatch(/^[A-Za-z0-9._-]{1,128}$/); // the format the database accepts
  });

  it('an unchanged count is reported as unchanged, not as a saved change', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    await submit(d, 'حفظ التعديل'); // the field already holds 10
    expect(await screen.findByText(/لا تغيير — الكمية المعدودة تساوي الرصيد الحالي \(10\)/)).toBeTruthy();
    expect(b.tables.stock_movements).toHaveLength(0);
  });

  it('rejects negative, fractional and empty quantities before sending anything', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    for (const bad of ['-1', '2.5', '', 'abc']) {
      const qty = within(d).getByLabelText(/الكمية المعدودة فعليًا/);
      await userEvent.clear(qty);
      if (bad) await userEvent.type(qty, bad);
      await submit(d, 'حفظ التعديل');
      expect(within(d).getByRole('alert').textContent).toContain('أدخل كمية صحيحة');
    }
    expect(rpcCalls(b, 'inventory_adjust')).toHaveLength(0);
  });

  it('records incoming stock with an optional reference', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'وارد'));
    const d = dialog('تسجيل وارد');
    await userEvent.type(within(d).getByLabelText(/الكمية الواردة/), '25');
    await userEvent.type(within(d).getByLabelText(/المرجع/), 'فاتورة 114');
    expect(within(d).getByText(/الرصيد 10 ← 35/)).toBeTruthy();
    await submit(d, 'تسجيل الوارد');
    expect(await screen.findByText(/تم تسجيل وارد \+25 — الرصيد 35/)).toBeTruthy();
    await waitFor(() => expect(onHandOf('p1')).toBe('35'));
    expect(rpcCalls(b, 'inventory_receive')[0].args).toMatchObject({ p_quantity: 25, p_reference: 'فاتورة 114', p_reason: 'استلام مخزون' });
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'receipt', reference: 'فاتورة 114' });
  });

  it('sets the minimum threshold, which immediately drives the low-stock status', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'الحد الأدنى'));
    const d = dialog('الحد الأدنى للمخزون');
    const qty = within(d).getByLabelText(/الحد الأدنى للتنبيه/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '12');
    await submit(d, 'حفظ الحد الأدنى');
    expect(await screen.findByText(/تم ضبط الحد الأدنى على 12/)).toBeTruthy();
    await waitFor(() => expect(within(rowFor('منتج p1')).getByText('منخفض')).toBeTruthy());
    expect(rpcCalls(b, 'inventory_set_threshold')[0].args).toEqual({ p_product_id: 'p1', p_threshold: 12 });
    expect(b.tables.stock_movements).toHaveLength(0); // a threshold is not a stock movement
  });

  it('makes the admin CHOOSE between a resaleable and a damaged return (no default)', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'مرتجع'));
    const d = dialog('تسجيل مرتجع');
    const yes = within(d).getByRole('radio', { name: /صالح لإعادة البيع/ }) as HTMLInputElement;
    const no = within(d).getByRole('radio', { name: /تالف/ }) as HTMLInputElement;
    expect(yes.checked).toBe(false);
    expect(no.checked).toBe(false);
    await userEvent.type(within(d).getByLabelText(/كمية المرتجع/), '2');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'مرتجع عميل');
    await submit(d, 'تسجيل المرتجع');
    expect(within(d).getByRole('alert').textContent).toContain('اختر هل المرتجع صالح لإعادة البيع أم تالف');
    expect(rpcCalls(b, 'inventory_record_return')).toHaveLength(0);
  });

  it('a RESALEABLE return adds to the balance', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'مرتجع'));
    const d = dialog('تسجيل مرتجع');
    await click(within(d).getByRole('radio', { name: /صالح لإعادة البيع/ }));
    await userEvent.type(within(d).getByLabelText(/كمية المرتجع/), '2');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'مرتجع عميل');
    expect(within(d).getByText(/مرتجع سليم: الرصيد 10 ← 12/)).toBeTruthy();
    await submit(d, 'تسجيل المرتجع');
    expect(await screen.findByText(/تم تسجيل مرتجع سليم \+2 — الرصيد 12/)).toBeTruthy();
    await waitFor(() => expect(onHandOf('p1')).toBe('12'));
    expect(rpcCalls(b, 'inventory_record_return')[0].args).toMatchObject({ p_resellable: true, p_quantity: 2, p_order_id: null });
  });

  it('a DAMAGED return does NOT change the balance but is still recorded in the ledger', async () => {
    const b = await freshBackend('admin');
    await setup(b);
    await click(inRow('منتج p1', 'مرتجع'));
    const d = dialog('تسجيل مرتجع');
    await click(within(d).getByRole('radio', { name: /تالف/ }));
    await userEvent.type(within(d).getByLabelText(/كمية المرتجع/), '3');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'تالف أثناء الشحن');
    expect(within(d).getByText(/لن يتغيّر الرصيد \(10\)/)).toBeTruthy();
    await submit(d, 'تسجيل المرتجع');
    expect(await screen.findByText(/تم تسجيل مرتجع تالف \(3\) — لم يتغيّر الرصيد \(10\)/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onHandOf('p1')).toBe('10');
    expect(rpcCalls(b, 'inventory_record_return')[0].args).toMatchObject({ p_resellable: false });
    expect(b.tables.stock_movements[0]).toMatchObject({ kind: 'return_damaged', quantity: 3, qty_delta: 0, qty_before: 10, qty_after: 10 });
  });

  it('offers only the orders that contain the product for the optional link, and the cap is enforced with a clear message', async () => {
    const b = await freshBackend('admin');
    b.tables.orders.push(
      order('o-1', 'TYB-A', [{ productId: 'p1', qty: 2, price: 1 }]),
      order('o-2', 'TYB-B', [{ productId: 'p2', qty: 1, price: 1 }]),
    );
    await setup(b);
    await click(inRow('منتج p1', 'مرتجع'));
    const d = dialog('تسجيل مرتجع');
    const select = within(d).getByLabelText(/الطلب/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['بدون ربط بطلب', 'TYB-A — تم التسليم (2)']);
    await userEvent.selectOptions(select, 'o-1');
    await click(within(d).getByRole('radio', { name: /صالح لإعادة البيع/ }));
    await userEvent.type(within(d).getByLabelText(/كمية المرتجع/), '3');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'مرتجع عميل');
    await submit(d, 'تسجيل المرتجع');
    expect((await within(d).findByRole('alert')).textContent).toContain('كمية المرتجع تتجاوز الكمية المباعة');
    expect(onHandOf('p1')).toBe('10');
    expect(b.tables.stock_movements).toHaveLength(0);
    // within the cap it succeeds and links the order
    const qty = within(d).getByLabelText(/كمية المرتجع/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '2');
    await submit(d, 'تسجيل المرتجع');
    await waitFor(() => expect(onHandOf('p1')).toBe('12'));
    expect(b.tables.stock_movements[0]).toMatchObject({ order_id: 'o-1', kind: 'return_restock' });
  });
});

// ===========================================================================
describe('inventory actions — failures never look like success', () => {
  it('a rejected request shows the database reason, keeps the dialog and every typed value, and records nothing', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'وارد'));
    const d = dialog('تسجيل وارد');
    await userEvent.type(within(d).getByLabelText(/الكمية الواردة/), '5');
    b.failNext('rpc:inventory_receive', { code: '22023', message: 'inventory_invalid', details: 'resulting quantity is out of range' });
    await userEvent.click(within(d).getByRole('button', { name: 'تسجيل الوارد' }));
    expect((await within(d).findByRole('alert')).textContent).toContain('الكمية الناتجة خارج الحد المسموح');
    expect((within(d).getByLabelText(/الكمية الواردة/) as HTMLInputElement).value).toBe('5');
    expect(screen.queryByText(/تم تسجيل وارد/)).toBeNull();
    expect(onHandOf('p1')).toBe('10');
    expect((within(d).getByRole('button', { name: 'تسجيل الوارد' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a network failure is reported as such and nothing is claimed', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    const qty = within(d).getByLabelText(/الكمية المعدودة فعليًا/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '4');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    b.failNext('rpc:inventory_adjust', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(within(d).getByRole('button', { name: 'حفظ التعديل' }));
    expect((await within(d).findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(screen.queryByText(/تم تعديل الرصيد/)).toBeNull();
    expect(b.tables.stock_movements).toHaveLength(0);
  });

  it('LOST RESPONSE: the retry of the identical request reuses its idempotency key, is reported as already recorded, and writes once', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    const qty = within(d).getByLabelText(/الكمية المعدودة فعليًا/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '7');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    b.loseResponseNext('rpc:inventory_adjust'); // the server applies it; the answer never arrives
    await userEvent.click(within(d).getByRole('button', { name: 'حفظ التعديل' }));
    expect((await within(d).findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(b.tables.stock_movements).toHaveLength(1); // it did go through
    await userEvent.click(within(d).getByRole('button', { name: 'حفظ التعديل' })); // plain retry
    expect(await screen.findByText(/سُجِّلت هذه العملية سابقًا ولم تُكرَّر \(الرصيد 7\)/)).toBeTruthy();
    const calls = rpcCalls(b, 'inventory_adjust');
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_idempotency_key).toBe(calls[1].args.p_idempotency_key);
    expect(b.tables.stock_movements).toHaveLength(1);
    await waitFor(() => expect(onHandOf('p1')).toBe('7'));
  });

  it('a CHANGED request after a failure gets a NEW idempotency key', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'تعديل الكمية'));
    const d = dialog('تعديل الكمية');
    const qty = within(d).getByLabelText(/الكمية المعدودة فعليًا/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '7');
    await userEvent.type(within(d).getByLabelText(/السبب/), 'جرد فعلي');
    b.failNext('rpc:inventory_adjust', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(within(d).getByRole('button', { name: 'حفظ التعديل' }));
    await within(d).findByRole('alert');
    await userEvent.clear(qty);
    await userEvent.type(qty, '6');
    await userEvent.click(within(d).getByRole('button', { name: 'حفظ التعديل' }));
    await screen.findByText(/تم تعديل الرصيد من 10 إلى 6/);
    const calls = rpcCalls(b, 'inventory_adjust');
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_idempotency_key).not.toBe(calls[1].args.p_idempotency_key);
  });

  it('a double click sends one request', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'وارد'));
    const d = dialog('تسجيل وارد');
    await userEvent.type(within(d).getByLabelText(/الكمية الواردة/), '5');
    const gate = b.hold('rpc:inventory_receive');
    await userEvent.click(within(d).getByRole('button', { name: 'تسجيل الوارد' }));
    await waitFor(() => expect(within(d).getByRole('button', { name: /جارٍ الحفظ/ }).hasAttribute('disabled')).toBe(true));
    fireEvent.submit(d);
    fireEvent.submit(d);
    gate.release();
    await screen.findByText(/تم تسجيل وارد \+5/);
    expect(rpcCalls(b, 'inventory_receive')).toHaveLength(1);
    expect(b.tables.stock_movements).toHaveLength(1);
  });

  it('a non-confirming answer from the database is never reported as saved', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p1', 'وارد'));
    const d = dialog('تسجيل وارد');
    await userEvent.type(within(d).getByLabelText(/الكمية الواردة/), '5');
    b.respondNext('rpc:inventory_receive', { surprise: true });
    await userEvent.click(within(d).getByRole('button', { name: 'تسجيل الوارد' }));
    expect((await within(d).findByRole('alert')).textContent).toContain('تعذّر التحقق من الحفظ');
    expect(screen.queryByText(/تم تسجيل وارد/)).toBeNull();
  });

  it('writes ONLY through the approved RPCs — never directly to an inventory table', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1'), product('p2')], (x) => lvl(x, 'p1', 10));
    await click(inRow('منتج p2', 'تهيئة الرصيد'));
    let d = dialog('تهيئة الرصيد الافتتاحي');
    await userEvent.type(within(d).getByLabelText(/الرصيد الافتتاحي/), '4');
    await userEvent.click(within(d).getByRole('button', { name: 'تهيئة الرصيد' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await click(inRow('منتج p1', 'وارد'));
    d = dialog('تسجيل وارد');
    await userEvent.type(within(d).getByLabelText(/الكمية الواردة/), '1');
    await userEvent.click(within(d).getByRole('button', { name: 'تسجيل الوارد' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(directWrites(b)).toEqual([]);
    expect(new Set(rpcCalls(b).map((c) => c.name))).toEqual(new Set(['is_admin', 'inventory_set_opening', 'inventory_receive']));
  });

  it('the database refuses a direct client write to the inventory tables (defence behind the UI)', async () => {
    const b = await freshBackend('admin');
    const { supabase } = await import('../../../lib/supabase/client');
    const r = await supabase.from('stock_levels').insert({ product_id: 'x', on_hand: 999 });
    expect(r.error).toMatchObject({ code: '42501' });
    expect(b.tables.stock_levels).toHaveLength(0);
  });
});

// ===========================================================================
describe('inventory page — access and environment', () => {
  it('a signed-in NON-admin sees a refusal, no quantities, and triggers no stock or wholesale request', async () => {
    const b = await freshBackend('user');
    seedCatalog(b, [product('p1')]);
    lvl(b, 'p1', 10);
    b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 123456 });
    await mount(b);
    expect((await screen.findByText(/ليست لديك صلاحية عرض المخزون/)).textContent).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).not.toContain('123');
    expect(b.calls('from:stock_levels:select')).toBe(0);
    expect(b.calls('from:product_internal_pricing:select')).toBe(0);
  });

  it('explains that migration 0009 is missing and shows no numbers or actions (not an empty inventory)', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    delete (b.tables as Record<string, unknown>).stock_levels;
    delete (b.tables as Record<string, unknown>).stock_movements;
    await mount(b);
    const alert = await screen.findByText(/جداول المخزون غير موجودة في قاعدة البيانات/);
    expect(alert.textContent).toContain('0009_inventory.sql');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'تهيئة الرصيد' })).toBeNull();
  });

  it('a failed load is an error with a retry — never an empty inventory', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    lvl(b, 'p1', 10);
    b.failNext('from:stock_levels:select', new TypeError('Failed to fetch'), { reject: true });
    await mount(b);
    expect((await screen.findByText(/تعذّر تحميل المخزون/)).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(screen.queryByRole('table')).toBeNull();
    await click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await screen.findByRole('table');
    expect(onHandOf('p1')).toBe('10');
  });

  it('while the catalog is NOT migrated it explains why and disables every stock action', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1'), product('p2')]);
    b.setInitialized(false);
    lvl(b, 'p1', 10);
    await mount(b);
    await screen.findByRole('table');
    expect(screen.getByText(/الكتالوج لم يُرحَّل إلى قاعدة البيانات بعد/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'فتح النسخ الاحتياطي والترحيل' })).toBeTruthy();
    for (const btn of within(table()).getAllByRole('button').filter((x) => /تعديل|وارد|مرتجع|الحد الأدنى|تهيئة/.test(x.textContent ?? ''))) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('links each product to its movement history', async () => {
    const b = await freshBackend('admin');
    await ready(b, [product('p1')], (x) => lvl(x, 'p1', 10));
    const link = within(rowFor('منتج p1')).getByRole('link', { name: 'حركات منتج p1' });
    expect(link.getAttribute('href')).toBe('/admin/inventory/movements?product=p1');
  });
});
