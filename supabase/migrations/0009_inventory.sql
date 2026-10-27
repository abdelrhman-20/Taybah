-- Taybah — inventory, phase 1: stock balances, an append-only movement ledger,
-- order reconciliation decisions, and the admin-only operations on them.
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders), 0003 (is_admin()), 0006 (catalog_docs / app_settings)
-- and 0008 (orders.source). Re-runnable. A pre-flight check below aborts,
-- changing nothing, if any of those is missing, if the catalog has not been
-- migrated into the database (the app_settings.catalog_initialized object that
-- catalog_mark_initialized() writes, and at least one valid product), or if
-- PUBLIC / anon / authenticated can CREATE objects in the `public` or `auth`
-- schema (the SECURITY DEFINER functions below trust those schemas). It never
-- changes privileges itself — fixing a shared setting is the owner's decision.
--
-- THIS FILE DOES NOT CHANGE ORDER BEHAVIOUR. It adds no trigger, policy or
-- column to public.orders and nothing here deducts stock when an order is
-- created or delivered. That integration is a separate, later migration
-- (0010_inventory_orders.sql) which will refuse to apply until opening balances
-- and the reconciliation checks below pass. Online checkout, delivery, in-store
-- orders and every order status behave exactly as before this file.
--
-- Model (one warehouse, product-level quantity, variants aggregated by product)
--   stock_levels           one row per product that has an INITIALIZED balance
--                          (an explicit opening quantity, zero included). A
--                          product without a row is "not initialized".
--   stock_movements        the ledger: append-only, every change to a balance,
--                          with before/after quantity, reason, actor, timestamp.
--   inventory_order_decisions  append-only reconciliation decisions for orders
--                          that existed before inventory (used by 0010).
--   stock_override_grants  audit table for explicit shortage overrides (rows are
--                          created and consumed by 0010's RPCs; defined here so
--                          the ledger can reference them).
--
-- Privacy and write path
--   Quantities are NOT stored in catalog_docs (world-readable). All four tables
--   are readable by admins only; no API role has INSERT/UPDATE/DELETE/TRUNCATE.
--   Every change goes through the SECURITY DEFINER functions below, each of which
--   checks is_admin() first. Wholesale pricing (0007) is untouched and purchase
--   cost is deliberately NOT modelled here.
--
-- Ledger rules (enforced by constraints and a trigger, not by the UI)
--   quantity_after = quantity_before + qty_delta on every row.
--   opening        first row of a product, before = 0, delta = quantity (>= 0).
--   receipt        delta = +quantity.
--   adjustment     delta = counted - on_hand (never to a negative count).
--   return_restock delta = +quantity   — resaleable, goes back on the shelf.
--   return_damaged delta = 0, before = after, `quantity` records the units — a
--                  damaged return is auditable but NEVER increases on_hand.
--   sale           delta = -quantity   (written by 0010).
--   sale_accounted delta = 0           (written by 0010; stock already accounted).
--   Rows cannot be updated, deleted or truncated.
--
-- Idempotency keys (adjust / receive / return): optional, ASCII [A-Za-z0-9._-]{1,128}.
-- A reused key returns the original result only when the whole request matches
-- (product, operation, quantity/count, classification, linked order, reference,
-- reason); otherwise IS005 idempotency_key_reuse. ':' is not allowed in user keys,
-- so they can never collide with the system keys (opening:<id>, sale:..., ...).
--
-- WARNING — NEVER RE-RUN 0005_order_email_outbox.sql AFTER 0008 (see 0008).

-- ============================================================================
-- 0. Pre-flight: refuse to run unless everything this file depends on exists
-- ============================================================================
-- First statement of the script, so an abort happens before ANY change.

do $$
declare
  v_missing text[] := '{}';
  v_exposed text[] := '{}';
  v_schema text;
  v_role text;
