import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// SIMPLE STOCK (migration 0009) on a real Postgres engine (PGlite): reservation,
// the last-piece refusal, delivery / in-store deduction and who may see numbers.

let db: PGlite;
let n = 0;

const line = (qty: number, variantId: string | null = null, productId = 'p1') => ({
  productId,
  slug: productId,
  name: { ar: 'منتج', en: 'Product' },
  color: null,
  size: null,
  qty,
  price: 1000,
  image: '',
  variantId,
});

async function order(id: string, lines: unknown[], over: { status?: string; source?: string } = {}) {
  const source = over.source ?? 'online';
  const total = (lines as { qty: number }[]).reduce((s, l) => s + l.qty * 1000, 0);
  n += 1;
  await db.query(
    `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
     values ($1,$2,$3,$4,'{"name":"x","phone":"0100","email":""}','{}',$5,$6,$7,$7)`,
    [
      id,
      `TYB-${n}`,
      over.status ?? (source === 'online' ? 'pending' : 'sold'),
      source,
      JSON.stringify({ method: source === 'online' ? 'delivery' : 'in_store' }),
      JSON.stringify(lines),
      total,
    ],
  );
}

const O = (i: number) => `00000000-0000-0000-0000-00000000010${i}`;

const qtyOf = async () =>
  (await db.query<{ qty: number }>(`select qty from public.stock where product_id='p1' and variant_id=''`)).rows[0].qty;
const stateOf = async () =>
  (await db.query<{ state: string }>(`select state from public.stock_availability() where product_id='p1'`)).rows[0]
    ?.state;
const setStatus = (id: string, status: string) =>
  db.query(`update public.orders set status=$2 where id=$1`, [id, status]);
const track = (variant: string, qty: number, threshold: number) =>
  db.query(`insert into public.stock(product_id, variant_id, qty, low_threshold) values ('p1',$1,$2,$3)`, [
    variant,
    qty,
    threshold,
  ]);
const insertOnlineFails = (id: string, lines: unknown[]) =>
  fails(
    db,
    `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
     values ($1,'TYB-X','pending','online','{}','{}','{}',$2,1000,1000)`,
    [id, JSON.stringify(lines)],
  );

beforeAll(async () => {
  db = await baseDb();
  for (const f of [
    '0001_orders.sql',
    '0005_order_email_outbox.sql',
    '0006_catalog_documents.sql',
    '0007_product_internal_pricing.sql',
    '0008_in_store_orders.sql',
    '0009_simple_stock.sql',
  ]) {
    await db.exec(migrationSql(f));
  }
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await begin(db);
  await as(db, 'postgres');
  await db.query(
    `insert into public.catalog_docs(kind, id, slug, visible, data) values ('product','p1','p1',true,$1)`,
    [JSON.stringify({ id: 'p1', price: 1000, availability: 'in_stock' })],
  );
});

afterEach(async () => {
  await rollback(db);
});

describe('online orders reserve, delivery deducts', () => {
  it('an untracked product is never limited', async () => {
    await order(O(1), [line(500)]);
    expect((await db.query(`select 1 from public.stock_availability()`)).rows).toHaveLength(0);
  });

  it('reserves on order, refuses the last piece twice, deducts only on delivery', async () => {
    await track('', 3, 1);
    expect(await stateOf()).toBe('in_stock');

    await order(O(1), [line(2)]);
    expect(await qtyOf()).toBe(3); // physical count untouched
    expect(await stateOf()).toBe('low_stock'); // 3 - 2 reserved = 1

    expect((await insertOnlineFails(O(2), [line(2)])).code).toBe('IS002');

    await order(O(3), [line(1)]);
    expect(await stateOf()).toBe('out_of_stock');

    await setStatus(O(1), 'delivered');
    expect(await qtyOf()).toBe(1);
    await setStatus(O(1), 'cancelled'); // leaving delivered puts the pieces back
    expect(await qtyOf()).toBe(3);
  });

  it('cancelling a pending order releases its reservation without touching qty', async () => {
    await track('', 2, 0);
    await order(O(1), [line(2)]);
    expect(await stateOf()).toBe('out_of_stock');
    await setStatus(O(1), 'cancelled');
    expect(await stateOf()).toBe('in_stock');
    expect(await qtyOf()).toBe(2);
  });

  it('retrying an order that already exists reaches the primary-key check, not the stock check', async () => {
    await track('', 2, 0);
    await order(O(1), [line(2)]);
    expect((await insertOnlineFails(O(1), [line(2)])).code).toBe('23505');
  });
});

describe('in-store sales and variants', () => {
  it('an in-store sale deducts at once, is never blocked, and cancelling restores', async () => {
    await track('', 1, 0);
    await order(O(1), [line(2)], { source: 'in_store' });
    expect(await qtyOf()).toBe(-1); // allowed; the admin page flags it for a recount
    await setStatus(O(1), 'cancelled');
    expect(await qtyOf()).toBe(1);
  });

  it('tracks variants separately from the product row', async () => {
    await track('v1', 1, 0);
    await order(O(1), [line(1, 'v1')]);
    const r = await db.query<{ variant_id: string; state: string }>(
      `select variant_id, state from public.stock_availability()`,
    );
    expect(r.rows).toEqual([{ variant_id: 'v1', state: 'out_of_stock' }]);
    expect((await insertOnlineFails(O(2), [line(1, 'v1')])).code).toBe('IS002');
  });
});

describe('who can see and change numbers', () => {
  it('anonymous visitors get states only and cannot touch the table or the admin functions', async () => {
    await track('', 5, 1);
    await as(db, 'anon');
    expect((await db.query(`select * from public.stock_availability()`)).rows).toEqual([
      { product_id: 'p1', variant_id: '', state: 'in_stock' },
    ]);
    expect((await fails(db, `select * from public.stock`)).code).toBe('42501');
    expect((await fails(db, `select * from public.stock_overview()`)).code).toBe('42501');
    expect((await fails(db, `select public.stock_set('p1','',99,1)`)).code).toBe('42501');
  });

  it('an admin sets, reads and untracks', async () => {
    await as(db, 'authenticated', ADMIN);
    await db.query(`select public.stock_set('p1','',7,2)`);
    expect((await db.query(`select qty, low_threshold, reserved from public.stock_overview()`)).rows).toEqual([
      { qty: 7, low_threshold: 2, reserved: 0 },
    ]);
    expect((await fails(db, `select public.stock_set('p1','',-1,2)`)).code).toBe('22023');
    await db.query(`select public.stock_untrack('p1','')`);
    expect((await db.query(`select * from public.stock_overview()`)).rows).toHaveLength(0);
  });
});
