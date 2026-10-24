import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// REAL POSTGRES (PGlite) verification of the SQL migrations 0001, 0005, 0006:
// tables, triggers, constraints, RLS policies, GRANTs and plpgsql functions
// are executed from the actual migration files. Supabase-only pieces (auth.uid,
// vault, pg_net, roles) are minimal stubs — see ./pg.ts for exactly what is and
// is not covered. This is NOT a test against a live Supabase project.

const O1 = '11111111-1111-1111-1111-111111111111';
const O2 = '22222222-2222-2222-2222-222222222222';
const O3 = '33333333-3333-3333-3333-333333333333';

let db: PGlite;

async function insertOrder(id: string, ref: string, email: string | null, status = 'pending') {
  await db.query(
    `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
     values ($1, $2, $3, $4, '{}', '{}', '[]', 100, 100)`,
    [id, ref, status, JSON.stringify({ name: 'منى', email })],
  );
}

async function outbox(orderId: string) {
  return (
    await db.query<{ kind: string; status: string; state: string; attempts: number; last_error: string | null }>(
      `select kind, status, state, attempts, last_error from public.order_email_outbox
        where order_id = $1 order by created_at, id`,
      [orderId],
    )
  ).rows;
}

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ c: number }>(`select count(*)::int c from (${sql}) t`, params)).rows[0].c;

beforeAll(async () => {
  db = await baseDb();
  await db.exec(migrationSql('0001_orders.sql'));
  await db.exec(migrationSql('0005_order_email_outbox.sql'));
  await db.exec(migrationSql('0006_catalog_documents.sql'));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await begin(db);
});
afterEach(async () => {
  await rollback(db);
});

