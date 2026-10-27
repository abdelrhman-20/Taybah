import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// IN-STORE ORDERS (migration 0008) on a REAL Postgres engine (PGlite): source
// column, 'sold' status, who may insert, server-side price/total validation,
// immutability, and "no customer e-mail" — executed from the actual migration
// files. NOT covered: PostgREST's HTTP layer (API key -> role mapping), which
// this harness approximates with `set role`.

const O1 = '11111111-1111-1111-1111-111111111111';
const O2 = '22222222-2222-2222-2222-222222222222';
const WHOLESALE = 777.25;

let db: PGlite;

const line = (over: Record<string, unknown> = {}) => ({
  productId: 'p1',
  slug: 'p1',
  name: { ar: 'منتج', en: 'Product' },
  color: null,
  size: null,
  qty: 2,
  price: 1000,
  image: '',
  variantId: null,
  ...over,
});

interface Over {
  id?: string;
  ref?: string;
  status?: string;
  source?: string;
  contact?: unknown;
  delivery?: unknown;
  lines?: unknown[];
  subtotal?: number;
  total?: number;
  note?: string | null;
}

// Inserts a fully-specified order; defaults describe a valid in-store sale.
const insert = (o: Over = {}) => {
  const lines = o.lines ?? [line()];
  return db.query(
    `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total, note)
     values ($1,$2,$3,$4,$5,'{}',$6,$7,$8,$9,$10)`,
    [
      o.id ?? O1,
      o.ref ?? 'TYB-S1',
      o.status ?? 'sold',
      o.source ?? 'in_store',
      JSON.stringify(o.contact ?? { name: 'زبون', phone: '0100', email: '' }),
      JSON.stringify(o.delivery ?? { method: 'in_store' }),
      JSON.stringify(lines),
      o.subtotal ?? 2000,
      o.total ?? 2000,
      o.note ?? null,
    ],
  );
};

const insertFails = (o: Over = {}) => {
  const lines = o.lines ?? [line()];
  return fails(
    db,
    `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total, note)
     values ($1,$2,$3,$4,$5,'{}',$6,$7,$8,$9,$10)`,
    [
      o.id ?? O1,
      o.ref ?? 'TYB-S1',
      o.status ?? 'sold',
      o.source ?? 'in_store',
      JSON.stringify(o.contact ?? { name: 'زبون', phone: '0100', email: '' }),
      JSON.stringify(o.delivery ?? { method: 'in_store' }),
      JSON.stringify(lines),
      o.subtotal ?? 2000,
      o.total ?? 2000,
      o.note ?? null,
    ],
  );
};

const count = async (sql: string) =>
  (await db.query<{ c: number }>(`select count(*)::int c from (${sql}) t`)).rows[0].c;

beforeAll(async () => {
  db = await baseDb();
  await db.exec(migrationSql('0001_orders.sql'));
  await db.exec(migrationSql('0005_order_email_outbox.sql'));
  await db.exec(migrationSql('0006_catalog_documents.sql'));
  await db.exec(migrationSql('0007_product_internal_pricing.sql'));
  await db.exec(migrationSql('0008_in_store_orders.sql'));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await begin(db);
  await as(db, 'postgres');
  // p1: simple product at 1000. p2: variant product, v1 inherits 1500, v2 overrides to 1800.
  await db.query(
    `insert into public.catalog_docs(kind, id, slug, visible, data) values
       ('product','p1','p1',true,$1),
       ('product','p2','p2',false,$2)`,
    [
      JSON.stringify({ id: 'p1', price: 1000, availability: 'out_of_stock' }),
      JSON.stringify({
        id: 'p2',
        price: 1500,
        variants: [
          { id: 'v1', price: null },
          { id: 'v2', price: 1800 },
        ],
      }),
    ],
  );
  await db.query(`insert into public.product_internal_pricing(product_id, wholesale_price) values ('p1', $1)`, [WHOLESALE]);
  await as(db, 'authenticated', ADMIN);
});
afterEach(async () => {
  await rollback(db);
});

