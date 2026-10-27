-- Taybah — inventory, phase 2: stock deduction from orders (the integration).
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders), 0003 (is_admin()), 0005 (e-mail outbox), 0006 (catalog),
-- 0008 (in-store orders, with its e-mail suppression INTACT) and 0009 (inventory).
-- Re-runnable.
--
-- !!! APPLYING THIS FILE IS THE ACTIVATION. There is no feature flag, no go-live
-- !!! timestamp and no switch: from the moment this transaction commits, EVERY
-- !!! delivery of an online order and EVERY in-store sale deducts stock — and is
-- !!! REFUSED while a product has no explicit opening balance or stock is short.
-- !!! It therefore FAILS CLOSED: the guard below aborts, changing nothing, unless the
-- !!! reconciliation is complete (see "Activation guard"). Do not apply it until
-- !!! `select * from inventory_activation_blockers()` (as an admin) returns no rows.
--
-- WARNINGS
--   • NEVER re-run 0005 after 0008 (it overwrites the in-store e-mail suppression).
--     This file refuses to run if that suppression is missing.
--   • If 0009 is ever re-run after this file, re-run THIS file straight after: 0009
--     recreates the base inventory_reconcile_rows() (without the order checks) and
--     this file restores the extended one. Nothing else is overwritten.
--
-- What it does
--   Online orders      status -> 'delivered' deducts the order's quantities, summed per
--                      PRODUCT across all variants, in the SAME transaction as the status
--                      change. Creation, confirmation, processing and shipping never
--                      deduct. A cancelled/other transition after delivery never reverses
--                      a deduction (returns are recorded separately).
--   In-store orders    inserting source = 'in_store', status = 'sold' deducts in the SAME
--                      transaction as the insert. A cancelled in-store order (inserted as
--                      cancelled, or cancelled later) deducts nothing / reverses nothing.
--   Refusals (all roll the whole statement back — no order change, no partial deduction):
--                      IS001 a product has no opening balance · IS002 stock is insufficient
--                      (detail = JSON list of the shortfalls) · IS003 a pre-existing order
--                      re-enters 'delivered' without an explicit reconciliation decision ·
--                      IS004 the order's lines changed after stock was deducted/returned ·
--                      IS006 the order's lines are not valid product/quantity lines.
--   Shortage override  only through inventory_deliver_order_override() and
--                      inventory_create_in_store_order_override(): admin only, a reason of
--                      at least 5 characters, bound to the EXACT shortfall the admin saw
--                      (a changed shortfall is refused with IS007), one grant per product
--                      per ATTEMPT (attempt_key), consumed once inside the same transaction,
--                      fully audited (stock_override_grants + movement.override_grant_id).
--                      Unknown products, uninitialized balances and every other validation
--                      (prices, totals, order status) are NOT bypassed.
--   Idempotency        movement keys sale:<order>:<product> and accounted:<order>:<product>
--                      are unique, so a retry or a repeated transition never deducts twice.
--   Legacy orders      every order that existed before this file gets a decision row:
--                      the explicit one an admin recorded (deduct_on_delivery /
--                      already_accounted) or 'settled_legacy' (a historical classification,
--                      not a switch). A legacy order re-entering 'delivered' is handled by
--                      its decision; settled_legacy => IS003.
--   Orders' lines      locked (IS004) once any sale / sale_accounted / return movement
--                      exists for the order.
--
-- Not changed by this file: checkout, order statuses and their transitions, the status
-- history, the e-mail outbox and its in-store suppression, RLS on orders.

-- ============================================================================
-- 0. Activation guard (fails closed, before ANY change)
-- ============================================================================

do $$
declare
  v_missing text[] := '{}';
  v_exposed text[] := '{}';
  v_blockers integer;
  v_lines text;
  v_schema text;
  v_role text;
  v_obj text;
