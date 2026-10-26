import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// ADMIN-ONLY WHOLESALE PRICING (migration 0007: product_internal_pricing +
// catalog_write_product) on a REAL Postgres engine (PGlite). Roles, RLS,
// GRANTs, the foreign-key cascade and plpgsql atomicity are all executed from
// the actual migration files. NOT covered: PostgREST's HTTP layer (the Supabase
// API key -> role mapping), which this harness approximates with `set role`.

let db: PGlite;

const put = (id: string, over: Record<string, unknown> = {}) => ({
  op: 'put',
  kind: 'product',
  id,
  expected_revision: null,
  slug: `slug-${id}`,
  visible: true,
  sort_order: 0,
  data: { id, sku: `SKU-${id}`, price: 1000, name: { ar: id, en: id } },
  ...over,
});

const writeProduct = async (ops: unknown[], wholesale: unknown = null) =>
  (
    await db.query<{ r: Array<{ revision: number | null; deleted: boolean }> }>(
      'select public.catalog_write_product($1::jsonb, $2::jsonb) r',
      [JSON.stringify(ops), wholesale === null ? null : JSON.stringify(wholesale)],
    )
  ).rows[0].r;

const writeProductFails = (ops: unknown[], wholesale: unknown = null) =>
  fails(db, 'select public.catalog_write_product($1::jsonb, $2::jsonb)', [
    JSON.stringify(ops),
    wholesale === null ? null : JSON.stringify(wholesale),
  ]);

const stored = async (id: string) =>
  (
    await db.query<{ wholesale_price: string }>(
      'select wholesale_price from public.product_internal_pricing where product_id = $1',
      [id],
    )
  ).rows.map((r) => Number(r.wholesale_price));

const count = async (sql: string) =>
  (await db.query<{ c: number }>(`select count(*)::int c from (${sql}) t`)).rows[0].c;

beforeAll(async () => {
  db = await baseDb();
  await db.exec(migrationSql('0001_orders.sql'));
  await db.exec(migrationSql('0006_catalog_documents.sql'));
  await db.exec(migrationSql('0007_product_internal_pricing.sql'));
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await begin(db);
  await as(db, 'authenticated', ADMIN);
});
afterEach(async () => {
  await rollback(db);
});

describe('0007 — saving and retrieving the wholesale price', () => {
  it('an admin saves a wholesale price together with a new product and reads it back', async () => {
    const r = await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    expect(r.map((x) => x.revision)).toEqual([1]);
    expect(await stored('p1')).toEqual([720]);
  });

  it('updates it with the product and clears it with price null', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    await writeProduct([put('p1', { expected_revision: 1 })], { product_id: 'p1', price: 650.5 });
    expect(await stored('p1')).toEqual([650.5]);
    await writeProduct([put('p1', { expected_revision: 2 })], { product_id: 'p1', price: null });
    expect(await stored('p1')).toEqual([]);
  });

  it('allows a wholesale price above the retail price (the UI only warns)', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 5000 });
    expect(await stored('p1')).toEqual([5000]);
  });

  it('the original catalog_write path is untouched and leaves the stored wholesale price alone', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    await db.query('select public.catalog_write($1::jsonb)', [
      JSON.stringify([put('p1', { expected_revision: 1, data: { id: 'p1', sku: 'SKU-p1', price: 1200 } })]),
    ]);
    expect(await stored('p1')).toEqual([720]);
  });

  it('a write without wholesale (p_wholesale null) does not touch pricing', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    await writeProduct([put('p1', { expected_revision: 1 })]);
    expect(await stored('p1')).toEqual([720]);
  });
});

