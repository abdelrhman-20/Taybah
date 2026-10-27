import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql } from './pg';

// INVENTORY PHASE 1 (migration 0009) on a REAL Postgres engine (PGlite): the
// tables, constraints, triggers, RLS, GRANTs and plpgsql functions are executed
// from the actual migration files.
//
// What this suite does NOT prove: concurrency. PGlite has ONE connection, so
// races between simultaneous transactions (row-lock ordering, idempotency under
// parallel retries) are NOT exercised here — see docs/DATABASE_SCHEMA.md
// ("Inventory — concurrency verification status"). Also not covered: PostgREST's
// HTTP layer and Supabase's hosted default privileges (approximated in ./pg.ts).

const P1 = 'p1';
const P2 = 'p2';
const P3 = 'p3';
const O1 = '11111111-1111-1111-1111-111111111111';
const O2 = '22222222-2222-2222-2222-222222222222';
const O3 = '33333333-3333-3333-3333-333333333333';

let db: PGlite;

type Row = Record<string, unknown>;
const q = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) =>
  (await one<{ c: number }>(`select count(*)::int c from (${sql}) t`, params)).c;
const admin = () => as(db, 'authenticated', ADMIN);
const superuser = () => as(db, 'postgres');
const asUser = () => as(db, 'authenticated', USER);

const setOpening = (pid: string, qty: number, reason = 'رصيد افتتاحي') =>
  one<{ r: Row }>('select public.inventory_set_opening($1, $2, $3) r', [pid, qty, reason]);
const adjust = (pid: string, counted: number, reason = 'جرد فعلي', key: string | null = null) =>
  one<{ r: Row }>('select public.inventory_adjust($1, $2, $3, $4) r', [pid, counted, reason, key]);
const stock = (pid: string) => one<{ on_hand: number; low_threshold: number }>('select on_hand, low_threshold from public.stock_levels where product_id = $1', [pid]);
const ledger = (pid: string) =>
  q<{ kind: string; quantity: number; qty_delta: number; qty_before: number; qty_after: number; reason: string; order_id: string | null }>(
    'select kind, quantity, qty_delta, qty_before, qty_after, reason, order_id from public.stock_movements where product_id = $1 order by seq',
    [pid],
  );
// message + detail: the database reports the reason in DETAIL (e.g. 'price_mismatch').
const errOf = async (sql: string, params: unknown[] = []) => {
  const e = await fails(db, sql, params);
  return { ...e, message: `${e.message} ${e.detail}`.trim() };
};

interface MkOrder {
  id: string;
  ref: string;
  status?: string;
  source?: 'online' | 'in_store';
  lines?: unknown;
  // [status, minutes after creation]; null = leave the automatic history untouched
  history?: Array<[string, number]> | null;
  updatedMin?: number;
}

// Inserts an order with a hand-built status history (explicit timestamps), so the
// audit can be tested against complete, partial and inconsistent histories.
async function mkOrder(o: MkOrder) {
  const lines = o.lines ?? [{ productId: P1, qty: 2, price: 100, variantId: 'v-a', name: { ar: 'سجادة' } }];
  const inStore = o.source === 'in_store';
  await superuser();
  await db.query(
    `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total, created_at, updated_at)
     values ($1, $2, $3, $4, '{}', '{}', $5, $6, $7, $7, now() - interval '1 day', now() - interval '1 day')`,
    [
      o.id,
      o.ref,
      o.status ?? 'pending',
      o.source ?? 'online',
      JSON.stringify({ method: inStore ? 'in_store' : 'standard' }),
      JSON.stringify(lines),
      Array.isArray(lines)
        ? (lines as Array<{ qty?: unknown; price?: unknown }>).reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)
        : 0,
    ],
  );
  if (o.history !== null && o.history !== undefined) {
    await db.query('delete from public.order_status_history where order_id = $1', [o.id]);
    for (const [status, min] of o.history) {
      await db.query(
        `insert into public.order_status_history(order_id, status, created_at)
         select id, $2, created_at + ($3 || ' minutes')::interval from public.orders where id = $1`,
        [o.id, status, String(min)],
      );
    }
  } else if (o.history === null) {
    await db.query('delete from public.order_status_history where order_id = $1', [o.id]);
  }
  if (o.updatedMin !== undefined) {
    await db.exec('alter table public.orders disable trigger orders_touch_updated_at');
    await db.query(`update public.orders set updated_at = created_at + ($2 || ' minutes')::interval where id = $1`, [o.id, String(o.updatedMin)]);
    await db.exec('alter table public.orders enable trigger orders_touch_updated_at');
  }
  await admin();
}

beforeAll(async () => {
  db = await baseDb();
  for (const f of ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0007_product_internal_pricing.sql', '0008_in_store_orders.sql']) {
    await db.exec(migrationSql(f));
  }
  await db.exec(`insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`);
  await db.exec(`insert into public.catalog_docs(kind, id, slug, visible, data) values
    ('product', 'p1', 'p1', true, '{"id":"p1","sku":"TYB-001","price":100,"name":{"ar":"سجادة كلاسيك","en":"Classic"}}')`);
  await db.exec(migrationSql('0009_inventory.sql'));
}, 120_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await begin(db);
  await superuser();
  await db.query(
    `insert into public.catalog_docs(kind, id, slug, visible, data) values
       ('product', $1, 'p1', true, $4),
       ('product', $2, 'p2', true, $5),
       ('product', $3, 'p3', false, $6)
     on conflict (kind, id) do update set data = excluded.data, slug = excluded.slug, visible = excluded.visible`,
    [
      P1,
      P2,
      P3,
      JSON.stringify({ id: P1, sku: 'TYB-001', price: 100, name: { ar: 'سجادة كلاسيك', en: 'Classic' } }),
      JSON.stringify({ id: P2, sku: 'TYB-002', price: 200, name: { ar: 'مخدة', en: 'Cushion' } }),
      JSON.stringify({ id: P3, sku: 'TYB-003', price: 300, name: { ar: 'ستارة', en: 'Curtain' } }),
    ],
  );
  await admin();
});
afterEach(async () => {
  // ROLLBACK first: it works even when a failed statement left the transaction aborted
  await db.exec('rollback');
  await db.exec('reset role');
});