begin
  if to_regclass('public.orders') is null or to_regclass('public.order_status_history') is null then
    v_missing := array_append(v_missing, 'public.orders / order_status_history (migration 0001)');
  end if;
  if to_regprocedure('public.touch_updated_at()') is null then
    v_missing := array_append(v_missing, 'public.touch_updated_at() (migration 0001)');
  end if;
  if to_regprocedure('public.is_admin()') is null then
    v_missing := array_append(v_missing, 'public.is_admin() (migration 0003)');
  end if;
  if to_regclass('public.catalog_docs') is null or to_regclass('public.app_settings') is null then
    v_missing := array_append(v_missing, 'public.catalog_docs / app_settings (migration 0006)');
  else
    -- The exact value catalog_mark_initialized() writes: an object with "at"
    -- ("by" is optional: it is null when run from the SQL editor).
    if not exists (
      select 1 from public.app_settings
       where key = 'catalog_initialized'
         and jsonb_typeof(value) = 'object'
         and nullif(btrim(value ->> 'at'), '') is not null
    ) then
      v_missing := array_append(v_missing, 'a migrated catalog (app_settings.catalog_initialized must be the object written by catalog_mark_initialized(), e.g. {"at": "..."} — complete the catalog migration first)');
    end if;
    if not exists (
      select 1 from public.catalog_docs d
       where d.kind = 'product'
         and nullif(btrim(d.id), '') is not null
         and jsonb_typeof(d.data) = 'object'
         and nullif(btrim(d.data ->> 'sku'), '') is not null
         and nullif(btrim(d.data #>> '{name,ar}'), '') is not null
    ) then
      v_missing := array_append(v_missing, 'at least one valid catalog product (kind product, with a sku and an Arabic name)');
    end if;
  end if;
  if to_regclass('public.orders') is not null and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'source'
  ) then
    v_missing := array_append(v_missing, 'orders.source (migration 0008)');
  end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'ABORT: migration 0009 needs % — apply the missing migration(s) first (see docs/PRODUCTION_RUNBOOK.md). Nothing was changed.',
      array_to_string(v_missing, ', ');
  end if;

  -- The functions below are SECURITY DEFINER with search_path = public and call
  -- auth.uid()/auth.jwt(). That is only safe while untrusted roles cannot create
  -- objects in those schemas.
  foreach v_schema in array array['public', 'auth'] loop
    if to_regnamespace(v_schema) is not null then
      foreach v_role in array array['public', 'anon', 'authenticated'] loop
        if (v_role = 'public' or exists (select 1 from pg_roles where rolname = v_role))
           and has_schema_privilege(v_role, v_schema, 'CREATE') then
          v_exposed := array_append(v_exposed, format('%s can CREATE in schema %s', case when v_role = 'public' then 'PUBLIC' else v_role end, v_schema));
        end if;
      end loop;
    end if;
  end loop;
  if array_length(v_exposed, 1) is not null then
    raise exception 'ABORT: migration 0009 refuses to run: % — SECURITY DEFINER inventory functions would be exposed to object shadowing. This migration does not change privileges. If this is intended to be fixed, the project owner can run: revoke create on schema public from public, anon, authenticated; (and the same for schema auth), then re-run. Nothing was changed.',
      array_to_string(v_exposed, '; ');
  end if;
end;
$$;

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table if not exists public.stock_levels (
  product_id text primary key check (char_length(product_id) between 1 and 200),
  -- Deliberately NO foreign key to catalog_docs: the row (and its ledger) must
  -- outlive a deleted product. Negative is possible only through an audited
  -- shortage override (0010); manual operations never go below zero.
  on_hand integer not null check (on_hand between -100000000 and 100000000),
  low_threshold integer not null default 0 check (low_threshold between 0 and 10000000),
  -- Snapshot of the catalog identity, so a deleted product stays identifiable.
  product_name text,
  product_sku text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists stock_levels_touch_updated_at on public.stock_levels;
create trigger stock_levels_touch_updated_at
  before update on public.stock_levels
  for each row execute function public.touch_updated_at();

-- Audit of explicit shortage overrides. One row per product per ATTEMPT: a new
-- attempt has a new attempt_key, so a failed or changed attempt never blocks a
-- legitimate retry, while a consumed grant can never be reused.
create table if not exists public.stock_override_grants (
  id uuid primary key default gen_random_uuid(),
  attempt_key uuid not null,
  operation text not null check (operation in ('deliver_order', 'create_in_store_order')),
  -- Deferred: for an in-store order the grant is written just before the order.
  order_id uuid not null references public.orders (id) deferrable initially deferred,
  product_id text not null,
  requested_qty integer not null check (requested_qty > 0),
  available_qty integer not null,
  shortfall integer not null check (shortfall > 0),
  reason text not null check (char_length(btrim(reason)) >= 5),
  granted_by uuid not null,
  granted_by_email text,
  txid bigint not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (attempt_key, product_id),
  check (shortfall = requested_qty - available_qty)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  -- Strictly increasing order of writes (timestamps can tie inside one transaction).
  seq bigint generated always as identity unique,
  product_id text not null check (char_length(product_id) between 1 and 200),
  product_name text,
  product_sku text,
  kind text not null check (kind in (
    'opening', 'receipt', 'sale', 'sale_accounted', 'return_restock', 'return_damaged', 'adjustment'
  )),
  -- Units involved (>= 0). Equals |qty_delta| except for rows that do not move
  -- stock (return_damaged, sale_accounted), where it still records the units.
  quantity integer not null check (quantity between 0 and 100000000),
  qty_delta integer not null,
  qty_before integer not null,
  qty_after integer not null,
  reason text not null check (char_length(btrim(reason)) >= 3),
  reference text check (reference is null or char_length(reference) <= 200),
  order_id uuid references public.orders (id) on delete restrict,
  idempotency_key text unique check (idempotency_key is null or char_length(idempotency_key) <= 200),
  override boolean not null default false,
  shortfall integer not null default 0 check (shortfall >= 0),
  override_grant_id uuid unique references public.stock_override_grants (id),
  actor uuid,
  actor_email text,
  created_at timestamptz not null default now(),

  constraint stock_movements_chain check (qty_after = qty_before + qty_delta),
  constraint stock_movements_kind_rules check (
    case kind
      when 'opening'        then qty_before = 0 and qty_delta = quantity
      when 'receipt'        then quantity > 0 and qty_delta = quantity
      when 'return_restock' then quantity > 0 and qty_delta = quantity
      when 'adjustment'     then qty_delta <> 0 and quantity = abs(qty_delta)
      when 'sale'           then quantity > 0 and qty_delta = -quantity
      when 'return_damaged' then quantity > 0 and qty_delta = 0
      when 'sale_accounted' then quantity > 0 and qty_delta = 0
    end
  ),
  constraint stock_movements_order_rules check (
    case kind
      when 'sale'           then order_id is not null
      when 'sale_accounted' then order_id is not null
      when 'return_restock' then true
      when 'return_damaged' then true
      else order_id is null
    end
  ),
  constraint stock_movements_override_rules check (
    (override and kind = 'sale' and shortfall > 0 and override_grant_id is not null)
    or (not override and shortfall = 0 and override_grant_id is null)
  )
);

create index if not exists stock_movements_product_idx on public.stock_movements (product_id, seq);
create index if not exists stock_movements_order_idx on public.stock_movements (order_id) where order_id is not null;

-- Reconciliation decisions for orders that existed before inventory. Append-only:
-- a newer decision supersedes (never edits) the previous one.
create table if not exists public.inventory_order_decisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  -- deduct_on_delivery : the order's goods are inside the opening balance; stock is
  --                      deducted when it is delivered.
  -- already_accounted  : the goods are NOT in the opening balance (already out / counted
  --                      elsewhere); no deduction at delivery, only an audit row.
  -- settled_legacy     : historical classification written by 0010 for old finished
  --                      orders. It is NOT a switch: it only marks an order as old.
  decision text not null check (decision in ('deduct_on_delivery', 'already_accounted', 'settled_legacy')),
  reason text not null check (char_length(btrim(reason)) >= 5),
  -- Hash of the product/quantity lines the admin was shown (see inventory_lines_hash).
  lines_hash text not null,
  status_at_decision text not null,
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz not null default now(),
  superseded_by uuid references public.inventory_order_decisions (id) deferrable initially deferred,
  check (decision = 'settled_legacy' or decided_by is not null)
);

create unique index if not exists inventory_order_decisions_current_uq
  on public.inventory_order_decisions (order_id) where superseded_by is null;

-- ============================================================================
-- 2. Row-level security and privileges: admins read, nobody writes directly
-- ============================================================================
-- Supabase grants new tables to anon/authenticated by default, so the explicit
-- revoke is what makes them private (same pattern as 0007).

alter table public.stock_levels enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_override_grants enable row level security;
alter table public.inventory_order_decisions enable row level security;

revoke all on table public.stock_levels from anon, authenticated;
revoke all on table public.stock_movements from anon, authenticated;
revoke all on table public.stock_override_grants from anon, authenticated;
revoke all on table public.inventory_order_decisions from anon, authenticated;

-- service_role (the trusted server key) keeps SELECT only: every change goes through
-- the SECURITY DEFINER functions, which run as the table owner and need nothing
-- from service_role. Nothing in the application writes these tables directly.
revoke insert, update, delete, truncate, references, trigger on table
  public.stock_levels, public.stock_movements, public.stock_override_grants, public.inventory_order_decisions
  from service_role;

-- The ledger's identity sequence is only ever advanced by inserts made by the
-- owner-run functions; no API role needs (or gets) any privilege on it.
do $$
declare
  v_seq text := pg_get_serial_sequence('public.stock_movements', 'seq');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_seq);
  end if;
end;
$$;

grant select on table public.stock_levels to authenticated;
grant select on table public.stock_movements to authenticated;
grant select on table public.stock_override_grants to authenticated;
grant select on table public.inventory_order_decisions to authenticated;

drop policy if exists "admins can read stock levels" on public.stock_levels;
create policy "admins can read stock levels" on public.stock_levels
  for select using (public.is_admin());
drop policy if exists "admins can read stock movements" on public.stock_movements;
create policy "admins can read stock movements" on public.stock_movements
  for select using (public.is_admin());
drop policy if exists "admins can read stock override grants" on public.stock_override_grants;
create policy "admins can read stock override grants" on public.stock_override_grants
  for select using (public.is_admin());
drop policy if exists "admins can read inventory order decisions" on public.inventory_order_decisions;
create policy "admins can read inventory order decisions" on public.inventory_order_decisions
  for select using (public.is_admin());

-- ============================================================================
-- 3. Immutability guards
-- ============================================================================

create or replace function public.inventory_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the stock movement ledger is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists stock_movements_no_update on public.stock_movements;
create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function public.inventory_ledger_guard();
drop trigger if exists stock_movements_no_truncate on public.stock_movements;
create trigger stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement execute function public.inventory_ledger_guard();

-- A grant may only change once: consumed_at null -> a timestamp.
create or replace function public.inventory_grant_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.consumed_at is null and new.consumed_at is not null
     and (to_jsonb(new) - 'consumed_at') = (to_jsonb(old) - 'consumed_at') then
    return new;
  end if;
  raise exception 'override grants are append-only and can be consumed exactly once' using errcode = '42501';
end;
$$;

drop trigger if exists stock_override_grants_guard on public.stock_override_grants;
create trigger stock_override_grants_guard
  before update or delete on public.stock_override_grants
  for each row execute function public.inventory_grant_guard();
drop trigger if exists stock_override_grants_no_truncate on public.stock_override_grants;
create trigger stock_override_grants_no_truncate
  before truncate on public.stock_override_grants
  for each statement execute function public.inventory_ledger_guard();

-- A decision may only change once: superseded_by null -> a newer decision id.
create or replace function public.inventory_decision_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.superseded_by is null and new.superseded_by is not null
     and (to_jsonb(new) - 'superseded_by') = (to_jsonb(old) - 'superseded_by') then
    return new;
  end if;
  raise exception 'inventory order decisions are append-only' using errcode = '42501';
end;
$$;

drop trigger if exists inventory_order_decisions_guard on public.inventory_order_decisions;
create trigger inventory_order_decisions_guard
  before update or delete on public.inventory_order_decisions
  for each row execute function public.inventory_decision_guard();
drop trigger if exists inventory_order_decisions_no_truncate on public.inventory_order_decisions;
create trigger inventory_order_decisions_no_truncate
  before truncate on public.inventory_order_decisions
  for each statement execute function public.inventory_ledger_guard();

-- ============================================================================
-- 4. Internal helpers (not callable by API roles)
-- ============================================================================