begin
  -- 0009 objects
  foreach v_obj in array array['stock_levels', 'stock_movements', 'stock_override_grants', 'inventory_order_decisions'] loop
    if to_regclass('public.' || v_obj) is null then
      v_missing := array_append(v_missing, format('public.%s (migration 0009)', v_obj));
    end if;
  end loop;
  foreach v_obj in array array[
    'public.inventory_blockers_rows()', 'public.inventory_reconcile_rows()', 'public.inventory_order_audit()',
    'public.inventory_order_lines(jsonb)', 'public.inventory_lines_valid(jsonb)', 'public.inventory_lines_hash(jsonb)',
    'public.inventory_require_admin()', 'public.inventory_check_reason(text, integer)',
    'public.inventory_raise_key_reuse(text[])', 'public.inventory_decide_order(uuid, text, text, text)',
    'public.inventory_write_movement(text, text, integer, integer, integer, text, text, uuid, text, uuid, integer)'
  ] loop
    if to_regprocedure(v_obj) is null then
      v_missing := array_append(v_missing, format('%s (migration 0009)', v_obj));
    end if;
  end loop;
  -- 0001 / 0008 / 0005
  if to_regclass('public.orders') is null then
    v_missing := array_append(v_missing, 'public.orders (migration 0001)');
  elsif not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'source'
  ) then
    v_missing := array_append(v_missing, 'orders.source (migration 0008)');
  elsif not exists (
    select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_validate_in_store' and not tgisinternal
  ) then
    v_missing := array_append(v_missing, 'the in-store order validation trigger orders_validate_in_store (migration 0008)');
  end if;
  if to_regprocedure('public.enqueue_order_email()') is null then
    v_missing := array_append(v_missing, 'public.enqueue_order_email() (migration 0005)');
  elsif position('in_store_order' in pg_get_functiondef(to_regprocedure('public.enqueue_order_email()'))) = 0 then
    v_missing := array_append(v_missing, 'the in-store e-mail suppression inside enqueue_order_email() — it was overwritten (re-applying 0005 after 0008 does this); re-run 0008 first');
  end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'ABORT: migration 0010 needs % — apply the missing migration(s) first (see docs/PRODUCTION_RUNBOOK.md). Nothing was changed.',
      array_to_string(v_missing, ', ');
  end if;

  -- the SECURITY DEFINER functions below pin search_path = public and call auth.*
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
    raise exception 'ABORT: migration 0010 refuses to run: % — SECURITY DEFINER inventory functions would be exposed to object shadowing. This migration does not change privileges (the project owner can run: revoke create on schema public from public, anon, authenticated; and the same for schema auth). Nothing was changed.',
      array_to_string(v_exposed, '; ');
  end if;

  -- Freeze orders so the reconciliation below is a consistent snapshot until commit.
  lock table public.orders in share row exclusive mode;

  select count(*) into v_blockers from public.inventory_blockers_rows();
  if v_blockers > 0 then
    select string_agg(l, E'\n') into v_lines
      from (
        select format('  %s%s%s: %s', b.code,
                 case when b.order_id is not null then ' [order ' || b.order_id::text || ']' else '' end,
                 case when b.product_id is not null then ' [product ' || b.product_id || ']' else '' end,
                 b.detail) as l
          from public.inventory_blockers_rows() b
         order by b.code, b.order_id, b.product_id
         limit 15
      ) t;
    raise exception E'ABORT: migration 0010 refuses to run: % activation blocker(s) are unresolved (see inventory_activation_blockers() for the complete list). Nothing was changed. First blockers:\n%',
      v_blockers, v_lines;
  end if;
end;
$$;

-- ============================================================================
-- 1. Mark every PRE-EXISTING order that has no explicit decision as 'settled_legacy'
--    (a historical classification — it triggers nothing by itself). Only on the first
--    install: a re-run must never classify new orders as legacy.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.inventory_apply_order(public.orders, text)') is null then
    insert into public.inventory_order_decisions (order_id, decision, reason, lines_hash, status_at_decision, decided_by)
    select a.audit_order_id, 'settled_legacy', 'settled before the inventory integration (migration 0010)',
           a.audit_lines_hash, a.audit_status, null
      from public.inventory_order_audit() a
     where not exists (select 1 from public.inventory_order_decisions d where d.order_id = a.audit_order_id);
  end if;
end;
$$;

-- ============================================================================
-- 2. Helpers (internal)
-- ============================================================================