describe('0008 — schema and existing data', () => {
  it('existing (online) orders keep working: the column defaults to online and note to null', async () => {
    await as(db, 'postgres');
    await db.query(
      `insert into public.orders(id, ref, contact, address, delivery, lines, subtotal, total)
       values ($1,'OLD','{}','{}','{}','[]',1,1)`,
      [O1],
    );
    const r = (await db.query<{ source: string; status: string; note: string | null }>('select source, status, note from public.orders')).rows[0];
    expect(r).toEqual({ source: 'online', status: 'pending', note: null });
  });

  it('every pre-existing status is still accepted for online orders', async () => {
    await as(db, 'postgres');
    for (const [i, s] of ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].entries()) {
      await insert({ id: `0000000${i}-0000-0000-0000-000000000000`, ref: `R${i}`, source: 'online', status: s, delivery: { method: 'standard' }, lines: [], subtotal: 1, total: 1 });
    }
    expect(await count('select 1 from public.orders')).toBe(6);
  });

  it('source and status are tied together: sold is in-store only, in-store is sold/cancelled only', async () => {
    await as(db, 'postgres');
    const sold = await insertFails({ source: 'online', status: 'sold', delivery: { method: 'standard' } });
    expect(sold.message).toMatch(/orders_source_status_check/);
    for (const s of ['pending', 'confirmed', 'processing', 'shipped', 'delivered']) {
      const e = await insertFails({ source: 'in_store', status: s });
      expect(e.message).toMatch(/orders_source_status_check/);
    }
    const unknown = await insertFails({ source: 'kiosk' });
    expect(unknown.message).toMatch(/orders_source_check/);
  });
});

describe('0008 — who can create an in-store order', () => {
  it('an admin can, and it is persisted with source=in_store, status=sold and the note', async () => {
    await insert({ note: 'دفع نقدًا' });
    await as(db, 'postgres');
    const r = (await db.query<{ source: string; status: string; note: string; total: string }>('select source, status, note, total from public.orders')).rows[0];
    expect(r).toMatchObject({ source: 'in_store', status: 'sold', note: 'دفع نقدًا', total: '2000.00' });
  });

  it('an anonymous visitor cannot', async () => {
    await as(db, 'anon');
    // the validation trigger and the RLS policy both refuse; either message is a denial
    expect((await insertFails()).message).toMatch(/forbidden|row-level security/);
    await as(db, 'postgres');
    expect(await count('select 1 from public.orders')).toBe(0);
  });

  it('a signed-in NON-admin cannot', async () => {
    await as(db, 'authenticated', USER);
    expect((await insertFails()).message).toMatch(/forbidden|row-level security/);
    await as(db, 'postgres');
    expect(await count('select 1 from public.orders')).toBe(0);
  });

  it('a guest cannot fake the source or status on an online-looking order', async () => {
    await as(db, 'anon');
    expect((await insertFails({ source: 'in_store', status: 'pending' })).message).toBeTruthy();
    expect((await insertFails({ source: 'online', status: 'sold', delivery: { method: 'standard' } })).message).toMatch(/row-level security/);
    await as(db, 'postgres');
    expect(await count('select 1 from public.orders')).toBe(0);
  });

  it('online checkout is unchanged: a guest inserting a pending order (no source column) still works and is online', async () => {
    await as(db, 'anon');
    await db.query(
      `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
       values ($1,'ONL','pending','{"email":"a@b.co"}','{}','{"method":"standard"}','[]',5,5)`,
      [O2],
    );
    await as(db, 'postgres');
    expect((await db.query<{ source: string }>('select source from public.orders')).rows[0].source).toBe('online');
    // and the confirmation e-mail is still queued for it
    expect((await db.query<{ state: string }>('select state from public.order_email_outbox')).rows).toEqual([{ state: 'pending' }]);
  });

  it('an admin cannot use the staff policy to create a non-sold in-store order', async () => {
    expect((await insertFails({ status: 'cancelled' })).message).toMatch(/row-level security/);
  });
});

