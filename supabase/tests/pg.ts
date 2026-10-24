import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

// Real-Postgres harness for the SQL migrations (PGlite = Postgres compiled to
// WASM). Supabase-only pieces are stubbed minimally: the three API roles
// (service_role has BYPASSRLS like the real one), auth.uid() driven by the
// `request.jwt.claim.sub` setting, pg_net's http_post (records calls),
// vault.decrypted_secrets, and public.admins/is_admin() exactly as in 0003.
// Everything else — tables, triggers, RLS, GRANTs, plpgsql, constraints — is
// executed by a real Postgres engine from the actual migration files.
//
// NOT covered here: pg_cron scheduling, real pg_net HTTP delivery, Supabase
// Storage, PostgREST error mapping, and Supabase's own default privileges
// (approximated with ALTER DEFAULT PRIVILEGES).

export const ADMIN = '00000000-0000-0000-0000-0000000000a1';
export const USER = '00000000-0000-0000-0000-0000000000b2';

const MIGRATIONS = path.resolve(__dirname, '../migrations');

export function migrationSql(file: string): string {
  return fs
    .readFileSync(path.join(MIGRATIONS, file), 'utf8')
    .replace(/\r\n/g, '\n')
    // extensions PGlite does not ship (pg_net is stubbed; gen_random_uuid is built in)
    .replace('create extension if not exists pgcrypto;', '')
    .replace('create extension if not exists pg_net with schema extensions;', '');
}

export async function baseDb(opts: { admin?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema net; create schema vault;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table net.calls(url text, headers jsonb);
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
      timeout_milliseconds int default 1000) returns bigint language sql as
      $$ insert into net.calls values (url, headers); select 1::bigint $$;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    grant usage on schema auth, net, vault, extensions to anon, authenticated, service_role;
    grant all on all tables in schema net, vault to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.admins (user_id uuid primary key references auth.users(id));
    alter table public.admins enable row level security;
    create function public.is_admin() returns boolean language sql stable security definer
      set search_path = pg_catalog, public as
      $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
    insert into auth.users values ('${ADMIN}'), ('${USER}');
  `);
  if (opts.admin !== false) await db.exec(`insert into public.admins values ('${ADMIN}')`);
  return db;
}

// Run each test inside a transaction that is rolled back, so tests are
// independent without paying the cost of rebuilding the database.
export async function begin(db: PGlite) {
  await db.exec('begin');
}
export async function rollback(db: PGlite) {
  await db.exec('reset role');
  await db.exec('rollback');
}

export async function as(db: PGlite, role: 'anon' | 'authenticated' | 'service_role' | 'postgres', sub?: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}

// Executes a statement that is EXPECTED to fail; returns the error (code and
// message) and rolls back to a savepoint so the surrounding transaction stays
// usable.
export async function fails(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string }> {
  await db.exec('savepoint expected_failure');
  try {
    await db.query(sql, params);
  } catch (e) {
    await db.exec('rollback to savepoint expected_failure');
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? '', message: err.message ?? '' };
  }
  await db.exec('release savepoint expected_failure');
  throw new Error(`expected statement to fail but it succeeded: ${sql}`);
}