-- Locks the balance rows of an order's products in product-id order (a fixed order, so
-- two orders competing for the same products cannot deadlock) and returns the plan:
-- [{ product_id, requested, initialized, available }] — products aggregated across variants.
create or replace function public.inventory_plan_lines(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_row public.stock_levels%rowtype;
  v_found boolean;
  v_plan jsonb := '[]'::jsonb;
begin
  for r in select l.product_id, l.qty from public.inventory_order_lines(p_lines) l order by l.product_id loop
    select * into v_row from public.stock_levels s where s.product_id = r.product_id for update;
    v_found := found;
    v_plan := v_plan || jsonb_build_object(
      'product_id', r.product_id,
      'requested', r.qty,
      'initialized', v_found,
      'available', case when v_found then v_row.on_hand end
    );
  end loop;
  return v_plan;
end;
$$;

-- Shortfalls of a plan: [{ product_id, requested, available, shortfall }] (initialized products only).
create or replace function public.inventory_plan_shortfalls(p_plan jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', e ->> 'product_id',
           'requested', (e ->> 'requested')::integer,
           'available', (e ->> 'available')::integer,
           'shortfall', (e ->> 'requested')::integer - (e ->> 'available')::integer
         ) order by e ->> 'product_id'), '[]'::jsonb)
    from jsonb_array_elements(p_plan) e
   where (e ->> 'initialized')::boolean
     and (e ->> 'available')::integer < (e ->> 'requested')::integer
$$;

-- The shortfall list the caller says it saw, normalized (sorted, integers) or rejected.
create or replace function public.inventory_normalize_shortfalls(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  e jsonb;
begin
  if p is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'confirmed shortfall must be a list';
  end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'product_id') is distinct from 'string'
       or jsonb_typeof(e -> 'requested') is distinct from 'number'
       or jsonb_typeof(e -> 'available') is distinct from 'number'
       or jsonb_typeof(e -> 'shortfall') is distinct from 'number'
       or (e ->> 'requested')::numeric <> trunc((e ->> 'requested')::numeric)
       or (e ->> 'available')::numeric <> trunc((e ->> 'available')::numeric)
       or (e ->> 'shortfall')::numeric <> trunc((e ->> 'shortfall')::numeric) then
      raise exception 'inventory_invalid' using errcode = '22023',
        detail = 'confirmed shortfall must be a list of { product_id, requested, available, shortfall } with whole numbers';
    end if;
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'product_id', x ->> 'product_id',
             'requested', (x ->> 'requested')::integer,
             'available', (x ->> 'available')::integer,
             'shortfall', (x ->> 'shortfall')::integer
           ) order by x ->> 'product_id')
      from jsonb_array_elements(p) x
  ), '[]'::jsonb);
end;
$$;

-- Result of an override operation: what the ledger says happened to the order.
create or replace function public.inventory_override_result(p_order_id uuid, p_status text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', p_status,
    'order_id', p_order_id,
    'deductions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', m.product_id, 'quantity', m.quantity,
               'qty_before', m.qty_before, 'qty_after', m.qty_after,
               'override', m.override, 'shortfall', m.shortfall
             ) order by m.product_id)
        from public.stock_movements m
       where m.order_id = p_order_id and m.kind = 'sale'
    ), '[]'::jsonb)
  )
$$;

-- ============================================================================
-- 3. The deduction itself (internal; called only by the triggers below)
-- ============================================================================
-- Runs INSIDE the statement that changes the order, so the order change, the balance
-- update and the ledger rows commit or roll back together.

