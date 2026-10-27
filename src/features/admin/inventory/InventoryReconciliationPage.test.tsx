// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';
import { parseOpeningCsv } from './inventoryReconciliation';

// The reconciliation page against the FAKE backend (client.mock.ts). The real SQL
// (blockers, decisions bound to lines_hash, dry-run import) is verified against Postgres
// in supabase/tests/inventory*.test.ts. Nothing here may invent a quantity or a decision.

afterEach(cleanup);

type Row = Record<string, unknown>;

const preflightRow = (over: Row = {}): Row => ({
  order_id: 'o1',
  ref: 'TB-0001',
  status: 'processing',
  source: 'online',
  order_created_at: '2026-01-01T00:00:00Z',
  classification: 'in_flight',
  issues: [],
  lines_hash: 'h1',
  needs_decision: true,
  decision: null,
  decision_matches_lines: null,
  decision_status_changed: null,
  product_id: 'p1',
  product_name: 'منتج p1',
  qty: 2,
  product_in_catalog: true,
  stock_initialized: false,
  ...over,
});

async function mount(b: Backend) {
  void b;
  const { InventoryReconciliationPage } = await import('./InventoryReconciliationPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter>
      <InventoryReconciliationPage />
    </MemoryRouter>,
  );
}

describe('parseOpeningCsv', () => {
  it('reads product_id,quantity lines, skips header / comments / blanks', () => {
    expect(parseOpeningCsv('product_id,quantity\n# c\n\na,5\nb,0,جرد\r\n')).toEqual({
      rows: [
        { product_id: 'a', quantity: 5 },
        { product_id: 'b', quantity: 0, reason: 'جرد' },
      ],
      errors: [],
    });
  });
  it('NEVER reads an empty / missing / non-integer quantity as zero', () => {
    const r = parseOpeningCsv('a,\nb\nc,x\nd,-1\ne,1.5\n,3');
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(6);
  });
});