// ===========================================================================
describe('0009 — pre-flight guard (aborts before any change)', () => {
  const tables = ['stock_levels', 'stock_movements', 'stock_override_grants', 'inventory_order_decisions'];
  const exists = async (d: PGlite) =>
    (await d.query<{ c: number }>(`select count(*)::int c from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [tables])).rows[0].c;

  async function partial(files: string[], opts: { flag?: boolean } = {}) {
    const d = await baseDb();
    for (const f of files) await d.exec(migrationSql(f));
    if (opts.flag) {
      await d.exec(`insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`);
      await d.exec(`insert into public.catalog_docs(kind, id, slug, visible, data) values
    ('product', 'p1', 'p1', true, '{"id":"p1","sku":"TYB-001","price":100,"name":{"ar":"سجادة كلاسيك","en":"Classic"}}')`);
    }
    return d;
  }
  const apply = async (d: PGlite) => {
    try {
      await d.exec(migrationSql('0009_inventory.sql'));
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const FULL = ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0008_in_store_orders.sql'];

  it('aborts without catalog_docs (0006) and creates nothing', async () => {
    const d = await partial(['0001_orders.sql']);
    expect(await apply(d)).toMatch(/ABORT: migration 0009 needs .*catalog_docs.*0006/);
    expect(await exists(d)).toBe(0);
    await d.close();
  });

  it('aborts when the catalog has not been migrated into the database', async () => {
    const d = await partial(FULL);
    expect(await apply(d)).toMatch(/ABORT: migration 0009 needs .*migrated catalog/);
    expect(await exists(d)).toBe(0);
    await d.close();
  });

  it('aborts without orders.source (0008)', async () => {
    const d = await partial(['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql'], { flag: true });
    expect(await apply(d)).toMatch(/ABORT: migration 0009 needs .*orders\.source.*0008/);
    expect(await exists(d)).toBe(0);
    await d.close();
  });

  it('aborts without is_admin() (0003) and lists every missing dependency at once', async () => {
    const d = await partial(['0001_orders.sql']);
    const msg = await apply(d);
    expect(msg).toMatch(/catalog_docs/);
    expect(msg).toMatch(/orders\.source/);
    expect(msg).toMatch(/Nothing was changed/);
    await d.close();
  });

  it('applies when everything is present, and is re-runnable', async () => {
    const d = await partial(FULL, { flag: true });
    expect(await apply(d)).toBe('');
    expect(await exists(d)).toBe(4);
    expect(await apply(d)).toBe('');
    await d.close();
  });
});

// ===========================================================================
describe('0009 — order behaviour is untouched', () => {
  const snapshot = async (d: PGlite) => {
    const cols = await d.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='orders' order by ordinal_position`);
    const trg = await d.query(`select tgname, pg_get_triggerdef(oid) def from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal order by tgname`);
    const pol = await d.query(`select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'orders' order by policyname`);
    const con = await d.query(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.orders'::regclass order by conname`);
    const fns = await d.query(`select proname, md5(prosrc) h from pg_proc where proname in ('enqueue_order_email','validate_in_store_order','guard_order_update','log_order_created','log_order_status_change') order by proname`);
    return JSON.stringify([cols.rows, trg.rows, pol.rows, con.rows, fns.rows]);
  };

  it('0009 adds no trigger, policy, constraint or column to orders and redefines none of its functions', async () => {
    const d = await baseDb();
    for (const f of ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0007_product_internal_pricing.sql', '0008_in_store_orders.sql']) {
      await d.exec(migrationSql(f));
    }
    await d.exec(`insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`);
    await d.exec(`insert into public.catalog_docs(kind, id, slug, visible, data) values
    ('product', 'p1', 'p1', true, '{"id":"p1","sku":"TYB-001","price":100,"name":{"ar":"سجادة كلاسيك","en":"Classic"}}')`);
    const before = await snapshot(d);
    await d.exec(migrationSql('0009_inventory.sql'));
    expect(await snapshot(d)).toBe(before);
    await d.close();
  });

  it('delivering, selling in store and checking out still work exactly as before, and move no stock', async () => {
    await superuser();
    await db.query(`insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
                    values ($1,'ONL','pending','{}','{}','{"method":"standard"}','[{"productId":"p1","qty":1,"price":100}]',100,100)`, [O1]);
    await admin();
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [O1]);
    await as(db, 'anon');
    await db.query(`insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
                    values ($1,'ONL2','pending','{}','{}','{"method":"standard"}','[]',1,1)`, [O2]);
    await admin();
    await db.query(`insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
                    values ($1,'STORE','sold','in_store','{}','{}','{"method":"in_store"}',$2,100,100)`,
                   [O3, JSON.stringify([{ productId: P1, qty: 1, price: 100 }])]);
    await superuser();
    expect(await count('select 1 from public.orders')).toBe(3);
    expect(await count('select 1 from public.stock_movements')).toBe(0);
    expect(await count('select 1 from public.stock_levels')).toBe(0);
  });
});

// ===========================================================================
describe('0009 — privacy and permissions', () => {
  const TABLES = ['stock_levels', 'stock_movements', 'stock_override_grants', 'inventory_order_decisions'];
  const PUBLIC_CALLS = [
    `select public.inventory_set_opening('p1', 1, 'reason abc')`,
    `select public.inventory_import_opening('[{"product_id":"p1","quantity":1}]'::jsonb, true)`,
    `select public.inventory_adjust('p1', 1, 'reason abc')`,
    `select public.inventory_receive('p1', 1, null, 'reason abc')`,
    `select public.inventory_record_return('p1', 1, true, 'reason abc')`,
    `select public.inventory_set_threshold('p1', 1)`,
    `select public.inventory_init_removed_product('gone', 'reason abc')`,
    `select public.inventory_decide_order(gen_random_uuid(), 'already_accounted', 'reason abc', 'x')`,
    `select * from public.inventory_preflight_report()`,
    `select * from public.inventory_reconcile()`,
    `select public.inventory_reconcile_summary()`,
  ];
  const INTERNAL_CALLS = [
    `select public.inventory_require_admin()`,
    `select public.inventory_init_product('p1', 1, 'reason abc')`,
    `select public.inventory_write_movement('p1', 'opening', 1, 1, 0, 'reason abc')`,
    `select * from public.inventory_order_audit()`,
    `select public.inventory_lines_hash('[]'::jsonb)`,
  ];

  it('anonymous visitors cannot read any inventory table or call anything', async () => {
    await setOpening(P1, 5);
    await as(db, 'anon');
    for (const t of TABLES) expect((await errOf(`select * from public.${t}`)).message).toMatch(/permission denied/);
    for (const c of [...PUBLIC_CALLS, ...INTERNAL_CALLS]) expect((await errOf(c)).message).toMatch(/permission denied/);
  });

  it('a signed-in NON-admin sees no rows and every admin operation says forbidden', async () => {
    await setOpening(P1, 5);
    await asUser();
    for (const t of TABLES) expect(await count(`select 1 from public.${t}`)).toBe(0);
    for (const c of PUBLIC_CALLS) expect((await errOf(c)).message).toMatch(/forbidden/);
    for (const c of INTERNAL_CALLS) expect((await errOf(c)).message).toMatch(/permission denied/);
    await superuser();
    expect(await count('select 1 from public.stock_movements')).toBe(1); // nothing was written by the denied calls
  });

  it('an admin can read, but NOT write, any table directly — and cannot call the internal helpers', async () => {
    await setOpening(P1, 5);
    for (const t of TABLES) expect(await count(`select 1 from public.${t}`)).toBeGreaterThanOrEqual(0);
    expect(await count('select 1 from public.stock_levels')).toBe(1);
    expect((await errOf(`insert into public.stock_levels(product_id, on_hand) values ('x', 1)`)).message).toMatch(/permission denied/);
    expect((await errOf(`update public.stock_levels set on_hand = 999`)).message).toMatch(/permission denied/);
    expect((await errOf(`delete from public.stock_levels`)).message).toMatch(/permission denied/);
    expect((await errOf(`update public.stock_movements set reason = 'x'`)).message).toMatch(/permission denied/);
    expect((await errOf(`delete from public.stock_movements`)).message).toMatch(/permission denied/);
    expect((await errOf(`truncate public.stock_movements`)).message).toMatch(/permission denied/);
    expect((await errOf(`insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
        values (gen_random_uuid(), 'deliver_order', gen_random_uuid(), 'p1', 2, 1, 1, 'reason abc', gen_random_uuid(), 1)`)).message).toMatch(/permission denied/);
    expect((await errOf(`insert into public.inventory_order_decisions(order_id, decision, reason, lines_hash, status_at_decision, decided_by)
        values (gen_random_uuid(), 'already_accounted', 'reason abc', 'x', 'pending', gen_random_uuid())`)).message).toMatch(/permission denied/);
    for (const c of INTERNAL_CALLS) expect((await errOf(c)).message).toMatch(/permission denied/);
    expect(await stock(P1)).toMatchObject({ on_hand: 5 });
  });

  it('quantities are not stored in the world-readable catalog documents', async () => {
    await setOpening(P1, 5);
    await superuser();
    expect(await count(`select 1 from public.catalog_docs where data::text ~* '(on_hand|stock_quantity|low_threshold)'`)).toBe(0);
  });
});

