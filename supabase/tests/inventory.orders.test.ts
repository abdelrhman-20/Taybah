import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql } from './pg';

// INVENTORY PHASE 2 (migration 0010: stock deduction from orders) on a REAL Postgres
// engine (PGlite). Triggers, RLS, GRANTs, constraints and plpgsql are executed from the
// actual migration files.
//
// NOT proven here: concurrency. PGlite has ONE connection, so races between simultaneous
// transactions (two deliveries competing for the same stock, parallel retries with one
// attempt key, concurrent returns against a cap) are NOT exercised. Those guarantees rest
// on row locks taken in a fixed order and on unique constraints, and are UNVERIFIED until
// supabase/tests/concurrency/inventory.concurrency.ts runs against a disposable PostgreSQL
// with several connections (see docs/INVENTORY_SETUP.md). Never against production.

type Row = Record<string, unknown>;

const O = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const K = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`; // attempt keys
const L1 = O(101); // legacy, shipped, decided deduct_on_delivery (p1 x3)
const L2 = O(102); // legacy, processing, decided already_accounted (p2 x2)
const L3 = O(103); // legacy, delivered, clean -> settled_legacy (p1 x1)
const L4 = O(104); // legacy, shipped, decided deduct_on_delivery (p1 x1)
const L5 = O(105); // legacy in-store sale, clean -> settled_legacy (p2 x1)
const PRICE: Record<string, number> = { p1: 100, p2: 200, p3: 300 };

const FLAG = `insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`;
const PRE = ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0007_product_internal_pricing.sql', '0008_in_store_orders.sql', '0009_inventory.sql'];

async function buildPre(): Promise<PGlite> {
  const d = await baseDb();
  for (const f of PRE.slice(0, 5)) await d.exec(migrationSql(f));
  await d.exec(FLAG);
  await d.query(
    `insert into public.catalog_docs(kind, id, slug, visible, data) values
       ('product','p1','p1',true,$1), ('product','p2','p2',true,$2), ('product','p3','p3',true,$3)`,
    [
      JSON.stringify({ id: 'p1', sku: 'TYB-001', price: 100, name: { ar: 'سجادة كلاسيك', en: 'Classic' } }),
      JSON.stringify({ id: 'p2', sku: 'TYB-002', price: 200, name: { ar: 'مخدة', en: 'Cushion' } }),
      JSON.stringify({ id: 'p3', sku: 'TYB-003', price: 300, name: { ar: 'ستارة', en: 'Curtain' } }),
    ],
  );
  await d.exec(migrationSql('0009_inventory.sql'));
  return d;
}

const line = (pid: string, qty: number, over: Row = {}) => ({
  productId: pid,
  slug: pid,
  name: { ar: `منتج ${pid}`, en: pid },
  color: null,
  size: null,
  qty,
  price: PRICE[pid] ?? 1,
  image: '',
  variantId: null,
  ...over,
});
const total = (lines: Array<{ qty: number; price: number }>) => lines.reduce((n, l) => n + l.qty * l.price, 0);

// ===========================================================================
// Shared helpers (bound to a db by `use`)
function use(getDb: () => PGlite) {
  const db = () => getDb();
  const q = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await db().query<T>(sql, params)).rows;
  const one = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => (await one<{ c: number }>(`select count(*)::int c from (${sql}) t`, params)).c;
  const admin = () => as(db(), 'authenticated', ADMIN);
  const superuser = () => as(db(), 'postgres');
  const errOf = async (sql: string, params: unknown[] = []) => {
    const e = await fails(db(), sql, params);
    return { ...e, message: `${e.message} ${e.detail}`.trim() };
  };
  const bal = async (pid: string) => (await one<{ on_hand: number }>('select on_hand from public.stock_levels where product_id = $1', [pid])).on_hand;
  const sales = (orderId: string) =>
    q<{ product_id: string; kind: string; quantity: number; qty_delta: number; qty_before: number; qty_after: number; override: boolean; shortfall: number; idempotency_key: string; reason: string; actor: string | null; product_name: string | null }>(
      `select product_id, kind, quantity, qty_delta, qty_before, qty_after, override, shortfall, idempotency_key, reason, actor, product_name
         from public.stock_movements where order_id = $1 and kind in ('sale','sale_accounted') order by product_id`, [orderId]);
  const status = async (id: string) => (await one<{ status: string }>('select status from public.orders where id = $1', [id])).status;
  const history = (id: string) => q<{ status: string }>('select status from public.order_status_history where order_id = $1 order by created_at, status', [id]).then((r) => r.map((x) => x.status));
  // the three opening movements of the fixture are the baseline; count what the integration wrote
  const movementCount = () => count(`select 1 from public.stock_movements where kind <> 'opening'`);

  // a native online order, created as a guest would (pending)
  async function online(id: string, lines: Row[], ref = `TYB-${id.slice(-3)}`, email = 'buyer@example.com') {
    await superuser();
    await db().query(
      `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
       values ($1, $2, 'pending', $3, '{}', '{"method":"standard"}', $4, $5, $5)`,
      [id, ref, JSON.stringify({ name: 'عميل', email }), JSON.stringify(lines), total(lines as never)],
    );
    await admin();
  }
  const setStatus = (id: string, s: string) => db().query('update public.orders set status = $2 where id = $1', [id, s]);
  const inStorePayload = (id: string, lines: Row[], ref = `STORE-${id.slice(-3)}`) => ({
    id, ref, contact: { name: '', phone: '', email: '' },
    address: { country: '', governorate: '', city: '', street: '', building: '', apartment: '', instructions: '' },
    delivery: { method: 'in_store' }, lines, subtotal: total(lines as never), total: total(lines as never), note: null,
  });
  const insertInStore = (p: ReturnType<typeof inStorePayload>, st = 'sold') =>
    db().query(
      `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
       values ($1, $2, $3, 'in_store', $4, $5, $6, $7, $8, $8)`,
      [p.id, p.ref, st, JSON.stringify(p.contact), JSON.stringify(p.address), JSON.stringify(p.delivery), JSON.stringify(p.lines), p.total],
    );
  const deliverOverride = (id: string, expected: string, key: string, confirmed: unknown, reason = 'العميل دفع والبضاعة وصلت') =>
    one<{ r: Row }>('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5) r', [id, expected, key, JSON.stringify(confirmed), reason]);
  const storeOverride = (p: ReturnType<typeof inStorePayload>, key: string, confirmed: unknown, reason = 'العميل دفع والبضاعة وصلت') =>
    one<{ r: Row }>('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4) r', [JSON.stringify(p), key, JSON.stringify(confirmed), reason]);
  return { db, q, one, count, admin, superuser, errOf, bal, sales, status, history, movementCount, online, setStatus, inStorePayload, insertInStore, deliverOverride, storeOverride };
}

// ===========================================================================
describe('0010 — activation guard: fails closed, before any change', () => {
  let pdb: PGlite;
  const h = use(() => pdb);

  beforeAll(async () => {
    pdb = await buildPre();
  }, 120_000);
  afterAll(async () => {
    await pdb.close();
  });
  beforeEach(async () => {
    await begin(pdb);
    await h.superuser();
    // a ready catalog: explicit opening balances for every product, zero included
    for (const [pid, qty] of [['p1', 10], ['p2', 5], ['p3', 0]] as const) {
      await pdb.query(`select public.inventory_init_product($1, $2, 'رصيد افتتاحي', null, null)`, [pid, qty]);
    }
  });
  afterEach(async () => {
    await pdb.exec('rollback');
    await pdb.exec('reset role');
  });

  const apply = async () => {
    try {
      await h.superuser(); // a migration runs as the owner (SQL editor), never as an API role
      await pdb.exec('savepoint apply10'); // each attempt is its own "run": a failure must not poison the next one
      await pdb.exec(migrationSql('0010_inventory_orders.sql'));
      await pdb.exec('release savepoint apply10');
      return '';
    } catch (e) {
      await pdb.exec('rollback to savepoint apply10');
      return (e as Error).message;
    }
  };
  const installed = async () => (await h.one<{ c: number }>(`select count(*)::int c from pg_proc where proname = 'inventory_apply_order'`)).c === 1;
  const legacy = async (id: string, status: string, history: Array<[string, number]>, lines: Row[] = [line('p1', 1)]) => {
    await h.superuser();
    await pdb.query(
      `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total, created_at, updated_at)
       values ($1, $2, $3, '{}', '{}', '{"method":"standard"}', $4, 1, 1, now() - interval '1 day', now() - interval '1 day')`,
      [id, `OLD-${id.slice(-3)}`, status, JSON.stringify(lines)],
    );
    await pdb.query('delete from public.order_status_history where order_id = $1', [id]);
    for (const [s, m] of history) {
      await pdb.query(`insert into public.order_status_history(order_id, status, created_at) select id, $2, created_at + ($3 || ' minutes')::interval from public.orders where id = $1`, [id, s, String(m)]);
    }
    await pdb.exec('alter table public.orders disable trigger orders_touch_updated_at');
    await pdb.query(`update public.orders set updated_at = created_at + ($2 || ' minutes')::interval where id = $1`, [id, String(history[history.length - 1][1])]);
    await pdb.exec('alter table public.orders enable trigger orders_touch_updated_at');
  };
  const decide = async (id: string, decision: string, reason = 'تم التحقق يدويًا') => {
    await h.superuser();
    const hash = (await h.one<{ h: string }>('select public.inventory_lines_hash(lines) h from public.orders where id = $1', [id])).h;
    await h.admin();
    await h.one('select public.inventory_decide_order($1, $2, $3, $4)', [id, decision, reason, hash]);
  };

  it('applies when the reconciliation is complete, activates the integration, and marks old finished orders settled_legacy', async () => {
    await legacy(L3, 'delivered', [['pending', 0], ['delivered', 1]]);
    expect(await apply()).toBe('');
    expect(await installed()).toBe(true);
    const rows = await h.q('select order_id, decision, decided_by from public.inventory_order_decisions');
    expect(rows).toEqual([{ order_id: L3, decision: 'settled_legacy', decided_by: null }]);
  });

  it('refuses while a catalog product has no explicit opening balance (and leaves the integration uninstalled)', async () => {
    await h.superuser();
    await pdb.exec(`delete from public.stock_levels where product_id = 'p3'`).catch(() => undefined);
    // the ledger forbids deleting history, so model "never initialized" with a product added later
    await pdb.query(`insert into public.catalog_docs(kind, id, slug, visible, data) values ('product','p9','p9',true,$1)`, [JSON.stringify({ id: 'p9', sku: 'TYB-009', price: 1, name: { ar: 'جديد' } })]);
    const msg = await apply();
    expect(msg).toMatch(/^ABORT: migration 0010 refuses to run: \d+ activation blocker/);
    expect(msg).toContain('RECONCILE_PRODUCT_UNINITIALIZED');
    expect(msg).toContain('[product p9]');
    expect(msg).toMatch(/Nothing was changed/);
    await pdb.exec('rollback to savepoint zz').catch(() => undefined);
  });

  it('refuses while an order in flight has no explicit decision — it never guesses', async () => {
    await legacy(L1, 'shipped', [['pending', 0], ['shipped', 1]], [line('p1', 3)]);
    const msg = await apply();
    expect(msg).toContain('DECISION_MISSING');
    expect(msg).toContain(`[order ${L1}]`);
    expect(msg).toMatch(/has no explicit decision/);
  });

  it('refuses an order with an ambiguous history until it has an explicit decision', async () => {
    await legacy(L3, 'delivered', [['pending', 0], ['shipped', 1]]); // delivered, but history never says so
    const first = await apply();
    expect(first).toContain('DECISION_MISSING');
    expect(first).toContain('ambiguous');
    await decide(L3, 'already_accounted');
    expect(await apply()).toBe('');
  });

  it('refuses a decision whose order status changed since it was recorded, or whose lines changed', async () => {
    await legacy(L1, 'shipped', [['pending', 0], ['shipped', 1]], [line('p1', 3)]);
    await decide(L1, 'deduct_on_delivery');
    await h.superuser();
    await pdb.exec('alter table public.orders disable trigger user');
    await pdb.query(`update public.orders set status = 'processing' where id = $1`, [L1]);
    await pdb.exec('alter table public.orders enable trigger user');
    expect(await apply()).toContain('DECISION_STATUS_CHANGED');
    await h.superuser();
    await pdb.query(`update public.orders set lines = $2 where id = $1`, [L1, JSON.stringify([line('p1', 9)])]);
    const msg = await apply();
    expect(msg).toContain('RECONCILE_DECISION_STALE_LINES');
  });

  it('refuses a deduct_on_delivery decision on lines that cannot be read', async () => {
    await legacy(L1, 'shipped', [['pending', 0], ['shipped', 1]], [{ productId: 'p1', qty: '3' }]);
    await decide(L1, 'deduct_on_delivery');
    expect(await apply()).toContain('DEDUCT_DECISION_INVALID_LINES');
  });

  it('refuses an unsettled order whose product was deleted from the catalog and never initialized', async () => {
    await legacy(L1, 'shipped', [['pending', 0], ['shipped', 1]], [line('gone', 2)]);
    await decide(L1, 'deduct_on_delivery');
    const msg = await apply();
    expect(msg).toContain('RECONCILE_ORDER_PRODUCT_UNINITIALIZED');
    expect(msg).toContain('[product gone]');
    await h.superuser();
    await pdb.query(`select public.inventory_init_product('gone', 0, 'منتج محذوف', 'منتج محذوف', null)`);
    expect(await apply()).toBe('');
  });

  it('refuses when the ledger itself is inconsistent', async () => {
    await h.superuser();
    await pdb.query(`update public.stock_levels set on_hand = 99 where product_id = 'p1'`);
    expect(await apply()).toContain('RECONCILE_BALANCE_MISMATCH');
  });

  it('refuses when the in-store e-mail suppression was overwritten (0005 re-applied after 0008) and works again after re-running 0008', async () => {
    await h.superuser();
    await pdb.exec(migrationSql('0005_order_email_outbox.sql'));
    const msg = await apply();
    expect(msg).toMatch(/^ABORT: migration 0010 needs /);
    expect(msg).toContain('the in-store e-mail suppression');
    await pdb.exec(migrationSql('0008_in_store_orders.sql'));
    expect(await apply()).toBe('');
  });

  it('refuses without 0009 objects / 0008 objects, naming what is missing', async () => {
    await h.superuser();
    await pdb.exec('drop trigger orders_validate_in_store on public.orders');
    expect(await apply()).toContain('orders_validate_in_store');
  });

  it.each([
    ['authenticated can CREATE in schema public', 'grant create on schema public to authenticated'],
    ['anon can CREATE in schema auth', 'grant create on schema auth to anon'],
  ])('refuses when %s, without changing privileges', async (phrase, grant) => {
    await h.superuser();
    await pdb.exec(grant);
    const msg = await apply();
    expect(msg).toMatch(/^ABORT: migration 0010 refuses to run: /);
    expect(msg).toContain(phrase);
    expect(msg).toMatch(/does not change privileges/);
  });

  it('is re-runnable: a second run installs nothing twice and never classifies a NEW order as legacy', async () => {
    expect(await apply()).toBe('');
    await h.admin();
    await h.online(O(1), [line('p1', 1)]);
    await h.superuser();
    expect(await apply()).toBe('');
    expect(await h.count(`select 1 from public.inventory_order_decisions where order_id = $1`, [O(1)])).toBe(0);
    expect(await h.count(`select 1 from pg_trigger where tgname like 'orders_inventory_%' and not tgisinternal`)).toBe(3);
  });

  it('does not touch the e-mail outbox function, checkout, or any status rule', async () => {
    const before = (await h.one<{ d: string }>(`select md5(pg_get_functiondef('public.enqueue_order_email'::regproc)) d`)).d;
    const fns = `select proname, md5(prosrc) m from pg_proc where proname in ('log_order_created','log_order_status_change','validate_in_store_order','guard_order_update','touch_updated_at') order by proname`;
    const f0 = JSON.stringify((await pdb.query(fns)).rows);
    expect(await apply()).toBe('');
    expect((await h.one<{ d: string }>(`select md5(pg_get_functiondef('public.enqueue_order_email'::regproc)) d`)).d).toBe(before);
    expect(JSON.stringify((await pdb.query(fns)).rows)).toBe(f0);
  });

  it('the migration file warns that applying it IS the activation, and never auto-revokes privileges', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/0010_inventory_orders.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(sql).toMatch(/APPLYING THIS FILE IS THE ACTIVATION/);
    expect(sql).toMatch(/NEVER re-run 0005 after 0008/);
    const executable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/^\s*(revoke|grant)\s+(create|usage|all)\s+on\s+schema/im);
  });
});

// ===========================================================================
describe('0010 — stock deduction from orders (activated database)', () => {
  let db0: PGlite;
  const h = use(() => db0);
  const { db, q, one, count, admin, superuser, errOf, bal, sales, status, history, movementCount, online, setStatus, inStorePayload, insertInStore, deliverOverride, storeOverride } = h;

  beforeAll(async () => {
    db0 = await buildPre();
    await as(db0, 'postgres');
    for (const [pid, qty] of [['p1', 10], ['p2', 5], ['p3', 0]] as const) {
      await db0.query(`select public.inventory_init_product($1, $2, 'رصيد افتتاحي', null, null)`, [pid, qty]);
    }
    // legacy orders (committed BEFORE the integration exists)
    const legacy = async (id: string, st: string, hist: Array<[string, number]>, lines: Row[], source = 'online') => {
      const inStore = source === 'in_store';
      await db0.query(
        `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total, created_at, updated_at)
         values ($1, $2, $3, $4, '{}', '{}', $5, $6, $7, $7, now() - interval '1 day', now() - interval '1 day')`,
        [id, `OLD-${id.slice(-3)}`, st, source, JSON.stringify({ method: inStore ? 'in_store' : 'standard' }), JSON.stringify(lines), total(lines as never)],
      );
      await db0.query('delete from public.order_status_history where order_id = $1', [id]);
      for (const [s, m] of hist) {
        await db0.query(`insert into public.order_status_history(order_id, status, created_at) select id, $2, created_at + ($3 || ' minutes')::interval from public.orders where id = $1`, [id, s, String(m)]);
      }
      await db0.exec('alter table public.orders disable trigger orders_touch_updated_at');
      await db0.query(`update public.orders set updated_at = created_at + ($2 || ' minutes')::interval where id = $1`, [id, String(hist[hist.length - 1][1])]);
      await db0.exec('alter table public.orders enable trigger orders_touch_updated_at');
    };
    await legacy(L1, 'shipped', [['pending', 0], ['shipped', 1]], [line('p1', 3)]);
    await legacy(L2, 'processing', [['pending', 0], ['processing', 1]], [line('p2', 2)]);
    await legacy(L3, 'delivered', [['pending', 0], ['delivered', 1]], [line('p1', 1)]);
    await legacy(L4, 'shipped', [['pending', 0], ['shipped', 1]], [line('p1', 1)]);
    await legacy(L5, 'sold', [['sold', 0]], [line('p2', 1)], 'in_store');
    const decide = async (id: string, decision: string) => {
      await as(db0, 'postgres');
      const hash = (await db0.query<{ h: string }>('select public.inventory_lines_hash(lines) h from public.orders where id = $1', [id])).rows[0].h;
      await as(db0, 'authenticated', ADMIN);
      await db0.query('select public.inventory_decide_order($1, $2, $3, $4)', [id, decision, 'تم التحقق يدويًا', hash]);
    };
    await decide(L1, 'deduct_on_delivery');
    await decide(L2, 'already_accounted');
    await decide(L4, 'deduct_on_delivery');
    await as(db0, 'postgres');
    await db0.exec(migrationSql('0010_inventory_orders.sql')); // the activation
  }, 180_000);
  afterAll(async () => {
    await db0.close();
  });
  beforeEach(async () => {
    await begin(db0);
    await admin();
  });
  afterEach(async () => {
    await db0.exec('rollback');
    await db0.exec('reset role');
  });

  // -------------------------------------------------------------------------
  describe('online orders: only the entry into delivered deducts', () => {
    it('deducts per product when delivered, in the same transaction, with a complete ledger row', async () => {
      await online(O(1), [line('p1', 2), line('p2', 1)]);
      await setStatus(O(1), 'delivered');
      expect(await bal('p1')).toBe(8);
      expect(await bal('p2')).toBe(4);
      const rows = await sales(O(1));
      expect(rows.map((r) => [r.product_id, r.kind, r.quantity, r.qty_delta, r.qty_before, r.qty_after, r.override, r.shortfall])).toEqual([
        ['p1', 'sale', 2, -2, 10, 8, false, 0],
        ['p2', 'sale', 1, -1, 5, 4, false, 0],
      ]);
      expect(rows[0].idempotency_key).toBe(`sale:${O(1)}:p1`);
      expect(rows[0].actor).toBe(ADMIN);
      expect(rows[0].reason).toContain('تسليم الطلب');
      expect(rows[0].product_name).toBe('سجادة كلاسيك');
    });

    it('does NOT deduct on creation, confirmation, processing, shipping or cancellation', async () => {
      await online(O(1), [line('p1', 4)]);
      expect(await bal('p1')).toBe(10);
      for (const s of ['confirmed', 'processing', 'shipped', 'cancelled']) {
        await setStatus(O(1), s);
        expect(await bal('p1'), s).toBe(10);
      }
      expect(await movementCount()).toBe(0);
    });

    it('aggregates the variants of a product into ONE deduction', async () => {
      await online(O(1), [line('p1', 2, { variantId: 'v-a' }), line('p1', 3, { variantId: 'v-b' }), line('p2', 1)]);
      await setStatus(O(1), 'delivered');
      expect(await bal('p1')).toBe(5);
      const rows = await sales(O(1));
      expect(rows.filter((r) => r.product_id === 'p1')).toHaveLength(1);
      expect(rows.find((r) => r.product_id === 'p1')).toMatchObject({ quantity: 5, qty_before: 10, qty_after: 5 });
    });

    it('never deducts twice: leaving and re-entering delivered, repeated updates, and a repeated identical update', async () => {
      await online(O(1), [line('p1', 2)]);
      await setStatus(O(1), 'delivered');
      await setStatus(O(1), 'delivered'); // same status: not a transition
      await setStatus(O(1), 'shipped');
      await setStatus(O(1), 'delivered');
      await setStatus(O(1), 'cancelled');
      await setStatus(O(1), 'delivered');
      expect(await bal('p1')).toBe(8);
      expect(await sales(O(1))).toHaveLength(1);
      expect(await db().query(`update public.orders set status = 'delivered' where id = $1 and status = 'pending'`, [O(1)])).toMatchObject({ affectedRows: 0 });
    });

    it('a deduction survives later status changes (cancelling a delivered order never restores stock)', async () => {
      await online(O(1), [line('p1', 2)]);
      await setStatus(O(1), 'delivered');
      await setStatus(O(1), 'cancelled');
      expect(await bal('p1')).toBe(8);
      expect(await sales(O(1))).toHaveLength(1);
    });

    it('keeps the status history and the customer e-mail workflow exactly as before', async () => {
      await online(O(1), [line('p1', 1)]);
      await setStatus(O(1), 'shipped');
      await setStatus(O(1), 'delivered');
      expect(await history(O(1))).toEqual(expect.arrayContaining(['pending', 'shipped', 'delivered']));
      await superuser();
      const outbox = await q<{ kind: string; status: string; state: string }>(`select kind, status, state from public.order_email_outbox where order_id = $1 order by seq`, [O(1)]);
      expect(outbox.map((r) => [r.kind, r.status, r.state])).toEqual([
        ['confirmation', 'pending', 'pending'],
        ['status_update', 'shipped', 'pending'],
        ['status_update', 'delivered', 'pending'],
      ]);
    });

    it('a refused delivery changes NOTHING: status, history, balances, ledger, e-mail', async () => {
      await online(O(1), [line('p1', 99)]);
      await superuser();
      const outbox0 = await count('select 1 from public.order_email_outbox');
      await admin();
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(1)]);
      expect(e.code).toBe('IS002');
      expect(JSON.parse(e.detail)).toEqual([{ product_id: 'p1', requested: 99, available: 10, shortfall: 89 }]);
      expect(await status(O(1))).toBe('pending');
      expect(await history(O(1))).toEqual(['pending']);
      expect(await bal('p1')).toBe(10);
      expect(await movementCount()).toBe(0);
      await superuser();
      expect(await count('select 1 from public.order_email_outbox')).toBe(outbox0);
    });
  });

  // -------------------------------------------------------------------------
  describe('in-store orders: a NEW sold order deducts atomically with its creation', () => {
    it('creates the order, deducts, and writes the ledger in one step', async () => {
      const p = inStorePayload(O(11), [line('p1', 3), line('p3', 0.0 as never)].slice(0, 1));
      await insertInStore(p);
      expect(await status(O(11))).toBe('sold');
      expect(await bal('p1')).toBe(7);
      expect(await sales(O(11))).toMatchObject([{ product_id: 'p1', kind: 'sale', quantity: 3, qty_before: 10, qty_after: 7, reason: expect.stringContaining('بيع من المتجر') }]);
    });

    it('a cancelled in-store order deducts nothing — created cancelled, or cancelled afterwards (which does not restore)', async () => {
      await superuser();
      await insertInStore(inStorePayload(O(12), [line('p1', 2)]), 'cancelled');
      expect(await bal('p1')).toBe(10);
      expect(await movementCount()).toBe(0);
      await admin();
      await insertInStore(inStorePayload(O(13), [line('p1', 2)]));
      expect(await bal('p1')).toBe(8);
      await setStatus(O(13), 'cancelled');
      expect(await bal('p1')).toBe(8); // not reversed (a return is recorded separately)
      expect(await sales(O(13))).toHaveLength(1);
    });

    it('a duplicate submission (same id) is refused and never deducts twice; a different id is a different sale', async () => {
      const p = inStorePayload(O(11), [line('p1', 3)]);
      await insertInStore(p);
      const e = await errOf(
        `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
         values ($1,'STORE-X','sold','in_store','{}','{}','{"method":"in_store"}',$2,300,300)`,
        [O(11), JSON.stringify(p.lines)],
      );
      expect(e.message).toMatch(/orders_pkey|duplicate key/);
      expect(await bal('p1')).toBe(7);
      await insertInStore(inStorePayload(O(14), [line('p1', 1)]));
      expect(await bal('p1')).toBe(6);
      expect(await movementCount()).toBe(2);
    });

    it('is refused when stock is short, and the order is NOT created', async () => {
      const e = await errOf(
        `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
         values ($1,'STORE-S','sold','in_store','{}','{}','{"method":"in_store"}',$2,1500,1500)`,
        [O(15), JSON.stringify([line('p1', 15)])],
      );
      expect(e.code).toBe('IS002');
      expect(await count('select 1 from public.orders where id = $1', [O(15)])).toBe(0);
      expect(await bal('p1')).toBe(10);
      expect(await movementCount()).toBe(0);
    });

    it('does not deduct for other sources or statuses (an online order created as sold-like / pending, a guest checkout)', async () => {
      await as(db(), 'anon');
      await db().query(
        `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
         values ($1,'GUEST','pending','{"email":"a@b.co"}','{}','{"method":"standard"}',$2,100,100)`,
        [O(16), JSON.stringify([line('p1', 1)])],
      );
      await superuser();
      expect(await bal('p1')).toBe(10);
      expect(await movementCount()).toBe(0);
      expect(await count(`select 1 from public.order_email_outbox where order_id = $1 and state = 'pending'`, [O(16)])).toBe(1); // checkout confirmation still queued
    });

    it('still queues NO customer e-mail for an in-store sale (the 0008 suppression is intact)', async () => {
      await insertInStore({ ...inStorePayload(O(17), [line('p1', 1)]), contact: { name: 'x', phone: '', email: 'buyer@example.com' } });
      await superuser();
      expect(await q(`select state, last_error from public.order_email_outbox where order_id = $1`, [O(17)])).toEqual([{ state: 'skipped', last_error: 'in_store_order' }]);
    });
  });

  // -------------------------------------------------------------------------
  describe('uninitialized products and atomicity', () => {
    it('blocks delivery while ANY product lacks an opening balance — all-or-nothing', async () => {
      await superuser();
      await db().query(`insert into public.catalog_docs(kind, id, slug, visible, data) values ('product','p9','p9',true,$1)`, [JSON.stringify({ id: 'p9', sku: 'TYB-009', price: 1, name: { ar: 'جديد' } })]);
      await admin();
      await online(O(1), [line('p1', 1), line('p9', 1)]);
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(1)]);
      expect(e.code).toBe('IS001');
      expect(e.detail).toBe('p9');
      expect(await bal('p1')).toBe(10);
      expect(await status(O(1))).toBe('pending');
    });

    it('blocks an in-store sale of an uninitialized product', async () => {
      const e = await errOf(
        `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
         values ($1,'STORE-U','sold','in_store','{}','{}','{"method":"in_store"}',$2,1,1)`,
        [O(18), JSON.stringify([line('nope', 1)])],
      );
      expect(e.message).toMatch(/invalid_in_store_order|stock_not_initialized/); // unknown to the catalog first, uninitialized otherwise
      expect(await count('select 1 from public.orders where id = $1', [O(18)])).toBe(0);
    });

    it('rolls EVERYTHING back when a later ledger write fails (balances, ledger and the order change)', async () => {
      await online(O(1), [line('p1', 2), line('p2', 1)]);
      await superuser();
      await db().exec(`alter table public.stock_movements add constraint zz_force_fail check (kind <> 'sale' or product_id <> 'p2')`);
      await admin();
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(1)]);
      expect(e.message).toMatch(/zz_force_fail/);
      expect(await bal('p1')).toBe(10);
      expect(await bal('p2')).toBe(5);
      expect(await movementCount()).toBe(0);
      expect(await status(O(1))).toBe('pending');
      expect(await history(O(1))).toEqual(['pending']);
    });

    it('refuses orders whose lines are not valid product/quantity lines (IS006) instead of deducting a guess', async () => {
      await online(O(1), [{ productId: 'p1', qty: '2' }]);
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(1)]);
      expect(e.code).toBe('IS006');
      expect(await bal('p1')).toBe(10);
    });

    it('keeps the snapshot of a product deleted from the catalog (its balance and ledger name survive)', async () => {
      await superuser();
      await db().query(`select public.inventory_init_product('gone', 6, 'رصيد افتتاحي', 'منتج قديم', 'OLD-1')`);
      await admin();
      await online(O(1), [line('gone', 2, { name: { ar: 'منتج قديم', en: 'old' } })]);
      await setStatus(O(1), 'delivered');
      expect(await bal('gone')).toBe(4);
      expect(await sales(O(1))).toMatchObject([{ product_id: 'gone', qty_after: 4, product_name: 'منتج قديم' }]);
    });
  });

  // -------------------------------------------------------------------------
  describe('shortage override: the only way past IS002', () => {
    const SHORT = [{ product_id: 'p1', requested: 12, available: 10, shortfall: 2 }];

    it('delivers an online order with an audited override: negative balance, grant consumed, ledger flagged', async () => {
      await online(O(1), [line('p1', 12)]);
      const r = (await deliverOverride(O(1), 'pending', K(1), SHORT)).r;
      expect(r).toMatchObject({ status: 'delivered', order_id: O(1) });
      expect(r.deductions).toEqual([{ product_id: 'p1', quantity: 12, qty_before: 10, qty_after: -2, override: true, shortfall: 2 }]);
      expect(await bal('p1')).toBe(-2);
      expect(await status(O(1))).toBe('delivered');
      await superuser();
      const grant = await one<{ operation: string; reason: string; granted_by: string; granted_by_email: string; consumed_at: string | null; shortfall: number; requested_qty: number; available_qty: number }>(
        `select operation, reason, granted_by, granted_by_email, consumed_at, shortfall, requested_qty, available_qty from public.stock_override_grants`);
      expect(grant).toMatchObject({ operation: 'deliver_order', reason: 'العميل دفع والبضاعة وصلت', granted_by: ADMIN, granted_by_email: `${ADMIN}@example.test`, shortfall: 2, requested_qty: 12, available_qty: 10 });
      expect(grant.consumed_at).not.toBeNull();
      expect(await count(`select 1 from public.stock_movements where override and override_grant_id is not null`)).toBe(1);
    });

    it('creates an in-store sale with an audited override', async () => {
      const p = inStorePayload(O(21), [line('p1', 12)]);
      const r = (await storeOverride(p, K(2), SHORT)).r;
      expect(r).toMatchObject({ status: 'created', order_id: O(21) });
      expect(await status(O(21))).toBe('sold');
      expect(await bal('p1')).toBe(-2);
      expect((await sales(O(21)))[0]).toMatchObject({ override: true, shortfall: 2, qty_after: -2 });
    });

    it('requires an admin and a reason of at least five characters — and writes nothing otherwise', async () => {
      await online(O(1), [line('p1', 12)]);
      for (const bad of ['', '    ', 'abcd', ' ab ']) {
        const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), bad]);
        expect(e.message, JSON.stringify(bad)).toMatch(/inventory_invalid/);
      }
      expect(await bal('p1')).toBe(10);
      await as(db(), 'authenticated', USER);
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ'])).message).toMatch(/forbidden/);
      expect((await errOf('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4)', [JSON.stringify(inStorePayload(O(22), [line('p1', 12)])), K(3), JSON.stringify(SHORT), 'سبب كافٍ'])).message).toMatch(/forbidden/);
      await as(db(), 'anon');
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ'])).message).toMatch(/permission denied/);
      await superuser();
      expect(await bal('p1')).toBe(10);
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
      expect(await status(O(1))).toBe('pending');
    });

    it('is bound to the EXACT shortfall seen: a changed shortfall is refused (IS007) with the fresh numbers, nothing is written', async () => {
      await online(O(1), [line('p1', 12)]);
      await one(`select public.inventory_adjust('p1', 9, 'سحب بعد المعاينة')`); // stock moved after the admin looked
      const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(e.code).toBe('IS007');
      expect(JSON.parse(e.detail)).toEqual([{ product_id: 'p1', requested: 12, available: 9, shortfall: 3 }]);
      expect(await status(O(1))).toBe('pending');
      expect(await bal('p1')).toBe(9);
      await superuser();
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
    });

    it('a confirmation for the wrong product, wrong numbers, or an empty/malformed list is refused', async () => {
      await online(O(1), [line('p1', 12)]);
      for (const wrong of [
        [{ product_id: 'p2', requested: 12, available: 10, shortfall: 2 }],
        [{ product_id: 'p1', requested: 12, available: 10, shortfall: 1 }],
        [{ product_id: 'p1', requested: 13, available: 10, shortfall: 3 }],
        [],
      ]) {
        const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(wrong), 'سبب كافٍ']);
        expect(e.code, JSON.stringify(wrong)).toBe('IS007');
      }
      for (const malformed of ['{}', '"x"', '[1]', '[{"product_id":"p1"}]', '[{"product_id":"p1","requested":1.5,"available":1,"shortfall":1}]']) {
        const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), malformed, 'سبب كافٍ']);
        expect(e.message, malformed).toMatch(/inventory_invalid/);
      }
      expect(await bal('p1')).toBe(10);
    });

    it('does not bypass anything else: no shortage, uninitialized product, stale expected status, non-online or already-delivered order', async () => {
      await online(O(1), [line('p1', 2)]);
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), '[]', 'سبب كافٍ'])).message).toMatch(/no shortage/);
      await superuser();
      await db().query(`insert into public.catalog_docs(kind, id, slug, visible, data) values ('product','p9','p9',true,$1)`, [JSON.stringify({ id: 'p9', sku: 'T9', price: 1, name: { ar: 'جديد' } })]);
      await admin();
      await online(O(2), [line('p1', 12), line('p9', 1)]);
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(2), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ'])).code).toBe('IS001');
      await online(O(3), [line('p1', 12)]);
      const stale = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(3), 'shipped', K(1), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(stale.code).toBe('CF001');
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(999), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ'])).message).toMatch(/unknown order/);
      await insertInStore(inStorePayload(O(4), [line('p2', 1)]));
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(4), 'sold', K(1), '[]', 'سبب كافٍ'])).message).toMatch(/only online orders/);
      await setStatus(O(1), 'delivered');
      expect((await deliverOverride(O(1), 'pending', K(9), [])).r).toMatchObject({ status: 'unchanged' });
      expect(await bal('p1')).toBe(8);
    });

    it('does NOT bypass the in-store price/total validation or an existing order id', async () => {
      const bad = { ...inStorePayload(O(23), [line('p1', 12)]), total: 1, subtotal: 1 };
      const e = await errOf('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4)', [JSON.stringify(bad), K(5), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(e.message).toMatch(/invalid_in_store_order/);
      expect(await count('select 1 from public.orders where id = $1', [O(23)])).toBe(0);
      expect(await bal('p1')).toBe(10);
      await superuser();
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
      await admin();
      await insertInStore(inStorePayload(O(24), [line('p1', 1)]));
      const dup = await errOf('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4)', [JSON.stringify(inStorePayload(O(24), [line('p1', 12)])), K(6), JSON.stringify([{ product_id: 'p1', requested: 12, available: 9, shortfall: 3 }]), 'سبب كافٍ']);
      expect(dup.message).toMatch(/already exists/);
    });

    it('replays are idempotent; the same key for a DIFFERENT request is IS005; a new key after a failed attempt is never blocked', async () => {
      await online(O(1), [line('p1', 12)]);
      await online(O(2), [line('p1', 12)]);
      const first = (await deliverOverride(O(1), 'pending', K(1), SHORT)).r;
      const replay = (await deliverOverride(O(1), 'pending', K(1), SHORT)).r;
      expect(first.status).toBe('delivered');
      expect(replay).toMatchObject({ status: 'replayed', order_id: O(1) });
      expect(replay.deductions).toEqual(first.deductions);
      expect(await bal('p1')).toBe(-2);
      expect(await count(`select 1 from public.stock_movements where kind = 'sale'`)).toBe(1);
      const reuse = (sql: string, params: unknown[]) => errOf(sql, params);
      const base = [O(1), 'pending', K(1), JSON.stringify(SHORT), 'العميل دفع والبضاعة وصلت'];
      for (const [i, diff] of [[0, 'order'], [3, 'confirmed_shortfall'], [4, 'reason']] as const) {
        const args = [...base];
        args[i] = i === 0 ? O(2) : i === 3 ? JSON.stringify([{ product_id: 'p1', requested: 12, available: 10, shortfall: 5 }]) : 'سبب مختلف تمامًا';
        const e = await reuse('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', args);
        expect(e.code, diff).toBe('IS005');
        expect(e.message).toContain(`differs: ${diff}`);
      }
      expect(await status(O(2))).toBe('pending');
      // another attempt (new key) for ANOTHER order works: grants are per attempt, never a permanent block
      const second = (await deliverOverride(O(2), 'pending', K(2), [{ product_id: 'p1', requested: 12, available: -2, shortfall: 14 }])).r;
      expect(second.status).toBe('delivered');
      expect(await bal('p1')).toBe(-14);
    });

    // Attempt-key serialization. PGlite has ONE connection: these tests prove the lock IS TAKEN
    // (on the same key, by both RPCs) and that a key already bound to an order cannot be
    // re-bound to another; that the lock actually serializes two RACING connections is proven
    // only by scenario 6 of supabase/tests/concurrency/inventory.concurrency.ts (never run).
    describe('one attempt key = one operation (advisory lock)', () => {
      const keyLocks = async (key: string) =>
        count(
          `select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
              and ((classid::bigint << 32) | objid::bigint) = hashtextextended('inventory_override:' || $1, 0)`,
          [key],
        );

      it('both override RPCs take the advisory lock for their attempt key, and hold it until the transaction ends', async () => {
        await online(O(1), [line('p1', 12)]);
        expect(await keyLocks(K(1))).toBe(0);
        await deliverOverride(O(1), 'pending', K(1), SHORT);
        expect(await keyLocks(K(1))).toBe(1);
        await storeOverride(inStorePayload(O(21), [line('p2', 6)]), K(2), [{ product_id: 'p2', requested: 6, available: 5, shortfall: 1 }]);
        expect(await keyLocks(K(2))).toBe(1);
        expect(await keyLocks(K(3))).toBe(0); // only the keys actually used
      });

      it('the same key cannot be bound to a second order with a DIFFERENT product, in either RPC order', async () => {
        await online(O(1), [line('p1', 12)]);
        await online(O(2), [line('p2', 6)]);
        await deliverOverride(O(1), 'pending', K(1), SHORT);
        const e1 = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(2), 'pending', K(1), JSON.stringify([{ product_id: 'p2', requested: 6, available: 5, shortfall: 1 }]), 'العميل دفع والبضاعة وصلت']);
        expect(e1.code).toBe('IS005');
        expect(e1.message).toContain('order');
        const e2 = await errOf('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4)', [JSON.stringify(inStorePayload(O(22), [line('p2', 6)])), K(1), JSON.stringify([{ product_id: 'p2', requested: 6, available: 5, shortfall: 1 }]), 'العميل دفع والبضاعة وصلت']);
        expect(e2.code).toBe('IS005');
        expect(await status(O(2))).toBe('pending');
        expect(await count('select 1 from public.orders where id = $1', [O(22)])).toBe(0);
        await superuser();
        expect(await count('select distinct order_id from public.stock_override_grants where attempt_key = $1', [K(1)])).toBe(1);
      });
    });

    it('a failed attempt leaves no grant behind and does not block its key; a consumed grant can never be used again', async () => {
      await online(O(1), [line('p1', 12)], 'FAILME-1');
      await superuser();
      await db().exec(`alter table public.stock_movements add constraint zz_force_fail check (kind <> 'sale' or reason not like '%FAILME%')`);
      await admin();
      const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(e.message).toMatch(/zz_force_fail/);
      // the attempt was rolled back as a whole: no grant, no deduction, status unchanged
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
      expect(await status(O(1))).toBe('pending');
      expect(await bal('p1')).toBe(10);
      await superuser();
      await db().exec('alter table public.stock_movements drop constraint zz_force_fail');
      await admin();
      // the SAME key is usable now: a failed attempt never burned it
      expect((await deliverOverride(O(1), 'pending', K(1), SHORT)).r.status).toBe('delivered');
      // the consumed grant authorizes nothing else: a plain delivery of another short order is refused
      await online(O(2), [line('p1', 5)]);
      expect((await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(2)])).code).toBe('IS002');
    });

    it('a grant that the deduction did not consume rolls the whole override back (IS009) — online delivery and in-store sale', async () => {
      await online(O(1), [line('p1', 12)]);
      await superuser();
      await db().exec('alter table public.orders disable trigger orders_inventory_status'); // the deduction never runs
      await admin();
      const e = await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [O(1), 'pending', K(1), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(e.code).toBe('IS009');
      expect(await status(O(1))).toBe('pending'); // not left "delivered" without a deduction
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
      await superuser();
      await db().exec('alter table public.orders disable trigger orders_inventory_insert');
      await admin();
      const p = inStorePayload(O(25), [line('p1', 12)]);
      const e2 = await errOf('select public.inventory_create_in_store_order_override($1::jsonb, $2, $3::jsonb, $4)', [JSON.stringify(p), K(2), JSON.stringify(SHORT), 'سبب كافٍ']);
      expect(e2.code).toBe('IS009');
      expect(await count('select 1 from public.orders where id = $1', [O(25)])).toBe(0);
      expect(await count('select 1 from public.stock_override_grants')).toBe(0);
      expect(await bal('p1')).toBe(10);
    });

    it('a grant that is not for THIS operation / order / product / quantities / transaction authorizes nothing', async () => {
      await online(O(1), [line('p1', 12)]);
      await superuser();
      const ins = (over: Row) =>
        db().query(
          `insert into public.stock_override_grants(attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall, reason, granted_by, txid)
           values ($1,$2,$3,$4,$5,$6,$7,'سبب كافٍ',$8,$9)`,
          [over.key ?? K(7), over.op ?? 'deliver_order', over.order ?? O(1), over.pid ?? 'p1', over.req ?? 12, over.avail ?? 10, over.short ?? 2, ADMIN, over.txid ?? 1],
        );
      await ins({ txid: 1 }); // another transaction
      await ins({ key: K(8), op: 'create_in_store_order', txid: -1 });
      await ins({ key: K(9), pid: 'p2', txid: -1 });
      await ins({ key: K(10), short: 3, avail: 9, txid: -1 });
      await admin();
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [O(1)]);
      expect(e.code).toBe('IS002');
      expect(await bal('p1')).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  describe('orders that existed before the integration (legacy)', () => {
    it('a legacy order decided "deduct_on_delivery" deducts once when delivered, and never again', async () => {
      await setStatus(L1, 'delivered');
      expect(await bal('p1')).toBe(7);
      await setStatus(L1, 'shipped');
      await setStatus(L1, 'delivered');
      expect(await bal('p1')).toBe(7);
      expect(await sales(L1)).toHaveLength(1);
    });

    it('a legacy order decided "already_accounted" records audit rows only — the stock is untouched', async () => {
      await setStatus(L2, 'delivered');
      expect(await bal('p2')).toBe(5);
      expect(await sales(L2)).toMatchObject([{ product_id: 'p2', kind: 'sale_accounted', quantity: 2, qty_delta: 0, qty_before: 5, qty_after: 5 }]);
      await setStatus(L2, 'shipped');
      await setStatus(L2, 'delivered');
      expect(await sales(L2)).toHaveLength(1);
      expect(await bal('p2')).toBe(5);
    });

    it('a legacy order that was already delivered stays untouched while it stays delivered; leaving and re-entering needs an explicit decision (IS003)', async () => {
      expect(await sales(L3)).toHaveLength(0);
      expect(await bal('p1')).toBe(10);
      await setStatus(L3, 'shipped');
      const e = await errOf(`update public.orders set status = 'delivered' where id = $1`, [L3]);
      expect(e.code).toBe('IS003');
      expect(await status(L3)).toBe('shipped');
      expect(await bal('p1')).toBe(10);
      // an explicit decision (the order is not delivered now) makes it deliverable under that decision
      await superuser();
      const hash = (await one<{ h: string }>('select public.inventory_lines_hash(lines) h from public.orders where id = $1', [L3])).h;
      await admin();
      await one('select public.inventory_decide_order($1, $2, $3, $4)', [L3, 'already_accounted', 'تم التسليم قبل الجرد', hash]);
      await setStatus(L3, 'delivered');
      expect(await bal('p1')).toBe(10);
      expect(await sales(L3)).toMatchObject([{ kind: 'sale_accounted' }]);
    });

    it('the override refuses a settled_legacy order (IS003) and an already_accounted one (no deduction applies)', async () => {
      await setStatus(L3, 'shipped');
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [L3, 'shipped', K(1), '[]', 'سبب كافٍ'])).code).toBe('IS003');
      expect((await errOf('select public.inventory_deliver_order_override($1, $2, $3, $4::jsonb, $5)', [L2, 'processing', K(2), '[]', 'سبب كافٍ'])).message).toMatch(/no stock deduction applies/);
    });

    it('a legacy in-store sale was never deducted; cancelling it changes nothing', async () => {
      expect(await sales(L5)).toHaveLength(0);
      await setStatus(L5, 'cancelled');
      expect(await bal('p2')).toBe(5);
    });

    it('a NEW order can never be given a decision (that would switch its deduction off); a legacy one can still be re-decided', async () => {
      await online(O(1), [line('p1', 1)]);
      await superuser();
      const hash = (await one<{ h: string }>('select public.inventory_lines_hash(lines) h from public.orders where id = $1', [O(1)])).h;
      await admin();
      const e = await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O(1), 'already_accounted', 'محاولة تعطيل الخصم', hash]);
      expect(e.message).toMatch(/only orders that predate the inventory integration/);
      expect(await count('select 1 from public.inventory_order_decisions where order_id = $1', [O(1)])).toBe(0);
      await setStatus(O(1), 'delivered');
      expect(await bal('p1')).toBe(9);
    });
  });

  // -------------------------------------------------------------------------
  describe('order lines are frozen once stock moved (IS004)', () => {
    it('an online order\'s lines can change before delivery, not after a deduction or a linked return', async () => {
      await online(O(1), [line('p1', 2)]);
      await db().query(`update public.orders set lines = $2 where id = $1`, [O(1), JSON.stringify([line('p1', 3)])]);
      await setStatus(O(1), 'delivered');
      const e = await errOf(`update public.orders set lines = $2 where id = $1`, [O(1), JSON.stringify([line('p1', 1)])]);
      expect(e.code).toBe('IS004');
      await db().query(`update public.orders set note = 'x' where id = $1`, [O(1)]); // other columns stay editable
      await online(O(2), [line('p2', 2)]);
      await one(`select public.inventory_record_return('p2', 1, true, 'مرتجع قبل التسليم', $1)`, [O(2)]);
      expect((await errOf(`update public.orders set lines = $2 where id = $1`, [O(2), JSON.stringify([line('p2', 1)])])).code).toBe('IS004');
    });
  });

  // -------------------------------------------------------------------------
  describe('reconciliation after the integration', () => {
    const codes = async () => (await q<{ code: string }>('select code from public.inventory_reconcile() where severity = $1', ['error'])).map((r) => r.code);

    it('is clean after deliveries, in-store sales, overrides and returns', async () => {
      await online(O(1), [line('p1', 2), line('p2', 1)]);
      await setStatus(O(1), 'delivered');
      await insertInStore(inStorePayload(O(2), [line('p1', 1)]));
      await online(O(3), [line('p1', 12)]);
      await deliverOverride(O(3), 'pending', K(1), [{ product_id: 'p1', requested: 12, available: 7, shortfall: 5 }]);
      await one(`select public.inventory_record_return('p1', 1, true, 'مرتجع سليم', $1)`, [O(1)]);
      await one(`select public.inventory_record_return('p1', 1, false, 'مرتجع تالف', $1)`, [O(1)]);
      expect(await codes()).toEqual([]);
      expect(await one('select public.inventory_reconcile_summary() s')).toMatchObject({ s: { clean: true } });
      expect(await count('select 1 from public.inventory_activation_blockers()')).toBe(0);
    });

    it('detects a delivered order that has no sale movement (MISSING_SALE) and a movement contradicting a decision', async () => {
      await online(O(1), [line('p1', 2)]);
      await superuser();
      await db().exec('alter table public.orders disable trigger orders_inventory_status');
      await db().query(`update public.orders set status = 'delivered' where id = $1`, [O(1)]); // delivered with the integration bypassed
      await db().exec('alter table public.orders enable trigger orders_inventory_status');
      await admin();
      expect(await codes()).toContain('MISSING_SALE');
      await superuser();
      await db().exec('alter table public.stock_movements disable trigger user');
      await db().query(`insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason, order_id) values ('p2','sale',1,-1,5,4,'مخالف للقرار',$1)`, [L2]);
      await db().exec(`update public.stock_levels set on_hand = 4 where product_id = 'p2'`);
      await admin();
      expect(await codes()).toContain('DECISION_VIOLATED');
    });

    it('detects a legacy order that was delivered without inventory writing its movement', async () => {
      await superuser();
      await db().exec('alter table public.orders disable trigger orders_inventory_status');
      await db().query(`update public.orders set status = 'delivered' where id = $1`, [L1]);
      await admin();
      expect(await codes()).toContain('LEGACY_DELIVERED_WITHOUT_MOVEMENT');
    });
  });

  // -------------------------------------------------------------------------
  describe('privileges and security surface', () => {
    const NEW_PUBLIC = ['inventory_deliver_order_override', 'inventory_create_in_store_order_override'];
    const NEW_INTERNAL = [
      'inventory_plan_lines', 'inventory_plan_shortfalls', 'inventory_normalize_shortfalls', 'inventory_override_result',
      'inventory_apply_order', 'inventory_on_order_insert', 'inventory_on_order_status', 'inventory_guard_order_lines',
    ];

    it('the two overrides are executable by authenticated only; everything else new is executable by nobody; all pin search_path', async () => {
      const rows = await q<{ name: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean; def: boolean; cfg: string | null }>(
        `select p.proname name,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
                p.prosecdef def, array_to_string(p.proconfig, ';') cfg
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by 1`,
        [[...NEW_PUBLIC, ...NEW_INTERNAL]],
      );
      expect(rows.map((r) => r.name).sort()).toEqual([...NEW_PUBLIC, ...NEW_INTERNAL].sort());
      for (const r of rows) {
        expect(r.anon, r.name).toBe(false);
        expect(r.svc, r.name).toBe(false);
        expect(r.pub, r.name).toBe(false);
        expect(r.auth, r.name).toBe(NEW_PUBLIC.includes(r.name));
        if (r.def) expect(r.cfg, r.name).toBe('search_path=public');
      }
      // the SECURITY DEFINER ones that write inventory are definer + pinned
      expect(rows.filter((r) => ['inventory_apply_order', 'inventory_deliver_order_override', 'inventory_create_in_store_order_override', 'inventory_on_order_insert', 'inventory_on_order_status', 'inventory_guard_order_lines', 'inventory_plan_lines'].includes(r.name)).every((r) => r.def)).toBe(true);
    });

    it('a client cannot call the internal deduction, nor write any inventory table directly (admin included)', async () => {
      await online(O(1), [line('p1', 1)]);
      for (const role of ['authenticated', 'anon', 'service_role'] as const) {
        await as(db(), role, role === 'authenticated' ? ADMIN : undefined);
        for (const sql of [
          `select public.inventory_apply_order((select o from public.orders o where id = '${O(1)}'), 'deliver_order')`,
          `select public.inventory_plan_lines('[]'::jsonb)`,
          `insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason) values ('p1','receipt',1,1,10,11,'abc')`,
          `update public.stock_levels set on_hand = 999`,
        ]) {
          expect((await errOf(sql)).message, `${role}: ${sql}`).toMatch(/permission denied/);
        }
      }
      await superuser();
      expect(await bal('p1')).toBe(10);
    });

    it('anon (guests) cannot trigger a deduction path: they can only insert pending online orders', async () => {
      await as(db(), 'anon');
      const e = await errOf(
        `insert into public.orders(id, ref, status, source, contact, address, delivery, lines, subtotal, total)
         values ($1,'X','sold','in_store','{}','{}','{"method":"in_store"}',$2,100,100)`,
        [O(30), JSON.stringify([line('p1', 1)])],
      );
      expect(e.message).toMatch(/forbidden|row-level security/);
      await superuser();
      expect(await bal('p1')).toBe(10);
    });

    it('a non-admin cannot deliver an order (RLS) so no deduction can be triggered by them', async () => {
      await online(O(1), [line('p1', 1)]);
      await as(db(), 'authenticated', USER);
      await db().query(`update public.orders set status = 'delivered' where id = $1`, [O(1)]); // matches zero rows under RLS
      await superuser();
      expect(await status(O(1))).toBe('pending');
      expect(await bal('p1')).toBe(10);
    });

    it('the three new triggers exist on orders and leave the existing ones in place', async () => {
      const names = (await q<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal order by tgname`)).map((r) => r.tgname);
      expect(names).toEqual(expect.arrayContaining([
        'orders_inventory_insert', 'orders_inventory_status', 'orders_inventory_lines_guard',
        'orders_touch_updated_at', 'orders_log_created', 'orders_log_status_change', 'orders_validate_in_store', 'orders_guard_update',
      ]));
    });
  });
});
