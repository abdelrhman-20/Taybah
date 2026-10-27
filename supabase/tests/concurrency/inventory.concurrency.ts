import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { ADMIN, USER, migrationSql } from '../pg';

// MULTI-CONNECTION concurrency checks for inventory (0009 + 0010) on a REAL PostgreSQL
// server. STATUS: NEVER RUN — no PostgreSQL server was available when this was written, so
// every guarantee below is UNVERIFIED until this file passes against one. PGlite has a
// single connection and cannot exercise any of it.
//
// NOT part of `npm test` (the filename has no `.test.`). Run it with:
//   INVENTORY_CONCURRENCY_DB_URL=postgres://postgres:...@localhost:5432/tybah_inventory_concurrency_test
//   INVENTORY_CONCURRENCY_CONFIRM=I_UNDERSTAND_THIS_DB_IS_DISPOSABLE
//   npm run test:concurrency
//
// SAFETY (all enforced below, before a single statement runs):
//   - host must be localhost / 127.0.0.1 / ::1;
//   - the database name must end in `_test`, `_scratch` or `_disposable`;
//   - the confirmation variable must be set;
//   - the database must be EMPTY of this app (no public.orders): it is built from the
//     migration files here, never reused. It is never a Supabase project.

const DB_URL = process.env.INVENTORY_CONCURRENCY_DB_URL ?? '';
const CONFIRM = process.env.INVENTORY_CONCURRENCY_CONFIRM === 'I_UNDERSTAND_THIS_DB_IS_DISPOSABLE';