create or replace function public.inventory_apply_order(p_order public.orders, p_operation text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text;
  v_plan jsonb;
  v_todo jsonb := '[]'::jsonb;
  v_short jsonb;
  v_missing text[];
  v_grants jsonb := '{}'::jsonb;
  v_unauth boolean := false;
  v_grant uuid;
  v_reason text;
  v_key text;
  e jsonb;
  v_pid text;
  v_qty integer;
  v_avail integer;
begin
  if p_operation not in ('create_in_store_order', 'deliver_order') then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'unknown operation';
  end if;

  if p_operation = 'deliver_order' then
    select d.decision into v_decision
      from public.inventory_order_decisions d
     where d.order_id = p_order.id and d.superseded_by is null;
    if v_decision = 'settled_legacy' then
      raise exception 'legacy_order_decision_required' using errcode = 'IS003',
        detail = 'order ' || p_order.ref || ' predates the inventory integration: record an explicit reconciliation decision before delivering it';
    end if;
  end if;

  if not public.inventory_lines_valid(p_order.lines) then
    if v_decision = 'already_accounted' then
      return; -- explicitly accounted for; there is nothing readable to record
    end if;
    raise exception 'order_lines_invalid' using errcode = 'IS006',
      detail = 'order ' || p_order.ref || ' has lines that are not valid product/quantity lines';
  end if;

  v_plan := public.inventory_plan_lines(p_order.lines); -- locks the balances in product order

  select array_agg(x ->> 'product_id' order by x ->> 'product_id') into v_missing
    from jsonb_array_elements(v_plan) x
   where not (x ->> 'initialized')::boolean;
  if v_missing is not null then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = array_to_string(v_missing, ',');
  end if;

  v_reason := case p_operation when 'deliver_order' then 'تسليم الطلب ' else 'بيع من المتجر ' end || p_order.ref;

  if v_decision = 'already_accounted' then
    -- the goods were already accounted for in the opening balance: audit rows only, stock untouched
    for e in select * from jsonb_array_elements(v_plan) loop
      v_key := 'accounted:' || p_order.id::text || ':' || (e ->> 'product_id');
      if not exists (select 1 from public.stock_movements m where m.idempotency_key = v_key) then
        perform public.inventory_write_movement(
          e ->> 'product_id', 'sale_accounted', (e ->> 'requested')::integer, 0, (e ->> 'available')::integer,
          v_reason || ' (محتسب مسبقًا)', null, p_order.id, v_key);
      end if;
    end loop;
    return;
  end if;

  -- products already deducted for THIS order (a retry, or a repeated transition) are skipped
  for e in select * from jsonb_array_elements(v_plan) loop
    if not exists (
      select 1 from public.stock_movements m
       where m.idempotency_key = 'sale:' || p_order.id::text || ':' || (e ->> 'product_id')
    ) then
      v_todo := v_todo || e;
    end if;
  end loop;

  -- every shortage needs an explicit, exactly matching, not-yet-consumed grant created in THIS transaction
  for e in select * from jsonb_array_elements(v_todo) loop
    v_pid := e ->> 'product_id';
    v_qty := (e ->> 'requested')::integer;
    v_avail := (e ->> 'available')::integer;
    if v_avail < v_qty then
      v_grant := null;
      update public.stock_override_grants g
         set consumed_at = now()
       where g.txid = txid_current()
         and g.order_id = p_order.id
         and g.product_id = v_pid
         and g.operation = p_operation
         and g.consumed_at is null
         and g.requested_qty = v_qty
         and g.available_qty = v_avail
         and g.shortfall = v_qty - v_avail
      returning g.id into v_grant;
      if v_grant is null then
        v_unauth := true;
      else
        v_grants := v_grants || jsonb_build_object(v_pid, v_grant);
      end if;
    end if;
  end loop;
  if v_unauth then
    v_short := public.inventory_plan_shortfalls(v_todo);
    raise exception 'insufficient_stock' using errcode = 'IS002', detail = v_short::text;
  end if;

  for e in select * from jsonb_array_elements(v_todo) loop
    v_pid := e ->> 'product_id';
    v_qty := (e ->> 'requested')::integer;
    v_avail := (e ->> 'available')::integer;
    v_grant := nullif(v_grants ->> v_pid, '')::uuid;
    update public.stock_levels set on_hand = on_hand - v_qty where product_id = v_pid;
    perform public.inventory_write_movement(
      v_pid, 'sale', v_qty, -v_qty, v_avail, v_reason, null, p_order.id,
      'sale:' || p_order.id::text || ':' || v_pid,
      v_grant, case when v_grant is not null then v_qty - v_avail else 0 end);
  end loop;
end;
$$;

-- ============================================================================
-- 4. Triggers on orders (new, independent: no existing trigger or function is redefined)
-- ============================================================================

create or replace function public.inventory_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only a NEW in-store sale deducts; an in-store order created as 'cancelled' does not
  if new.source = 'in_store' and new.status = 'sold' then
    perform public.inventory_apply_order(new, 'create_in_store_order');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_inventory_insert on public.orders;
create trigger orders_inventory_insert
  after insert on public.orders
  for each row execute function public.inventory_on_order_insert();

create or replace function public.inventory_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only the ENTRY into 'delivered' of an online order deducts
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.source = 'online' then
    perform public.inventory_apply_order(new, 'deliver_order');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_inventory_status on public.orders;
create trigger orders_inventory_status
  after update of status on public.orders
  for each row
  when (new.status = 'delivered' and old.status is distinct from new.status)
  execute function public.inventory_on_order_status();

-- IS004: once stock was deducted or returned for an order, its lines are frozen
-- (0008 already freezes in-store orders; this covers online orders too and keys the
-- freeze to the ledger). There is no automatic correction path: a mistake is fixed
-- with an audited manual adjustment / return, never by rewriting the lines.
create or replace function public.inventory_guard_order_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lines is distinct from old.lines and exists (
    select 1 from public.stock_movements m
     where m.order_id = old.id
       and m.kind in ('sale', 'sale_accounted', 'return_restock', 'return_damaged')
  ) then
    raise exception 'order_lines_locked' using errcode = 'IS004',
      detail = 'order ' || old.ref || ' already has inventory movements; its lines can no longer change';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_inventory_lines_guard on public.orders;
create trigger orders_inventory_lines_guard
  before update of lines on public.orders
  for each row execute function public.inventory_guard_order_lines();

-- ============================================================================
-- 5. Admin-authorized shortage overrides (the ONLY way past IS002)
-- ============================================================================
-- Responsibilities of both functions: admin check · reason >= 5 characters · an
-- attempt_key (UUID) per attempt · the confirmed shortfall must equal the shortfall
-- computed NOW under row locks (else IS007 with the fresh numbers) · one grant per
-- short product, bound to (operation, order, product, requested, available, shortfall,
-- this transaction) · the grants are consumed by the trigger in the SAME transaction and
-- any unconsumed grant rolls everything back · replays are idempotent, a reused key with
-- a different request is IS005. Unknown/uninitialized products, price/total validation,
-- order status rules etc. are NOT bypassed.

create or replace function public.inventory_deliver_order_override(
  p_order_id uuid,
  p_expected_status text,
  p_attempt_key uuid,
  p_confirmed_shortfall jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_decision text;
  v_plan jsonb;
  v_todo jsonb := '[]'::jsonb;
  v_short jsonb;
  v_confirmed jsonb;
  v_missing text[];
  v_diff text[];
  v_updated integer;
  v_unused integer;
  e jsonb;
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason, 5);
  if p_attempt_key is null or p_order_id is null or p_expected_status is null then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'order, expected status and attempt key are required';
  end if;
  v_confirmed := public.inventory_normalize_shortfalls(p_confirmed_shortfall);

  -- One attempt key = one operation, even across DIFFERENT orders: unique (attempt_key,
  -- product_id) only collides when two attempts share a product, so two concurrent requests
  -- with one key on different orders/products could otherwise both pass the replay check
  -- below and leave one key attached to two orders. Same lock string as the in-store
  -- override. LOCK ORDER (everywhere): attempt-key advisory lock -> orders row -> stock_levels
  -- rows in product_id order. Non-override paths never take the advisory lock, so no cycle.
  -- hashtextextended is 64-bit; a collision between two different keys only makes those two
  -- requests wait for each other (never a wrong result).
  perform pg_advisory_xact_lock(hashtextextended('inventory_override:' || p_attempt_key::text, 0));

  select * into v_order from public.orders where id = p_order_id for update; -- serializes concurrent attempts
  if not found then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'unknown order';
  end if;

  -- replay (or reuse) of this attempt key
  if exists (select 1 from public.stock_override_grants g where g.attempt_key = p_attempt_key) then
    v_diff := array_remove(array[
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.order_id <> p_order_id) then 'order' end,
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.operation <> 'deliver_order') then 'operation' end,
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.reason <> btrim(p_reason)) then 'reason' end,
      case when coalesce((
                 select jsonb_agg(jsonb_build_object('product_id', g.product_id, 'requested', g.requested_qty,
                          'available', g.available_qty, 'shortfall', g.shortfall) order by g.product_id)
                   from public.stock_override_grants g where g.attempt_key = p_attempt_key
               ), '[]'::jsonb) <> v_confirmed then 'confirmed_shortfall' end
    ], null);
    if array_length(v_diff, 1) is not null then
      perform public.inventory_raise_key_reuse(v_diff);
    end if;
    return public.inventory_override_result(p_order_id, 'replayed');
  end if;

  if v_order.source <> 'online' then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'only online orders are delivered';
  end if;
  if v_order.status = 'delivered' then
    return public.inventory_override_result(p_order_id, 'unchanged'); -- nothing to do
  end if;
  if v_order.status <> p_expected_status then
    raise exception 'order_status_changed' using errcode = 'CF001', detail = 'order ' || v_order.ref;
  end if;

  select d.decision into v_decision
    from public.inventory_order_decisions d where d.order_id = p_order_id and d.superseded_by is null;
  if v_decision = 'settled_legacy' then
    raise exception 'legacy_order_decision_required' using errcode = 'IS003',
      detail = 'order ' || v_order.ref || ' predates the inventory integration: record an explicit reconciliation decision first';
  elsif v_decision = 'already_accounted' then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'no stock deduction applies to this order: deliver it normally';
  end if;
  if not public.inventory_lines_valid(v_order.lines) then
    raise exception 'order_lines_invalid' using errcode = 'IS006', detail = 'order ' || v_order.ref;
  end if;

  v_plan := public.inventory_plan_lines(v_order.lines);
  select array_agg(x ->> 'product_id' order by x ->> 'product_id') into v_missing
    from jsonb_array_elements(v_plan) x where not (x ->> 'initialized')::boolean;
  if v_missing is not null then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = array_to_string(v_missing, ',');
  end if;
  for e in select * from jsonb_array_elements(v_plan) loop
    if not exists (select 1 from public.stock_movements m
                    where m.idempotency_key = 'sale:' || p_order_id::text || ':' || (e ->> 'product_id')) then
      v_todo := v_todo || e;
    end if;
  end loop;

  v_short := public.inventory_plan_shortfalls(v_todo);
  if jsonb_array_length(v_short) = 0 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'no shortage: deliver the order normally';
  end if;
  if v_short <> v_confirmed then
    raise exception 'shortfall_changed' using errcode = 'IS007', detail = v_short::text;
  end if;

  insert into public.stock_override_grants (
    attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall,
    reason, granted_by, granted_by_email, txid
  )
  select p_attempt_key, 'deliver_order', p_order_id, s ->> 'product_id',
         (s ->> 'requested')::integer, (s ->> 'available')::integer, (s ->> 'shortfall')::integer,
         btrim(p_reason), auth.uid(), public.inventory_actor_email(), txid_current()
    from jsonb_array_elements(v_short) s;

  update public.orders set status = 'delivered' where id = p_order_id and status = p_expected_status;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'order_status_changed' using errcode = 'CF001', detail = 'order ' || v_order.ref;
  end if;

  select count(*) into v_unused from public.stock_override_grants g
   where g.attempt_key = p_attempt_key and g.consumed_at is null;
  if v_unused > 0 then
    raise exception 'unused_override_grant' using errcode = 'IS009', detail = v_unused || ' grant(s) were not consumed';
  end if;
  return public.inventory_override_result(p_order_id, 'delivered');
