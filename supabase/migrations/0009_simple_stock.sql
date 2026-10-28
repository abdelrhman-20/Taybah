-- Taybah — simple stock counts with reservation.
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders), 0003 (is_admin()) and 0008 (orders.source). Re-runnable.
--
-- Model (deliberately small)
--   • public.stock holds one row per tracked unit: a simple product (variant_id = '')
--     or one variant of a variant product. A unit with NO row is untracked and
--     behaves exactly as before (manual availability, never blocked).
--   • qty      = physical pieces on the shelf. It changes only when
--       - an admin sets it (stock_set),
--       - an online order becomes 'delivered'      (qty goes down),
--       - an in-store sale is recorded as 'sold'    (qty goes down).
--     Leaving 'delivered' / 'sold' (e.g. cancelling) puts the pieces back.
--   • reserved = pieces in online orders that are placed but not delivered yet
--     (pending / confirmed / processing / shipped). COMPUTED from orders, never
--     stored, so it cannot drift.
--   • available = qty - reserved. The storefront sees only a state derived from it
--     (in_stock / low_stock / out_of_stock), never the numbers.
--   • Placing an online order fails (IS002) when a tracked unit has fewer
--     available pieces than the order needs. The stock row is locked while the
--     check runs, so two customers cannot both take the last piece.
--   • In-store sales are never blocked (the piece is already in the customer's
--     hand); qty may go below zero, which the admin page shows as "review count".
--
-- No client has any direct privilege on public.stock: everything goes through the
-- functions below.

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'ABORT: migration 0009 needs public.orders (0001). Nothing was changed.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'ABORT: migration 0009 needs public.is_admin() (0003). Nothing was changed.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'source'
  ) then
    raise exception 'ABORT: migration 0009 needs orders.source (0008). Nothing was changed.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table if not exists public.stock (
  product_id text not null,
  variant_id text not null default '',
  qty integer not null default 0,
  low_threshold integer not null default 3 check (low_threshold >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, variant_id)
);

alter table public.stock enable row level security;
revoke all on table public.stock from anon, authenticated;

-- ============================================================================
-- 2. Reserved pieces (computed)
-- ============================================================================

create or replace function public.stock_reserved(p_product text, p_variant text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum((l ->> 'qty')::numeric), 0)::integer
    from public.orders o,
         jsonb_array_elements(
           case when jsonb_typeof(o.lines) = 'array' then o.lines else '[]'::jsonb end
         ) l
   where o.source = 'online'
     and o.status in ('pending', 'confirmed', 'processing', 'shipped')
     and l ->> 'productId' = p_product
     and coalesce(nullif(l ->> 'variantId', ''), '') = p_variant
$$;

revoke execute on function public.stock_reserved(text, text) from public, anon, authenticated;

-- ============================================================================
-- 3. Public: availability state of every tracked unit (no numbers)
-- ============================================================================