// ===========================================================================
describe('0005 — order email outbox (real Postgres)', () => {
  it('an anonymous order insert enqueues exactly one pending confirmation', async () => {
    await as(db, 'anon');
    await insertOrder(O1, 'T1', 'mona@example.com');
    await as(db, 'postgres');
    expect((await outbox(O1)).map((r) => [r.kind, r.status, r.state])).toEqual([
      ['confirmation', 'pending', 'pending'],
    ]);
  });

  it('the worker kick is a silent no-op until Vault is configured, and never breaks the order write', async () => {
    await as(db, 'anon');
    await insertOrder(O1, 'T1', 'mona@example.com');
    await as(db, 'postgres');
    expect(await count('select 1 from net.calls')).toBe(0);
    expect(await count('select 1 from public.orders')).toBe(1);
  });

  it('once Vault is configured the kick posts to the worker with the secret header', async () => {
    await db.exec(`insert into vault.decrypted_secrets values
      ('order_email_worker_url', 'https://x.supabase.co/functions/v1/process-order-emails'),
      ('order_email_worker_secret', 's3cret')`);
    await as(db, 'anon');
    await insertOrder(O1, 'T1', 'mona@example.com');
    await as(db, 'postgres');
    const calls = (await db.query<{ url: string; h: string }>(`select url, headers->>'x-worker-secret' h from net.calls`)).rows;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ url: 'https://x.supabase.co/functions/v1/process-order-emails', h: 's3cret' });
  });

  it('guests cannot create an order in a privileged status', async () => {
    await as(db, 'anon');
    const err = await fails(db, `insert into public.orders(id,ref,status,contact,address,delivery,lines,subtotal,total)
      values ('${O1}','X','delivered','{}','{}','{}','[]',1,1)`);
    expect(err.message).toMatch(/row-level security/);
  });

  it('anonymous visitors cannot read orders, the outbox, or call the worker functions', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'anon');
    expect(await count('select 1 from public.orders')).toBe(0);
    expect((await fails(db, 'select * from public.order_email_outbox')).message).toMatch(/permission denied/);
    expect((await fails(db, `update public.order_email_outbox set state = 'sent'`)).message).toMatch(/permission denied/);
    expect((await fails(db, 'select public.claim_order_emails(5)')).message).toMatch(/permission denied/);
    expect((await fails(db, `select public.finish_order_email(gen_random_uuid(), 'sent', 'x')`)).message).toMatch(/permission denied/);
  });

  it('a signed-in NON-admin cannot read or change orders, or retry emails', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'authenticated', USER);
    expect(await count('select 1 from public.orders')).toBe(0);
    await db.query(`update public.orders set status = 'delivered'`); // matches zero rows under RLS
    await as(db, 'postgres');
    expect((await db.query<{ status: string }>('select status from public.orders')).rows[0].status).toBe('pending');
    await as(db, 'authenticated', USER);
    expect((await fails(db, `select public.retry_order_email(gen_random_uuid())`)).message).toMatch(/forbidden/);
  });

  it('a status change enqueues once; an unchanged status or other column edit enqueues nothing', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'authenticated', ADMIN);
    await db.query(`update public.orders set status = 'processing' where id = $1`, [O1]);
    await db.query(`update public.orders set status = 'processing' where id = $1`, [O1]);
    await db.query(`update public.orders set total = 200 where id = $1`, [O1]);
    await as(db, 'postgres');
    expect((await outbox(O1)).map((r) => [r.kind, r.status])).toEqual([
      ['confirmation', 'pending'],
      ['status_update', 'processing'],
    ]);
    expect(await count('select 1 from public.order_status_history')).toBe(2);
  });

  it('a duplicate history event can never create a second email row (UNIQUE history_id)', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    const h = (await db.query<{ id: string }>('select id from public.order_status_history limit 1')).rows[0].id;
    const err = await fails(
      db,
      `insert into public.order_email_outbox(order_id, history_id, kind, status) values ($1, $2, 'confirmation', 'pending')`,
      [O1, h],
    );
    expect(err.message).toMatch(/duplicate|unique/);
    expect(await outbox(O1)).toHaveLength(1);
  });

  it('a missing or invalid customer email is recorded as skipped and the order is still created', async () => {
    await as(db, 'anon');
    await insertOrder(O2, 'T2', '');
    await insertOrder(O3, 'T3', 'not-an-email');
    await as(db, 'postgres');
    for (const id of [O2, O3]) {
      const [row] = await outbox(id);
      expect([row.state, row.last_error]).toEqual(['skipped', 'no_customer_email']);
    }
    expect(await count('select 1 from public.orders')).toBe(2);
  });

  it('claim hands out due rows once; finish records outcomes; sent requires a provider id', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'service_role');
    const claimed = (await db.query<{ out_id: string; out_attempts: number; out_contact: { email: string } }>(
      'select * from public.claim_order_emails(10)',
    )).rows;
    expect(claimed).toHaveLength(1);
    expect(claimed[0].out_attempts).toBe(1);
    expect(claimed[0].out_contact.email).toBe('a@b.co');
    expect((await db.query('select * from public.claim_order_emails(10)')).rows).toHaveLength(0); // nobody else gets it
    const id = claimed[0].out_id;

    expect((await fails(db, `select public.finish_order_email($1, 'sent', null)`, [id])).message).toMatch(/provider message id/);
    await db.query(`select public.finish_order_email($1, 'sent', 'msg_1')`, [id]);
    await db.query(`select public.finish_order_email($1, 'failed', null, 'late')`, [id]); // duplicate report: no-op
    await as(db, 'postgres');
    const r = (await db.query(`select state, provider_message_id, last_error from public.order_email_outbox where id = $1`, [id])).rows[0];
    expect(r).toEqual({ state: 'sent', provider_message_id: 'msg_1', last_error: null });
  });

  it('transient failures retry with backoff, then the 5th failure marks the email failed', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'service_role');
    const id = (await db.query<{ out_id: string }>('select * from public.claim_order_emails(10)')).rows[0].out_id;
    await db.query(`select public.finish_order_email($1, 'retry', null, 'provider_http_503')`, [id]);
    await as(db, 'postgres');
    let r = (await db.query(`select state, attempts, last_error, next_attempt_at > now() later from public.order_email_outbox where id = $1`, [id])).rows[0];
    expect(r).toEqual({ state: 'pending', attempts: 1, last_error: 'provider_http_503', later: true });

    await db.query(`update public.order_email_outbox set next_attempt_at = now(), attempts = 4 where id = $1`, [id]);
    await as(db, 'service_role');
    await db.query('select * from public.claim_order_emails(10)');
    await db.query(`select public.finish_order_email($1, 'retry', null, 'provider_http_503')`, [id]);
    await as(db, 'postgres');
    r = (await db.query(`select state from public.order_email_outbox where id = $1`, [id])).rows[0];
    expect(r.state).toBe('failed');
  });

  it('an admin can retry a failed email, but never re-send one already accepted', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await insertOrder(O2, 'T2', 'b@b.co');
    const [failed, sent] = (await db.query<{ id: string }>('select id from public.order_email_outbox order by created_at, id')).rows.map((x) => x.id);
    await db.query(`update public.order_email_outbox set state = 'failed', attempts = 5, last_error = 'provider_http_403' where id = $1`, [failed]);
    await db.query(`update public.order_email_outbox set state = 'sent', provider_message_id = 'm' where id = $1`, [sent]);
    await as(db, 'authenticated', ADMIN);
    await db.query('select public.retry_order_email($1)', [failed]);
    await db.query('select public.retry_order_email($1)', [sent]);
    await as(db, 'postgres');
    const states = Object.fromEntries((await db.query<{ id: string; state: string; attempts: number }>('select id, state, attempts from public.order_email_outbox')).rows.map((r) => [r.id, [r.state, r.attempts]]));
    expect(states[failed]).toEqual(['pending', 0]);
    expect(states[sent]).toEqual(['sent', 0]);
  });

  it('a stale retry is skipped once a NEWER status email was accepted (no out-of-order mail)', async () => {
    await as(db, 'postgres');
    await insertOrder(O1, 'T1', 'a@b.co');
    await as(db, 'authenticated', ADMIN);
    await db.query(`update public.orders set status = 'shipped' where id = $1`, [O1]);
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [O1]);
    await as(db, 'postgres');
    await db.query(`update public.order_email_outbox set attempts = 1 where order_id = $1 and status = 'shipped'`, [O1]);
    await db.query(`update public.order_email_outbox set state = 'sent' where order_id = $1 and status = 'delivered'`, [O1]);
    await as(db, 'service_role');
    await db.query('select * from public.claim_order_emails(10)');
    await as(db, 'postgres');
    const r = (await db.query(`select last_error from public.order_email_outbox where order_id = $1 and status = 'shipped'`, [O1])).rows[0];
    expect(r.last_error).toBe('superseded');
  });
});