end;
$$;

-- p_order: { id (uuid), ref, contact, address, delivery, lines, subtotal, total, note? } — the same
-- shape the in-store form already inserts. status/source are fixed here ('sold' / 'in_store').
create or replace function public.inventory_create_in_store_order_override(
  p_order jsonb,
  p_attempt_key uuid,
  p_confirmed_shortfall jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_lines jsonb;
  v_plan jsonb;
  v_todo jsonb;
  v_short jsonb;
  v_confirmed jsonb;
  v_missing text[];
  v_diff text[];
  v_unused integer;
  v_existing public.orders%rowtype;
begin
  perform public.inventory_require_admin();
  perform public.inventory_check_reason(p_reason, 5);
  if p_attempt_key is null or p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'an order object and an attempt key are required';
  end if;
  begin
    v_id := (p_order ->> 'id')::uuid;
  exception when others then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'order id must be a UUID';
  end;
  if v_id is null then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'order id must be a UUID';
  end if;
  v_lines := p_order -> 'lines';
  v_confirmed := public.inventory_normalize_shortfalls(p_confirmed_shortfall);

  -- one attempt key = one operation (see the same lock in inventory_deliver_order_override: lock order
  -- attempt-key advisory lock -> stock_levels rows in product_id order; the order row is new).
  -- A second request with the same key waits here, then takes the replay / key-reuse branch.
  perform pg_advisory_xact_lock(hashtextextended('inventory_override:' || p_attempt_key::text, 0));

  if exists (select 1 from public.stock_override_grants g where g.attempt_key = p_attempt_key) then
    select * into v_existing from public.orders where id = v_id;
    v_diff := array_remove(array[
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.order_id <> v_id) then 'order' end,
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.operation <> 'create_in_store_order') then 'operation' end,
      case when exists (select 1 from public.stock_override_grants g
                         where g.attempt_key = p_attempt_key and g.reason <> btrim(p_reason)) then 'reason' end,
      case when coalesce((
                 select jsonb_agg(jsonb_build_object('product_id', g.product_id, 'requested', g.requested_qty,
                          'available', g.available_qty, 'shortfall', g.shortfall) order by g.product_id)
                   from public.stock_override_grants g where g.attempt_key = p_attempt_key
               ), '[]'::jsonb) <> v_confirmed then 'confirmed_shortfall' end,
      case when v_existing.id is not null
                and public.inventory_lines_hash(v_existing.lines) is distinct from public.inventory_lines_hash(v_lines)
           then 'order_lines' end
    ], null);
    if array_length(v_diff, 1) is not null then
      perform public.inventory_raise_key_reuse(v_diff);
    end if;
    return public.inventory_override_result(v_id, 'replayed');
  end if;

  if exists (select 1 from public.orders o where o.id = v_id) then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'an order with this id already exists';
  end if;
  if not public.inventory_lines_valid(v_lines) then
    raise exception 'order_lines_invalid' using errcode = 'IS006', detail = 'the order lines are not valid product/quantity lines';
  end if;

  v_plan := public.inventory_plan_lines(v_lines);
  select array_agg(x ->> 'product_id' order by x ->> 'product_id') into v_missing
    from jsonb_array_elements(v_plan) x where not (x ->> 'initialized')::boolean;
  if v_missing is not null then
    raise exception 'stock_not_initialized' using errcode = 'IS001', detail = array_to_string(v_missing, ',');
  end if;
  v_todo := v_plan;
  v_short := public.inventory_plan_shortfalls(v_todo);
  if jsonb_array_length(v_short) = 0 then
    raise exception 'inventory_invalid' using errcode = '22023', detail = 'no shortage: record the sale normally';
  end if;
  if v_short <> v_confirmed then
    raise exception 'shortfall_changed' using errcode = 'IS007', detail = v_short::text;
  end if;

  insert into public.stock_override_grants (
    attempt_key, operation, order_id, product_id, requested_qty, available_qty, shortfall,
    reason, granted_by, granted_by_email, txid
  )
  select p_attempt_key, 'create_in_store_order', v_id, s ->> 'product_id',
         (s ->> 'requested')::integer, (s ->> 'available')::integer, (s ->> 'shortfall')::integer,
         btrim(p_reason), auth.uid(), public.inventory_actor_email(), txid_current()
    from jsonb_array_elements(v_short) s;

  -- the 0008 validation trigger still checks prices, totals and the delivery method
  insert into public.orders (id, ref, status, source, contact, address, delivery, lines, subtotal, total, note)
  values (
    v_id, p_order ->> 'ref', 'sold', 'in_store',
    p_order -> 'contact', p_order -> 'address', p_order -> 'delivery', v_lines,
    (p_order ->> 'subtotal')::numeric, (p_order ->> 'total')::numeric, nullif(btrim(p_order ->> 'note'), '')
  );

  select count(*) into v_unused from public.stock_override_grants g
   where g.attempt_key = p_attempt_key and g.consumed_at is null;
  if v_unused > 0 then
    raise exception 'unused_override_grant' using errcode = 'IS009', detail = v_unused || ' grant(s) were not consumed';
  end if;
  return public.inventory_override_result(v_id, 'created');
