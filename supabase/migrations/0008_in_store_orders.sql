-- Taybah — in-store (walk-in) orders recorded manually by staff.
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders), 0003 (is_admin()), 0005 (email outbox) and 0006
-- (catalog_docs). Re-runnable. A pre-flight check below aborts, changing
-- nothing, if any of those is missing.
--
-- !!! WARNING — NEVER RE-RUN 0005_order_email_outbox.sql AFTER THIS FILE !!!
-- Section 5 below REPLACES public.enqueue_order_email() with a version that
-- never e-mails customers for in-store sales. 0005 defines the same function
-- WITHOUT that rule, so re-applying 0005 later silently restores the old
-- function and in-store orders that carry an e-mail address would start
-- queueing customer e-mails again. If 0005 ever has to be re-applied, run this
-- file again straight afterwards (it is re-runnable).
--
-- What it adds
--   • orders.source  'online' | 'in_store'  — persisted, never inferred.
--     Every existing row becomes 'online' via the column default.
--   • orders.note    optional free text.
--   • status 'sold' («تم البيع») — only valid for in-store orders; in-store
--     orders may only be 'sold' or 'cancelled', so they can never enter the
--     shipping statuses (shipped / processing / ...) by any route.
--   • A staff-only INSERT path (RLS policy + validation trigger). The browser
--     inserts directly; the DATABASE, not the UI, enforces who may do it and
--     that the stored prices/totals are the current retail prices.
--
-- Security model for direct inserts (why this does not open anything up)
--   1. Guests / non-admin users: the only INSERT policy that applies to them
--      is "public can insert pending orders", now narrowed to
--      source = 'online' AND status = 'pending'. They cannot create an
--      in-store order or a 'sold' order.
--   2. Admins: a second policy allows INSERT only when is_admin() AND
--      source = 'in_store' AND status = 'sold'. Anything else an admin tries
--      to insert falls through to policy 1's limits.
--   3. A BEFORE INSERT trigger re-checks admin-ness (defence in depth) and
--      validates the order against the live catalog: every line must be an
--      existing product (and variant) at its CURRENT retail price, quantities
--      must be positive integers, subtotal/total must equal the sum of the
--      lines, no line may carry a wholesale key, delivery must be 'in_store'.
--      A forged price or total is rejected by the database.
--   4. Wholesale prices live in product_internal_pricing (0007). Nothing here
--      reads or writes that table.
--   5. A BEFORE UPDATE trigger makes `source` immutable and freezes an
--      in-store order's lines/totals/contact, so an existing order cannot be
--      re-labelled or re-priced after the fact (status and note stay editable).

-- ============================================================================
-- 0. Pre-flight: refuse to run unless everything this file depends on exists
-- ============================================================================
-- First statement of the script, so an abort happens before ANY change (the
-- SQL editor also runs the whole script as one transaction).

do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.orders') is null then
    v_missing := array_append(v_missing, 'public.orders (migration 0001)');
  end if;
  if to_regprocedure('public.is_admin()') is null then
    v_missing := array_append(v_missing, 'public.is_admin() (migration 0003)');
  end if;
  if to_regclass('public.order_email_outbox') is null
     or to_regprocedure('public.kick_order_email_worker()') is null then
    v_missing := array_append(v_missing, 'public.order_email_outbox / kick_order_email_worker() (migration 0005)');
  end if;
  if to_regclass('public.catalog_docs') is null then
    v_missing := array_append(v_missing, 'public.catalog_docs (migration 0006)');
  end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'ABORT: migration 0008 needs % — apply the missing migration(s) first (see docs/PRODUCTION_RUNBOOK.md). Nothing was changed.',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- ============================================================================
-- 1. Columns and constraints
-- ============================================================================

alter table public.orders
  add column if not exists source text not null default 'online',
  add column if not exists note text;

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders
  add constraint orders_source_check check (source in ('online', 'in_store'));

alter table public.orders drop constraint if exists orders_note_check;
alter table public.orders
  add constraint orders_note_check check (note is null or char_length(note) <= 1000);

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'sold'));

-- 'sold' is an in-store status; in-store orders have no shipping lifecycle.
alter table public.orders drop constraint if exists orders_source_status_check;
alter table public.orders
  add constraint orders_source_status_check check (
    (source = 'online' and status <> 'sold')
    or (source = 'in_store' and status in ('sold', 'cancelled'))
  );

-- ============================================================================
-- 2. RLS — guests stay online/pending only; admins may add in-store sales
-- ============================================================================

drop policy if exists "public can insert pending orders" on public.orders;
create policy "public can insert pending orders" on public.orders
  for insert to anon, authenticated
  with check (status = 'pending' and source = 'online');

drop policy if exists "admins can insert in-store orders" on public.orders;
create policy "admins can insert in-store orders" on public.orders
  for insert to authenticated
  with check (public.is_admin() and source = 'in_store' and status = 'sold');

-- ============================================================================
-- 3. Validation of an in-store INSERT (runs before the row is stored)
-- ============================================================================
-- Deliberately NOT security definer: it reads catalog_docs with the caller's
-- rights (admins can read every document) and checks is_admin() as the caller.

