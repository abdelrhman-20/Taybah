import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// OWNER NOTIFICATIONS (migration 0011): what another admin changes is logged, only the
// owner (nehro@info.com) can read it, the owner's own changes are not logged.

const OWNER = '00000000-0000-0000-0000-0000000000c3';
let db: PGlite;

const email = (e: string) => db.exec(`select set_config('request.jwt.claims', '{"email":"${e}"}', false)`);
// ADMIN is the shop-floor account (Taybah); OWNER is nehro.
const asTaybah = async () => {
  await email('Taybah@info.com');
  await as(db, 'authenticated', ADMIN);
};
const asOwner = async () => {
  await email('nehro@info.com');
  await as(db, 'authenticated', OWNER);
};
// Keeps Taybah's e-mail in the JWT setting but runs as the table owner.
const writeAsTaybah = async () => {
  await email('Taybah@info.com');
  await as(db, 'postgres');
};
const log = async () => {
  await as(db, 'postgres');
  return (
    await db.query<{ actor: string; kind: string; subject: string; detail: Record<string, unknown> }>(
      `select actor, kind, subject, detail from public.activity_log order by id`,
    )
  ).rows;
};

beforeAll(async () => {
  db = await baseDb();
  await db.exec(`
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    insert into auth.users values ('${OWNER}');
    insert into public.admins values ('${OWNER}');
  `);
  for (const f of [
    '0001_orders.sql',
    '0005_order_email_outbox.sql',
    '0006_catalog_documents.sql',
    '0007_product_internal_pricing.sql',
    '0008_in_store_orders.sql',
    '0009_simple_stock.sql',
    '0011_activity_notifications.sql',
    '0012_activity_everything.sql',
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
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `insert into public.catalog_docs(kind, id, slug, visible, data) values ('product','p1','p1',true,$1)`,
    [JSON.stringify({ id: 'p1', name: { ar: 'سجادة' }, price: 1000 })],
  );
});

afterEach(async () => {
  await rollback(db);
});

describe('what is logged', () => {
  it('a stock edit by Taybah says who, what and from/to', async () => {
    await asTaybah();
    await db.query(`select public.stock_set('p1','',5,2)`);
    await db.query(`select public.stock_set('p1','',3,2)`);
    await db.query(`select public.stock_set('p1','',3,9)`); // threshold only: nothing to report
    await db.query(`select public.stock_untrack('p1','')`);
    expect(await log()).toEqual([
      { actor: 'taybah@info.com', kind: 'stock_tracked', subject: 'p1', detail: { variant: '', qty: 5 } },
      { actor: 'taybah@info.com', kind: 'stock_changed', subject: 'p1', detail: { variant: '', from: 5, to: 3 } },
      { actor: 'taybah@info.com', kind: 'stock_untracked', subject: 'p1', detail: { variant: '' } },
    ]);
  });

  it('price, visibility, wholesale price and deletion of a product', async () => {
    await writeAsTaybah();
    await db.query(`update public.catalog_docs set data = jsonb_set(data,'{price}','1200') where id='p1'`);
    await db.query(`update public.catalog_docs set visible = false where id='p1'`);
    await db.query(`insert into public.product_internal_pricing(product_id, wholesale_price) values ('p1', 700)`);
    await db.query(`update public.product_internal_pricing set wholesale_price = 750 where product_id='p1'`);
    await db.query(`delete from public.catalog_docs where id='p1'`);
    const rows = await log();
    // the two wholesale edits within 30 s are one notification: first "from", latest "to"
    expect(rows.map((r) => r.kind)).toEqual(['price_changed', 'visibility_changed', 'wholesale_changed', 'product_deleted']);
    expect(rows[0].detail).toMatchObject({ name: 'سجادة', from: 1000, to: 1200 });
    expect(rows[2].detail).toMatchObject({ from: null, to: 750 });
  });

  it('an order status change and an in-store sale', async () => {
    await writeAsTaybah();
    await db.query(
      `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
       values ('00000000-0000-0000-0000-000000000101','TYB-1','sold','in_store','{"name":"x","phone":"0100","email":""}','{}','{"method":"in_store"}',
               '[{"productId":"p1","slug":"p1","name":{"ar":"x","en":"x"},"color":null,"size":null,"qty":1,"price":1000,"image":"","variantId":null}]',1000,1000)`,
    );
    await db.query(`update public.orders set status='cancelled' where ref='TYB-1'`);
    const rows = await log();
    expect(rows.map((r) => r.kind)).toEqual(['in_store_sale', 'order_status']);
    expect(rows[1].detail).toMatchObject({ from: 'sold', to: 'cancelled' });
  });

  it("the owner's own changes, and changes with no signed-in user, are not logged", async () => {
    await asOwner();
    await db.query(`select public.stock_set('p1','',5,2)`);
    await as(db, 'postgres');
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    await db.query(`update public.catalog_docs set data = jsonb_set(data,'{price}','1500') where id='p1'`);
    expect(await log()).toEqual([]);
  });
});

describe('everything else, merged when repeated', () => {
  it('any other product field is reported once, with every field touched', async () => {
    await writeAsTaybah();
    await db.query(`update public.catalog_docs set data = jsonb_set(data,'{name}','{"ar":"سجادة جديدة"}') where id='p1'`);
    await db.query(`update public.catalog_docs set data = data || '{"description":"x"}' where id='p1'`);
    const rows = await log();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'product_updated', subject: 'p1' });
    expect(rows[0].detail.fields).toEqual(['description', 'name']);
  });

  it('categories: three created in a row are one line, and a later edit is its own kind', async () => {
    await writeAsTaybah();
    for (const id of ['c1', 'c2', 'c3']) {
      await db.query(
        `insert into public.catalog_docs(kind, id, slug, visible, data) values ('category',$1,$1,true,$2)`,
        [id, JSON.stringify({ id, name: { ar: `قسم ${id}` } })],
      );
    }
    await db.query(`update public.catalog_docs set data = data || '{"order":2}' where id='c1'`);
    const rows = await log();
    expect(rows.map((r) => r.kind)).toEqual(['doc_created', 'doc_updated']);
    expect(rows[0].detail).toMatchObject({ docKind: 'category', count: 3 });
    expect(rows[0].detail.names).toEqual(['قسم c1', 'قسم c2', 'قسم c3']);
  });

  it('a changed order note, and a repeat brings a read notification back to new', async () => {
    await writeAsTaybah();
    await db.query(
      `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
       values ('00000000-0000-0000-0000-000000000101','TYB-1','pending','online','{"name":"x","phone":"0100","email":""}','{}','{"method":"delivery"}','[]',0,0)`,
    );
    await db.query(`update public.orders set note='a' where ref='TYB-1'`);
    await asOwner();
    await db.query(`select public.activity_mark_seen()`);
    await writeAsTaybah();
    await db.query(`update public.orders set note='b' where ref='TYB-1'`);
    await as(db, 'postgres');
    const rows = (await db.query<{ kind: string; seen_at: string | null }>(`select kind, seen_at from public.activity_log`)).rows;
    expect(rows).toEqual([{ kind: 'order_note', seen_at: null }]);
  });
});

describe('who can read it', () => {
  beforeEach(async () => {
    await asTaybah();
    await db.query(`select public.stock_set('p1','',5,2)`);
  });

  it('the owner reads it and can mark it seen', async () => {
    await asOwner();
    expect((await db.query(`select kind from public.activity_log`)).rows).toHaveLength(1);
    await db.query(`select public.activity_mark_seen()`);
    const seen = (await db.query<{ seen_at: string | null }>(`select seen_at from public.activity_log`)).rows[0];
    expect(seen.seen_at).not.toBeNull();
  });

  it('Taybah (an admin) and anonymous visitors get nothing, and cannot write or mark seen', async () => {
    await asTaybah();
    expect((await db.query(`select * from public.activity_log`)).rows).toHaveLength(0);
    expect((await fails(db, `select public.activity_mark_seen()`)).code).toBe('42501');
    expect((await fails(db, `insert into public.activity_log(actor, kind) values ('x','stock_changed')`)).code).toBe(
      '42501',
    );
    await email('');
    await as(db, 'anon');
    expect((await fails(db, `select * from public.activity_log`)).code).toBe('42501');
  });
});