create or replace function public.stock_availability()
returns table (product_id text, variant_id text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select t.product_id, t.variant_id,
         case
           when t.avail <= 0 then 'out_of_stock'
           when t.avail <= t.low_threshold then 'low_stock'
           else 'in_stock'
         end
    from (
      select s.product_id, s.variant_id, s.low_threshold,
             s.qty - public.stock_reserved(s.product_id, s.variant_id) as avail
        from public.stock s
    ) t
$$;

revoke execute on function public.stock_availability() from public;
grant execute on function public.stock_availability() to anon, authenticated;

-- ============================================================================
-- 4. Admin: numbers, and the only write paths
-- ============================================================================

create or replace function public.stock_overview()
returns table (product_id text, variant_id text, qty integer, low_threshold integer, reserved integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.product_id, s.variant_id, s.qty, s.low_threshold,
           public.stock_reserved(s.product_id, s.variant_id)
      from public.stock s;
end;
$$;

revoke execute on function public.stock_overview() from public, anon;
grant execute on function public.stock_overview() to authenticated;

-- Start tracking a unit, or set its count / alert threshold.
create or replace function public.stock_set(p_product text, p_variant text, p_qty integer, p_threshold integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_product is null or p_product = ''
     or p_qty is null or p_qty < 0 or p_qty > 1000000
     or p_threshold is null or p_threshold < 0 or p_threshold > 1000000 then
    raise exception 'invalid_stock' using errcode = '22023', detail = 'bad product, quantity or threshold';
  end if;
  insert into public.stock (product_id, variant_id, qty, low_threshold)
  values (p_product, coalesce(p_variant, ''), p_qty, p_threshold)
  on conflict (product_id, variant_id)
  do update set qty = excluded.qty, low_threshold = excluded.low_threshold, updated_at = now();
end;
$$;

revoke execute on function public.stock_set(text, text, integer, integer) from public, anon;
grant execute on function public.stock_set(text, text, integer, integer) to authenticated;

-- Stop tracking a unit (it goes back to the manual availability field).
create or replace function public.stock_untrack(p_product text, p_variant text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.stock where product_id = p_product and variant_id = coalesce(p_variant, '');
end;
$$;

revoke execute on function public.stock_untrack(text, text) from public, anon;
grant execute on function public.stock_untrack(text, text) to authenticated;

-- ============================================================================
-- 5. Placing an online order: refuse when a tracked unit is short
-- ============================================================================

create or replace function public.orders_check_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_qty integer;
  v_short jsonb := '[]'::jsonb;
begin
  if new.source <> 'online' or jsonb_typeof(new.lines) <> 'array' then
    return new;
  end if;
  -- A retry of an order that already exists must reach the primary-key check
  -- (the client treats that as "already created"), not fail on its own reservation.
  if exists (select 1 from public.orders where id = new.id) then
    return new;
  end if;

  for r in
    select l ->> 'productId' as pid,
           coalesce(nullif(l ->> 'variantId', ''), '') as vid,
           sum((l ->> 'qty')::numeric)::integer as need
      from jsonb_array_elements(new.lines) l
     group by 1, 2
     order by 1, 2
  loop
    -- Lock the unit so a concurrent order waits, then sees this order's reservation.
    select s.qty into v_qty
      from public.stock s
     where s.product_id = r.pid and s.variant_id = r.vid
       for update;
    if not found then
      continue;
    end if;
    if v_qty - public.stock_reserved(r.pid, r.vid) < r.need then
      v_short := v_short || jsonb_build_array(
        jsonb_build_object('productId', r.pid, 'variantId', nullif(r.vid, '')));
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'insufficient_stock' using errcode = 'IS002', detail = v_short::text;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_check_stock on public.orders;
create trigger orders_check_stock
  before insert on public.orders
  for each row execute function public.orders_check_stock();

-- ============================================================================
-- 6. Delivered / sold moves the real count
-- ============================================================================

create or replace function public.orders_apply_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dir integer := 0;
begin
  if tg_op = 'INSERT' then
    if new.source = 'in_store' and new.status = 'sold' then
      v_dir := -1;
    end if;
  else
    if new.status is not distinct from old.status then
      return new;
    end if;
    if new.source = 'online' then
      if new.status = 'delivered' and old.status <> 'delivered' then
        v_dir := -1;
      elsif old.status = 'delivered' and new.status <> 'delivered' then
        v_dir := 1;
      end if;
    else
      if new.status = 'sold' and old.status <> 'sold' then
        v_dir := -1;
      elsif old.status = 'sold' and new.status <> 'sold' then
        v_dir := 1;
      end if;
    end if;
  end if;

  if v_dir = 0 or jsonb_typeof(new.lines) <> 'array' then
    return new;
  end if;

  update public.stock s
     set qty = s.qty + v_dir * t.n, updated_at = now()
    from (
      select l ->> 'productId' as pid,
             coalesce(nullif(l ->> 'variantId', ''), '') as vid,
             sum((l ->> 'qty')::numeric)::integer as n
        from jsonb_array_elements(new.lines) l
       group by 1, 2
    ) t
   where s.product_id = t.pid and s.variant_id = t.vid;
  return new;
end;
$$;

drop trigger if exists orders_apply_stock on public.orders;
create trigger orders_apply_stock
  after insert or update of status on public.orders
  for each row execute function public.orders_apply_stock();

-- ============================================================================
-- Rollback (NOT executed automatically). Destroys the stock counts.
-- ============================================================================
--   drop trigger if exists orders_apply_stock on public.orders;
--   drop trigger if exists orders_check_stock on public.orders;
--   drop function if exists public.orders_apply_stock();
--   drop function if exists public.orders_check_stock();
--   drop function if exists public.stock_untrack(text, text);
--   drop function if exists public.stock_set(text, text, integer, integer);
--   drop function if exists public.stock_overview();
--   drop function if exists public.stock_availability();
--   drop function if exists public.stock_reserved(text, text);
--   drop table if exists public.stock;