function guard(): string | null {
  if (!DB_URL) return 'INVENTORY_CONCURRENCY_DB_URL is not set';
  let u: URL;
  try {
    u = new URL(DB_URL);
  } catch {
    return 'INVENTORY_CONCURRENCY_DB_URL is not a valid URL';
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) return `refusing non-local host ${u.hostname}`;
  if (!/_(test|scratch|disposable)$/.test(u.pathname.replace(/^\//, ''))) return 'database name must end in _test, _scratch or _disposable';
  if (!CONFIRM) return 'INVENTORY_CONCURRENCY_CONFIRM is not set';
  return null;
}
const refusal = guard();
if (DB_URL && refusal) throw new Error(`inventory concurrency tests refuse to run: ${refusal}`);
const d = DB_URL && !refusal ? describe : describe.skip;

const O = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const K = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRICE: Record<string, number> = { p1: 100, p2: 200 };
const lines = (pid: string, qty: number) => [
  { productId: pid, slug: pid, name: { ar: pid, en: pid }, color: null, size: null, qty, price: PRICE[pid], image: '', variantId: null },
];

// Supabase-only pieces the migrations lean on (same stubs as supabase/tests/pg.ts)
const STUBS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;
  create schema auth; create schema extensions; create schema net; create schema vault;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table net.calls(url text, headers jsonb);
  create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
    timeout_milliseconds int default 1000) returns bigint language sql as
    $$ insert into net.calls values (url, headers); select 1::bigint $$;
  create table vault.decrypted_secrets(name text, decrypted_secret text);
  grant usage on schema auth, net, vault, extensions to anon, authenticated, service_role;
  grant all on all tables in schema net, vault to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create table public.admins (user_id uuid primary key references auth.users(id));
  alter table public.admins enable row level security;
  create function public.is_admin() returns boolean language sql stable security definer
    set search_path = pg_catalog, public as
    $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
  insert into auth.users values ('${ADMIN}'), ('${USER}');
  insert into public.admins values ('${ADMIN}');
`;

d('inventory concurrency (real PostgreSQL, several connections) — UNVERIFIED until run', () => {
  const clients: Client[] = [];
  const connect = async () => {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    clients.push(c);
    return c;
  };
  let owner: Client;

  // one admin API session per call: its own connection and transaction
  async function asAdmin<T>(fn: (c: Client) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(
        `select set_config('request.jwt.claim.sub', '${ADMIN}', true), set_config('request.jwt.claims', '{"sub":"${ADMIN}","email":"a@example.test"}', true)`,
      );
      const value = await fn(c);
      await c.query('commit');
      return { ok: true, value };
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code ?? '', message: err.message ?? '' };
    }
  }

  // The ledger is append-only, so every scenario uses its own order ids and reads deltas.
  const bal = async (pid: string) => (await owner.query('select on_hand from public.stock_levels where product_id = $1', [pid])).rows[0].on_hand as number;
  const online = (id: string, pid: string, qty: number) =>
    owner.query(
      `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
       values ($1, $2, 'shipped', '{"name":"x","email":"b@example.com"}', '{}', '{"method":"standard"}', $3, $4, $4)`,
      [id, `C-${id.slice(-4)}`, JSON.stringify(lines(pid, qty)), PRICE[pid] * qty],
    );
  const deliver = (id: string) => asAdmin((c) => c.query(`update public.orders set status = 'delivered' where id = $1`, [id]));
  const saleRows = async (orderId: string) =>
    (await owner.query(`select count(*)::int n from public.stock_movements where order_id = $1 and kind = 'sale'`, [orderId])).rows[0].n as number;

  beforeAll(async () => {
    owner = await connect();
    if ((await owner.query(`select to_regclass('public.orders') as t`)).rows[0].t) {
      throw new Error('refusing: the database is not empty (public.orders exists) — use a fresh disposable database');
    }
    await owner.query(STUBS);
    for (const f of ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0007_product_internal_pricing.sql', '0008_in_store_orders.sql']) {
      await owner.query(migrationSql(f));
    }
    await owner.query(`insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`);
    for (const p of ['p1', 'p2']) {
      await owner.query(`insert into public.catalog_docs(kind, id, slug, visible, data) values ('product', $1, $1, true, $2)`, [
        p,
        JSON.stringify({ id: p, sku: p, price: PRICE[p], name: { ar: p } }),
      ]);
    }
    await owner.query(migrationSql('0009_inventory.sql'));
    for (const p of ['p1', 'p2']) await owner.query(`select public.inventory_init_product($1, 10, 'concurrency fixture', null, null)`, [p]);
    await owner.query(migrationSql('0010_inventory_orders.sql'));
  }, 120_000);

  afterAll(async () => {
    for (const c of clients) await c.end().catch(() => undefined);
  });

  it('two orders racing for the same scarce stock: exactly one wins, the balance never goes negative', async () => {
    await online(O(1), 'p1', 7);
    await online(O(2), 'p1', 7);
    const before = await bal('p1');
    const [a, b] = await Promise.all([deliver(O(1)), deliver(O(2))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok === false && loser.message).toMatch(/insufficient_stock/);
    expect(await bal('p1')).toBe(before - 7);
  });

  it('the SAME order delivered by many connections at once deducts exactly once', async () => {
    await online(O(3), 'p2', 2);
    const before = await bal('p2');
    await Promise.all(Array.from({ length: 8 }, () => deliver(O(3))));
    expect(await bal('p2')).toBe(before - 2);
    expect(await saleRows(O(3))).toBe(1);
  });

  it('parallel overrides with ONE attempt key deduct once; the others replay or are refused', async () => {
    await online(O(4), 'p1', 50); // far beyond stock: needs an override
    const available = await bal('p1');
    const short = [{ product_id: 'p1', requested: 50, available, shortfall: 50 - available }];
    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        asAdmin((c) =>
          c.query(`select public.inventory_deliver_order_override($1, 'shipped', $2, $3::jsonb, 'العميل دفع والبضاعة وصلت')`, [O(4), K(1), JSON.stringify(short)]),
        ),
      ),
    );
    expect(res.some((r) => r.ok)).toBe(true);
    expect(await saleRows(O(4))).toBe(1);
  });

  it('ONE attempt key raced across DIFFERENT orders with DIFFERENT products binds to exactly one order (advisory lock)', async () => {
    await online(O(8), 'p1', 500);
    await online(O(9), 'p2', 500);
    const shortOf = async (pid: string, qty: number) => {
      const available = await bal(pid);
      return [{ product_id: pid, requested: qty, available, shortfall: qty - available }];
    };
    const [s1, s2] = [await shortOf('p1', 500), await shortOf('p2', 500)];
    const attempt = (orderId: string, short: unknown) =>
      asAdmin((c) =>
        c.query(`select public.inventory_deliver_order_override($1, 'shipped', $2, $3::jsonb, 'العميل دفع والبضاعة وصلت')`, [orderId, K(50), JSON.stringify(short)]),
      );
    const res = await Promise.all([attempt(O(8), s1), attempt(O(9), s2)]);
    // exactly one wins; the loser is refused as a key reuse (IS005), never a second success
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const loser = res.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.code).toBe('IS005');
    const orders = (await owner.query(`select distinct order_id from public.stock_override_grants where attempt_key = $1`, [K(50)])).rows;
    expect(orders).toHaveLength(1);
    const delivered = (await owner.query(`select count(*)::int n from public.orders where id in ($1, $2) and status = 'delivered'`, [O(8), O(9)])).rows[0].n;
    expect(delivered).toBe(1);
  });

  it('opposite-order multi-product deliveries do not deadlock (locks are taken in sorted product order)', async () => {
    const mk = (id: string, first: string, second: string) =>
      owner.query(
        `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
         values ($1, $2, 'shipped', '{"name":"x","email":"b@example.com"}', '{}', '{"method":"standard"}', $3, 300, 300)`,
        [id, `D-${id.slice(-4)}`, JSON.stringify([...lines(first, 1), ...lines(second, 1)])],
      );
    await mk(O(5), 'p1', 'p2');
    await mk(O(6), 'p2', 'p1');
    const [a, b] = await Promise.all([deliver(O(5)), deliver(O(6))]);
    for (const r of [a, b]) expect(r.ok === false ? r.code : 'ok').not.toBe('40P01'); // deadlock_detected
  });

  it('concurrent returns cannot exceed what was sold (the cap is enforced under lock)', async () => {
    await online(O(7), 'p2', 1);
    await deliver(O(7));
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        asAdmin((c) => c.query(`select public.inventory_record_return('p2', 1, false, 'مرتجع تجريبي', $1, $2)`, [O(7), K(10 + i)])),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
  });
});