describe('InventoryReconciliationPage', () => {
  it('shows the blockers and the orders that need an explicit decision', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    b.reconBlockers.push({ code: 'NO_OPENING', category: 'coverage', order_id: null, product_id: 'p1', detail: 'لا رصيد افتتاحي' });
    b.reconRows.push(preflightRow({ issues: ['NO_HISTORY'] }));
    await mount(b);
    expect(await screen.findByText(/عائقًا يمنع تطبيق الترحيل 0010/)).toBeTruthy();
    expect(screen.getByText('NO_OPENING')).toBeTruthy();
    expect(screen.getByText('TB-0001')).toBeTruthy();
    expect(screen.getByText(/لا سجل حالات/)).toBeTruthy();
    // no decision is preselected
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLInputElement).checked).toBe(false);
  });

  it('says there are no blockers only when the database returns none (and still leaves activation to the admin)', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    expect(await screen.findByText(/لا توجد عوائق/)).toBeTruthy();
    expect(screen.getByText(/التفعيل نفسه ما زال قرارك/)).toBeTruthy();
    expect(screen.getByText('لا توجد طلبات تحتاج قرارًا.')).toBeTruthy();
  });

  it('records a decision only with an explicit choice and a reason, bound to the shown lines_hash', async () => {
    const b = await freshBackend('admin');
    b.reconRows.push(preflightRow());
    await mount(b);
    await screen.findByText('TB-0001');
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'تسجيل القرار' }));
    expect(screen.getByText('اختر القرار أولًا.')).toBeTruthy();
    expect(b.rpcLog.filter((c) => c.name === 'inventory_decide_order')).toHaveLength(0);

    await u.click(screen.getAllByRole('radio')[0]);
    await u.click(screen.getByRole('button', { name: 'تسجيل القرار' }));
    expect(screen.getByText('اكتب سببًا من 5 أحرف على الأقل.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('سبب قرار الطلب TB-0001'), { target: { value: 'محسوب في الجرد' } });
    await u.click(screen.getByRole('button', { name: 'تسجيل القرار' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/سُجِّل القرار/));
    const calls = b.rpcLog.filter((c) => c.name === 'inventory_decide_order');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_order_id: 'o1', p_decision: 'deduct_on_delivery', p_lines_hash: 'h1' });
  });

  it('a delivered order offers only the no-deduction decision', async () => {
    const b = await freshBackend('admin');
    b.reconRows.push(preflightRow({ status: 'delivered', classification: 'ambiguous' }));
    await mount(b);
    await screen.findByText('TB-0001');
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].disabled).toBe(true);
    expect(radios[1].disabled).toBe(false);
  });

  it('shows a clear Arabic message when the lines changed since they were shown, and keeps the form', async () => {
    const b = await freshBackend('admin');
    b.reconRows.push(preflightRow());
    await mount(b);
    await screen.findByText('TB-0001');
    b.reconRows[0].lines_hash = 'h2'; // the order changed behind the admin's back
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('radio')[1]);
    fireEvent.change(screen.getByLabelText('سبب قرار الطلب TB-0001'), { target: { value: 'خرجت قبل الجرد' } });
    await u.click(screen.getByRole('button', { name: 'تسجيل القرار' }));
    expect(await screen.findByText(/تغيّرت أسطر الطلب/)).toBeTruthy();
    expect((screen.getByLabelText('سبب قرار الطلب TB-0001') as HTMLInputElement).value).toBe('خرجت قبل الجرد');
  });

  describe('opening-balance import', () => {
    it('dry run writes nothing; the real run is offered only for the exact text that passed it', async () => {
      const b = await freshBackend('admin');
      seedCatalog(b, [product('p1'), product('p2')]);
      await mount(b);
      await screen.findByText(/لا توجد عوائق/);
      const u = userEvent.setup();
      const box = screen.getByLabelText('الأرصدة الافتتاحية');
      const real = screen.getByRole('button', { name: 'تنفيذ الاستيراد' }) as HTMLButtonElement;
      expect(real.disabled).toBe(true); // never before a dry run

      fireEvent.change(box, { target: { value: 'p1,12\np2,0' } });
      await u.click(screen.getByRole('button', { name: 'فحص تجريبي' }));
      await screen.findByText(/لم يُكتب شيء/);
      expect(b.tables.stock_levels).toHaveLength(0);
      expect(real.disabled).toBe(false);

      fireEvent.change(box, { target: { value: 'p1,13\np2,0' } }); // edited after the dry run
      expect(real.disabled).toBe(true);

      fireEvent.change(box, { target: { value: 'p1,12\np2,0' } });
      await u.click(screen.getByRole('button', { name: 'فحص تجريبي' }));
      await waitFor(() => expect(real.disabled).toBe(false));
      await u.click(real);
      await waitFor(() => expect(b.tables.stock_levels).toHaveLength(2));
      expect(b.tables.stock_levels.map((l) => [l.product_id, l.on_hand]).sort()).toEqual([
        ['p1', 12],
        ['p2', 0], // an explicit zero is a real opening balance
      ]);
    });

    it('a blank quantity is an error, not zero, and is never sent', async () => {
      const b = await freshBackend('admin');
      seedCatalog(b, [product('p1')]);
      await mount(b);
      await screen.findByText(/لا توجد عوائق/);
      fireEvent.change(screen.getByLabelText('الأرصدة الافتتاحية'), { target: { value: 'p1,' } });
      expect(screen.getByText(/ليست عددًا صحيحًا/)).toBeTruthy();
      await userEvent.setup().click(screen.getByRole('button', { name: 'فحص تجريبي' }));
      expect(b.rpcLog.filter((c) => c.name === 'inventory_import_opening')).toHaveLength(0);
    });

    it('reports rejected rows and products left out (never filled with zero)', async () => {
      const b = await freshBackend('admin');
      seedCatalog(b, [product('p1'), product('p2')]);
      await mount(b);
      await screen.findByText(/لا توجد عوائق/);
      fireEvent.change(screen.getByLabelText('الأرصدة الافتتاحية'), { target: { value: 'p1,5\nghost,3' } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'فحص تجريبي' }));
      const list = await screen.findByText('منتج غير موجود في الكتالوج');
      expect(list).toBeTruthy();
      expect(screen.getByText(/1 منتجًا في الكتالوج بلا رصيد/)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'تنفيذ الاستيراد' }) as HTMLButtonElement).disabled).toBe(true);
      expect(b.tables.stock_levels).toHaveLength(0);
    });
  });

  it('a non-admin sees the permission message and no data', async () => {
    const b = await freshBackend('user');
    b.reconRows.push(preflightRow());
    await mount(b);
    expect(await screen.findByText(/ليست لديك صلاحية/)).toBeTruthy();
    expect(screen.queryByText('TB-0001')).toBeNull();
    expect(within(document.body).queryAllByRole('radio')).toHaveLength(0);
  });
});