describe('0008 — totals and retail prices are enforced by the database', () => {
  it('accepts several lines; variants resolve to their own or the inherited retail price', async () => {
    await insert({
      lines: [
        line({ qty: 1 }),
        line({ productId: 'p2', variantId: 'v1', price: 1500, qty: 2 }),
        line({ productId: 'p2', variantId: 'v2', price: 1800, qty: 1 }),
      ],
      subtotal: 1000 + 3000 + 1800,
      total: 1000 + 3000 + 1800,
    });
    expect(await count('select 1 from public.orders')).toBe(1);
  });

  it('allows selling a product that is out of stock / not published (warning is UI-side)', async () => {
    await insert({ lines: [line({ productId: 'p2', variantId: 'v1', price: 1500, qty: 1 })], subtotal: 1500, total: 1500 });
    expect(await count('select 1 from public.orders')).toBe(1);
  });

  it('rejects a price that is not the current retail price (e.g. the wholesale price)', async () => {
    const e = await insertFails({ lines: [line({ price: WHOLESALE, qty: 1 })], subtotal: WHOLESALE, total: WHOLESALE });
    expect(e.message).toMatch(/invalid_in_store_order/);
  });

  it('rejects a forged subtotal or total', async () => {
    expect((await insertFails({ total: 1 })).message).toMatch(/invalid_in_store_order/);
    expect((await insertFails({ subtotal: 1 })).message).toMatch(/invalid_in_store_order/);
  });

  it('rejects unknown products / variants, bad quantities, empty orders, wholesale keys, wrong delivery', async () => {
    expect((await insertFails({ lines: [line({ productId: 'nope' })] })).message).toMatch(/invalid_in_store_order/);
    expect((await insertFails({ lines: [line({ productId: 'p2', variantId: 'zzz', price: 1500, qty: 1 })], subtotal: 1500, total: 1500 })).message).toMatch(/invalid_in_store_order/);
    for (const qty of [0, -1, 1.5, 1000]) {
      expect((await insertFails({ lines: [line({ qty })], subtotal: 1000 * qty, total: 1000 * qty })).message).toMatch(/invalid_in_store_order/);
    }
    expect((await insertFails({ lines: [], subtotal: 0, total: 0 })).message).toMatch(/invalid_in_store_order/);
    expect((await insertFails({ lines: [line({ wholesalePrice: 5 })] })).message).toMatch(/invalid_in_store_order/);
    expect((await insertFails({ delivery: { method: 'standard' } })).message).toMatch(/invalid_in_store_order/);
  });

  it('never stores wholesale pricing anywhere in the order', async () => {
    await insert();
    await as(db, 'postgres');
    const r = (await db.query<{ t: string }>('select o::text t from public.orders o')).rows[0];
    expect(r.t).not.toContain(String(WHOLESALE));
    expect(r.t.toLowerCase()).not.toContain('wholesale');
  });

  it('keeps the 1000-character note limit', async () => {
    expect((await insertFails({ note: 'x'.repeat(1001) })).message).toMatch(/orders_note_check/);
  });
});

describe('0008 — statuses, immutability and e-mail', () => {
  it('an in-store order can be cancelled by an admin, but not moved to a shipping status', async () => {
    await insert();
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [O1]);
    const e = await fails(db, `update public.orders set status = 'shipped' where id = $1`, [O1]);
    expect(e.message).toMatch(/orders_source_status_check/);
    const e2 = await fails(db, `update public.orders set status = 'pending' where id = $1`, [O1]);
    expect(e2.message).toMatch(/orders_source_status_check/);
  });

  it('an online order cannot be moved to sold, and its source can never change', async () => {
    await as(db, 'postgres');
    await insert({ source: 'online', status: 'pending', delivery: { method: 'standard' }, lines: [], subtotal: 1, total: 1 });
    await as(db, 'authenticated', ADMIN);
    expect((await fails(db, `update public.orders set status = 'sold' where id = $1`, [O1])).message).toMatch(/orders_source_status_check/);
    expect((await fails(db, `update public.orders set source = 'in_store' where id = $1`, [O1])).message).toMatch(/immutable/);
  });

  it('an in-store order is frozen: items, totals and customer cannot be rewritten; note and status can', async () => {
    await insert();
    expect((await fails(db, `update public.orders set total = 1 where id = $1`, [O1])).message).toMatch(/immutable/);
    expect((await fails(db, `update public.orders set lines = '[]' where id = $1`, [O1])).message).toMatch(/immutable/);
    await db.query(`update public.orders set note = 'تعديل' where id = $1`, [O1]);
  });

  it('records the sale in the status history but NEVER queues a customer e-mail — even with an address', async () => {
    await insert({ contact: { name: 'زبون', phone: '0100', email: 'buyer@example.com' } });
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [O1]);
    await as(db, 'postgres');
    expect((await db.query<{ status: string }>('select status from public.order_status_history order by created_at, status')).rows.map((r) => r.status).sort()).toEqual(['cancelled', 'sold']);
    const rows = (await db.query<{ state: string; last_error: string }>('select state, last_error from public.order_email_outbox')).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.state === 'skipped' && r.last_error === 'in_store_order')).toBe(true);
    // nothing for the worker to pick up
    expect(await count(`select 1 from public.order_email_outbox where state = 'pending'`)).toBe(0);
  });

  it('migration 0008 can be applied again without error (idempotent)', async () => {
    await as(db, 'postgres');
    await db.exec(migrationSql('0008_in_store_orders.sql'));
  });
});