create or replace function public.inventory_require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- E-mail of the acting session, a convenience snapshot. auth.uid() stays the
-- authoritative identity; the e-mail is absent in the SQL editor.
-- Only the two EXPECTED failures are tolerated: auth.jwt() does not exist
-- (non-Supabase database) or the claims are not valid JSON. Anything else is a
-- real error and propagates.
create or replace function public.inventory_actor_email()
returns text
language plpgsql
stable
as $$
begin
  return nullif(auth.jwt() ->> 'email', '');
exception when undefined_function or invalid_schema_name or invalid_text_representation then
  return null;
end;
$$;

-- User-supplied idempotency keys: ASCII letters, digits, '.', '_', '-', 1-128
-- characters. ':' is excluded ON PURPOSE: every system key (opening:<id>, and in
-- 0010 sale:/accounted:/grant:) contains ':', so user and system keys can never
-- collide, whatever the name or case. System keys do not pass through here.
create or replace function public.inventory_check_key(p_key text)
returns void
language plpgsql
immutable
as $$
begin
  if p_key is not null and (
       p_key !~ '^[A-Za-z0-9._-]{1,128}$'
       or octet_length(p_key) <> char_length(p_key)
     ) then
    raise exception 'inventory_invalid' using errcode = '22023',
      detail = 'idempotency key must be 1-128 ASCII characters from A-Z a-z 0-9 . _ - (no spaces, no ":", no non-ASCII; ":" is reserved for system keys)';
  end if;
end;
$$;

-- A reused key is accepted only for the SAME request. Names the differing fields
-- (never their values).
create or replace function public.inventory_raise_key_reuse(p_diff text[])
returns void
language plpgsql
immutable
as $$
begin
  raise exception 'idempotency_key_reuse' using errcode = 'IS005',
    detail = 'idempotency key already used for a different request (differs: ' || array_to_string(p_diff, ', ') || ')';
end;
$$;

create or replace function public.inventory_check_reason(p_reason text, p_min integer default 3)
returns void
language plpgsql
immutable
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < p_min then
    raise exception 'inventory_invalid' using errcode = '22023',
      detail = format('a reason of at least %s characters is required', p_min);
  end if;
end;
$$;

-- Order lines aggregated by PRODUCT (every variant of a product counts toward
-- the same balance). Malformed lines are ignored here; inventory_lines_valid()
-- reports whether any were.
create or replace function public.inventory_order_lines(p_lines jsonb)
returns table (product_id text, qty integer, product_name text)
language sql
immutable
as $$
  select l ->> 'productId',
         sum((l ->> 'qty')::numeric)::integer,
         min(l #>> '{name,ar}')
    from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) l
   where jsonb_typeof(l) = 'object'
     and jsonb_typeof(l -> 'productId') = 'string'
     and btrim(l ->> 'productId') <> ''
     and jsonb_typeof(l -> 'qty') = 'number'
     and (l ->> 'qty')::numeric = trunc((l ->> 'qty')::numeric)
     and (l ->> 'qty')::numeric between 1 and 999999
   group by l ->> 'productId'
$$;

create or replace function public.inventory_lines_valid(p_lines jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_lines) = 'array'
     and jsonb_array_length(p_lines) >= 1
     and jsonb_array_length(p_lines) = (
       select count(*)
         from jsonb_array_elements(p_lines) l
        where jsonb_typeof(l) = 'object'
          and jsonb_typeof(l -> 'productId') = 'string'
          and btrim(l ->> 'productId') <> ''
          and jsonb_typeof(l -> 'qty') = 'number'
          and (l ->> 'qty')::numeric = trunc((l ->> 'qty')::numeric)
          and (l ->> 'qty')::numeric between 1 and 999999
     )
$$;

-- What a decision is bound to: the exact product/quantity set shown to the admin.
create or replace function public.inventory_lines_hash(p_lines jsonb)
returns text
language sql
immutable
as $$
  select md5(coalesce(string_agg(product_id || ':' || qty, ',' order by product_id), ''))
    from public.inventory_order_lines(p_lines)
$$;