// ===========================================================================
describe('0009 — opening balances', () => {
  it('records an explicit opening with actor, e-mail, snapshot, before/after and reason', async () => {
    const r = (await setOpening(P1, 12, 'جرد افتتاحي')).r;
    expect(r).toMatchObject({ status: 'created', on_hand: 12 });
    expect(await stock(P1)).toEqual({ on_hand: 12, low_threshold: 0 });
    expect(await ledger(P1)).toEqual([
      { kind: 'opening', quantity: 12, qty_delta: 12, qty_before: 0, qty_after: 12, reason: 'جرد افتتاحي', order_id: null },
    ]);
    const m = await one('select actor, actor_email, product_name, product_sku, idempotency_key, created_at from public.stock_movements');
    expect(m).toMatchObject({ actor: ADMIN, actor_email: `${ADMIN}@example.test`, product_name: 'سجادة كلاسيك', product_sku: 'TYB-001', idempotency_key: 'opening:p1' });
    expect(m.created_at).toBeTruthy();
  });

  it('zero is a valid, explicit opening balance (initialized, not "missing")', async () => {
    await setOpening(P2, 0);
    expect(await stock(P2)).toMatchObject({ on_hand: 0 });
    expect(await count(`select 1 from public.stock_movements where product_id = 'p2' and kind = 'opening' and quantity = 0`)).toBe(1);
  });

  it('NEVER overwrites: a second call reports "exists" and changes nothing', async () => {
    await setOpening(P1, 12);
    const again = (await setOpening(P1, 999)).r;
    expect(again).toMatchObject({ status: 'exists', on_hand: 12, requested: 999 });
    expect(await stock(P1)).toMatchObject({ on_hand: 12 });
    expect(await ledger(P1)).toHaveLength(1);
  });

  it('rejects an unknown product, a bad quantity and a too-short reason', async () => {
    expect((await errOf(`select public.inventory_set_opening('nope', 1, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    for (const bad of ['-1', '10000001']) {
      expect((await errOf(`select public.inventory_set_opening('p1', ${bad}, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    }
    expect((await errOf(`select public.inventory_set_opening('p1', null, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_set_opening('p1', 1, 'ab')`)).message).toMatch(/inventory_invalid/);
    expect(await count('select 1 from public.stock_levels')).toBe(0);
  });
});

describe('0009 — re-applying the migration', () => {
  it('keeps every balance, ledger row, threshold and decision, and the ledger stays append-only', async () => {
    await setOpening(P1, 9);
    await one(`select public.inventory_set_threshold('p1', 3)`);
    await adjust(P1, 7, 'جرد فعلي');
    await superuser();
    await db.exec(migrationSql('0009_inventory.sql'));
    await admin();
    expect(await stock(P1)).toEqual({ on_hand: 7, low_threshold: 3 });
    expect(await ledger(P1)).toHaveLength(2);
    await superuser();
    expect((await errOf(`delete from public.stock_movements`)).message).toMatch(/append-only/);
  });
});

describe('0009 — batch opening import', () => {
  const imp = (rows: unknown[], dry = true) =>
    one<{ r: { dry_run: boolean; created: number; skipped: number; rejected: number; rows: Array<{ product_id: string; status: string }>; catalog_products_not_in_batch_and_uninitialized: number; catalog_products_not_in_batch_sample: string[] } }>(
      'select public.inventory_import_opening($1::jsonb, $2) r', [JSON.stringify(rows), dry]);

  it('a dry run reports and writes nothing', async () => {
    const { r } = await imp([{ product_id: P1, quantity: 5 }, { product_id: P2, quantity: 0 }]);
    expect(r).toMatchObject({ dry_run: true, created: 2, rejected: 0 });
    expect(r.rows.map((x) => x.status)).toEqual(['would_create', 'would_create']);
    expect(await count('select 1 from public.stock_levels')).toBe(0);
    expect(await count('select 1 from public.stock_movements')).toBe(0);
  });

  it('a real run creates explicit balances (zero included) and reports what was NOT in the batch — never filling it', async () => {
    const { r } = await imp([{ product_id: P1, quantity: 5 }, { product_id: P2, quantity: 0 }], false);
    expect(r).toMatchObject({ dry_run: false, created: 2 });
    expect(await stock(P1)).toMatchObject({ on_hand: 5 });
    expect(await stock(P2)).toMatchObject({ on_hand: 0 });
    expect(r.catalog_products_not_in_batch_and_uninitialized).toBe(1);
    expect(r.catalog_products_not_in_batch_sample).toEqual([P3]);
    expect(await count(`select 1 from public.stock_levels where product_id = 'p3'`)).toBe(0); // not silently zero-filled
  });

  it('never overwrites: existing balances are skipped, and re-running is harmless', async () => {
    await setOpening(P1, 12);
    const first = (await imp([{ product_id: P1, quantity: 999 }, { product_id: P2, quantity: 3 }], false)).r;
    expect(first).toMatchObject({ created: 1, skipped: 1 });
    expect(await stock(P1)).toMatchObject({ on_hand: 12 });
    const again = (await imp([{ product_id: P1, quantity: 999 }, { product_id: P2, quantity: 3 }], false)).r;
    expect(again).toMatchObject({ created: 0, skipped: 2 });
    expect(await ledger(P2)).toHaveLength(1);
  });

  it('is all-or-nothing about INVALID input: unknown product, bad quantity or duplicate writes nothing', async () => {
    const cases: unknown[][] = [
      [{ product_id: P1, quantity: 1 }, { product_id: 'nope', quantity: 1 }],
      [{ product_id: P1, quantity: 1 }, { product_id: P2, quantity: -3 }],
      [{ product_id: P1, quantity: 1 }, { product_id: P2, quantity: 1.5 }],
      [{ product_id: P1, quantity: 1 }, { product_id: P2, quantity: '4' }],
      [{ product_id: P1, quantity: 1 }, { product_id: P1, quantity: 2 }],
      [{ product_id: P1, quantity: 1 }, 'garbage'],
    ];
    for (const rows of cases) {
      const dry = (await imp(rows, true)).r;
      expect(dry.rejected).toBeGreaterThan(0);
      expect((await errOf('select public.inventory_import_opening($1::jsonb, false)', [JSON.stringify(rows)])).message).toMatch(/inventory_invalid/);
    }
    expect(await count('select 1 from public.stock_levels')).toBe(0);
  });

  it('rejects malformed batches', async () => {
    expect((await errOf(`select public.inventory_import_opening('{}'::jsonb, true)`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_import_opening('[]'::jsonb, true)`)).message).toMatch(/inventory_invalid/);
  });
});

// ===========================================================================
describe('0009 — manual adjustment', () => {
  it('sets the counted quantity and records before/after, delta, reason, actor and e-mail', async () => {
    await setOpening(P1, 10);
    const r = (await adjust(P1, 7, 'تلف في المخزن')).r;
    expect(r).toMatchObject({ status: 'recorded', kind: 'adjustment', qty_delta: -3, qty_before: 10, qty_after: 7, quantity: 3 });
    expect(await stock(P1)).toMatchObject({ on_hand: 7 });
    const rows = await ledger(P1);
    expect(rows[1]).toMatchObject({ kind: 'adjustment', qty_delta: -3, qty_before: 10, qty_after: 7, reason: 'تلف في المخزن' });
    expect(await one('select actor, actor_email from public.stock_movements where kind = $1', ['adjustment'])).toMatchObject({ actor: ADMIN, actor_email: `${ADMIN}@example.test` });
  });

  it('an unchanged count records nothing', async () => {
    await setOpening(P1, 10);
    expect((await adjust(P1, 10)).r).toMatchObject({ status: 'unchanged', on_hand: 10 });
    expect(await ledger(P1)).toHaveLength(1);
  });

  it('refuses a negative count, a missing product balance and a too-short reason', async () => {
    await setOpening(P1, 10);
    expect((await errOf(`select public.inventory_adjust('p1', -1, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_adjust('p1', 5, 'ab')`)).message).toMatch(/inventory_invalid/);
    const e = await errOf(`select public.inventory_adjust('p2', 5, 'reason abc')`);
    expect(e.message).toMatch(/stock_not_initialized/);
    expect(e.code).toBe('IS001');
    expect(await stock(P1)).toMatchObject({ on_hand: 10 });
  });

  it('can raise a NEGATIVE balance (left by an audited override) back to a real count', async () => {
    await setOpening(P1, 2);
    await superuser();
    await db.query(`insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
                    values ($1,'N','delivered','{}','{}','{}','[{"productId":"p1","qty":5,"price":1}]',5,5)`, [O1]);
    await db.query(`update public.stock_levels set on_hand = -3 where product_id = 'p1'`);
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id)
                    values ('p1','sale',5,-5,2,-3,'seed negative',$1)`, [O1]);
    await admin();
    expect((await adjust(P1, 4, 'جرد بعد البيع الزائد')).r).toMatchObject({ qty_before: -3, qty_after: 4, qty_delta: 7 });
  });

  it('an idempotency key makes a retry return the original result and write once', async () => {
    await setOpening(P1, 10);
    const first = (await adjust(P1, 7, 'جرد فعلي', 'adj-1')).r;
    const retry = (await adjust(P1, 7, 'جرد فعلي', 'adj-1')).r;
    expect(first.status).toBe('recorded');
    expect(retry).toMatchObject({ status: 'replayed', movement_id: first.movement_id });
    expect(await ledger(P1)).toHaveLength(2);
    expect(await stock(P1)).toMatchObject({ on_hand: 7 });
    // the same key cannot be reused for another product or operation
    await setOpening(P2, 4);
    expect((await errOf(`select public.inventory_adjust('p2', 1, 'reason abc', 'adj-1')`)).message).toMatch(/idempotency key/);
    expect((await errOf(`select public.inventory_receive('p1', 1, null, 'reason abc', 'adj-1')`)).message).toMatch(/idempotency key/);
  });
});

describe('0009 — stock receipts (no supplier, no cost)', () => {
  it('adds the quantity with reference, reason and before/after', async () => {
    await setOpening(P1, 10);
    const r = (await one<{ r: Row }>(`select public.inventory_receive('p1', 25, 'فاتورة 114', 'استلام شحنة') r`)).r;
    expect(r).toMatchObject({ kind: 'receipt', qty_delta: 25, qty_before: 10, qty_after: 35 });
    expect(await stock(P1)).toMatchObject({ on_hand: 35 });
    expect(await one(`select reference, reason from public.stock_movements where kind = 'receipt'`)).toEqual({ reference: 'فاتورة 114', reason: 'استلام شحنة' });
  });

  it('rejects non-positive quantities and uninitialized products; stores no cost column', async () => {
    await setOpening(P1, 10);
    for (const bad of ['0', '-4', 'null']) {
      expect((await errOf(`select public.inventory_receive('p1', ${bad}, null, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    }
    expect((await errOf(`select public.inventory_receive('p2', 1, null, 'reason abc')`)).code).toBe('IS001');
    expect(await count(`select 1 from information_schema.columns where table_name = 'stock_movements' and column_name ~* '(cost|price|supplier)'`)).toBe(0);
  });
});

describe('0009 — returns (resaleable vs damaged)', () => {
  it('RESALEABLE: on_hand increases and the ledger records the restock', async () => {
    await setOpening(P1, 10);
    const r = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 3, true, 'مرتجع سليم') r`)).r;
    expect(r).toMatchObject({ kind: 'return_restock', qty_delta: 3, qty_before: 10, qty_after: 13, quantity: 3 });
    expect(await stock(P1)).toMatchObject({ on_hand: 13 });
  });

  it('DAMAGED: on_hand does NOT change, yet the units, reason and actor are recorded (delta 0, before = after)', async () => {
    await setOpening(P1, 10);
    const r = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 4, false, 'تالف أثناء الشحن') r`)).r;
    expect(r).toMatchObject({ kind: 'return_damaged', qty_delta: 0, qty_before: 10, qty_after: 10, quantity: 4 });
    expect(await stock(P1)).toMatchObject({ on_hand: 10 });
    const row = await one(`select kind, quantity, qty_delta, qty_before, qty_after, reason, actor from public.stock_movements where kind = 'return_damaged'`);
    expect(row).toMatchObject({ quantity: 4, qty_delta: 0, qty_before: 10, qty_after: 10, reason: 'تالف أثناء الشحن', actor: ADMIN });
    // damaged units never add to the ledger total, so the balance still reconciles
    expect((await one<{ s: Record<string, unknown> }>(`select public.inventory_reconcile_summary() s`)).s).toMatchObject({ integrity_errors: 0 });
    expect(await count(`select 1 from public.inventory_reconcile() where category = 'integrity' and severity = 'error'`)).toBe(0);
  });

  it('the admin MUST choose: a missing (null) resaleable flag is rejected', async () => {
    await setOpening(P1, 10);
    const e = await errOf(`select public.inventory_record_return('p1', 1, null, 'reason abc')`);
    expect(e.message).toMatch(/inventory_invalid/);
    expect(await ledger(P1)).toHaveLength(1);
  });

  it('needs an initialized balance and a valid quantity and reason', async () => {
    await setOpening(P1, 10);
    expect((await errOf(`select public.inventory_record_return('p2', 1, true, 'reason abc')`)).code).toBe('IS001');
    expect((await errOf(`select public.inventory_record_return('p1', 0, true, 'reason abc')`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_record_return('p1', 1, true, 'ab')`)).message).toMatch(/inventory_invalid/);
  });

  it('a linked return may not exceed the quantity sold (resaleable + damaged together); the link stays optional', async () => {
    await setOpening(P1, 10);
    await mkOrder({
      id: O1,
      ref: 'R1',
      status: 'delivered',
      lines: [
        { productId: P1, qty: 2, price: 100, variantId: 'a' },
        { productId: P1, qty: 1, price: 100, variantId: 'b' }, // two variants of one product add up: 3 sold
        { productId: P2, qty: 1, price: 200 },
      ],
    });
    const ret = (qty: number, resell: boolean) =>
      one<{ r: Row }>('select public.inventory_record_return($1, $2, $3, $4, $5) r', [P1, qty, resell, 'مرتجع', O1]);
    expect((await ret(2, true)).r).toMatchObject({ kind: 'return_restock' });
    expect((await ret(1, false)).r).toMatchObject({ kind: 'return_damaged' });
    const e = await errOf('select public.inventory_record_return($1, 1, true, $2, $3)', [P1, 'مرتجع', O1]);
    expect(e.message).toMatch(/inventory_invalid/);
    expect(e.message).toMatch(/inventory_invalid/);
    expect(await stock(P1)).toMatchObject({ on_hand: 12 });
    // not linked: allowed
    expect((await one<{ r: Row }>(`select public.inventory_record_return('p1', 1, true, 'مرتجع بدون طلب') r`)).r).toMatchObject({ status: 'recorded' });
  });

  it('rejects a link to an unknown order or to an order that does not contain the product', async () => {
    await setOpening(P1, 10);
    await setOpening(P3, 1);
    await mkOrder({ id: O1, ref: 'R1', status: 'delivered' });
    expect((await errOf(`select public.inventory_record_return('p1', 1, true, 'reason abc', gen_random_uuid())`)).message).toMatch(/inventory_invalid/);
    const e = await errOf('select public.inventory_record_return($1, 1, true, $2, $3)', [P3, 'reason abc', O1]);
    expect(e.message).toMatch(/inventory_invalid/);
  });

  it('is idempotent with a key', async () => {
    await setOpening(P1, 10);
    const a = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 2, true, 'reason abc', null, 'ret-1') r`)).r;
    const b = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 2, true, 'reason abc', null, 'ret-1') r`)).r;
    expect(b).toMatchObject({ status: 'replayed', movement_id: a.movement_id });
    expect(await stock(P1)).toMatchObject({ on_hand: 12 });
  });
});

describe('0009 — thresholds and removed products', () => {
  it('sets the minimum threshold for initialized products only (not a ledger movement)', async () => {
    await setOpening(P1, 10);
    await one(`select public.inventory_set_threshold('p1', 4)`);
    expect(await stock(P1)).toEqual({ on_hand: 10, low_threshold: 4 });
    expect(await ledger(P1)).toHaveLength(1);
    expect((await errOf(`select public.inventory_set_threshold('p1', -1)`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_set_threshold('p2', 1)`)).code).toBe('IS001');
  });

  it('initializes a zero balance for a DELETED product referenced by a historical order, keeping its snapshot', async () => {
    await mkOrder({ id: O1, ref: 'H1', status: 'delivered', lines: [{ productId: 'gone', qty: 2, price: 50, name: { ar: 'منتج محذوف' }, variantSku: 'OLD-SKU' }] });
    const r = (await one<{ r: Row }>(`select public.inventory_init_removed_product('gone', 'منتج محذوف من الكتالوج') r`)).r;
    expect(r).toMatchObject({ status: 'created', on_hand: 0 });
    expect(await one(`select on_hand, product_name, product_sku from public.stock_levels where product_id = 'gone'`)).toEqual({ on_hand: 0, product_name: 'منتج محذوف', product_sku: 'OLD-SKU' });
    expect(await ledger('gone')).toEqual([
      { kind: 'opening', quantity: 0, qty_delta: 0, qty_before: 0, qty_after: 0, reason: 'منتج محذوف من الكتالوج', order_id: null },
    ]);
    expect((await one<{ r: Row }>(`select public.inventory_init_removed_product('gone', 'منتج محذوف من الكتالوج') r`)).r).toMatchObject({ status: 'exists' });
    // the historical product is not a live catalog product, yet it reconciles cleanly
    expect(await count(`select 1 from public.inventory_reconcile() where severity = 'error' and product_id = 'gone'`)).toBe(0);
  });

  it('refuses a product that still exists in the catalog, or that no order references', async () => {
    await mkOrder({ id: O1, ref: 'H1', status: 'delivered' });
    expect((await errOf(`select public.inventory_init_removed_product('p1', 'reason abc')`)).message).toMatch(/inventory_invalid/);
    expect((await errOf(`select public.inventory_init_removed_product('never-existed', 'reason abc')`)).message).toMatch(/inventory_invalid/);
    expect(await count('select 1 from public.stock_levels')).toBe(0);
  });
});

// ===========================================================================
describe('0009 — the ledger is append-only and well-formed', () => {
  const ins = (cols: string, vals: string) => `insert into public.stock_movements(product_id, ${cols}) values ('p1', ${vals})`;
  const base = `kind, quantity, qty_delta, qty_before, qty_after, reason`;

  it('rejects UPDATE, DELETE and TRUNCATE — even for the table owner', async () => {
    await setOpening(P1, 5);
    await superuser();
    expect((await errOf(`update public.stock_movements set reason = 'tampered'`)).message).toMatch(/append-only/);
    expect((await errOf(`update public.stock_movements set qty_after = 99`)).message).toMatch(/append-only/);
    expect((await errOf(`delete from public.stock_movements`)).message).toMatch(/append-only/);
    expect((await errOf(`truncate public.stock_movements`)).message).toMatch(/append-only/);
    expect(await count('select 1 from public.stock_movements')).toBe(1);
  });

  it('enforces the row rules for every kind', async () => {
    await superuser();
    const bad: Array<[string, string]> = [
      [base, `'opening', 5, 5, 1, 6, 'reason abc'`], // opening must start at 0
      [base, `'opening', 5, 4, 0, 4, 'reason abc'`], // opening delta = quantity
      [base, `'receipt', 5, 4, 1, 5, 'reason abc'`],
      [base, `'receipt', 0, 0, 1, 1, 'reason abc'`],
      [base, `'adjustment', 0, 0, 1, 1, 'reason abc'`], // no no-op adjustments
      [base, `'adjustment', 5, 3, 1, 4, 'reason abc'`],
      [base, `'return_restock', 2, 1, 1, 2, 'reason abc'`],
      [base, `'return_damaged', 2, 2, 5, 7, 'reason abc'`], // a damaged return can NEVER add stock
      [base, `'return_damaged', 2, -2, 5, 3, 'reason abc'`],
      [base, `'return_damaged', 0, 0, 5, 5, 'reason abc'`], // and must record the units
      [base, `'sale', 2, 2, 5, 7, 'reason abc'`],
      [base, `'bogus', 1, 1, 0, 1, 'reason abc'`],
      [base, `'receipt', 1, 1, 5, 7, 'reason abc'`], // after <> before + delta
      [base, `'receipt', 1, 1, 5, 6, 'ab'`], // reason too short
      [`${base}, order_id`, `'receipt', 1, 1, 5, 6, 'reason abc', gen_random_uuid()`], // receipts carry no order
    ];
    for (const [cols, vals] of bad) {
      const e = await errOf(ins(cols, vals));
      expect(e.message).toMatch(/violates|check|foreign key/);
    }
    // a sale needs an order; a sale_accounted row carries units but no delta
    expect((await errOf(ins(base, `'sale', 2, -2, 5, 3, 'reason abc'`))).message).toMatch(/stock_movements_order_rules/);
    expect((await errOf(ins(`${base}, order_id`, `'sale_accounted', 2, -2, 5, 3, 'reason abc', gen_random_uuid()`))).message).toMatch(/stock_movements_kind_rules|foreign key/);
  });

  it('override fields are tied together: no override flag without a grant, no shortfall without an override', async () => {
    await superuser();
    await db.query(`insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total) values ($1,'O','delivered','{}','{}','{}','[]',0,0)`, [O1]);
    const cols = `${base}, order_id, shortfall`;
    expect((await errOf(ins(cols, `'sale', 2, -2, 5, 3, 'reason abc', '${O1}', 1`))).message).toMatch(/stock_movements_override_rules/);
    expect((await errOf(ins(`${cols}, override_grant_id`, `'sale', 2, -2, 5, 3, 'reason abc', '${O1}', 0, gen_random_uuid()`))).message).toMatch(/foreign key|override_rules/);
  });

  it('the idempotency key is unique', async () => {
    await setOpening(P1, 5);
    await adjust(P1, 4, 'جرد فعلي', 'k-1');
    await superuser();
    expect((await errOf(ins(`${base}, idempotency_key`, `'receipt', 1, 1, 4, 5, 'reason abc', 'k-1'`))).message).toMatch(/duplicate key|unique/);
  });

  it('a product has exactly one opening row, even if the balance row is removed and re-added', async () => {
    await setOpening(P1, 5);
    await superuser();
    await db.query(`delete from public.stock_levels where product_id = 'p1'`);
    expect((await errOf(`select public.inventory_init_product('p1', 9, 'reason abc')`)).message).toMatch(/duplicate key|unique/);
  });
});

// ===========================================================================
describe('0009 — override grants (table rules; the RPCs that use them arrive with 0010)', () => {
  const grant = (over: Record<string, unknown> = {}) => {
    const g = { key: 'a0000000-0000-0000-0000-000000000001', op: 'deliver_order', order: O1, pid: P1, req: 5, avail: 2, short: 3, reason: 'reason abc', ...over };
    return db.query(
      `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, txid_current())`,
      [g.key, g.op, g.order, g.pid, g.req, g.avail, g.short, g.reason, ADMIN],
    );
  };
  beforeEach(async () => {
    await superuser();
    await db.query(`insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total) values ($1,'O','pending','{}','{}','{}','[]',0,0)`, [O1]);
  });

  it('shortfall must equal requested - available, the reason needs 5+ characters, the operation is restricted', async () => {
    expect((await fails(db, `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
       values (gen_random_uuid(),'deliver_order',$1,'p1',5,2,1,'reason abc',$2,1)`, [O1, ADMIN])).message).toMatch(/check/);
    expect((await fails(db, `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
       values (gen_random_uuid(),'deliver_order',$1,'p1',5,2,3,'abcd',$2,1)`, [O1, ADMIN])).message).toMatch(/check/);
    expect((await fails(db, `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
       values (gen_random_uuid(),'anything',$1,'p1',5,2,3,'reason abc',$2,1)`, [O1, ADMIN])).message).toMatch(/check/);
  });

  it('each ATTEMPT has its own key: a retry with a new key is never blocked, the same (attempt, product) is unique', async () => {
    await grant();
    await grant({ key: 'a0000000-0000-0000-0000-000000000002' }); // same order+product, new attempt: fine
    expect((await fails(db, `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
       values ('a0000000-0000-0000-0000-000000000001','deliver_order',$1,'p1',5,2,3,'reason abc',$2,1)`, [O1, ADMIN])).message).toMatch(/duplicate key|unique/);
  });

  it('a grant can be consumed exactly once and nothing else about it can ever change', async () => {
    await grant();
    expect((await errOf(`update public.stock_override_grants set reason = 'changed reason'`)).message).toMatch(/consumed exactly once/);
    expect((await errOf(`update public.stock_override_grants set shortfall = 1, requested_qty = 3`)).message).toMatch(/consumed exactly once/);
    await db.query(`update public.stock_override_grants set consumed_at = now() where consumed_at is null`);
    expect((await errOf(`update public.stock_override_grants set consumed_at = now()`)).message).toMatch(/consumed exactly once/);
    expect((await errOf(`update public.stock_override_grants set consumed_at = null`)).message).toMatch(/consumed exactly once/);
    expect((await errOf(`delete from public.stock_override_grants`)).message).toMatch(/consumed exactly once/);
    await db.exec('set constraints all immediate');
    // blocked either by the append-only trigger or, because movements reference it, by the foreign key
    expect((await errOf(`truncate public.stock_override_grants`)).message).toMatch(/append-only|referenced in a foreign key/);
  });

  it('the order reference is checked at COMMIT (deferred, so a grant can precede its order)', async () => {
    await grant({ order: '99999999-9999-9999-9999-999999999999' }); // accepted for now: the order may still be created
    expect((await errOf('set constraints all immediate')).message).toMatch(/foreign key|violates/);
  });

  it('an order that has a grant cannot be deleted', async () => {
    await grant();
    await db.exec('set constraints all immediate');
    expect((await errOf('delete from public.orders where id = $1', [O1])).message).toMatch(/foreign key|violates/);
  });

  it('a movement can reference a grant at most once', async () => {
    await grant();
    const gid = (await one<{ id: string }>('select id from public.stock_override_grants')).id;
    await admin();
    await setOpening(P1, 2);
    await superuser();
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id, override, shortfall, override_grant_id)
                    values ('p1','sale',5,-5,2,-3,'reason abc',$1,true,3,$2)`, [O1, gid]);
    expect((await errOf(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id, override, shortfall, override_grant_id)
                    values ('p1','sale',1,-1,-3,-4,'reason abc',$1,true,3,$2)`, [O1, gid])).message).toMatch(/duplicate key|unique/);
  });
});

// ===========================================================================
describe('0009 — reconciliation decisions (append-only, bound to the lines shown)', () => {
  const hashOf = async (id: string) => (await one<{ h: string }>('select lines_hash h from public.inventory_preflight_report() where order_id = $1 limit 1', [id])).h;
  const decide = (id: string, decision: string, hash: string, reason = 'تم التحقق يدويًا') =>
    one<{ r: Row }>('select public.inventory_decide_order($1, $2, $3, $4) r', [id, decision, reason, hash]);
  const decisions = (id: string) =>
    q<{ decision: string; superseded: boolean; by: string }>(
      `select decision, superseded_by is not null superseded, decided_by::text by from public.inventory_order_decisions where order_id = $1 order by (superseded_by is null), id`, [id]);

  beforeEach(async () => {
    await mkOrder({ id: O1, ref: 'D1', status: 'shipped', history: [['pending', 0], ['shipped', 1]], updatedMin: 1 });
  });

  it('records a decision for the exact lines that were shown', async () => {
    const r = (await decide(O1, 'deduct_on_delivery', await hashOf(O1))).r;
    expect(r).toMatchObject({ status: 'recorded', decision: 'deduct_on_delivery' });
    expect(await one(`select decision, status_at_decision, reason, decided_by from public.inventory_order_decisions`)).toMatchObject({
      decision: 'deduct_on_delivery', status_at_decision: 'shipped', reason: 'تم التحقق يدويًا', decided_by: ADMIN });
  });

  it('refuses a stale lines_hash, a short reason, an unknown order, an unknown decision, and the settled_legacy classification', async () => {
    const h = await hashOf(O1);
    expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'تم التحقق', 'stale'])).message).toMatch(/inventory_invalid/);
    expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'abcd', h])).message).toMatch(/inventory_invalid/);
    expect((await errOf('select public.inventory_decide_order(gen_random_uuid(), $1, $2, $3)', ['deduct_on_delivery', 'تم التحقق', h])).message).toMatch(/inventory_invalid/);
    for (const d of ['whatever', 'settled_legacy']) {
      expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, d, 'تم التحقق', h])).message).toMatch(/inventory_invalid/);
    }
    expect(await count('select 1 from public.inventory_order_decisions')).toBe(0);
  });

  it('the hash changes when the order lines change, so an old decision can no longer be recorded', async () => {
    const before = await hashOf(O1);
    await superuser();
    await db.query(`update public.orders set lines = '[{"productId":"p1","qty":9,"price":100}]' where id = $1`, [O1]);
    await admin();
    expect(await hashOf(O1)).not.toBe(before);
    expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'تم التحقق', before])).message).toMatch(/lines_changed/);
  });

  it('is append-only: a newer decision SUPERSEDES the old one; exactly one is current; identical retries add nothing', async () => {
    const h = await hashOf(O1);
    await decide(O1, 'deduct_on_delivery', h);
    expect((await decide(O1, 'deduct_on_delivery', h)).r).toMatchObject({ status: 'unchanged' });
    expect(await decisions(O1)).toHaveLength(1);
    await decide(O1, 'already_accounted', h, 'البضاعة خرجت قبل الجرد');
    const all = await decisions(O1);
    expect(all.map((d) => [d.decision, d.superseded])).toEqual([['deduct_on_delivery', true], ['already_accounted', false]]);
    expect(await count(`select 1 from public.inventory_order_decisions where order_id = $1 and superseded_by is null`, [O1])).toBe(1);
    await superuser();
    expect((await errOf(`update public.inventory_order_decisions set decision = 'deduct_on_delivery' where superseded_by is null`)).message).toMatch(/append-only/);
    expect((await errOf(`update public.inventory_order_decisions set reason = 'edited reason'`)).message).toMatch(/append-only/);
    expect((await errOf(`delete from public.inventory_order_decisions`)).message).toMatch(/append-only/);
    await db.exec('set constraints all immediate');
    expect((await errOf(`truncate public.inventory_order_decisions`)).message).toMatch(/append-only|referenced in a foreign key/);
  });

  it('an order that is already delivered can only be recorded as already_accounted', async () => {
    await mkOrder({ id: O2, ref: 'D2', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1 });
    const h = await hashOf(O2);
    expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O2, 'deduct_on_delivery', 'تم التحقق', h])).message).toMatch(/already_accounted/);
    expect((await decide(O2, 'already_accounted', h)).r).toMatchObject({ status: 'recorded' });
  });

  it('refuses a decision for an order inventory has already processed', async () => {
    await setOpening(P1, 5);
    const h = await hashOf(O1);
    await superuser();
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id)
                    values ('p1','sale_accounted',2,0,5,5,'seed',$1)`, [O1]);
    await admin();
    expect((await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'تم التحقق', h])).message).toMatch(/already processed/);
  });
});