create or replace function public.validate_in_store_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line jsonb;
  v_doc jsonb;
  v_variant jsonb;
  v_qty numeric;
  v_price numeric;
  v_expected numeric;
  v_sum numeric := 0;
begin
  if new.source <> 'in_store' then
    return new;
  end if;

  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new.delivery is null or new.delivery ->> 'method' is distinct from 'in_store' then
    raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'delivery must be in_store';
  end if;

  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) not between 1 and 100 then
    raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'lines must hold 1-100 items';
  end if;

  -- Wholesale pricing must never appear in an order, under any key.
  if new.lines::text ~* 'wholesale' or new.contact::text ~* 'wholesale' then
    raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'wholesale data not allowed';
  end if;

  for v_line in select * from jsonb_array_elements(new.lines) loop
    if jsonb_typeof(v_line) <> 'object'
       or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
       or jsonb_typeof(v_line -> 'price') is distinct from 'number' then
      raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'malformed line';
    end if;

    v_qty := (v_line ->> 'qty')::numeric;
    v_price := (v_line ->> 'price')::numeric;
    if v_qty < 1 or v_qty > 999 or v_qty <> trunc(v_qty) then
      raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'bad quantity';
    end if;

    select data into v_doc from public.catalog_docs
     where kind = 'product' and id = v_line ->> 'productId';
    if v_doc is null then
      raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'unknown product';
    end if;

    v_expected := (v_doc ->> 'price')::numeric;
    if nullif(v_line ->> 'variantId', '') is not null then
      select v into v_variant
        from jsonb_array_elements(coalesce(v_doc -> 'variants', '[]'::jsonb)) v
       where v ->> 'id' = v_line ->> 'variantId';
      if v_variant is null then
        raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'unknown variant';
      end if;
      -- price null on a variant = inherits the product price
      if jsonb_typeof(v_variant -> 'price') = 'number' then
        v_expected := (v_variant ->> 'price')::numeric;
      end if;
    end if;

    if v_expected is null or v_price <> v_expected then
      raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'price_mismatch';
    end if;
    v_sum := v_sum + v_price * v_qty;
  end loop;

  if new.subtotal <> v_sum or new.total <> v_sum then
    raise exception 'invalid_in_store_order' using errcode = '22023', detail = 'total_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_validate_in_store on public.orders;
create trigger orders_validate_in_store
  before insert on public.orders
  for each row execute function public.validate_in_store_order();

-- ============================================================================
-- 4. Immutability on UPDATE
-- ============================================================================

create or replace function public.guard_order_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source is distinct from old.source then
    raise exception 'order source is immutable' using errcode = '22023';
  end if;
  if old.source = 'in_store' and (
       new.lines is distinct from old.lines
    or new.subtotal is distinct from old.subtotal
    or new.total is distinct from old.total
    or new.contact is distinct from old.contact
  ) then
    raise exception 'in-store order items and totals are immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_update on public.orders;
create trigger orders_guard_update
  before update on public.orders
  for each row execute function public.guard_order_update();

-- ============================================================================
-- 5. No customer e-mail (shipping/confirmation workflow) for in-store sales
-- ============================================================================
-- Same function as 0005 plus one rule: an in-store order is always recorded
-- as 'skipped' in the outbox, whatever contact data exists — so the worker
-- never mails the customer and the admin log explains why.

create or replace function public.enqueue_order_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_source text;
  v_kind text;
  v_skip text;
begin
  select nullif(btrim(contact ->> 'email'), ''), source into v_email, v_source
    from public.orders where id = new.order_id;

  v_kind := case
    when exists (
      select 1 from public.order_status_history h
      where h.order_id = new.order_id and h.id <> new.id
    ) then 'status_update'
    else 'confirmation'
  end;

  v_skip := case
    when v_source = 'in_store' then 'in_store_order'
    when v_email is null or v_email !~ '^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$' then 'no_customer_email'
  end;

  insert into public.order_email_outbox (order_id, history_id, kind, status, state, last_error)
  values (
    new.order_id, new.id, v_kind, new.status,
    case when v_skip is null then 'pending' else 'skipped' end,
    v_skip
  )
  on conflict (history_id) do nothing;

  perform public.kick_order_email_worker();
  return new;
end;
$$;

revoke execute on function public.enqueue_order_email() from public, anon, authenticated;

-- ============================================================================
-- Rollback (NOT executed automatically). Delete in-store orders first.
-- ============================================================================
--   drop trigger if exists orders_guard_update on public.orders;
--   drop trigger if exists orders_validate_in_store on public.orders;
--   drop function if exists public.guard_order_update();
--   drop function if exists public.validate_in_store_order();
--   drop policy if exists "admins can insert in-store orders" on public.orders;
--   drop policy if exists "public can insert pending orders" on public.orders;
--   create policy "public can insert pending orders" on public.orders
--     for insert to anon, authenticated with check (status = 'pending');
--   alter table public.orders drop constraint orders_source_status_check;
--   alter table public.orders drop constraint orders_status_check;
--   alter table public.orders add constraint orders_status_check check
--     (status in ('pending','confirmed','processing','shipped','delivered','cancelled'));
--   alter table public.orders drop column source, drop column note;
--   -- and re-run the enqueue_order_email() definition from 0005.