-- Writes one ledger row. Callers hold the stock_levels row lock and have
-- already updated the balance in the same transaction.
create or replace function public.inventory_write_movement(
  p_product_id text,
  p_kind text,
  p_quantity integer,
  p_delta integer,
  p_before integer,
  p_reason text,
  p_reference text default null,
  p_order_id uuid default null,
  p_idempotency_key text default null,
  p_grant_id uuid default null,
  p_shortfall integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_sku text;
  v_ident record;
begin
  -- Refresh the catalog snapshot while the product still exists (the caller holds
  -- the balance row lock). A product that was deleted keeps its last snapshot, and
  -- a blank catalog value never erases a stored one.
  select * into v_ident from public.inventory_catalog_identity(p_product_id);
  if v_ident.in_catalog then
    update public.stock_levels
       set product_name = coalesce(nullif(btrim(v_ident.name), ''), product_name),
           product_sku = coalesce(nullif(btrim(v_ident.sku), ''), product_sku)
     where product_id = p_product_id
       and (product_name is distinct from coalesce(nullif(btrim(v_ident.name), ''), product_name)
            or product_sku is distinct from coalesce(nullif(btrim(v_ident.sku), ''), product_sku));
  end if;
  select product_name, product_sku into v_name, v_sku
    from public.stock_levels where product_id = p_product_id;
  insert into public.stock_movements (
    product_id, product_name, product_sku, kind, quantity, qty_delta, qty_before, qty_after,
    reason, reference, order_id, idempotency_key, override, shortfall, override_grant_id,
    actor, actor_email
  ) values (
    p_product_id, v_name, v_sku, p_kind, p_quantity, p_delta, p_before, p_before + p_delta,
    btrim(p_reason), nullif(btrim(p_reference), ''), p_order_id, p_idempotency_key,
    p_grant_id is not null, coalesce(p_shortfall, 0), p_grant_id,
    auth.uid(), public.inventory_actor_email()
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Creates the balance row and its opening movement. Never overwrites: returns
-- false when the product already has a balance.
create or replace function public.inventory_init_product(
  p_product_id text,
  p_quantity integer,
  p_reason text,
  p_name text default null,
  p_sku text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted text;
begin
  insert into public.stock_levels (product_id, on_hand, product_name, product_sku)
  values (p_product_id, p_quantity, p_name, p_sku)
  on conflict (product_id) do nothing
  returning product_id into v_inserted;
  if v_inserted is null then
    return false;
  end if;
  perform public.inventory_write_movement(
    p_product_id, 'opening', p_quantity, p_quantity, 0, p_reason, null, null, 'opening:' || p_product_id
  );
  return true;
end;
$$;

-- Catalog identity of a product, from the live document (null when it is gone).
create or replace function public.inventory_catalog_identity(p_product_id text)
returns table (in_catalog boolean, name text, sku text)
language sql
stable
security definer
set search_path = public
as $$
  select true, d.data #>> '{name,ar}', d.data ->> 'sku'
    from public.catalog_docs d
   where d.kind = 'product' and d.id = p_product_id
  union all
  select false, null, null
   where not exists (select 1 from public.catalog_docs d where d.kind = 'product' and d.id = p_product_id)
$$;

-- Compact result of a ledger row for the callers.
create or replace function public.inventory_movement_result(p_id uuid, p_replayed boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', case when p_replayed then 'replayed' else 'recorded' end,
    'movement_id', m.id, 'product_id', m.product_id, 'kind', m.kind,
    'quantity', m.quantity, 'qty_delta', m.qty_delta,
    'qty_before', m.qty_before, 'qty_after', m.qty_after
  ) from public.stock_movements m where m.id = p_id
$$;

-- ============================================================================
-- 5. Admin operations
-- ============================================================================
-- Errors: 42501 forbidden · 22023 inventory_invalid (detail says why) ·
--         IS001 stock_not_initialized.

-- Initializes ONE product with an explicit opening quantity (zero is valid).
-- Never overwrites: a product that already has a balance is reported as 'exists'
-- and left untouched (corrections go through inventory_adjust).
create or replace function public.inventory_set_opening(
  p_product_id text,
  p_quantity integer,
  p_reason text default 'رصيد افتتاحي'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ident record;
  v_current integer;
  v_created boolean;
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason);
  if p_quantity is null or p_quantity < 0 or p_quantity > 10000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'quantity must be a whole number between 0 and 10000000';
  end if;
  select * into v_ident from public.inventory_catalog_identity(p_product_id);
  if not v_ident.in_catalog then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'unknown product';
  end if;

  v_created := public.inventory_init_product(p_product_id, p_quantity, p_reason, v_ident.name, v_ident.sku);
  if not v_created then
    select on_hand into v_current from public.stock_levels where product_id = p_product_id;
    return jsonb_build_object('status', 'exists', 'product_id', p_product_id,
                              'on_hand', v_current, 'requested', p_quantity);
  end if;
  return jsonb_build_object('status', 'created', 'product_id', p_product_id,
                            'on_hand', p_quantity, 'requested', p_quantity);
end;
$$;

-- Batch opening balances. p_rows: [{ "product_id": text, "quantity": int, "reason"?: text }].
-- Dry run (default) writes nothing. A real run is all-or-nothing about INVALID input
-- (unknown product, bad quantity, duplicate in the batch -> nothing is written) and
-- skips products that already have a balance (never overwritten). Products that are
-- absent from the batch are reported, never filled with zero.
create or replace function public.inventory_import_opening(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_pid text;
  v_status text;
  v_reason text;
  v_seen text[] := '{}';
  v_report jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_skipped integer := 0;
  v_rejected integer := 0;
  v_ident record;
  v_qty numeric;
  v_missing_count integer;
  v_missing jsonb;
begin
  perform public.inventory_require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'rows must be an array of 1-5000 items';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_pid := case when jsonb_typeof(r) = 'object' then r ->> 'product_id' end;
    v_reason := coalesce(nullif(btrim(r ->> 'reason'), ''), 'رصيد افتتاحي (استيراد)');
    v_qty := case when jsonb_typeof(r -> 'quantity') = 'number' then (r ->> 'quantity')::numeric end;
    if v_pid is null or btrim(v_pid) = '' or char_length(v_pid) > 200
       or v_qty is null or v_qty <> trunc(v_qty) or v_qty not between 0 and 10000000
       or char_length(btrim(v_reason)) < 3 then
      v_status := 'invalid';
    elsif v_pid = any (v_seen) then
      v_status := 'duplicate_in_batch';
    else
      select * into v_ident from public.inventory_catalog_identity(v_pid);
      if not v_ident.in_catalog then
        v_status := 'unknown_product';
      elsif exists (select 1 from public.stock_levels where product_id = v_pid) then
        v_status := 'already_initialized';
      else
        v_status := 'would_create';
      end if;
    end if;
    if v_pid is not null then
      v_seen := array_append(v_seen, v_pid);
    end if;
    if v_status in ('invalid', 'duplicate_in_batch', 'unknown_product') then
      v_rejected := v_rejected + 1;
    elsif v_status = 'already_initialized' then
      v_skipped := v_skipped + 1;
    end if;
    v_report := v_report || jsonb_build_object(
      'product_id', v_pid, 'quantity', r -> 'quantity', 'status', v_status);
  end loop;

  if not p_dry_run then
    if v_rejected > 0 then
      raise exception 'inventory_invalid' using errcode = '22023',
        detail = format('import rejected: %s invalid row(s); nothing was written', v_rejected);
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      v_pid := r ->> 'product_id';
      v_reason := coalesce(nullif(btrim(r ->> 'reason'), ''), 'رصيد افتتاحي (استيراد)');
      select * into v_ident from public.inventory_catalog_identity(v_pid);
      if public.inventory_init_product(v_pid, (r ->> 'quantity')::numeric::integer, v_reason, v_ident.name, v_ident.sku) then
        v_created := v_created + 1;
      end if;
    end loop;
  else
    select count(*) into v_created from jsonb_array_elements(v_report) x where x ->> 'status' = 'would_create';
  end if;

  select count(*), coalesce(jsonb_agg(id order by id) filter (where rn <= 200), '[]'::jsonb)
    into v_missing_count, v_missing
    from (
      select d.id, row_number() over (order by d.id) rn
        from public.catalog_docs d
       where d.kind = 'product'
         and not exists (select 1 from public.stock_levels s where s.product_id = d.id)
         and d.id <> all (v_seen)
    ) m;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'created', v_created, 'skipped', v_skipped, 'rejected', v_rejected,
    'rows', v_report,
    'catalog_products_not_in_batch_and_uninitialized', v_missing_count,
    'catalog_products_not_in_batch_sample', v_missing);
end;
$$;

-- Manual correction: sets the balance to the COUNTED quantity (>= 0) and records
-- the difference. An unchanged count records nothing. p_idempotency_key makes a
-- retry after a lost response return the original result.
create or replace function public.inventory_adjust(
  p_product_id text,
  p_counted integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stock_levels%rowtype;
  v_existing public.stock_movements%rowtype;
  v_mid uuid;
  v_diff text[];
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason);
  perform public.inventory_check_key(p_idempotency_key);
  if p_counted is null or p_counted < 0 or p_counted > 100000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'counted quantity must be a whole number >= 0';
  end if;

  select * into v_row from public.stock_levels where product_id = p_product_id for update;
  if not found then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = p_product_id;
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      v_diff := array_remove(array[
        case when v_existing.product_id <> p_product_id then 'product' end,
        case when v_existing.kind <> 'adjustment' then 'operation' end,
        case when v_existing.qty_after is distinct from p_counted then 'counted' end,
        case when v_existing.reason is distinct from btrim(p_reason) then 'reason' end
      ], null);
      if array_length(v_diff, 1) is not null then
        perform public.inventory_raise_key_reuse(v_diff);
      end if;
      return public.inventory_movement_result(v_existing.id, true);
    end if;
  end if;

  if p_counted = v_row.on_hand then
    return jsonb_build_object('status', 'unchanged', 'product_id', p_product_id, 'on_hand', v_row.on_hand);
  end if;

  update public.stock_levels set on_hand = p_counted where product_id = p_product_id;
  v_mid := public.inventory_write_movement(
    p_product_id, 'adjustment', abs(p_counted - v_row.on_hand), p_counted - v_row.on_hand,
    v_row.on_hand, p_reason, null, null, p_idempotency_key);
  return public.inventory_movement_result(v_mid);
end;
$$;

-- Simple stock receipt (goods in). No supplier and no cost — purchase cost is
-- deliberately not modelled and never touches the wholesale price.
create or replace function public.inventory_receive(
  p_product_id text,
  p_quantity integer,
  p_reference text,
  p_reason text default 'استلام مخزون',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stock_levels%rowtype;
  v_existing public.stock_movements%rowtype;
  v_mid uuid;
  v_diff text[];
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason);
  perform public.inventory_check_key(p_idempotency_key);
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'quantity must be a whole number between 1 and 10000000';
  end if;
  if p_reference is not null and char_length(p_reference) > 200 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'reference is too long';
  end if;

  select * into v_row from public.stock_levels where product_id = p_product_id for update;
  if not found then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = p_product_id;
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      v_diff := array_remove(array[
        case when v_existing.product_id <> p_product_id then 'product' end,
        case when v_existing.kind <> 'receipt' then 'operation' end,
        case when v_existing.quantity is distinct from p_quantity then 'quantity' end,
        case when v_existing.reference is distinct from nullif(btrim(p_reference), '') then 'reference' end,
        case when v_existing.reason is distinct from btrim(p_reason) then 'reason' end
      ], null);
      if array_length(v_diff, 1) is not null then
        perform public.inventory_raise_key_reuse(v_diff);
      end if;
      return public.inventory_movement_result(v_existing.id, true);
    end if;
  end if;

  if v_row.on_hand + p_quantity > 100000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'resulting quantity is out of range';
  end if;
  update public.stock_levels set on_hand = on_hand + p_quantity where product_id = p_product_id;
  v_mid := public.inventory_write_movement(
    p_product_id, 'receipt', p_quantity, p_quantity, v_row.on_hand, p_reason, p_reference, null, p_idempotency_key);
  return public.inventory_movement_result(v_mid);
end;
$$;

-- Manual return. p_resellable has NO default and null is rejected: the admin must
-- choose explicitly.
--   true  -> return_restock : on_hand increases by the quantity.
--   false -> return_damaged : on_hand is NOT changed (delta 0, before = after); the
--            row still records the units, who, why and which order.
-- p_order_id is optional; when given, the total returned for that order and product
-- (resaleable + damaged) may not exceed the quantity sold in that order.
create or replace function public.inventory_record_return(
  p_product_id text,
  p_quantity integer,
  p_resellable boolean,
  p_reason text,
  p_order_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stock_levels%rowtype;
  v_existing public.stock_movements%rowtype;
  v_order public.orders%rowtype;
  v_sold integer;
  v_returned integer;
  v_mid uuid;
  v_diff text[];
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason);
  perform public.inventory_check_key(p_idempotency_key);
  if p_resellable is null then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'choose whether the returned item is resaleable or damaged';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'quantity must be a whole number between 1 and 10000000';
  end if;

  -- The balance row lock serializes returns of the same product, so the cap
  -- check below cannot be raced.
  select * into v_row from public.stock_levels where product_id = p_product_id for update;
  if not found then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = p_product_id;
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      v_diff := array_remove(array[
        case when v_existing.product_id <> p_product_id then 'product' end,
        case when v_existing.kind not in ('return_restock', 'return_damaged') then 'operation' end,
        case when v_existing.kind in ('return_restock', 'return_damaged')
                  and v_existing.kind <> case when p_resellable then 'return_restock' else 'return_damaged' end
             then 'classification' end,
        case when v_existing.quantity is distinct from p_quantity then 'quantity' end,
        case when v_existing.order_id is distinct from p_order_id then 'order' end,
        case when v_existing.reason is distinct from btrim(p_reason) then 'reason' end
      ], null);
      if array_length(v_diff, 1) is not null then
        perform public.inventory_raise_key_reuse(v_diff);
      end if;
      return public.inventory_movement_result(v_existing.id, true);
    end if;
  end if;

  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id;
    if not found then
      raise exception 'inventory_invalid' using errcode = '22023', detail = 'unknown order';
    end if;
    select coalesce(sum(qty), 0) into v_sold
      from public.inventory_order_lines(v_order.lines) where product_id = p_product_id;
    if v_sold = 0 then
      raise exception 'inventory_invalid' using errcode = '22023', detail = 'the product is not part of that order';
    end if;
    select coalesce(sum(quantity), 0) into v_returned
      from public.stock_movements
     where order_id = p_order_id and product_id = p_product_id
       and kind in ('return_restock', 'return_damaged');
    if v_returned + p_quantity > v_sold then
      raise exception 'inventory_invalid' using errcode = '22023',
        detail = format('return exceeds the sold quantity (%s sold, %s already returned)', v_sold, v_returned);
    end if;
  end if;

  if p_resellable then
    if v_row.on_hand + p_quantity > 100000000 then
      raise exception 'inventory_invalid' using errcode = '22023', detail = 'resulting quantity is out of range';
    end if;
    update public.stock_levels set on_hand = on_hand + p_quantity where product_id = p_product_id;
    v_mid := public.inventory_write_movement(
      p_product_id, 'return_restock', p_quantity, p_quantity, v_row.on_hand, p_reason, null, p_order_id, p_idempotency_key);
  else
    v_mid := public.inventory_write_movement(
      p_product_id, 'return_damaged', p_quantity, 0, v_row.on_hand, p_reason, null, p_order_id, p_idempotency_key);
  end if;
  return public.inventory_movement_result(v_mid);
end;
$$;

-- Minimum-stock threshold for the low-stock alert. Not a quantity change, so it
-- is not a ledger movement.
create or replace function public.inventory_set_threshold(p_product_id text, p_threshold integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated text;
begin
  perform public.inventory_require_admin();
  if p_threshold is null or p_threshold < 0 or p_threshold > 10000000 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'threshold must be a whole number >= 0';
  end if;
  update public.stock_levels set low_threshold = p_threshold
   where product_id = p_product_id returning product_id into v_updated;
  if v_updated is null then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = p_product_id;
  end if;
  return jsonb_build_object('status', 'updated', 'product_id', p_product_id, 'low_threshold', p_threshold);
end;
$$;

-- Explicit zero balance for a product that was deleted from the catalog but is
-- still referenced by historical orders. The row needs no live catalog product:
-- the name comes from the order line snapshot. Refused for a product that still
-- exists in the catalog (use inventory_set_opening) or that no order references.
create or replace function public.inventory_init_removed_product(
  p_product_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ident record;
  v_name text;
  v_sku text;
  v_created boolean;
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason);
  select * into v_ident from public.inventory_catalog_identity(p_product_id);
  if v_ident.in_catalog then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'the product still exists in the catalog — initialize it normally';
  end if;

  select l ->> 'variantSku', l #>> '{name,ar}' into v_sku, v_name
    from public.orders o,
         jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l
   where jsonb_typeof(l) = 'object' and l ->> 'productId' = p_product_id
   order by o.created_at desc
   limit 1;
  if v_name is null and v_sku is null and not exists (
    select 1 from public.orders o,
         jsonb_array_elements(case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end) l
     where jsonb_typeof(l) = 'object' and l ->> 'productId' = p_product_id
  ) then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'no historical order references that product';
  end if;

  v_created := public.inventory_init_product(p_product_id, 0, p_reason, v_name, v_sku);
  return jsonb_build_object('status', case when v_created then 'created' else 'exists' end,
                            'product_id', p_product_id, 'on_hand', 0);
end;
$$;

-- ============================================================================
-- 6. Order audit, preflight report and reconciliation decisions
-- ============================================================================

-- One row per order: its history/lines problems and its classification.
-- Order-status history is NOT trusted to be complete: every inconsistency below
-- makes the order 'ambiguous', which can never be deducted or ignored
-- automatically — it needs an explicit decision.
create or replace function public.inventory_order_audit()
returns table (
  audit_order_id uuid,
  audit_ref text,
  audit_status text,
  audit_source text,
  audit_created_at timestamptz,
  audit_classification text,
  audit_issues text[],
  audit_lines_hash text
)
language sql
stable
security definer
set search_path = public
as $$
  with seq as (
    select h.order_id, h.status, h.created_at, h.id,
           lag(h.status) over w as prev_status,
           count(*) over (partition by h.order_id, h.created_at) as ties
      from public.order_status_history h
    window w as (partition by h.order_id order by h.created_at, h.id)
  ),
  agg as (
    select s.order_id,
           count(*) as n,
           (array_agg(s.status order by s.created_at, s.id))[1] as first_status,
           (array_agg(s.status order by s.created_at desc, s.id desc))[1] as last_status,
           min(s.created_at) as first_at,
           max(s.created_at) as last_at,
           bool_or(s.prev_status = s.status) as has_dup,
           bool_or(s.ties > 1) as has_tie,
           bool_or(s.status not in ('pending','confirmed','processing','shipped','delivered','cancelled','sold')) as has_unknown,
           count(*) filter (where s.status = 'delivered') as delivered_rows,
           count(*) filter (where s.status = 'delivered' and s.prev_status is distinct from 'delivered') as delivered_entries
      from seq s group by s.order_id
  ),
  issues as (
    select o.id, o.ref, o.status, o.source, o.created_at, o.lines,
      array_remove(array[
        case when a.order_id is null then 'NO_HISTORY' end,
        case when a.order_id is not null and a.first_status is distinct from
                  case when o.source = 'in_store' then 'sold' else 'pending' end
             then 'FIRST_STATUS_UNEXPECTED' end,
        case when a.order_id is not null and a.last_status is distinct from o.status then 'LAST_STATUS_MISMATCH' end,
        case when o.status = 'delivered' and coalesce(a.delivered_rows, 0) = 0 then 'DELIVERED_WITHOUT_ROW' end,
        case when coalesce(a.has_dup, false) then 'DUPLICATE_CONSECUTIVE' end,
        case when coalesce(a.has_tie, false) then 'TIMESTAMP_TIE' end,
        case when a.order_id is not null and (a.first_at < o.created_at - interval '1 second'
                                              or a.last_at > o.updated_at + interval '1 second')
             then 'TIMESTAMP_RANGE' end,
        case when coalesce(a.delivered_entries, 0) > 1 then 'REENTERED_DELIVERED' end,
        case when coalesce(a.has_unknown, false)
                  or o.status not in ('pending','confirmed','processing','shipped','delivered','cancelled','sold')
             then 'UNKNOWN_STATUS' end,
        case when not public.inventory_lines_valid(o.lines) then 'LINES_UNPARSEABLE' end
      ], null) as issue_list
      from public.orders o
      left join agg a on a.order_id = o.id
  )
  select i.id, i.ref, i.status, i.source, i.created_at,
         case when array_length(i.issue_list, 1) is not null then 'ambiguous'
              when i.status in ('pending', 'confirmed', 'processing', 'shipped') then 'in_flight'
              else 'clean_settled' end,
         i.issue_list,
         public.inventory_lines_hash(i.lines)
    from issues i
$$;

-- Read-only report for the opening-balance reconciliation: one row per ORDER AND
-- PRODUCT, so every product and quantity affected by an order is visible next to
-- the decision that covers it. Run it from the SQL editor (or export it); there
-- is no activation switch behind it.
create or replace function public.inventory_preflight_report()
returns table (
  order_id uuid,
  ref text,
  status text,
  source text,
  order_created_at timestamptz,
  classification text,
  issues text[],
  lines_hash text,
  needs_decision boolean,
  decision text,
  decision_matches_lines boolean,
  decision_status_changed boolean,
  product_id text,
  product_name text,
  qty integer,
  product_in_catalog boolean,
  stock_initialized boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.inventory_require_admin();
  return query
  select a.audit_order_id, a.audit_ref, a.audit_status, a.audit_source, a.audit_created_at,
         a.audit_classification, a.audit_issues, a.audit_lines_hash,
         a.audit_classification in ('ambiguous', 'in_flight'),
         d.decision,
         case when d.id is null then null else d.lines_hash = a.audit_lines_hash end,
         case when d.id is null then null else d.status_at_decision <> a.audit_status end,
         l.product_id, l.product_name, l.qty,
         exists (select 1 from public.catalog_docs c where c.kind = 'product' and c.id = l.product_id),
         exists (select 1 from public.stock_levels s where s.product_id = l.product_id)
    from public.inventory_order_audit() a
    join public.orders o on o.id = a.audit_order_id
    left join public.inventory_order_decisions d on d.order_id = a.audit_order_id and d.superseded_by is null
    left join lateral public.inventory_order_lines(o.lines) l on true
   order by a.audit_created_at, a.audit_order_id, l.product_id;
end;
$$;

-- Records an explicit, order-level reconciliation decision. The caller passes the
-- lines_hash of the product/quantity set it was shown; if the order's lines are
-- different now, the decision is refused. Append-only: a new decision supersedes
-- the previous one.
create or replace function public.inventory_decide_order(
  p_order_id uuid,
  p_decision text,
  p_reason text,
  p_lines_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_hash text;
  v_current public.inventory_order_decisions%rowtype;
  v_new uuid := gen_random_uuid();
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason, 5);
  if p_decision is null or p_decision not in ('deduct_on_delivery', 'already_accounted') then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'decision must be deduct_on_delivery or already_accounted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory_decision:' || p_order_id::text, 0));

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'unknown order';
  end if;
  v_hash := public.inventory_lines_hash(v_order.lines);
  if p_lines_hash is distinct from v_hash then
    raise exception 'inventory_invalid' using errcode = '22023',
      detail = 'lines_changed: the order lines are not the ones the decision was based on';
  end if;
  if exists (select 1 from public.stock_movements
              where order_id = p_order_id and kind in ('sale', 'sale_accounted')) then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'the order was already processed by inventory';
  end if;
  if v_order.status = 'delivered' and p_decision <> 'already_accounted' then
    raise exception 'inventory_invalid' using errcode = '22023',
      detail = 'an already delivered order can only be recorded as already_accounted';
  end if;

  select * into v_current from public.inventory_order_decisions
   where order_id = p_order_id and superseded_by is null;
  if found and v_current.decision = p_decision and v_current.lines_hash = v_hash then
    return jsonb_build_object('status', 'unchanged', 'decision_id', v_current.id, 'decision', p_decision);
  end if;
  -- Once the order integration (0010) is installed every order that predates it already
  -- has a decision row; a NEW order has none and must not get one, or an admin could
  -- switch its stock deduction off by recording "already_accounted".
  if not found and to_regprocedure('public.inventory_apply_order(public.orders, text)') is not null then
    raise exception 'inventory_invalid' using errcode = '22023',
      detail = 'only orders that predate the inventory integration can be reconciled';
  end if;

  if found then
    update public.inventory_order_decisions set superseded_by = v_new where id = v_current.id;
  end if;
  insert into public.inventory_order_decisions (
    id, order_id, decision, reason, lines_hash, status_at_decision, decided_by, decided_by_email
  ) values (
    v_new, p_order_id, p_decision, btrim(p_reason), v_hash, v_order.status, auth.uid(), public.inventory_actor_email()
  );
  return jsonb_build_object('status', 'recorded', 'decision_id', v_new, 'decision', p_decision);
end;
$$;

-- ============================================================================
-- 7. Reconciliation
-- ============================================================================
-- Returns one row per problem; an empty result for a category means that category
-- is clean. Severity: error | warning | info. Category:
--   integrity  ledger vs balances vs orders (never acceptable)
--   decision   reconciliation decisions that are stale or inconsistent
--   coverage   products that still have no explicit opening balance
-- A reconciliation is CLEAN when there are NO 'error' rows in ANY category.
-- (The checks that every delivered/sold order was deducted exist only once the
-- deduction triggers do; 0010 redefines inventory_reconcile_rows() with them.
-- Re-running 0009 afterwards would restore this base version: re-run 0010 straight
-- after if that ever happens.)
--
-- inventory_reconcile_rows() is INTERNAL (no is_admin() check): migration guards run
-- from the SQL editor, where auth.uid() is null. inventory_reconcile() below is the
-- admin-checked entry point.
create or replace function public.inventory_reconcile_rows()
returns table (
  code text,
  severity text,
  category text,
  product_id text,
  order_id uuid,
  expected text,
  actual text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Balance equals the sum of the ledger deltas.
  return query
  select 'BALANCE_MISMATCH', 'error', 'integrity', s.product_id, null::uuid,
         coalesce(m.total, 0)::text, s.on_hand::text, 'on_hand differs from the sum of ledger deltas'
    from public.stock_levels s
    left join (select mv.product_id, sum(mv.qty_delta) as total from public.stock_movements mv group by mv.product_id) m
      on m.product_id = s.product_id
   where s.on_hand <> coalesce(m.total, 0);

  -- The latest movement ends at the current balance.
  return query
  select 'LAST_AFTER_MISMATCH', 'error', 'integrity', s.product_id, null::uuid,
         l.qty_after::text, s.on_hand::text, 'the latest ledger row does not end at on_hand'
    from public.stock_levels s
    join (select distinct on (mv.product_id) mv.product_id, mv.qty_after
            from public.stock_movements mv order by mv.product_id, mv.seq desc) l
      on l.product_id = s.product_id
   where l.qty_after <> s.on_hand;

  -- Chain continuity, first row, single opening, arithmetic.
  return query
  with chain as (
    select mv.id, mv.product_id, mv.kind, mv.seq, mv.qty_before, mv.qty_after, mv.qty_delta,
           lag(mv.qty_after) over (partition by mv.product_id order by mv.seq) as prev_after,
           row_number() over (partition by mv.product_id order by mv.seq) as rn
      from public.stock_movements mv
  )
  select 'CHAIN_BREAK', 'error', 'integrity', c.product_id, null::uuid,
         c.prev_after::text, c.qty_before::text, 'qty_before is not the previous qty_after (seq ' || c.seq || ')'
    from chain c where c.prev_after is not null and c.qty_before <> c.prev_after
  union all
  select 'FIRST_NOT_OPENING', 'error', 'integrity', c.product_id, null::uuid,
         'opening with before 0', c.kind || ' before ' || c.qty_before, 'the first ledger row must be the opening'
    from chain c where c.rn = 1 and (c.kind <> 'opening' or c.qty_before <> 0)
  union all
  select 'MULTIPLE_OPENING', 'error', 'integrity', c.product_id, null::uuid,
         '1', '2+', 'more than one opening row (seq ' || c.seq || ')'
    from chain c where c.rn > 1 and c.kind = 'opening'
  union all
  select 'ARITHMETIC', 'error', 'integrity', c.product_id, null::uuid,
         (c.qty_before + c.qty_delta)::text, c.qty_after::text, 'qty_after <> qty_before + qty_delta (seq ' || c.seq || ')'
    from chain c where c.qty_after <> c.qty_before + c.qty_delta;

  -- Ledger rows without a balance row, and balances without an opening.
  return query
  select 'ORPHAN_MOVEMENT', 'error', 'integrity', mv.product_id, null::uuid,
         'a stock_levels row', 'none', 'movements exist for a product without a balance row'
    from (select distinct m2.product_id from public.stock_movements m2) mv
   where not exists (select 1 from public.stock_levels s where s.product_id = mv.product_id);
  return query
  select 'BALANCE_WITHOUT_OPENING', 'error', 'integrity', s.product_id, null::uuid,
         'an opening movement', 'none', 'balance row has no opening movement'
    from public.stock_levels s
   where not exists (select 1 from public.stock_movements mv where mv.product_id = s.product_id and mv.kind = 'opening');

  -- Movements that point at a missing order.
  return query
  select 'MOVEMENT_ORDER_MISSING', 'error', 'integrity', mv.product_id, mv.order_id,
         'an existing order', 'none', 'movement references an order that does not exist'
    from public.stock_movements mv
   where mv.order_id is not null and not exists (select 1 from public.orders o where o.id = mv.order_id);

  -- Sales: at most one per order+product, and equal to the order's quantity.
  return query
  with sales as (
    select mv.order_id, mv.product_id, count(*) as n, sum(mv.quantity) as qty
      from public.stock_movements mv where mv.kind = 'sale' group by mv.order_id, mv.product_id
  )
  select 'DUPLICATE_SALE', 'error', 'integrity', s.product_id, s.order_id, '1', s.n::text,
         'more than one sale movement for the same order and product'
    from sales s where s.n > 1
  union all
  select 'SALE_QTY_MISMATCH', 'error', 'integrity', s.product_id, s.order_id,
         coalesce((select sum(l.qty) from public.inventory_order_lines(o.lines) l where l.product_id = s.product_id), 0)::text,
         s.qty::text, 'deducted quantity differs from the order lines'
    from sales s join public.orders o on o.id = s.order_id
   where s.qty is distinct from coalesce(
           (select sum(l.qty) from public.inventory_order_lines(o.lines) l where l.product_id = s.product_id), 0)
  union all
  select 'DEDUCTED_NOT_DELIVERED', 'info', 'integrity', s.product_id, s.order_id,
         'delivered or sold', o.status, 'stock was deducted and the order has since left that status (by design not reversed)'
    from sales s join public.orders o on o.id = s.order_id
   where o.status not in ('delivered', 'sold');

  -- Returns linked to an order may not exceed what the order sold.
  return query
  with ret as (
    select mv.order_id, mv.product_id, sum(mv.quantity) as qty
      from public.stock_movements mv
     where mv.kind in ('return_restock', 'return_damaged') and mv.order_id is not null
     group by mv.order_id, mv.product_id
  )
  select 'RETURN_EXCEEDS_SOLD', 'error', 'integrity', r.product_id, r.order_id,
         coalesce((select sum(l.qty) from public.inventory_order_lines(o.lines) l where l.product_id = r.product_id), 0)::text,
         r.qty::text, 'returned quantity exceeds the order quantity (or the product is not in the order)'
    from ret r join public.orders o on o.id = r.order_id
   where r.qty > coalesce((select sum(l.qty) from public.inventory_order_lines(o.lines) l where l.product_id = r.product_id), 0);

  -- Override grants: consumed exactly once and matching their movement.
  return query
  select 'GRANT_UNCONSUMED', 'error', 'integrity', g.product_id, g.order_id,
         'consumed', 'unconsumed', 'an override grant was never consumed'
    from public.stock_override_grants g where g.consumed_at is null
  union all
  select 'GRANT_WITHOUT_MOVEMENT', 'error', 'integrity', g.product_id, g.order_id,
         'one movement', 'none', 'a consumed override grant has no movement'
    from public.stock_override_grants g
   where g.consumed_at is not null
     and not exists (select 1 from public.stock_movements mv where mv.override_grant_id = g.id)
  union all
  select 'GRANT_MISMATCH', 'error', 'integrity', mv.product_id, mv.order_id,
         g.product_id || '/' || g.order_id::text || '/' || g.shortfall, mv.product_id || '/' || mv.order_id::text || '/' || mv.shortfall,
         'movement and override grant disagree'
    from public.stock_movements mv
    join public.stock_override_grants g on g.id = mv.override_grant_id
   where g.product_id <> mv.product_id or g.order_id is distinct from mv.order_id or g.shortfall <> mv.shortfall;

  -- Decisions: stale lines are an error, a changed status is a warning.
  return query
  select 'DECISION_STALE_LINES', 'error', 'decision', null::text, d.order_id,
         d.lines_hash, public.inventory_lines_hash(o.lines), 'the order lines changed after the decision'
    from public.inventory_order_decisions d join public.orders o on o.id = d.order_id
   where d.superseded_by is null and d.lines_hash <> public.inventory_lines_hash(o.lines)
  union all
  select 'DECISION_STATUS_CHANGED', 'warning', 'decision', null::text, d.order_id,
         d.status_at_decision, o.status, 'the order status changed after the decision — review it'
    from public.inventory_order_decisions d join public.orders o on o.id = d.order_id
   where d.superseded_by is null and d.status_at_decision <> o.status and d.decision <> 'settled_legacy';

  -- Coverage: every current catalog product has an explicit balance (zero counts),
  -- and so does every product of an order still in flight or ambiguous — including
  -- products that have since been deleted from the catalog.
  return query
  select 'PRODUCT_UNINITIALIZED', 'error', 'coverage', d.id, null::uuid,
         'an explicit opening balance', 'none', 'catalog product without an initialized stock balance'
    from public.catalog_docs d
   where d.kind = 'product'
     and not exists (select 1 from public.stock_levels s where s.product_id = d.id);
  return query
  select 'ORDER_PRODUCT_UNINITIALIZED', 'error', 'coverage', l.product_id, a.audit_order_id,
         'an explicit opening balance', 'none',
         case when exists (select 1 from public.catalog_docs c where c.kind = 'product' and c.id = l.product_id)
              then 'product of an unsettled order has no balance'
              else 'removed product of an unsettled order has no balance (use inventory_init_removed_product)' end
    from public.inventory_order_audit() a
    join public.orders o on o.id = a.audit_order_id
    cross join lateral public.inventory_order_lines(o.lines) l
   where a.audit_classification in ('in_flight', 'ambiguous')
     and not exists (select 1 from public.stock_levels s where s.product_id = l.product_id);

  -- Balances of products no longer in the catalog.
  return query
  select case when exists (
           select 1 from public.orders o, lateral public.inventory_order_lines(o.lines) l where l.product_id = s.product_id)
         then 'REMOVED_PRODUCT_BALANCE' else 'ORPHAN_REMOVED_BALANCE' end,
         case when exists (
           select 1 from public.orders o, lateral public.inventory_order_lines(o.lines) l where l.product_id = s.product_id)
         then 'info' else 'warning' end,
         'integrity', s.product_id, null::uuid,
         'a catalog product', 'removed', 'balance of a product that no longer exists in the catalog'
    from public.stock_levels s
   where not exists (select 1 from public.catalog_docs c where c.kind = 'product' and c.id = s.product_id);
end;
$$;

create or replace function public.inventory_reconcile()
returns table (
  code text,
  severity text,
  category text,
  product_id text,
  order_id uuid,
  expected text,
  actual text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.inventory_require_admin();
  return query select * from public.inventory_reconcile_rows();
end;
$$;

-- ============================================================================
-- 7b. Activation blockers — everything that must be resolved BEFORE 0010 can be
--     applied. 0010 refuses to run while this returns any row (fail closed).
-- ============================================================================
-- Before 0010: every order is "legacy", so every order that is still in flight (or
-- whose history is ambiguous) needs an explicit, current decision that still matches
-- its lines and status. Nothing is guessed: a missing decision, a missing opening
-- balance or a stale decision is a blocker. After 0010 is installed, decisions no
-- longer apply to new orders, so only the reconciliation errors remain.
create or replace function public.inventory_blockers_rows()
returns table (
  code text,
  category text,
  order_id uuid,
  product_id text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- every ERROR of the reconciliation: integrity, decision and coverage
  -- (catalog products and products of unsettled orders without an opening balance)
  return query
  select 'RECONCILE_' || r.code, r.category, r.order_id, r.product_id,
         coalesce(r.detail, '')
           || case when r.expected is not null then ' (expected ' || r.expected || ', actual ' || coalesce(r.actual, '') || ')' else '' end
    from public.inventory_reconcile_rows() r
   where r.severity = 'error';

  if to_regprocedure('public.inventory_apply_order(public.orders, text)') is not null then
    return; -- integration installed: legacy decisions are history, not blockers
  end if;

  -- an order in flight or ambiguous must carry an explicit decision
  return query
  select 'DECISION_MISSING', 'decision', a.audit_order_id, null::text,
         'order ' || a.audit_ref || ' (' || a.audit_status || ', ' || a.audit_classification
           || coalesce(', ' || array_to_string(a.audit_issues, '/'), '') || ') has no explicit decision'
    from public.inventory_order_audit() a
   where a.audit_classification in ('in_flight', 'ambiguous')
     and not exists (
       select 1 from public.inventory_order_decisions d
        where d.order_id = a.audit_order_id and d.superseded_by is null and d.decision <> 'settled_legacy');

  -- a decision made for a different status is no longer trustworthy
  return query
  select 'DECISION_STATUS_CHANGED', 'decision', d.order_id, null::text,
         'order ' || o.ref || ': the status was ' || d.status_at_decision || ' when the decision was recorded, now '
           || o.status || ' — review it and record the decision again'
    from public.inventory_order_decisions d
    join public.orders o on o.id = d.order_id
   where d.superseded_by is null and d.decision <> 'settled_legacy' and d.status_at_decision <> o.status;

  -- "deduct at delivery" cannot be honoured when the lines cannot be read
  return query
  select 'DEDUCT_DECISION_INVALID_LINES', 'decision', d.order_id, null::text,
         'order ' || o.ref || ' is decided as deduct_on_delivery but its lines are not valid product/quantity lines'
    from public.inventory_order_decisions d
    join public.orders o on o.id = d.order_id
   where d.superseded_by is null and d.decision = 'deduct_on_delivery' and not public.inventory_lines_valid(o.lines);

  -- more than one current decision for the same order (the unique index should prevent it)
  return query
  select 'DUPLICATE_CURRENT_DECISION', 'decision', d.order_id, null::text,
         count(*) || ' current decisions for one order'
    from public.inventory_order_decisions d
   where d.superseded_by is null
   group by d.order_id
  having count(*) > 1;
end;
$$;

create or replace function public.inventory_activation_blockers()
returns table (
  code text,
  category text,
  order_id uuid,
  product_id text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.inventory_require_admin();
  return query select * from public.inventory_blockers_rows();
end;
$$;

-- Counts per category and severity, and the single answer to "is it clean?".
create or replace function public.inventory_reconcile_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.inventory_require_admin();
  select jsonb_build_object(
    'integrity_errors', count(*) filter (where category = 'integrity' and severity = 'error'),
    'decision_errors', count(*) filter (where category = 'decision' and severity = 'error'),
    'coverage_errors', count(*) filter (where category = 'coverage' and severity = 'error'),
    'warnings', count(*) filter (where severity = 'warning'),
    'info', count(*) filter (where severity = 'info'),
    'clean', count(*) filter (where severity = 'error') = 0
  ) into v from public.inventory_reconcile();
  return v;
end;
$$;

-- ============================================================================
-- 8. Function privileges: authenticated may call the admin operations (each
--    checks is_admin() itself); everything else is internal.
-- ============================================================================

revoke execute on function public.inventory_ledger_guard() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_grant_guard() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_decision_guard() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_require_admin() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_actor_email() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_check_reason(text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_check_key(text) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_raise_key_reuse(text[]) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_order_lines(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_lines_valid(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_lines_hash(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_write_movement(text, text, integer, integer, integer, text, text, uuid, text, uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_init_product(text, integer, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_catalog_identity(text) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_movement_result(uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_order_audit() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_reconcile_rows() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_blockers_rows() from public, anon, authenticated, service_role;

revoke execute on function public.inventory_set_opening(text, integer, text) from public, anon, service_role;
revoke execute on function public.inventory_import_opening(jsonb, boolean) from public, anon, service_role;
revoke execute on function public.inventory_adjust(text, integer, text, text) from public, anon, service_role;
revoke execute on function public.inventory_receive(text, integer, text, text, text) from public, anon, service_role;
revoke execute on function public.inventory_record_return(text, integer, boolean, text, uuid, text) from public, anon, service_role;
revoke execute on function public.inventory_set_threshold(text, integer) from public, anon, service_role;
revoke execute on function public.inventory_init_removed_product(text, text) from public, anon, service_role;
revoke execute on function public.inventory_decide_order(uuid, text, text, text) from public, anon, service_role;
revoke execute on function public.inventory_preflight_report() from public, anon, service_role;
revoke execute on function public.inventory_reconcile() from public, anon, service_role;
revoke execute on function public.inventory_activation_blockers() from public, anon, service_role;
revoke execute on function public.inventory_reconcile_summary() from public, anon, service_role;

grant execute on function public.inventory_set_opening(text, integer, text) to authenticated;
grant execute on function public.inventory_import_opening(jsonb, boolean) to authenticated;
grant execute on function public.inventory_adjust(text, integer, text, text) to authenticated;
grant execute on function public.inventory_receive(text, integer, text, text, text) to authenticated;
grant execute on function public.inventory_record_return(text, integer, boolean, text, uuid, text) to authenticated;
grant execute on function public.inventory_set_threshold(text, integer) to authenticated;
grant execute on function public.inventory_init_removed_product(text, text) to authenticated;
grant execute on function public.inventory_decide_order(uuid, text, text, text) to authenticated;
grant execute on function public.inventory_preflight_report() to authenticated;
grant execute on function public.inventory_reconcile() to authenticated;
grant execute on function public.inventory_activation_blockers() to authenticated;
grant execute on function public.inventory_reconcile_summary() to authenticated;

-- ============================================================================
-- Rollback (NOT executed automatically). Purely additive and nothing depends on
-- it until 0010 is applied — do NOT run this after 0010. EXPORT stock_movements
-- first: dropping the tables destroys the ledger.
-- ============================================================================
--   drop function if exists public.inventory_reconcile_summary();
--   drop function if exists public.inventory_activation_blockers();
--   drop function if exists public.inventory_blockers_rows();
--   drop function if exists public.inventory_reconcile();
--   drop function if exists public.inventory_reconcile_rows();
--   drop function if exists public.inventory_decide_order(uuid, text, text, text);
--   drop function if exists public.inventory_preflight_report();
--   drop function if exists public.inventory_order_audit();
--   drop function if exists public.inventory_init_removed_product(text, text);
--   drop function if exists public.inventory_set_threshold(text, integer);
--   drop function if exists public.inventory_record_return(text, integer, boolean, text, uuid, text);
--   drop function if exists public.inventory_receive(text, integer, text, text, text);
--   drop function if exists public.inventory_adjust(text, integer, text, text);
--   drop function if exists public.inventory_import_opening(jsonb, boolean);
--   drop function if exists public.inventory_set_opening(text, integer, text);
--   drop function if exists public.inventory_movement_result(uuid, boolean);
--   drop function if exists public.inventory_catalog_identity(text);
--   drop function if exists public.inventory_init_product(text, integer, text, text, text);
--   drop function if exists public.inventory_write_movement(text, text, integer, integer, integer, text, text, uuid, text, uuid, integer);
--   drop function if exists public.inventory_lines_hash(jsonb);
--   drop function if exists public.inventory_lines_valid(jsonb);
--   drop function if exists public.inventory_order_lines(jsonb);
--   drop function if exists public.inventory_raise_key_reuse(text[]);
--   drop function if exists public.inventory_check_key(text);
--   drop function if exists public.inventory_check_reason(text, integer);
--   drop function if exists public.inventory_actor_email();
--   drop function if exists public.inventory_require_admin();
--   drop table if exists public.inventory_order_decisions;
--   drop table if exists public.stock_movements;
--   drop table if exists public.stock_override_grants;
--   drop table if exists public.stock_levels;
--   drop function if exists public.inventory_decision_guard();
--   drop function if exists public.inventory_grant_guard();
--   drop function if exists public.inventory_ledger_guard();