end;
$$;

-- ============================================================================
-- 6. Reconciliation: the base checks of 0009 + the order-integration checks
-- ============================================================================
-- (inventory_reconcile(), inventory_reconcile_summary() and inventory_activation_blockers()
-- from 0009 call this function; they are not redefined.)

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

  -- ---- (0010) order-integration checks ---------------------------------------------
  -- Every delivered online order and every in-store sale of an order created after the
  -- integration has a sale movement for each product it contains.
  return query
  with expected as (
    select o.id as oid, l.product_id as pid, l.qty as q
      from public.orders o
      cross join lateral public.inventory_order_lines(o.lines) l
     where ((o.source = 'online' and o.status = 'delivered') or (o.source = 'in_store' and o.status = 'sold'))
       and not exists (select 1 from public.inventory_order_decisions d where d.order_id = o.id)
  )
  select 'MISSING_SALE', 'error', 'integrity', x.pid, x.oid, x.q::text, '0',
         'a delivered / sold order has no sale movement for this product'
    from expected x
   where not exists (
     select 1 from public.stock_movements mv
      where mv.order_id = x.oid and mv.product_id = x.pid and mv.kind = 'sale');

  -- A legacy order decided BEFORE delivery and delivered since must have been processed
  -- exactly as its decision says.
  return query
  select 'LEGACY_DELIVERED_WITHOUT_MOVEMENT', 'error', 'integrity', l.product_id, o.id,
         d.decision, 'none', 'a legacy order was delivered but inventory wrote no movement for this product'
    from public.inventory_order_decisions d
    join public.orders o on o.id = d.order_id
    cross join lateral public.inventory_order_lines(o.lines) l
   where d.superseded_by is null
     and d.decision in ('deduct_on_delivery', 'already_accounted')
     and d.status_at_decision <> 'delivered'
     and o.status = 'delivered'
     and not exists (
       select 1 from public.stock_movements mv
        where mv.order_id = o.id and mv.product_id = l.product_id
          and mv.kind = case d.decision when 'deduct_on_delivery' then 'sale' else 'sale_accounted' end);

  -- Movements that contradict the order's decision.
  return query
  select 'DECISION_VIOLATED', 'error', 'integrity', mv.product_id, mv.order_id,
         d.decision, mv.kind, 'a movement contradicts the reconciliation decision of its order'
    from public.stock_movements mv
    join public.inventory_order_decisions d on d.order_id = mv.order_id and d.superseded_by is null
   where (mv.kind = 'sale' and d.decision <> 'deduct_on_delivery')
      or (mv.kind = 'sale_accounted' and d.decision <> 'already_accounted');
