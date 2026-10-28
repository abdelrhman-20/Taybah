-- Taybah — owner notifications: what the OTHER admin accounts changed.
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders), 0003 (is_admin()), 0006 (catalog_docs), 0007 (internal pricing),
-- 0008 (orders.source) and 0009 (stock). Re-runnable.
--
-- What it does
--   • public.activity_log: one row per change an admin other than the owner made —
--     stock counts, product price / wholesale price / visibility / create / delete,
--     order status changes and in-store sales.
--   • Rows are written ONLY by triggers / functions (nobody has INSERT privilege) and
--     are readable ONLY by the owner account (RLS: is_owner()). Every other admin gets
--     zero rows, even through the API — the notifications do not exist for them.
--   • The owner's own changes are not logged; neither are changes with no signed-in
--     user (SQL editor, migrations, customers placing orders).
--   • Realtime: the table is published so the owner's open pages get each new row at once
--     (Realtime applies the same RLS, so no one else receives it).
--
-- !!! The owner is identified by e-mail: 'nehro@info.com' appears in is_owner() and in
-- activity_log_event(). Change both together if the owner ever changes, and keep
-- src/features/admin/auth/profitAccess.ts in step.

do $$
begin
  if to_regclass('public.stock') is null then
    raise exception 'ABORT: migration 0011 needs public.stock (0009). Nothing was changed.';
  end if;
  if to_regclass('public.product_internal_pricing') is null then
    raise exception 'ABORT: migration 0011 needs public.product_internal_pricing (0007). Nothing was changed.';
  end if;
  if to_regclass('public.catalog_docs') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'ABORT: migration 0011 needs catalog_docs (0006) and is_admin() (0003). Nothing was changed.';
  end if;
end;
$$;

-- ============================================================================
-- 1. Who is the owner
-- ============================================================================

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'nehro@info.com' and public.is_admin()
$$;

grant execute on function public.is_owner() to authenticated;

-- ============================================================================
-- 2. The log
-- ============================================================================

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor text not null,
  kind text not null check (kind in (
    'stock_changed', 'stock_tracked', 'stock_untracked',
    'price_changed', 'wholesale_changed', 'visibility_changed',
    'product_created', 'product_deleted',
    'order_status', 'in_store_sale'
  )),
  subject text,
  detail jsonb not null default '{}'::jsonb,
  seen_at timestamptz
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;
revoke all on table public.activity_log from anon, authenticated;
grant select on table public.activity_log to authenticated;

drop policy if exists "owner reads activity" on public.activity_log;
create policy "owner reads activity" on public.activity_log
  for select to authenticated using (public.is_owner());