// ===========================================================================
describe('0009 — preflight report: history is NOT trusted, ambiguity is flagged', () => {
  type Rep = { order_id: string; classification: string; issues: string[]; needs_decision: boolean; product_id: string | null; qty: number | null; product_in_catalog: boolean | null; stock_initialized: boolean | null; decision: string | null; decision_matches_lines: boolean | null; decision_status_changed: boolean | null };
  const report = () => q<Rep>('select order_id, classification, issues, needs_decision, product_id, qty, product_in_catalog, stock_initialized, decision, decision_matches_lines, decision_status_changed from public.inventory_preflight_report()');
  const forOrder = async (id: string) => (await report()).filter((r) => r.order_id === id);
  const issuesOf = async (id: string) => [...new Set((await forOrder(id)).flatMap((r) => r.issues))].sort();

  it('a complete, consistent history of a finished order is clean_settled and needs no decision', async () => {
    await mkOrder({ id: O1, ref: 'C1', status: 'delivered', history: [['pending', 0], ['confirmed', 1], ['shipped', 2], ['delivered', 3]], updatedMin: 3 });
    const r = await forOrder(O1);
    expect(r[0]).toMatchObject({ classification: 'clean_settled', needs_decision: false, issues: [] });
  });

  it('a clean order still in flight is in_flight and needs an explicit decision', async () => {
    await mkOrder({ id: O1, ref: 'C2', status: 'pending', history: [['pending', 0]], updatedMin: 0 });
    await mkOrder({ id: O2, ref: 'C3', status: 'shipped', history: [['pending', 0], ['shipped', 1]], updatedMin: 1 });
    expect((await forOrder(O1))[0]).toMatchObject({ classification: 'in_flight', needs_decision: true, issues: [] });
    expect((await forOrder(O2))[0]).toMatchObject({ classification: 'in_flight', needs_decision: true });
  });

  it('flags each kind of missing, inconsistent or ambiguous history as ambiguous (never auto-deducted, never ignored)', async () => {
    const cases: Array<[string, MkOrder, string]> = [
      ['NO_HISTORY', { id: O1, ref: 'A1', status: 'delivered', history: null }, 'NO_HISTORY'],
      ['FIRST_STATUS_UNEXPECTED', { id: O1, ref: 'A2', status: 'confirmed', history: [['confirmed', 0]], updatedMin: 0 }, 'FIRST_STATUS_UNEXPECTED'],
      ['LAST_STATUS_MISMATCH', { id: O1, ref: 'A3', status: 'shipped', history: [['pending', 0], ['confirmed', 1]], updatedMin: 1 }, 'LAST_STATUS_MISMATCH'],
      ['DELIVERED_WITHOUT_ROW', { id: O1, ref: 'A4', status: 'delivered', history: [['pending', 0], ['shipped', 1]], updatedMin: 1 }, 'DELIVERED_WITHOUT_ROW'],
      ['DUPLICATE_CONSECUTIVE', { id: O1, ref: 'A5', status: 'pending', history: [['pending', 0], ['pending', 1]], updatedMin: 1 }, 'DUPLICATE_CONSECUTIVE'],
      ['TIMESTAMP_TIE', { id: O1, ref: 'A6', status: 'confirmed', history: [['pending', 0], ['confirmed', 0]], updatedMin: 0 }, 'TIMESTAMP_TIE'],
      ['TIMESTAMP_RANGE', { id: O1, ref: 'A7', status: 'confirmed', history: [['pending', 0], ['confirmed', 90]], updatedMin: 1 }, 'TIMESTAMP_RANGE'],
      ['REENTERED_DELIVERED', { id: O1, ref: 'A8', status: 'delivered', history: [['pending', 0], ['delivered', 1], ['shipped', 2], ['delivered', 3]], updatedMin: 3 }, 'REENTERED_DELIVERED'],
      ['UNKNOWN_STATUS', { id: O1, ref: 'A9', status: 'pending', history: [['pending', 0], ['weird', 1]], updatedMin: 1 }, 'UNKNOWN_STATUS'],
      ['LINES_UNPARSEABLE', { id: O1, ref: 'A10', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ productId: P1, qty: '2' }] }, 'LINES_UNPARSEABLE'],
      ['LINES_UNPARSEABLE (empty)', { id: O1, ref: 'A11', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [] }, 'LINES_UNPARSEABLE'],
      ['LINES_UNPARSEABLE (no product id)', { id: O1, ref: 'A12', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ qty: 1 }] }, 'LINES_UNPARSEABLE'],
    ];
    for (const [label, order, code] of cases) {
      await db.exec('savepoint c');
      await mkOrder(order);
      const rows = await forOrder(O1);
      expect(rows.length, label).toBeGreaterThan(0);
      expect(rows[0].classification, label).toBe('ambiguous');
      expect(rows[0].needs_decision, label).toBe(true);
      expect(await issuesOf(O1), label).toContain(code);
      await db.exec('rollback to savepoint c');
    }
  });

  it('an in-store order whose history does not start at sold is ambiguous', async () => {
    await mkOrder({ id: O1, ref: 'S1', status: 'sold', source: 'in_store', history: [['pending', 0], ['sold', 1]], updatedMin: 1, lines: [{ productId: P1, qty: 1, price: 100 }] });
    expect(await issuesOf(O1)).toContain('FIRST_STATUS_UNEXPECTED');
    await mkOrder({ id: O2, ref: 'S2', status: 'sold', source: 'in_store', history: [['sold', 0]], updatedMin: 0, lines: [{ productId: P1, qty: 1, price: 100 }] });
    expect((await forOrder(O2))[0]).toMatchObject({ classification: 'clean_settled', issues: [] });
  });

  it('shows EVERY product and quantity of an order (variants aggregated per product), with catalog and balance flags', async () => {
    await setOpening(P1, 3);
    await mkOrder({
      id: O1,
      ref: 'L1',
      status: 'processing',
      history: [['pending', 0], ['processing', 1]],
      updatedMin: 1,
      lines: [
        { productId: P1, qty: 2, price: 100, variantId: 'a', name: { ar: 'سجادة' } },
        { productId: P1, qty: 3, price: 100, variantId: 'b', name: { ar: 'سجادة' } },
        { productId: P2, qty: 1, price: 200, name: { ar: 'مخدة' } },
        { productId: 'gone', qty: 4, price: 10, name: { ar: 'قديم' } },
      ],
    });
    const rows = (await forOrder(O1)).sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));
    expect(rows.map((r) => [r.product_id, r.qty, r.product_in_catalog, r.stock_initialized])).toEqual([
      ['gone', 4, false, false],
      [P1, 5, true, true], // 2 + 3 across two variants
      [P2, 1, true, false],
    ]);
  });

  it('shows the covering decision and whether it still matches the lines and the status', async () => {
    await mkOrder({ id: O1, ref: 'D1', status: 'processing', history: [['pending', 0], ['processing', 1]], updatedMin: 1 });
    const h = (await forOrder(O1)).length ? (await one<{ h: string }>('select lines_hash h from public.inventory_preflight_report() where order_id = $1 limit 1', [O1])).h : '';
    await one('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'تم التحقق', h]);
    expect((await forOrder(O1))[0]).toMatchObject({ decision: 'deduct_on_delivery', decision_matches_lines: true, decision_status_changed: false });
    await superuser();
    await db.exec('alter table public.orders disable trigger user');
    await db.query(`update public.orders set status = 'shipped' where id = $1`, [O1]);
    await db.exec('alter table public.orders enable trigger user');
    await admin();
    expect((await forOrder(O1))[0]).toMatchObject({ decision_status_changed: true });
  });

  it('is admin-only', async () => {
    await asUser();
    expect((await errOf('select * from public.inventory_preflight_report()')).message).toMatch(/forbidden/);
  });
});

