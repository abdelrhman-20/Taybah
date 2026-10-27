import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { baseDb, migrationSql } from './pg';

// Pre-flight guard of migration 0008 and the "never re-apply 0005 after 0008"
// hazard, on a REAL Postgres engine (PGlite). Each test builds its own database
// (the main in-store suite's database already has everything applied).

const columnCount = async (d: PGlite) =>
  (
    await d.query<{ c: number }>(
      `select count(*)::int c from information_schema.columns
        where table_schema = 'public' and table_name = 'orders' and column_name in ('source','note')`,
    )
  ).rows[0].c;

async function partial(files: string[], mutate?: (d: PGlite) => Promise<void>) {
  const d = await baseDb();
  for (const f of files) await d.exec(migrationSql(f));
  if (mutate) await mutate(d);
  return d;
}

// Runs 0008 and returns the error message ('' = it applied).
async function apply0008(d: PGlite): Promise<string> {
  try {
    await d.exec(migrationSql('0008_in_store_orders.sql'));
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

describe('0008 — pre-flight guard (fails before any change)', () => {
  it('aborts clearly without catalog_docs (0006) and leaves the database untouched', async () => {
    const d = await partial(['0001_orders.sql', '0005_order_email_outbox.sql']);
    expect(await apply0008(d)).toMatch(/ABORT: migration 0008 needs .*catalog_docs.*0006/);
    expect(await columnCount(d)).toBe(0);
    expect((await d.query(`select 1 from pg_policies where policyname = 'admins can insert in-store orders'`)).rows).toHaveLength(0);
    expect((await d.query(`select 1 from pg_proc where proname in ('validate_in_store_order','guard_order_update')`)).rows).toHaveLength(0);
    expect((await d.query(`select 1 from pg_constraint where conname = 'orders_source_status_check'`)).rows).toHaveLength(0);
    await d.close();
  });

  it('aborts clearly without the email outbox (0005) and leaves the database untouched', async () => {
    const d = await partial(['0001_orders.sql', '0006_catalog_documents.sql']);
    expect(await apply0008(d)).toMatch(/ABORT: migration 0008 needs .*order_email_outbox.*0005/);
    expect(await columnCount(d)).toBe(0);
    // the 0001 insert policy was not narrowed
    const pol = await d.query<{ with_check: string }>(
      `select with_check from pg_policies where policyname = 'public can insert orders' or policyname = 'public can insert pending orders'`,
    );
    expect(pol.rows.every((r) => !r.with_check.includes('source'))).toBe(true);
    await d.close();
  });

  it('aborts clearly without is_admin() (0003)', async () => {
    const d = await partial(['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql'], async (x) => {
      // the policies of 0005/0006 depend on it, so cascade just for this probe
      await x.exec('drop function public.is_admin() cascade');
    });
    expect(await apply0008(d)).toMatch(/ABORT: migration 0008 needs .*is_admin\(\).*0003/);
    expect(await columnCount(d)).toBe(0);
    await d.close();
  });

  it('lists every missing dependency at once', async () => {
    const d = await partial(['0001_orders.sql']);
    const msg = await apply0008(d);
    expect(msg).toMatch(/order_email_outbox/);
    expect(msg).toMatch(/catalog_docs/);
    expect(msg).toMatch(/Nothing was changed/);
    expect(await columnCount(d)).toBe(0);
    await d.close();
  });

  it('does not abort when everything is present, and stays re-runnable', async () => {
    const d = await partial(['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql']);
    expect(await apply0008(d)).toBe('');
    expect(await columnCount(d)).toBe(2);
    expect(await apply0008(d)).toBe('');
    await d.close();
  });
});

describe('0008 — re-applying 0005 afterwards (documented hazard)', () => {
  const hasSkipRule = async (d: PGlite) =>
    (await d.query<{ d: string }>(`select pg_get_functiondef('public.enqueue_order_email'::regproc) d`)).rows[0].d.includes('in_store_order');

  it('re-running 0005 removes the in-store e-mail suppression; re-running 0008 restores it', async () => {
    const d = await partial(['0001_orders.sql', '0005_order_email_outbox.sql', '0006_catalog_documents.sql', '0008_in_store_orders.sql']);
    expect(await hasSkipRule(d)).toBe(true);
    await d.exec(migrationSql('0005_order_email_outbox.sql'));
    expect(await hasSkipRule(d)).toBe(false); // exactly why the warning exists
    await d.exec(migrationSql('0008_in_store_orders.sql'));
    expect(await hasSkipRule(d)).toBe(true);
    await d.close();
  });

  it('the migration file, the runbook and the schema doc all carry the warning and the full order', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
    const sql = read('../migrations/0008_in_store_orders.sql');
    const runbook = read('../../docs/PRODUCTION_RUNBOOK.md');
    const schema = read('../../docs/DATABASE_SCHEMA.md');
    expect(sql).toMatch(/NEVER RE-RUN 0005/);
    expect(schema).toMatch(/Never re-apply 0005 after 0008/);
    expect(runbook).toMatch(/never re-apply `0005` after `0008`/i);
    const phaseF = runbook.slice(runbook.indexOf('## Phase F'));
    expect(phaseF).toMatch(/Requires Phase A and Phase C/);
    expect(phaseF).toMatch(/Apply `0006_catalog_documents\.sql`/);
    expect(phaseF).toMatch(/Apply `0005_order_email_outbox\.sql`/);
    expect(phaseF).toMatch(/Then\*\* deploy the app/);
    // order: 0006 before 0005 before 0008 before deploy
    const idx = (s: string) => phaseF.indexOf(s);
    expect(idx('0006_catalog_documents.sql')).toBeLessThan(idx('0005_order_email_outbox.sql'));
    expect(idx('0005_order_email_outbox.sql')).toBeLessThan(idx('Apply `0008_in_store_orders.sql`'));
    expect(idx('Apply `0008_in_store_orders.sql`')).toBeLessThan(idx('deploy the app'));
  });
});