describe('0007 — access permissions', () => {
  beforeEach(async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
  });

  it('anonymous visitors have no privileges on the table and cannot call the RPC', async () => {
    await as(db, 'anon');
    expect((await fails(db, 'select * from public.product_internal_pricing')).message).toMatch(/permission denied/);
    expect(
      (await writeProductFails([put('p2')], { product_id: 'p2', price: 1 })).message,
    ).toMatch(/permission denied/);
  });

  it('a signed-in NON-admin reads zero rows and is refused by the RPC', async () => {
    await as(db, 'authenticated', USER);
    expect(await count('select 1 from public.product_internal_pricing')).toBe(0);
    const err = await writeProductFails([put('p2')], { product_id: 'p2', price: 1 });
    expect(err.code).toBe('42501');
    expect(err.message).toMatch(/forbidden/);
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'p2'`)).toBe(0);
  });

  it('an admin can read the stored price', async () => {
    await as(db, 'authenticated', ADMIN);
    expect(await stored('p1')).toEqual([720]);
  });

  it('nobody — not even an admin — can write the table directly; only through the RPC', async () => {
    for (const [role, sub] of [['authenticated', ADMIN], ['authenticated', USER], ['anon', undefined]] as const) {
      await as(db, role, sub);
      expect(
        (await fails(db, `insert into public.product_internal_pricing(product_id, wholesale_price) values ('p1', 1)`)).message,
      ).toMatch(/permission denied/);
      expect((await fails(db, `update public.product_internal_pricing set wholesale_price = 1`)).message).toMatch(/permission denied/);
      expect((await fails(db, `delete from public.product_internal_pricing`)).message).toMatch(/permission denied/);
    }
    await as(db, 'authenticated', ADMIN);
    expect(await stored('p1')).toEqual([720]);
  });
});

describe('0007 — atomicity', () => {
  it('a revision conflict rolls back the wholesale change', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    const err = await writeProductFails([put('p1', { expected_revision: 99 })], { product_id: 'p1', price: 1 });
    expect(err.code).toBe('CF001');
    expect(await stored('p1')).toEqual([720]);
  });

  it('an invalid wholesale price rolls back the product write too', async () => {
    const err = await writeProductFails([put('p1')], { product_id: 'p1', price: -5 });
    expect(err.code).toBe('22023');
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'p1'`)).toBe(0);
    expect(await count('select 1 from public.product_internal_pricing')).toBe(0);
  });

  it('a non-numeric price, or a product that is not part of the batch, is rejected and nothing is saved', async () => {
    expect((await writeProductFails([put('p1')], { product_id: 'p1', price: '12' })).code).toBe('22023');
    expect((await writeProductFails([put('p1')], { product_id: 'other', price: 12 })).code).toBe('22023');
    expect((await writeProductFails([put('p1')], { price: 12 })).code).toBe('22023');
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'p1'`)).toBe(0);
  });

  it('a duplicate SKU rolls back the pricing row of the batch', async () => {
    await writeProduct([put('p1')]);
    const err = await writeProductFails(
      [put('p2', { data: { id: 'p2', sku: 'sku-p1' } })],
      { product_id: 'p2', price: 10 },
    );
    expect(err.code).toBe('CF005');
    expect(await stored('p2')).toEqual([]);
  });
});

describe('0007 — product deletion', () => {
  it('deleting a product removes its wholesale price (foreign-key cascade)', async () => {
    await writeProduct([put('p1'), put('p2')], { product_id: 'p1', price: 720 });
    await writeProduct([put('p2', { expected_revision: 1 })], { product_id: 'p2', price: 5 });
    expect(await stored('p1')).toEqual([720]);
    await db.query('select public.catalog_write($1::jsonb)', [
      JSON.stringify([{ op: 'delete', kind: 'product', id: 'p1', expected_revision: 1 }]),
    ]);
    expect(await stored('p1')).toEqual([]);
    expect(await stored('p2')).toEqual([5]);
  });
});

describe('0007 — never exposed to the public', () => {
  it('nothing the public can select from catalog_docs contains the wholesale price or key', async () => {
    await writeProduct([put('p1', { data: { id: 'p1', sku: 'SKU-p1', price: 1000 } })], {
      product_id: 'p1',
      price: 123456,
    });
    for (const role of ['anon', 'authenticated'] as const) {
      await as(db, role, role === 'authenticated' ? USER : undefined);
      const rows = (await db.query<{ doc: string }>('select to_jsonb(d)::text doc from public.catalog_docs d')).rows;
      expect(rows.length).toBe(1);
      for (const r of rows) {
        expect(r.doc).not.toMatch(/wholesale/i);
        expect(r.doc).not.toContain('123456');
      }
      expect(await count('select 1 from public.app_settings')).toBe(0);
    }
  });

  it('re-applying 0006 after 0007 keeps the pricing data and the RPC working (compatibility)', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    await as(db, 'postgres');
    await db.exec(migrationSql('0006_catalog_documents.sql'));
    await as(db, 'authenticated', ADMIN);
    expect(await stored('p1')).toEqual([720]);
    await writeProduct([put('p1', { expected_revision: 1 })], { product_id: 'p1', price: 800 });
    expect(await stored('p1')).toEqual([800]);
  });

  it('migration 0007 can be applied again without error (idempotent) and keeps the data', async () => {
    await writeProduct([put('p1')], { product_id: 'p1', price: 720 });
    await as(db, 'postgres');
    await db.exec(migrationSql('0007_product_internal_pricing.sql'));
    await as(db, 'authenticated', ADMIN);
    expect(await stored('p1')).toEqual([720]);
  });
});