// ===========================================================================
describe('0009 — reconcile: what "clean" means, and that corruption is actually detected', () => {
  const codes = async (cat?: string) =>
    (await q<{ code: string; severity: string; category: string }>(
      `select code, severity, category from public.inventory_reconcile() ${cat ? `where category = '${cat}'` : ''}`)).map((r) => r.code);
  const has = async (code: string) => (await codes()).includes(code);
  const summary = async () => (await one<{ s: Record<string, unknown> }>('select public.inventory_reconcile_summary() s')).s;
  const initAll = async () => {
    for (const p of [P1, P2, P3]) await setOpening(p, 10);
  };
  const noTriggers = async (fn: () => Promise<void>) => {
    await superuser();
    await db.exec('alter table public.stock_movements disable trigger user');
    await fn();
    await db.exec('alter table public.stock_movements enable trigger user');
    await admin();
  };

  it('with nothing initialized, integrity is clean but the COVERAGE of every catalog product is reported', async () => {
    expect(await codes('integrity')).toEqual([]);
    expect((await codes('coverage')).filter((c) => c === 'PRODUCT_UNINITIALIZED')).toHaveLength(3);
    expect(await summary()).toMatchObject({ integrity_errors: 0, coverage_errors: 3, clean: false });
  });

  it('is CLEAN only when no category has an error: every product initialized (zero counts) and every table consistent', async () => {
    await initAll();
    await adjust(P1, 7, 'جرد فعلي');
    await one(`select public.inventory_receive('p2', 5, 'مرجع', 'استلام')`);
    await one(`select public.inventory_record_return('p3', 2, false, 'مرتجع تالف')`);
    await one(`select public.inventory_record_return('p3', 2, true, 'مرتجع سليم')`);
    expect(await codes()).toEqual([]);
    expect(await summary()).toEqual({ integrity_errors: 0, decision_errors: 0, coverage_errors: 0, warnings: 0, info: 0, clean: true });
  });

  it('warnings and info are listed but do not break "clean"', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'W1', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1 });
    await superuser();
    await db.query(`select public.inventory_init_product('orphan-removed', 0, 'reason abc')`);
    await admin();
    const rows = await q<{ code: string; severity: string }>('select code, severity from public.inventory_reconcile()');
    expect(rows).toEqual([{ code: 'ORPHAN_REMOVED_BALANCE', severity: 'warning' }]);
    expect(await summary()).toMatchObject({ warnings: 1, clean: true });
  });

  it('detects a balance that differs from the ledger (BALANCE_MISMATCH, LAST_AFTER_MISMATCH)', async () => {
    await initAll();
    await superuser();
    await db.query(`update public.stock_levels set on_hand = on_hand + 1 where product_id = 'p1'`);
    await admin();
    const c = await codes('integrity');
    expect(c).toContain('BALANCE_MISMATCH');
    expect(c).toContain('LAST_AFTER_MISMATCH');
    expect((await summary()).clean).toBe(false);
  });

  it('detects a broken chain, a missing/duplicated opening and broken arithmetic', async () => {
    await initAll();
    await adjust(P1, 6, 'جرد فعلي');
    await noTriggers(async () => {
      await db.exec('alter table public.stock_movements drop constraint stock_movements_chain');
      await db.query(`update public.stock_movements set qty_before = qty_before + 10 where kind = 'adjustment'`);
    });
    expect(await has('CHAIN_BREAK')).toBe(true);
    expect(await has('ARITHMETIC')).toBe(true);
    await superuser();
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason) values ('p2','opening',0,0,0,0,'second opening')`);
    await admin();
    expect(await has('MULTIPLE_OPENING')).toBe(true);
    await noTriggers(async () => {
      await db.query(`delete from public.stock_movements where product_id = 'p3' and kind = 'opening'`);
    });
    expect(await has('BALANCE_WITHOUT_OPENING')).toBe(true);
    expect(await has('BALANCE_MISMATCH')).toBe(true);
  });

  it('detects a movement without a balance row and a movement pointing at a missing order', async () => {
    await initAll();
    await superuser();
    await db.query(`delete from public.stock_levels where product_id = 'p2'`);
    await admin();
    expect(await has('ORPHAN_MOVEMENT')).toBe(true);
    await superuser();
    await db.exec('alter table public.stock_movements drop constraint stock_movements_order_id_fkey');
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id)
                    values ('p1','return_restock',1,1,10,11,'reason abc','99999999-9999-9999-9999-999999999999')`);
    await db.query(`update public.stock_levels set on_hand = 11 where product_id = 'p1'`);
    await admin();
    expect(await has('MOVEMENT_ORDER_MISSING')).toBe(true);
  });

  it('checks sales against the order lines: duplicates, quantity mismatch, and (info) deducted-but-no-longer-delivered', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'S1', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ productId: P1, qty: 2, price: 100 }] });
    await mkOrder({ id: O2, ref: 'S2', status: 'pending', history: [['pending', 0]], updatedMin: 0, lines: [{ productId: P2, qty: 1, price: 100 }] });
    await superuser();
    const sale = (pid: string, order: string, qty: number, before: number) =>
      db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id) values ($1,'sale',$3,$4,$5,$6,'seed',$2)`,
        [pid, order, qty, -qty, before, before - qty]);
    await sale(P1, O1, 2, 10);
    await sale(P1, O1, 2, 8); // a second sale for the same order+product
    await sale(P2, O2, 3, 10); // the order says 1; and the order is only pending
    await db.query(`update public.stock_levels set on_hand = 6 where product_id = 'p1'`);
    await db.query(`update public.stock_levels set on_hand = 7 where product_id = 'p2'`);
    await admin();
    const rows = await q<{ code: string; severity: string; order_id: string }>('select code, severity, order_id from public.inventory_reconcile()');
    const byCode = (c: string) => rows.filter((r) => r.code === c);
    expect(byCode('DUPLICATE_SALE')).toHaveLength(1);
    expect(byCode('SALE_QTY_MISMATCH').map((r) => r.order_id).sort()).toEqual([O1, O2].sort());
    expect(byCode('DEDUCTED_NOT_DELIVERED')).toMatchObject([{ severity: 'info', order_id: O2 }]);
  });

  it('detects a linked return that exceeds the quantity sold', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'R1', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ productId: P1, qty: 2, price: 100 }] });
    await superuser();
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id) values ('p1','return_damaged',3,0,10,10,'reason abc',$1)`, [O1]);
    await admin();
    expect(await has('RETURN_EXCEEDS_SOLD')).toBe(true);
  });

  it('detects override grants that were never consumed, have no movement, or disagree with it', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'G1', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ productId: P1, qty: 12, price: 100 }] });
    await superuser();
    const g = async (key: string, consumed: boolean, short = 2) =>
      (await db.query<{ id: string }>(
        `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid, consumed_at)
         values ($1,'deliver_order',$2,'p1',12,$3,$4,'reason abc',$5, 1, ${consumed ? 'now()' : 'null'}) returning id`,
        [key, O1, 12 - short, short, ADMIN])).rows[0].id;
    await g('b0000000-0000-0000-0000-000000000001', false); // unconsumed
    await g('b0000000-0000-0000-0000-000000000002', true); // consumed, no movement
    const gid = await g('b0000000-0000-0000-0000-000000000003', true, 2);
    await db.query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id, override, shortfall, override_grant_id)
                    values ('p1','sale',12,-12,10,-2,'reason abc',$1,true,5,$2)`, [O1, gid]); // movement says 5, grant says 2
    await db.query(`update public.stock_levels set on_hand = -2 where product_id = 'p1'`);
    await admin();
    const c = await codes('integrity');
    expect(c).toContain('GRANT_UNCONSUMED');
    expect(c).toContain('GRANT_WITHOUT_MOVEMENT');
    expect(c).toContain('GRANT_MISMATCH');
  });

  it('detects a decision whose order lines changed (error) or whose order status changed (warning)', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'D1', status: 'shipped', history: [['pending', 0], ['shipped', 1]], updatedMin: 1 });
    const h = (await one<{ h: string }>('select lines_hash h from public.inventory_preflight_report() where order_id = $1 limit 1', [O1])).h;
    await one('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'تم التحقق', h]);
    expect(await codes('decision')).toEqual([]);
    await superuser();
    await db.exec('alter table public.orders disable trigger user');
    await db.query(`update public.orders set status = 'processing' where id = $1`, [O1]);
    await admin();
    expect(await q('select code, severity from public.inventory_reconcile() where category = $1', ['decision'])).toEqual([{ code: 'DECISION_STATUS_CHANGED', severity: 'warning' }]);
    await superuser();
    await db.query(`update public.orders set lines = '[{"productId":"p1","qty":9,"price":1}]' where id = $1`, [O1]);
    await admin();
    expect((await codes('decision')).sort()).toEqual(['DECISION_STALE_LINES', 'DECISION_STATUS_CHANGED']);
  });

  it('coverage includes products of unsettled orders — INCLUDING products deleted from the catalog', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'C1', status: 'shipped', history: [['pending', 0], ['shipped', 1]], updatedMin: 1, lines: [{ productId: 'gone', qty: 2, price: 5, name: { ar: 'محذوف' } }] });
    const rows = await q<{ code: string; product_id: string; order_id: string; detail: string }>(`select code, product_id, order_id, detail from public.inventory_reconcile() where category = 'coverage'`);
    expect(rows).toMatchObject([{ code: 'ORDER_PRODUCT_UNINITIALIZED', product_id: 'gone', order_id: O1 }]);
    expect(rows[0].detail).toMatch(/inventory_init_removed_product/);
    await one(`select public.inventory_init_removed_product('gone', 'منتج محذوف من الكتالوج')`);
    expect(await codes('coverage')).toEqual([]);
    // the removed product's balance is informational while an order references it
    expect(await q(`select code, severity from public.inventory_reconcile() where product_id = 'gone'`)).toEqual([{ code: 'REMOVED_PRODUCT_BALANCE', severity: 'info' }]);
    expect((await summary()).clean).toBe(true);
  });

  it('a settled order with a missing product does not block coverage; a catalog product deleted later keeps its balance and ledger', async () => {
    await initAll();
    await mkOrder({ id: O1, ref: 'C2', status: 'delivered', history: [['pending', 0], ['delivered', 1]], updatedMin: 1, lines: [{ productId: 'old', qty: 1, price: 5 }] });
    expect(await codes('coverage')).toEqual([]);
    await superuser();
    await db.query(`delete from public.catalog_docs where id = 'p1'`);
    await admin();
    expect(await stock(P1)).toMatchObject({ on_hand: 10 });
    expect(await ledger(P1)).toHaveLength(1);
    expect((await one<{ product_name: string; product_sku: string }>(`select product_name, product_sku from public.stock_levels where product_id = 'p1'`))).toEqual({ product_name: 'سجادة كلاسيك', product_sku: 'TYB-001' });
    expect((await codes('integrity')).sort()).toEqual(['ORPHAN_REMOVED_BALANCE']);
  });

  it('is admin-only', async () => {
    await asUser();
    expect((await errOf('select * from public.inventory_reconcile()')).message).toMatch(/forbidden/);
    expect((await errOf('select public.inventory_reconcile_summary()')).message).toMatch(/forbidden/);
  });
});