-- Writer used by the triggers below. Skips the owner's own actions and anonymous /
-- non-user contexts (no e-mail in the JWT).
create or replace function public.activity_log_event(p_kind text, p_subject text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_actor = '' or v_actor = 'nehro@info.com' then
    return;
  end if;
  insert into public.activity_log (actor, kind, subject, detail)
  values (v_actor, p_kind, p_subject, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke execute on function public.activity_log_event(text, text, jsonb) from public, anon, authenticated;

create or replace function public.activity_mark_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.activity_log set seen_at = now() where seen_at is null;
end;
$$;

revoke execute on function public.activity_mark_seen() from public, anon;
grant execute on function public.activity_mark_seen() to authenticated;

-- ============================================================================
-- 3. Stock: stock_set / stock_untrack now say what they changed
-- ============================================================================

create or replace function public.stock_set(p_product text, p_variant text, p_qty integer, p_threshold integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_variant text := coalesce(p_variant, '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_product is null or p_product = ''
     or p_qty is null or p_qty < 0 or p_qty > 1000000
     or p_threshold is null or p_threshold < 0 or p_threshold > 1000000 then
    raise exception 'invalid_stock' using errcode = '22023', detail = 'bad product, quantity or threshold';
  end if;

  select qty into v_old from public.stock where product_id = p_product and variant_id = v_variant;

  insert into public.stock (product_id, variant_id, qty, low_threshold)
  values (p_product, v_variant, p_qty, p_threshold)
  on conflict (product_id, variant_id)
  do update set qty = excluded.qty, low_threshold = excluded.low_threshold, updated_at = now();

  if v_old is null then
    perform public.activity_log_event('stock_tracked', p_product,
      jsonb_build_object('variant', v_variant, 'qty', p_qty));
  elsif v_old <> p_qty then
    perform public.activity_log_event('stock_changed', p_product,
      jsonb_build_object('variant', v_variant, 'from', v_old, 'to', p_qty));
  end if;
end;
$$;

revoke execute on function public.stock_set(text, text, integer, integer) from public, anon;
grant execute on function public.stock_set(text, text, integer, integer) to authenticated;

create or replace function public.stock_untrack(p_product text, p_variant text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant text := coalesce(p_variant, '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.stock where product_id = p_product and variant_id = v_variant;
  if found then
    perform public.activity_log_event('stock_untracked', p_product, jsonb_build_object('variant', v_variant));
  end if;
end;
$$;

revoke execute on function public.stock_untrack(text, text) from public, anon;
grant execute on function public.stock_untrack(text, text) to authenticated;

-- ============================================================================
-- 4. Products: price, visibility, create, delete
-- ============================================================================

create or replace function public.log_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'product' then
      perform public.activity_log_event('product_created', new.id,
        jsonb_build_object('name', new.data -> 'name' ->> 'ar', 'price', new.data -> 'price'));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.kind = 'product' then
      if (old.data -> 'price') is distinct from (new.data -> 'price') then
        perform public.activity_log_event('price_changed', new.id,
          jsonb_build_object('name', new.data -> 'name' ->> 'ar',
                             'from', old.data -> 'price', 'to', new.data -> 'price'));
      end if;
      if old.visible is distinct from new.visible then
        perform public.activity_log_event('visibility_changed', new.id,
          jsonb_build_object('name', new.data -> 'name' ->> 'ar', 'visible', new.visible));
      end if;
    end if;
    return new;
  end if;
  if old.kind = 'product' then
    perform public.activity_log_event('product_deleted', old.id,
      jsonb_build_object('name', old.data -> 'name' ->> 'ar'));
  end if;
  return old;
end;
$$;

drop trigger if exists catalog_docs_log_activity on public.catalog_docs;
create trigger catalog_docs_log_activity
  after insert or update or delete on public.catalog_docs
  for each row execute function public.log_product_change();

create or replace function public.log_wholesale_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid text := coalesce(new.product_id, old.product_id);
  v_name text;
begin
  if tg_op = 'UPDATE' and new.wholesale_price is not distinct from old.wholesale_price then
    return new;
  end if;
  select data -> 'name' ->> 'ar' into v_name
    from public.catalog_docs where kind = 'product' and id = v_pid;
  -- The product itself is gone (its delete cascaded here): that is already one
  -- 'product_deleted' notification, not a second one about its price.
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  perform public.activity_log_event('wholesale_changed', v_pid,
    jsonb_build_object('name', v_name, 'from', old.wholesale_price, 'to', new.wholesale_price));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists product_internal_pricing_log_activity on public.product_internal_pricing;
create trigger product_internal_pricing_log_activity
  after insert or update or delete on public.product_internal_pricing
  for each row execute function public.log_wholesale_change();

-- ============================================================================
-- 5. Orders: status changes and in-store sales
-- ============================================================================

create or replace function public.log_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'in_store' then
      perform public.activity_log_event('in_store_sale', new.ref,
        jsonb_build_object('total', new.total));
    end if;
  elsif new.status is distinct from old.status then
    perform public.activity_log_event('order_status', new.ref,
      jsonb_build_object('from', old.status, 'to', new.status, 'source', new.source));
  end if;
  return new;
end;
$$;

drop trigger if exists orders_log_activity on public.orders;
create trigger orders_log_activity
  after insert or update of status on public.orders
  for each row execute function public.log_order_activity();

-- ============================================================================
-- 6. Realtime for the owner's open pages (skipped quietly if Realtime is not set up)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
     ) then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end;
$$;

-- ============================================================================
-- Rollback (NOT executed automatically). Drops the log; stock_set / stock_untrack keep
-- working but no longer log (re-run 0009 to restore their original bodies).
-- ============================================================================
--   drop trigger if exists orders_log_activity on public.orders;
--   drop trigger if exists product_internal_pricing_log_activity on public.product_internal_pricing;
--   drop trigger if exists catalog_docs_log_activity on public.catalog_docs;
--   drop function if exists public.log_order_activity();
--   drop function if exists public.log_wholesale_change();
--   drop function if exists public.log_product_change();
--   drop function if exists public.activity_mark_seen();
--   drop table if exists public.activity_log;   -- also leaves the realtime publication
--   drop function if exists public.activity_log_event(text, text, jsonb);
--   drop function if exists public.is_owner();
