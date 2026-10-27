import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql } from './pg';

// INVENTORY PHASE 1 HARDENING (migration 0009) on a REAL Postgres engine
// (PGlite): the migration guard, the privilege/ACL surface, transaction
// atomicity, idempotency, reserved keys, snapshots and shadowing resistance.
//
// NOT proven here: concurrency. PGlite has one connection, so races between
// simultaneous transactions are NOT exercised (see docs/DATABASE_SCHEMA.md,
// "Inventory — concurrency verification status"). Hosted Supabase defaults are
// approximated by ./pg.ts (default privileges on tables, functions, sequences).

const P1 = 'p1';
const P2 = 'p2';
const P3 = 'p3';
const O1 = '11111111-1111-1111-1111-111111111111';
const O2 = '22222222-2222-2222-2222-222222222222';

type Row = Record<string, unknown>;
const VALID_PRODUCT = `insert into public.catalog_docs(kind, id, slug, visible, data) values
  ('product', 'p1', 'p1', true, '{"id":"p1","sku":"TYB-001","price":100,"name":{"ar":"سجادة كلاسيك","en":"Classic"}}')`;
const FLAG = `insert into public.app_settings(key, value) values ('catalog_initialized', '{"at":"test"}')`;
const PRE_INVENTORY = ['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0007_product_internal_pricing.sql', '0008_in_store_orders.sql'];

async function buildDb(withInventory: boolean): Promise<PGlite> {
  const d = await baseDb();
  for (const f of PRE_INVENTORY) await d.exec(migrationSql(f));
  await d.exec(FLAG);
  await d.exec(VALID_PRODUCT);
  if (withInventory) await d.exec(migrationSql('0009_inventory.sql'));
  return d;
}

// ===========================================================================
describe('0009 guard — each prerequisite fails independently, before any change', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await buildDb(false); // 0009 NOT applied: every test applies it inside a rolled-back transaction
  }, 120_000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await begin(db);
  });
  afterEach(async () => {
    await db.exec('rollback');
    await db.exec('reset role');
  });

  const L = {
    orders: 'public.orders / order_status_history (migration 0001)',
    touch: 'public.touch_updated_at() (migration 0001)',
    admin: 'public.is_admin() (migration 0003)',
    catalog: 'public.catalog_docs / app_settings (migration 0006)',
    flag: 'a migrated catalog (app_settings.catalog_initialized',
    product: 'at least one valid catalog product',
    source: 'orders.source (migration 0008)',
  } as const;
  type Label = keyof typeof L;

  const apply = async () => {
    try {
      await db.exec(migrationSql('0009_inventory.sql'));
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  // The message names exactly the expected prerequisite(s) and none of the others.
  const expectOnly = (msg: string, ...labels: Label[]) => {
    expect(msg).toMatch(/^ABORT: migration 0009 needs /);
    expect(msg).toMatch(/Nothing was changed/);
    for (const k of Object.keys(L) as Label[]) {
      if (labels.includes(k)) expect(msg, `should name ${k}`).toContain(L[k]);
      else expect(msg, `should NOT name ${k}`).not.toContain(L[k]);
    }
  };

  const cases: Array<[string, Label, string]> = [
    ['orders table missing', 'orders', 'drop table public.orders cascade'],
    ['order_status_history missing', 'orders', 'drop table public.order_status_history cascade'],
    ['touch_updated_at() missing', 'touch', 'drop function public.touch_updated_at() cascade'],
    ['is_admin() missing', 'admin', 'drop function public.is_admin() cascade'],
    ['catalog_docs missing', 'catalog', 'drop table public.catalog_docs cascade'],
    ['app_settings missing', 'catalog', 'drop table public.app_settings cascade'],
    ['orders.source missing', 'source', 'alter table public.orders drop column source cascade'],
    ['catalog_initialized row missing', 'flag', `delete from public.app_settings where key = 'catalog_initialized'`],
    ['catalog_initialized is JSON null', 'flag', `update public.app_settings set value = 'null'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized is {}', 'flag', `update public.app_settings set value = '{}'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized is an array', 'flag', `update public.app_settings set value = '[]'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized is a string', 'flag', `update public.app_settings set value = '"yes"'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized has "at": null', 'flag', `update public.app_settings set value = '{"at": null}'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized has a blank "at"', 'flag', `update public.app_settings set value = '{"at": "  "}'::jsonb where key = 'catalog_initialized'`],
    ['catalog_initialized has no "at"', 'flag', `update public.app_settings set value = '{"by": "someone"}'::jsonb where key = 'catalog_initialized'`],
    ['empty catalog (flag present)', 'product', `delete from public.catalog_docs`],
    ['only non-product documents', 'product', `update public.catalog_docs set kind = 'category' where id = 'p1'`],
    ['product without a sku', 'product', `update public.catalog_docs set data = data - 'sku'`],
    ['product with a blank sku', 'product', `update public.catalog_docs set data = jsonb_set(data, '{sku}', '"  "')`],
    ['product without an Arabic name', 'product', `update public.catalog_docs set data = jsonb_set(data, '{name}', '{"en":"Only English"}')`],
    ['product with a blank Arabic name', 'product', `update public.catalog_docs set data = jsonb_set(data, '{name,ar}', '" "')`],
  ];
  it.each(cases)('%s', async (_label, expected, mutation) => {
    await db.exec(mutation);
    expectOnly(await apply(), expected);
  });

  it('reports every failing prerequisite at once when several are missing', async () => {
    await db.exec(`delete from public.app_settings; delete from public.catalog_docs;`);
    expectOnly(await apply(), 'flag', 'product');
  });

  it.each([
    ['authenticated can CREATE in schema public', `grant create on schema public to authenticated`],
    ['anon can CREATE in schema public', `grant create on schema public to anon`],
    ['PUBLIC can CREATE in schema public', `grant create on schema public to public`],
    ['anon can CREATE in schema auth', `grant create on schema auth to anon`],
    ['authenticated can CREATE in schema auth', `grant create on schema auth to authenticated`],
  ])('refuses when %s, with a clear diagnostic, and without changing privileges', async (phrase, grant) => {
    await db.exec(grant);
    const msg = await apply();
    expect(msg).toMatch(/^ABORT: migration 0009 refuses to run: /);
    expect(msg).toContain(phrase);
    expect(msg).toContain('revoke create on schema public from public, anon, authenticated');
    expect(msg).toMatch(/does not change privileges/);
    expect(msg).toMatch(/Nothing was changed/);
    expect(msg).not.toMatch(/needs /);
  });

  it('a missing prerequisite is reported before the CREATE-privilege check', async () => {
    await db.exec(`grant create on schema public to authenticated; delete from public.app_settings;`);
    expect(await apply()).toMatch(/^ABORT: migration 0009 needs /);
  });

  it('applies cleanly when everything is present, and can be applied again', async () => {
    expect(await apply()).toBe('');
    expect(await apply()).toBe('');
    expect((await db.query<{ c: number }>(`select count(*)::int c from pg_class where relnamespace = 'public'::regnamespace and relname in ('stock_levels','stock_movements','stock_override_grants','inventory_order_decisions')`)).rows[0].c).toBe(4);
  });

  it('the migration NEVER changes privileges on those schemas itself (the revoke appears only inside the diagnostic text)', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/0009_inventory.sql'), 'utf8');
    const executable = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/^\s*(revoke|grant)\s+(create|usage|all)\s+on\s+schema/im);
  });
});