end;
$$;

-- ============================================================================
-- 7. Privileges: internal helpers are callable by nobody; the two overrides by
--    authenticated only (each checks is_admin() first). service_role has no use for them.
-- ============================================================================

revoke execute on function public.inventory_plan_lines(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_plan_shortfalls(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_normalize_shortfalls(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_override_result(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_apply_order(public.orders, text) from public, anon, authenticated, service_role;
revoke execute on function public.inventory_on_order_insert() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_on_order_status() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_guard_order_lines() from public, anon, authenticated, service_role;
revoke execute on function public.inventory_reconcile_rows() from public, anon, authenticated, service_role;

revoke execute on function public.inventory_deliver_order_override(uuid, text, uuid, jsonb, text) from public, anon, service_role;
revoke execute on function public.inventory_create_in_store_order_override(jsonb, uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.inventory_deliver_order_override(uuid, text, uuid, jsonb, text) to authenticated;
grant execute on function public.inventory_create_in_store_order_override(jsonb, uuid, jsonb, text) to authenticated;

-- ============================================================================
-- Rollback (NOT executed automatically). Removes the integration; the ledger, the
-- balances, the decisions and the grants are KEPT. Stock already deducted is NOT
-- restored: after a rollback, deliveries stop deducting but the balances keep what
-- the integration did — reconcile by hand (adjustments) before relying on them again.
-- ============================================================================
--   drop trigger if exists orders_inventory_lines_guard on public.orders;
--   drop trigger if exists orders_inventory_status on public.orders;
--   drop trigger if exists orders_inventory_insert on public.orders;
--   drop function if exists public.inventory_create_in_store_order_override(jsonb, uuid, jsonb, text);
--   drop function if exists public.inventory_deliver_order_override(uuid, text, uuid, jsonb, text);
--   drop function if exists public.inventory_guard_order_lines();
--   drop function if exists public.inventory_on_order_status();
--   drop function if exists public.inventory_on_order_insert();
--   drop function if exists public.inventory_apply_order(public.orders, text);
--   drop function if exists public.inventory_override_result(uuid, text);
--   drop function if exists public.inventory_normalize_shortfalls(jsonb);
--   drop function if exists public.inventory_plan_shortfalls(jsonb);
--   drop function if exists public.inventory_plan_lines(jsonb);
--   -- then re-run 0009 to restore the base inventory_reconcile_rows().
--   -- The 'settled_legacy' decision rows stay (they are history).