// ===========================================================================
describe('0006 — catalog document store (real Postgres)', () => {
  const put = (kind: string, id: string, over: Record<string, unknown> = {}) => ({
    op: 'put', kind, id, expected_revision: null,
    slug: kind === 'product' ? `slug-${id}` : null, visible: true, sort_order: 0, data: { id, n: 1 }, ...over,
  });
  const write = async (ops: unknown[]) =>
    (await db.query<{ r: Array<{ revision: number | null; deleted: boolean }> }>('select public.catalog_write($1::jsonb) r', [JSON.stringify(ops)])).rows[0].r;

  it('non-admins and anonymous users cannot write, import or flip the cutover flag', async () => {
    await as(db, 'authenticated', USER);
    expect((await fails(db, `select public.catalog_write($1::jsonb)`, [JSON.stringify([put('product', 'p1')])])).message).toMatch(/forbidden/);
    expect((await fails(db, `select public.catalog_import('[]', true)`)).message).toMatch(/forbidden/);
    expect((await fails(db, `select public.catalog_mark_initialized()`)).message).toMatch(/forbidden/);
    await as(db, 'anon');
    expect((await fails(db, `select public.catalog_write($1::jsonb)`, [JSON.stringify([put('product', 'p1')])])).message).toMatch(/permission denied/);
  });

  it('nobody — not even an admin — can write to the table directly; only through the RPCs', async () => {
    await as(db, 'authenticated', ADMIN);
    expect((await fails(db, `insert into public.catalog_docs(kind, id, data) values ('product', 'z', '{}')`)).message).toMatch(/permission denied/);
    expect((await fails(db, `update public.catalog_docs set data = '{}'`)).message).toMatch(/permission denied/);
    expect((await fails(db, `delete from public.catalog_docs`)).message).toMatch(/permission denied/);
  });

  it('inserts at revision 1; the public sees only visible records, admins see drafts', async () => {
    await as(db, 'authenticated', ADMIN);
    const r = await write([put('product', 'p1'), put('product', 'p2', { visible: false }), put('category', 'rugs', { slug: 'rugs' })]);
    expect(r.map((x) => x.revision)).toEqual([1, 1, 1]);
    expect(await count('select 1 from public.catalog_docs')).toBe(3);
    await as(db, 'anon');
    expect((await db.query<{ id: string }>('select id from public.catalog_docs order by id')).rows.map((x) => x.id)).toEqual(['p1', 'rugs']);
  });

  it('updates need the current revision: stale -> CF001, missing -> CF002, duplicate id -> CF003, duplicate slug -> CF004', async () => {
    await as(db, 'authenticated', ADMIN);
    await write([put('product', 'p1')]);
    const upd = await write([put('product', 'p1', { expected_revision: 1, data: { id: 'p1', n: 2 } })]);
    expect(upd[0].revision).toBe(2);
    const code = async (ops: unknown[]) => (await fails(db, 'select public.catalog_write($1::jsonb)', [JSON.stringify(ops)])).code;
    expect(await code([put('product', 'p1', { expected_revision: 1, data: { id: 'p1', n: 99 } })])).toBe('CF001');
    expect(await code([put('product', 'nope', { expected_revision: 1 })])).toBe('CF002');
    expect(await code([put('product', 'p1')])).toBe('CF003');
    expect(await code([put('product', 'p3', { slug: 'slug-p1' })])).toBe('CF004');
    expect((await db.query<{ n: string }>(`select data->>'n' n from public.catalog_docs where id = 'p1'`)).rows[0].n).toBe('2'); // stale write never applied
  });

  it('a batch is atomic: a failing later operation rolls back the earlier ones', async () => {
    await as(db, 'authenticated', ADMIN);
    await write([put('product', 'p1')]);
    const err = await fails(db, 'select public.catalog_write($1::jsonb)', [
      JSON.stringify([put('product', 'ok1'), put('product', 'p1', { expected_revision: 99 })]),
    ]);
    expect(err.code).toBe('CF001');
    expect(await count(`select 1 from public.catalog_docs where id = 'ok1'`)).toBe(0);
  });

  it('delete needs the right revision; deleting an already-removed record reports deleted:false', async () => {
    await as(db, 'authenticated', ADMIN);
    await write([put('product', 'p1')]);
    expect((await fails(db, 'select public.catalog_write($1::jsonb)', [JSON.stringify([{ op: 'delete', kind: 'product', id: 'p1', expected_revision: 7 }])])).code).toBe('CF001');
    expect((await write([{ op: 'delete', kind: 'product', id: 'p1', expected_revision: 1 }]))[0].deleted).toBe(true);
    expect((await write([{ op: 'delete', kind: 'product', id: 'p1', expected_revision: 1 }]))[0].deleted).toBe(false);
  });

  it('rejects malformed operations', async () => {
    await as(db, 'authenticated', ADMIN);
    expect((await fails(db, `select public.catalog_write('[]')`)).code).toBe('22023');
    expect((await fails(db, 'select public.catalog_write($1::jsonb)', [JSON.stringify([{ op: 'bogus', kind: 'product', id: 'x' }])])).code).toBe('22023');
    expect((await fails(db, 'select public.catalog_write($1::jsonb)', [JSON.stringify([put('product', 'x', { data: 'not an object' })])])).code).toBe('22023');
  });

  describe('catalog_import', () => {
    const docs = [
      { kind: 'product', id: 'i1', slug: 'i1', visible: true, sort_order: 0, data: { a: 1 } },
      { kind: 'product', id: 'i2', slug: 'i2', visible: true, sort_order: 1, data: { a: 2 } },
    ];
    const imp = async (d: unknown[], dry: boolean) =>
      (await db.query<{ r: { inserted: unknown[]; unchanged: unknown[]; conflicts: Array<{ reason: string }> } }>(
        'select public.catalog_import($1::jsonb, $2) r', [JSON.stringify(d), dry])).rows[0].r;

    it('a dry run reports but writes nothing; a real run inserts; a re-run is idempotent', async () => {
      await as(db, 'authenticated', ADMIN);
      expect((await imp(docs, true)).inserted).toHaveLength(2);
      expect(await count(`select 1 from public.catalog_docs where id like 'i%'`)).toBe(0);
      expect((await imp(docs, false)).inserted).toHaveLength(2);
      const again = await imp(docs, false);
      expect([again.inserted.length, again.unchanged.length, again.conflicts.length]).toEqual([0, 2, 0]);
    });

    it('never overwrites: a differing record or a taken slug is reported as a conflict', async () => {
      await as(db, 'authenticated', ADMIN);
      await imp(docs, false);
      const rep = await imp(
        [{ ...docs[0], data: { a: 'LOCAL' } }, { kind: 'product', id: 'i3', slug: 'i1', visible: true, sort_order: 2, data: {} }],
        false,
      );
      expect(rep.conflicts.map((c) => c.reason).sort()).toEqual(['different_data', 'slug_taken']);
      expect((await db.query<{ a: string }>(`select data->>'a' a from public.catalog_docs where id = 'i1'`)).rows[0].a).toBe('1');
    });
  });

  it('the cutover flag is world-readable but nothing else in app_settings is; unmark keeps all data', async () => {
    await as(db, 'authenticated', ADMIN);
    await write([put('product', 'p1')]);
    await db.query('select public.catalog_mark_initialized()');
    await as(db, 'postgres');
    await db.query(`insert into public.app_settings values ('secret_thing', '{"x":1}')`);
    await as(db, 'anon');
    expect((await db.query<{ key: string }>('select key from public.app_settings')).rows.map((r) => r.key)).toEqual(['catalog_initialized']);
    await as(db, 'authenticated', ADMIN);
    await db.query('select public.catalog_unmark_initialized()');
    await as(db, 'anon');
    expect(await count('select 1 from public.app_settings')).toBe(0);
    await as(db, 'postgres');
    expect(await count('select 1 from public.catalog_docs')).toBe(1);
  });
});

// ===========================================================================
describe('0005 pre-flight guard and re-runnability (real Postgres)', () => {
  it('refuses to run when public.admins is empty, leaving the database untouched', async () => {
    const empty = await baseDb({ admin: false });
    try {
      await empty.exec(migrationSql('0001_orders.sql'));
      await expect(empty.exec(migrationSql('0005_order_email_outbox.sql'))).rejects.toThrow(/ABORT: public\.admins is empty/);
      const policy = await empty.query(`select policyname from pg_policies where tablename = 'orders' order by 1`);
      expect(policy.rows.map((r) => (r as { policyname: string }).policyname)).toContain('public can insert orders'); // not replaced
      const t = await empty.query(`select to_regclass('public.order_email_outbox') r`);
      expect((t.rows[0] as { r: string | null }).r).toBeNull();
    } finally {
      await empty.close();
    }
  }, 60_000);

  it('0005 and 0006 can be applied again without error (idempotent)', async () => {
    await rollback(db); // leave the per-test transaction
    await db.exec(migrationSql('0005_order_email_outbox.sql'));
    await db.exec(migrationSql('0006_catalog_documents.sql'));
    await begin(db); // afterEach expects an open transaction
  });
});