// ===========================================================================
describe('0009 hardening — privileges, atomicity, idempotency, snapshots, shadowing', () => {
  let db: PGlite;

  const q = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const one = async <T extends Row = Row>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => (await one<{ c: number }>(`select count(*)::int c from (${sql}) t`, params)).c;
  const admin = () => as(db, 'authenticated', ADMIN);
  const superuser = () => as(db, 'postgres');
  const errOf = async (sql: string, params: unknown[] = []) => {
    const e = await fails(db, sql, params);
    return { ...e, message: `${e.message} ${e.detail}`.trim() };
  };
  const setOpening = (pid: string, qty: number, reason = 'رصيد افتتاحي') =>
    one<{ r: Row }>('select public.inventory_set_opening($1, $2, $3) r', [pid, qty, reason]);
  const stock = (pid: string) => one<{ on_hand: number; low_threshold: number; product_name: string | null; product_sku: string | null }>('select on_hand, low_threshold, product_name, product_sku from public.stock_levels where product_id = $1', [pid]);
  const movements = () => count('select 1 from public.stock_movements');

  async function mkOrder(id: string, ref: string, lines: unknown, status = 'delivered') {
    await superuser();
    await db.query(
      `insert into public.orders(id, ref, status, contact, address, delivery, lines, subtotal, total)
       values ($1, $2, $3, '{}', '{}', '{"method":"standard"}', $4, 1, 1)`,
      [id, ref, status, JSON.stringify(lines)],
    );
    await admin();
  }

  beforeAll(async () => {
    db = await buildDb(true);
  }, 120_000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await begin(db);
    await superuser();
    await db.query(
      `insert into public.catalog_docs(kind, id, slug, visible, data) values
         ('product', 'p1', 'p1', true, $1), ('product', 'p2', 'p2', true, $2), ('product', 'p3', 'p3', false, $3)
       on conflict (kind, id) do update set data = excluded.data, slug = excluded.slug, visible = excluded.visible`,
      [
        JSON.stringify({ id: P1, sku: 'TYB-001', price: 100, name: { ar: 'سجادة كلاسيك', en: 'Classic' } }),
        JSON.stringify({ id: P2, sku: 'TYB-002', price: 200, name: { ar: 'مخدة', en: 'Cushion' } }),
        JSON.stringify({ id: P3, sku: 'TYB-003', price: 300, name: { ar: 'ستارة', en: 'Curtain' } }),
      ],
    );
    await admin();
  });
  afterEach(async () => {
    await db.exec('rollback');
    await db.exec('reset role');
  });

  // -------------------------------------------------------------------------
  describe('function ACLs and SECURITY DEFINER search_path', () => {
    const PUBLIC_FUNCS = [
      'inventory_set_opening', 'inventory_import_opening', 'inventory_adjust', 'inventory_receive', 'inventory_record_return',
      'inventory_set_threshold', 'inventory_init_removed_product', 'inventory_decide_order',
      'inventory_preflight_report', 'inventory_reconcile', 'inventory_reconcile_summary', 'inventory_activation_blockers',
    ];
    const INTERNAL_DEFINER = [
      'inventory_catalog_identity', 'inventory_init_product', 'inventory_movement_result',
      'inventory_order_audit', 'inventory_require_admin', 'inventory_write_movement',
      'inventory_reconcile_rows', 'inventory_blockers_rows',
    ];
    const INTERNAL_PLAIN = [
      'inventory_actor_email', 'inventory_check_key', 'inventory_check_reason', 'inventory_raise_key_reuse',
      'inventory_decision_guard', 'inventory_grant_guard', 'inventory_ledger_guard',
      'inventory_lines_hash', 'inventory_lines_valid', 'inventory_order_lines',
    ];

    const catalog = () =>
      q<{ name: string; args: string; anon: boolean; auth: boolean; svc: boolean; def: boolean; cfg: string | null; acl: string | null; public_exec: boolean }>(
        `select p.proname name, pg_get_function_identity_arguments(p.oid) args,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
                p.prosecdef def, array_to_string(p.proconfig, ';') cfg, p.proacl::text acl,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') public_exec
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname ~ '^inventory_'
          order by p.proname`);

    it('every inventory_* function is explicitly classified (a new, unclassified function fails this test)', async () => {
      const names = (await catalog()).map((f) => f.name);
      expect(new Set(names)).toEqual(new Set([...PUBLIC_FUNCS, ...INTERNAL_DEFINER, ...INTERNAL_PLAIN]));
      expect(names).toHaveLength(new Set(names).size); // no overloads either
    });

    it('has an explicit ACL, no PUBLIC/anon/service_role execution; authenticated only on the 12 admin operations', async () => {
      for (const f of await catalog()) {
        const label = `${f.name}(${f.args})`;
        expect(f.acl, `${label} must not rely on the default PUBLIC execute`).not.toBeNull();
        expect(f.public_exec, `${label} executable by PUBLIC`).toBe(false);
        expect(f.anon, `${label} executable by anon`).toBe(false);
        expect(f.svc, `${label} executable by service_role`).toBe(false);
        expect(f.auth, `${label} authenticated`).toBe(PUBLIC_FUNCS.includes(f.name));
      }
    });

    it('exactly the intended functions are SECURITY DEFINER, and each pins search_path = public', async () => {
      const rows = await catalog();
      expect(new Set(rows.filter((f) => f.def).map((f) => f.name))).toEqual(new Set([...PUBLIC_FUNCS, ...INTERNAL_DEFINER]));
      for (const f of rows.filter((x) => x.def)) {
        expect(f.cfg, `${f.name} search_path`).toBe('search_path=public');
      }
    });

    it('each admin operation checks is_admin() first: non-admin and unauthenticated sessions are refused', async () => {
      const calls = [
        `select public.inventory_set_opening('p1', 1, 'reason abc')`,
        `select public.inventory_import_opening('[{"product_id":"p1","quantity":1}]'::jsonb, false)`,
        `select public.inventory_adjust('p1', 1, 'reason abc')`,
        `select public.inventory_receive('p1', 1, null, 'reason abc')`,
        `select public.inventory_record_return('p1', 1, true, 'reason abc')`,
        `select public.inventory_set_threshold('p1', 1)`,
        `select public.inventory_init_removed_product('gone', 'reason abc')`,
        `select public.inventory_decide_order(gen_random_uuid(), 'already_accounted', 'reason abc', 'x')`,
        `select * from public.inventory_preflight_report()`,
        `select * from public.inventory_reconcile()`,
        `select public.inventory_reconcile_summary()`,
        `select * from public.inventory_activation_blockers()`,
      ];
      await as(db, 'authenticated', USER);
      for (const c of calls) expect((await errOf(c)).message, c).toMatch(/forbidden/);
      await as(db, 'authenticated'); // signed in with no uid
      for (const c of calls) expect((await errOf(c)).message, c).toMatch(/forbidden/);
      await as(db, 'anon');
      for (const c of calls) expect((await errOf(c)).message, c).toMatch(/permission denied/);
      await as(db, 'service_role');
      for (const c of calls) expect((await errOf(c)).message, c).toMatch(/permission denied/);
      await superuser();
      expect(await movements()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('table and sequence privileges', () => {
    const TABLES = ['stock_levels', 'stock_movements', 'stock_override_grants', 'inventory_order_decisions'];
    const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const granted = async (role: string, table: string) => {
      const out: string[] = [];
      for (const p of PRIVS) {
        if ((await one<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${table}', '${p}') ok`)).ok) out.push(p);
      }
      return out;
    };

    it('anon has nothing; authenticated and service_role have SELECT only; PUBLIC has nothing', async () => {
      for (const t of TABLES) {
        expect(await granted('anon', t), `anon on ${t}`).toEqual([]);
        expect(await granted('authenticated', t), `authenticated on ${t}`).toEqual(['SELECT']);
        expect(await granted('service_role', t), `service_role on ${t}`).toEqual(['SELECT']);
        expect(await count(`select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.${t}'::regclass and a.grantee = 0`), `PUBLIC on ${t}`).toBe(0);
      }
    });

    it('a direct write is refused for every API role, including service_role (and a read still works for it)', async () => {
      await setOpening(P1, 5);
      const writes = [
        `insert into public.stock_levels(product_id, on_hand) values ('zz', 1)`,
        `update public.stock_levels set on_hand = 99`,
        `delete from public.stock_levels`,
        `truncate public.stock_levels`,
        `insert into public.stock_movements(product_id, kind, quantity, qty_delta, qty_before, qty_after, reason) values ('p1','receipt',1,1,5,6,'reason abc')`,
        `update public.stock_movements set reason = 'tampered'`,
        `delete from public.stock_movements`,
        `delete from public.stock_override_grants`,
        `delete from public.inventory_order_decisions`,
      ];
      for (const role of ['anon', 'authenticated', 'service_role'] as const) {
        await as(db, role, role === 'authenticated' ? ADMIN : undefined);
        for (const w of writes) expect((await errOf(w)).message, `${role}: ${w}`).toMatch(/permission denied/);
      }
      await as(db, 'service_role');
      expect(await count('select 1 from public.stock_levels')).toBe(1); // read access retained
      await superuser();
      expect(await stock(P1)).toMatchObject({ on_hand: 5 });
      expect(await movements()).toBe(1);
    });

    it('the ledger identity sequence has no privilege for any API role (the harness grants sequences by default, like Supabase)', async () => {
      await superuser();
      // control: a throwaway sequence DOES get the default privileges, so the check below is meaningful
      await db.exec('create sequence public.zz_control_seq');
      expect((await one<{ ok: boolean }>(`select has_sequence_privilege('anon', 'public.zz_control_seq', 'USAGE') ok`)).ok).toBe(true);
      const seq = (await one<{ s: string }>(`select pg_get_serial_sequence('public.stock_movements', 'seq') s`)).s;
      expect(seq).toBeTruthy();
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const p of ['USAGE', 'SELECT', 'UPDATE']) {
          expect((await one<{ ok: boolean }>(`select has_sequence_privilege('${role}', '${seq}', '${p}') ok`)).ok, `${role} ${p}`).toBe(false);
        }
      }
      expect(await count(`select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = '${seq}'::regclass and a.grantee = 0`)).toBe(0);
    });

    it('the other inventory tables own no sequence (uuid keys), so no other sequence needs a revoke', async () => {
      expect(await count(`select 1 from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a','i')
                          join pg_class t on t.oid = d.refobjid
                          where s.relkind = 'S' and t.relname in ('stock_levels','stock_override_grants','inventory_order_decisions')`)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('atomicity: the balance and the ledger row succeed or fail together', () => {
    const forceFail = async (table: string, expr: string) => {
      await superuser();
      await db.exec(`alter table public.${table} add constraint zz_force_fail check (${expr})`);
      await admin();
    };

    it.each([
      ['inventory_receive', `select public.inventory_receive('p1', 5, 'FAIL', 'reason abc')`, `reference is distinct from 'FAIL'`],
      ['inventory_adjust', `select public.inventory_adjust('p1', 3, 'FAILREASON')`, `reason <> 'FAILREASON'`],
      ['inventory_record_return (resaleable)', `select public.inventory_record_return('p1', 2, true, 'FAILREASON')`, `reason <> 'FAILREASON'`],
      ['inventory_record_return (damaged)', `select public.inventory_record_return('p1', 2, false, 'FAILREASON')`, `reason <> 'FAILREASON'`],
    ])('%s: a failing ledger insert rolls the balance change back', async (_name, call, constraint) => {
      await setOpening(P1, 10);
      await forceFail('stock_movements', constraint);
      const before = await movements();
      const e = await errOf(call);
      expect(e.message).toMatch(/violates check constraint "zz_force_fail"/);
      expect(await stock(P1)).toMatchObject({ on_hand: 10 });
      expect(await movements()).toBe(before);
    });

    it('inventory_set_opening: no balance row survives a failing opening movement', async () => {
      await forceFail('stock_movements', `reason <> 'FAILREASON'`);
      expect((await errOf(`select public.inventory_set_opening('p2', 4, 'FAILREASON')`)).message).toMatch(/zz_force_fail/);
      expect(await count(`select 1 from public.stock_levels where product_id = 'p2'`)).toBe(0);
      expect(await movements()).toBe(0);
    });

    it('inventory_init_removed_product: no balance row survives a failing opening movement', async () => {
      await mkOrder(O1, 'H', [{ productId: 'gone', qty: 1, price: 1, name: { ar: 'محذوف' } }]);
      await forceFail('stock_movements', `reason <> 'FAILREASON'`);
      expect((await errOf(`select public.inventory_init_removed_product('gone', 'FAILREASON')`)).message).toMatch(/zz_force_fail/);
      expect(await count(`select 1 from public.stock_levels where product_id = 'gone'`)).toBe(0);
    });

    it('inventory_import_opening: a failure in the LAST row creates none of the earlier rows', async () => {
      await forceFail('stock_movements', `reason <> 'FAILREASON'`);
      const rows = JSON.stringify([{ product_id: P1, quantity: 5 }, { product_id: P2, quantity: 6, reason: 'FAILREASON' }]);
      expect((await errOf('select public.inventory_import_opening($1::jsonb, false)', [rows])).message).toMatch(/zz_force_fail/);
      expect(await count('select 1 from public.stock_levels')).toBe(0);
      expect(await movements()).toBe(0);
    });

    it('inventory_decide_order: the previous decision stays current when recording the new one fails', async () => {
      await mkOrder(O1, 'D', [{ productId: P1, qty: 1, price: 1 }], 'shipped');
      const hash = (await one<{ h: string }>('select lines_hash h from public.inventory_preflight_report() where order_id = $1 limit 1', [O1])).h;
      await one('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'already_accounted', 'first reason', hash]);
      await superuser();
      await db.exec('set constraints all immediate'); // settle deferred events before altering the table
      await admin();
      await forceFail('inventory_order_decisions', `reason <> 'FAILREASON'`);
      await db.exec('set constraints all deferred'); // back to the production behaviour (the FK is initially deferred)
      // a CHANGED decision supersedes the old row first, then inserts the new one — which fails
      const e = await errOf('select public.inventory_decide_order($1, $2, $3, $4)', [O1, 'deduct_on_delivery', 'FAILREASON', hash]);
      expect(e.message).toMatch(/violates check constraint "zz_force_fail"/);
      expect(await q(`select decision, superseded_by is null as current from public.inventory_order_decisions where order_id = $1`, [O1])).toEqual([
        { decision: 'already_accounted', current: true },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('user idempotency keys: format and reserved namespaces', () => {
    const ops: Array<[string, (key: string | null) => string, () => Promise<void>]> = [
      ['inventory_adjust', (k) => `select public.inventory_adjust('p1', 4, 'reason abc', ${k === null ? 'null' : `'${k}'`})`, async () => undefined],
      ['inventory_receive', (k) => `select public.inventory_receive('p1', 1, null, 'reason abc', ${k === null ? 'null' : `'${k}'`})`, async () => undefined],
      ['inventory_record_return', (k) => `select public.inventory_record_return('p1', 1, true, 'reason abc', null, ${k === null ? 'null' : `'${k}'`})`, async () => undefined],
    ];
    const BAD = ['', ' ', 'a b', ' abc', 'abc ', 'a:b', 'opening:p2', 'OPENING:p2', ' opening:p2', 'Opening:p2', 'sale:x', 'accounted:x', 'grant:x', 'é', 'مفتاح', 'a\tb', 'a\nb', 'a/b', 'a+b', 'x'.repeat(129)];

    it.each(ops)('%s rejects reserved, spaced, colon, non-ASCII and over-long keys and writes nothing', async (_name, call) => {
      await setOpening(P1, 10);
      await setOpening(P2, 1);
      const before = await movements();
      for (const bad of BAD) {
        const e = await errOf(call(bad));
        expect(e.code, JSON.stringify(bad)).toBe('22023');
        expect(e.message, JSON.stringify(bad)).toMatch(/inventory_invalid/);
        expect(e.message, JSON.stringify(bad)).toMatch(/idempotency key must be 1-128 ASCII/);
      }
      expect(await movements()).toBe(before);
      expect(await stock(P1)).toMatchObject({ on_hand: 10 });
    });

    it.each(ops)('%s accepts valid keys (letters, digits, dot, underscore, hyphen, up to 128) and no key at all', async (_name, call) => {
      await setOpening(P1, 10);
      for (const ok of ['a', 'A-b_c.d', 'x'.repeat(128), '3f2504e0-4f89-41d3-9a0c-0305e82c3301']) {
        const row = await one<{ r: Row }>(`${call(ok)} r`);
        expect(row.r, ok).toBeTruthy();
      }
      expect((await one<{ r: Row }>(`${call(null)} r`)).r).toBeTruthy();
    });

    it('rejecting a reserved key never blocks the real system key: opening:<id> is still created, and a duplicate fails', async () => {
      await setOpening(P1, 10);
      await errOf(`select public.inventory_adjust('p1', 8, 'reason abc', 'opening:p2')`); // rejected
      expect((await setOpening(P2, 4)).r).toMatchObject({ status: 'created' });
      expect((await one<{ k: string }>(`select idempotency_key k from public.stock_movements where product_id = 'p2'`)).k).toBe('opening:p2');
      expect(await count(`select 1 from public.stock_movements where idempotency_key like '%:%' and kind <> 'opening'`)).toBe(0);
    });

    it('system keys written by the internal path are accepted even though a user could not send them', async () => {
      await setOpening(P1, 10);
      await superuser();
      await db.exec(`select public.inventory_write_movement('p1', 'receipt', 1, 1, 10, 'system write', null, null, 'sale:x:p1')`);
      expect(await count(`select 1 from public.stock_movements where idempotency_key = 'sale:x:p1'`)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotency: a reused key is accepted only for the identical request', () => {
    const reuse = async (sql: string, params: unknown[], differs: string) => {
      const e = await errOf(sql, params);
      expect(e.code).toBe('IS005');
      expect(e.message).toMatch(/idempotency_key_reuse/);
      expect(e.message).toContain(`differs: ${differs}`);
    };
    const adj = (pid: string, counted: number, reason: string, key: string) =>
      ['select public.inventory_adjust($1, $2, $3, $4) r', [pid, counted, reason, key]] as const;

    it('adjust: identical request replays; each differing field is rejected and nothing is written', async () => {
      await setOpening(P1, 20);
      await setOpening(P2, 20);
      const first = (await one<{ r: Row }>(...adj(P1, 15, 'جرد أول', 'key-adj-1'))).r;
      const again = (await one<{ r: Row }>(...adj(P1, 15, 'جرد أول', 'key-adj-1'))).r;
      expect(first.status).toBe('recorded');
      expect(again).toMatchObject({ status: 'replayed', movement_id: first.movement_id });
      const before = await movements();
      await reuse(adj(P1, 14, 'جرد أول', 'key-adj-1')[0], [...adj(P1, 14, 'جرد أول', 'key-adj-1')[1]], 'counted');
      await reuse(adj(P1, 15, 'سبب آخر', 'key-adj-1')[0], [...adj(P1, 15, 'سبب آخر', 'key-adj-1')[1]], 'reason');
      await reuse(adj(P2, 15, 'جرد أول', 'key-adj-1')[0], [...adj(P2, 15, 'جرد أول', 'key-adj-1')[1]], 'product');
      await reuse(`select public.inventory_receive('p1', 15, null, 'جرد أول', 'key-adj-1')`, [], 'operation');
      expect(await movements()).toBe(before);
      expect(await stock(P1)).toMatchObject({ on_hand: 15 });
      expect(await stock(P2)).toMatchObject({ on_hand: 20 });
    });

    it('receive: identical request replays; quantity, reference, reason, product and operation are each compared', async () => {
      await setOpening(P1, 10);
      await setOpening(P2, 10);
      const call = (pid: string, qty: number, ref: string | null, reason: string, key = 'key-rcv-1') =>
        ['select public.inventory_receive($1, $2, $3, $4, $5) r', [pid, qty, ref, reason, key]] as const;
      const first = (await one<{ r: Row }>(...call(P1, 5, 'فاتورة 1', 'استلام'))).r;
      expect((await one<{ r: Row }>(...call(P1, 5, 'فاتورة 1', 'استلام'))).r).toMatchObject({ status: 'replayed', movement_id: first.movement_id });
      const before = await movements();
      await reuse(call(P1, 6, 'فاتورة 1', 'استلام')[0], [...call(P1, 6, 'فاتورة 1', 'استلام')[1]], 'quantity');
      await reuse(call(P1, 5, 'فاتورة 2', 'استلام')[0], [...call(P1, 5, 'فاتورة 2', 'استلام')[1]], 'reference');
      await reuse(call(P1, 5, null, 'استلام')[0], [...call(P1, 5, null, 'استلام')[1]], 'reference');
      await reuse(call(P1, 5, 'فاتورة 1', 'سبب آخر')[0], [...call(P1, 5, 'فاتورة 1', 'سبب آخر')[1]], 'reason');
      await reuse(call(P2, 5, 'فاتورة 1', 'استلام')[0], [...call(P2, 5, 'فاتورة 1', 'استلام')[1]], 'product');
      await reuse(`select public.inventory_adjust('p1', 15, 'استلام', 'key-rcv-1')`, [], 'operation');
      expect(await movements()).toBe(before);
      expect(await stock(P1)).toMatchObject({ on_hand: 15 });
    });

    it('return: identical request replays; quantity, classification, linked order, reason and product are each compared', async () => {
      await setOpening(P1, 10);
      await setOpening(P2, 10);
      await mkOrder(O1, 'R1', [{ productId: P1, qty: 5, price: 1 }, { productId: P2, qty: 5, price: 1 }]);
      await mkOrder(O2, 'R2', [{ productId: P1, qty: 5, price: 1 }, { productId: P2, qty: 5, price: 1 }]);
      const call = (pid: string, qty: number, resell: boolean, reason: string, order: string | null) =>
        ['select public.inventory_record_return($1, $2, $3, $4, $5, $6) r', [pid, qty, resell, reason, order, 'key-ret-1']] as const;
      const first = (await one<{ r: Row }>(...call(P1, 2, true, 'مرتجع', O1))).r;
      expect((await one<{ r: Row }>(...call(P1, 2, true, 'مرتجع', O1))).r).toMatchObject({ status: 'replayed', movement_id: first.movement_id });
      const before = await movements();
      const variants: Array<[ReturnType<typeof call>, string]> = [
        [call(P1, 3, true, 'مرتجع', O1), 'quantity'],
        [call(P1, 2, false, 'مرتجع', O1), 'classification'],
        [call(P1, 2, true, 'مرتجع', O2), 'order'],
        [call(P1, 2, true, 'مرتجع', null), 'order'],
        [call(P1, 2, true, 'سبب آخر', O1), 'reason'],
        [call(P2, 2, true, 'مرتجع', O1), 'product'],
      ];
      for (const [c, differs] of variants) await reuse(c[0], [...c[1]], differs);
      await reuse(`select public.inventory_adjust('p1', 12, 'مرتجع', 'key-ret-1')`, [], 'operation');
      expect(await movements()).toBe(before);
      expect(await stock(P1)).toMatchObject({ on_hand: 12 });
    });

    it('a damaged return replays as damaged and still never changes on_hand', async () => {
      await setOpening(P1, 10);
      const a = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 3, false, 'تالف', null, 'key-dmg-1') r`)).r;
      const b = (await one<{ r: Row }>(`select public.inventory_record_return('p1', 3, false, 'تالف', null, 'key-dmg-1') r`)).r;
      expect(a).toMatchObject({ kind: 'return_damaged', qty_delta: 0 });
      expect(b).toMatchObject({ status: 'replayed', movement_id: a.movement_id });
      expect(await stock(P1)).toMatchObject({ on_hand: 10 });
    });
  });

  // -------------------------------------------------------------------------
  describe('product snapshots', () => {
    const snap = (pid: string) => one<{ product_name: string | null; product_sku: string | null }>(`select product_name, product_sku from public.stock_levels where product_id = $1`, [pid]);
    const lastMove = (pid: string) => one<{ product_name: string | null; product_sku: string | null }>(`select product_name, product_sku from public.stock_movements where product_id = $1 order by seq desc limit 1`, [pid]);
    const editCatalog = async (pid: string, patch: Row) => {
      await superuser();
      await db.query(`update public.catalog_docs set data = data || $2::jsonb where kind = 'product' and id = $1`, [pid, JSON.stringify(patch)]);
      await admin();
    };

    it('a renamed / re-SKUed product is reflected in the next movement and in the balance row; old rows keep their own snapshot', async () => {
      await setOpening(P1, 10);
      await editCatalog(P1, { sku: 'NEW-SKU', name: { ar: 'اسم جديد', en: 'New' } });
      await one(`select public.inventory_adjust('p1', 9, 'reason abc')`);
      expect(await snap(P1)).toEqual({ product_name: 'اسم جديد', product_sku: 'NEW-SKU' });
      expect(await lastMove(P1)).toEqual({ product_name: 'اسم جديد', product_sku: 'NEW-SKU' });
      expect(await q(`select product_sku from public.stock_movements where product_id = 'p1' order by seq`)).toEqual([{ product_sku: 'TYB-001' }, { product_sku: 'NEW-SKU' }]);
    });

    it('every ledger-writing operation refreshes it (receive and both return kinds)', async () => {
      await setOpening(P1, 10);
      await editCatalog(P1, { sku: 'SKU-2' });
      await one(`select public.inventory_receive('p1', 1, null, 'reason abc')`);
      expect((await lastMove(P1))?.product_sku).toBe('SKU-2');
      await editCatalog(P1, { sku: 'SKU-3' });
      await one(`select public.inventory_record_return('p1', 1, false, 'reason abc')`);
      expect((await lastMove(P1))?.product_sku).toBe('SKU-3');
      await editCatalog(P1, { sku: 'SKU-4' });
      await one(`select public.inventory_record_return('p1', 1, true, 'reason abc')`);
      expect((await snap(P1))?.product_sku).toBe('SKU-4');
    });

    it('a DELETED product keeps its last snapshot through later movements', async () => {
      await setOpening(P1, 10);
      await superuser();
      await db.query(`delete from public.catalog_docs where kind = 'product' and id = 'p1'`);
      await admin();
      await one(`select public.inventory_adjust('p1', 7, 'reason abc')`);
      await one(`select public.inventory_receive('p1', 2, null, 'reason abc')`);
      expect(await snap(P1)).toEqual({ product_name: 'سجادة كلاسيك', product_sku: 'TYB-001' });
      expect(await lastMove(P1)).toEqual({ product_name: 'سجادة كلاسيك', product_sku: 'TYB-001' });
    });

    it('a blank sku or name in the catalog never erases the stored snapshot', async () => {
      await setOpening(P1, 10);
      await editCatalog(P1, { sku: '   ', name: { ar: ' ', en: 'x' } });
      await one(`select public.inventory_adjust('p1', 9, 'reason abc')`);
      expect(await snap(P1)).toEqual({ product_name: 'سجادة كلاسيك', product_sku: 'TYB-001' });
    });

    it('a removed product initialized from an order line keeps the order snapshot', async () => {
      await mkOrder(O1, 'H', [{ productId: 'gone', qty: 1, price: 1, name: { ar: 'منتج قديم' }, variantSku: 'OLD-1' }]);
      await one(`select public.inventory_init_removed_product('gone', 'منتج محذوف')`);
      await superuser();
      await db.exec(`select public.inventory_write_movement('gone', 'receipt', 1, 1, 0, 'system seed')`);
      expect(await snap('gone')).toEqual({ product_name: 'منتج قديم', product_sku: 'OLD-1' });
    });
  });

  // -------------------------------------------------------------------------
  describe('actor e-mail: only the expected failures are tolerated', () => {
    const emailOf = async () => (await one<{ e: string | null }>(`select actor_email e from public.stock_movements order by seq desc limit 1`)).e;

    it('records the session e-mail normally', async () => {
      await setOpening(P1, 5);
      expect(await emailOf()).toBe(`${ADMIN}@example.test`);
    });

    it('malformed claims JSON: the operation succeeds with no e-mail (invalid_text_representation)', async () => {
      await db.exec(`select set_config('request.jwt.claims', '{not json', false)`);
      await setOpening(P1, 5);
      expect(await emailOf()).toBeNull();
      expect((await one<{ a: string }>(`select actor::text a from public.stock_movements`)).a).toBe(ADMIN);
    });

    it('auth.jwt() missing (a non-Supabase database): the operation succeeds with no e-mail (undefined_function)', async () => {
      await superuser();
      await db.exec('drop function auth.jwt()');
      await admin();
      await setOpening(P1, 5);
      expect(await emailOf()).toBeNull();
    });

    it('any OTHER failure inside auth.jwt() is NOT swallowed: the operation fails and writes nothing', async () => {
      await superuser();
      await db.exec(`create or replace function auth.jwt() returns jsonb language plpgsql stable as $$ begin raise exception 'boom' using errcode = 'XX000'; end $$`);
      await admin();
      expect((await errOf(`select public.inventory_set_opening('p1', 5, 'reason abc')`)).message).toMatch(/boom/);
      expect(await count('select 1 from public.stock_levels')).toBe(0);
      expect(await movements()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('shadowing resistance (search_path = public)', () => {
    it('temp tables named like the real ones cannot redirect the functions: every reference is schema-qualified', async () => {
      await mkOrder(O1, 'SH', [{ productId: P1, qty: 3, price: 1 }]);
      await admin();
      await db.exec(`
        create temp table stock_levels (product_id text, on_hand int, low_threshold int, product_name text, product_sku text, created_at timestamptz, updated_at timestamptz);
        create temp table stock_movements (id uuid, seq bigint, product_id text, kind text, quantity int, qty_delta int, qty_before int, qty_after int, reason text, reference text, order_id uuid, idempotency_key text);
        create temp table orders (id uuid, lines jsonb, status text, source text, created_at timestamptz, updated_at timestamptz, ref text);
        create temp table catalog_docs (kind text, id text, data jsonb);
        create temp table order_status_history (order_id uuid, status text, created_at timestamptz, id uuid);
        create temp table inventory_order_decisions (id uuid, order_id uuid);
        create temp table app_settings (key text, value jsonb);
      `);
      await setOpening(P1, 10);
      await one(`select public.inventory_adjust('p1', 8, 'reason abc')`);
      await one(`select public.inventory_receive('p1', 2, null, 'reason abc')`);
      await one(`select public.inventory_record_return('p1', 1, true, 'reason abc', '${O1}')`);
      await one(`select public.inventory_record_return('p1', 1, false, 'reason abc', '${O1}')`);
      await one(`select public.inventory_set_threshold('p1', 2)`);
      expect(await count(`select 1 from public.inventory_preflight_report() where order_id = '${O1}'`)).toBe(1);
      await one(`select public.inventory_reconcile_summary() s`);
      // every effect landed in the REAL tables; the look-alike temp tables stayed empty
      for (const t of ['stock_levels', 'stock_movements', 'orders', 'catalog_docs', 'order_status_history', 'inventory_order_decisions']) {
        expect(await count(`select 1 from pg_temp.${t}`), `pg_temp.${t}`).toBe(0);
      }
      expect(await stock(P1)).toMatchObject({ on_hand: 11, low_threshold: 2 });
      expect(await movements()).toBe(5);
    });

    it('untrusted roles cannot create objects in public or auth (so they cannot plant look-alikes there)', async () => {
      const attempts = [
        `create table public.zz_t(i int)`,
        `create function public.zz_f() returns int language sql as 'select 1'`,
        `create table auth.zz_t(i int)`,
        `create function auth.zz_f() returns int language sql as 'select 1'`,
        `create or replace function public.inventory_require_admin() returns void language sql as 'select'`,
        `create or replace function auth.uid() returns uuid language sql as 'select null::uuid'`,
        `create schema zz_schema`,
      ];
      for (const role of ['anon', 'authenticated'] as const) {
        await as(db, role, role === 'authenticated' ? ADMIN : undefined);
        for (const a of attempts) expect((await errOf(a)).message, `${role}: ${a}`).toMatch(/permission denied|must be owner/);
      }
    });

    it('no function used by the inventory code resolves an unqualified application object (static review)', () => {
      const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/0009_inventory.sql'), 'utf8').replace(/\r\n/g, '\n');
      const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      // application tables/functions are always referenced with a schema
      for (const t of ['stock_levels', 'stock_movements', 'stock_override_grants', 'inventory_order_decisions', 'orders', 'order_status_history', 'catalog_docs', 'app_settings']) {
        expect(body, `unqualified ${t}`).not.toMatch(new RegExp(`\\b(from|join|update|into|delete from|truncate)\\s+(only\\s+)?${t}\\b`, 'i'));
      }
    });
  });
});
