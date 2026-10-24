-- Taybah — reliable order email notifications (outbox pattern).
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (orders) and 0003 (admins / is_admin()). Replaces 0002.
--
-- Flow:
--   orders INSERT/UPDATE(status)            (0001 triggers)
--     -> order_status_history row           (only when status really changes)
--       -> enqueue_order_email()            (this file; one outbox row per
--                                            history row, enforced by UNIQUE)
--         -> kick_order_email_worker()      (pg_net -> Edge Function)
--   + pg_cron sweep every minute retries anything still pending.
-- The Edge Function claims rows, sends via Resend, and only then marks them
-- 'sent'. A failed/missing email never blocks the status update itself.

-- ============================================================================
-- Pre-flight: refuse to run if it could lock the admin out of orders
-- ============================================================================
-- Section 7 restricts order read/update to rows in public.admins. If that
-- table is empty (or 0003 was never applied) every admin would see an empty
-- orders list. Abort BEFORE changing anything; the SQL editor runs this
-- script as one transaction, so an abort leaves the database untouched.

do $$
begin
  if to_regclass('public.admins') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'ABORT: migration 0003 (public.admins / is_admin()) has not been applied.';
  end if;
  if not exists (select 1 from public.admins) then
    raise exception 'ABORT: public.admins is empty. Add your admin user first: insert into public.admins (user_id) values (''<your auth.users id>''); — otherwise this migration would lock you out of the orders admin.';
  end if;
end;
$$;

-- ============================================================================
-- 0. Retire the old fire-and-forget trigger (hardcoded key, no retries)
-- ============================================================================

drop trigger if exists order_status_history_notify_email on public.order_status_history;
drop function if exists public.notify_order_status_email();

-- ============================================================================
-- 1. Outbox table
-- ============================================================================

create table if not exists public.order_email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- Strictly increasing creation order. Timestamps can tie (now() is the
  -- transaction start time), so ordering and "is there a newer email" checks
  -- use this instead of created_at.
  seq bigint generated always as identity,
  order_id uuid not null references public.orders (id) on delete cascade,
  -- UNIQUE = at most one email per status-change event, however many times
  -- the trigger / retries / duplicate requests fire.
  history_id uuid not null unique references public.order_status_history (id) on delete cascade,
  kind text not null check (kind in ('confirmation', 'status_update')),
  status text not null,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  -- Short error CODE only (e.g. provider_http_403) — never provider bodies
  -- or addresses.
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_email_outbox_due_idx
  on public.order_email_outbox (next_attempt_at)
  where state in ('pending', 'sending');
create index if not exists order_email_outbox_order_idx
  on public.order_email_outbox (order_id, created_at);

alter table public.order_email_outbox enable row level security;

-- Admins may READ delivery state. Nobody can write from the client: all
-- writes go through the SECURITY DEFINER functions below.
revoke all on table public.order_email_outbox from anon, authenticated;
grant select on table public.order_email_outbox to authenticated;

drop policy if exists "admins can read order email outbox" on public.order_email_outbox;
create policy "admins can read order email outbox" on public.order_email_outbox
  for select to authenticated using (public.is_admin());

-- ============================================================================
-- 2. Worker kick (pg_net) — config lives in Vault, not in this file
-- ============================================================================
-- Vault secrets (create them once; see docs/ORDER_EMAIL_SETUP.md):
--   order_email_worker_url    https://<ref>.supabase.co/functions/v1/process-order-emails
--   order_email_worker_secret same value as the ORDER_EMAIL_WORKER_SECRET function secret

create extension if not exists pg_net with schema extensions;

create or replace function public.kick_order_email_worker()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.order_email_outbox
    where (state = 'pending' and next_attempt_at <= now())
       or (state = 'sending' and locked_at < now() - interval '10 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'order_email_worker_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'order_email_worker_secret';
  if v_url is null or v_secret is null then
    return; -- not configured yet: rows stay 'pending' and visible to admins
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
exception when others then
  -- Never let notification plumbing break an order write.
  return;
end;
$$;

revoke execute on function public.kick_order_email_worker() from public, anon, authenticated;

-- ============================================================================
-- 3. Enqueue on every order_status_history insert
-- ============================================================================

create or replace function public.enqueue_order_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_kind text;
begin
  select nullif(btrim(contact ->> 'email'), '') into v_email
    from public.orders where id = new.order_id;

  v_kind := case
    when exists (
      select 1 from public.order_status_history h
      where h.order_id = new.order_id and h.id <> new.id
    ) then 'status_update'
    else 'confirmation'
  end;

  insert into public.order_email_outbox (order_id, history_id, kind, status, state, last_error)
  values (
    new.order_id, new.id, v_kind, new.status,
    case when v_email is null or v_email !~ '^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$'
         then 'skipped' else 'pending' end,
    case when v_email is null or v_email !~ '^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$'
         then 'no_customer_email' end
  )
  on conflict (history_id) do nothing;

  perform public.kick_order_email_worker();
  return new;
end;
$$;

revoke execute on function public.enqueue_order_email() from public, anon, authenticated;

drop trigger if exists order_status_history_enqueue_email on public.order_status_history;
create trigger order_status_history_enqueue_email
  after insert on public.order_status_history
  for each row execute function public.enqueue_order_email();

-- ============================================================================
-- 4. Worker RPCs (service_role only)
-- ============================================================================

create or replace function public.claim_order_emails(p_limit integer default 10)
returns table (
  out_id uuid,
  out_kind text,
  out_status text,
  out_attempts integer,
  out_ref text,
  out_contact jsonb,
  out_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reclaim rows whose worker died mid-send. Safe: the provider call uses
  -- the outbox id as its idempotency key.
  update public.order_email_outbox
     set state = 'pending', updated_at = now()
   where state = 'sending' and locked_at < now() - interval '10 minutes';

  -- A retried email for an older status is pointless once a newer status
  -- email for the same order was accepted — don't send them out of order.
  update public.order_email_outbox o
     set state = 'skipped', last_error = 'superseded', updated_at = now()
   where o.state = 'pending'
     and o.attempts > 0
     and exists (
       select 1 from public.order_email_outbox n
       where n.order_id = o.order_id and n.state = 'sent' and n.seq > o.seq
     );

  return query
  with picked as (
    select ob.id from public.order_email_outbox ob
    where ob.state = 'pending' and ob.next_attempt_at <= now()
    order by ob.seq
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ),
  upd as (
    update public.order_email_outbox ob
       set state = 'sending', locked_at = now(),
           attempts = ob.attempts + 1, updated_at = now()
      from picked
     where ob.id = picked.id
    returning ob.id, ob.order_id, ob.kind, ob.status, ob.attempts
  )
  select upd.id, upd.kind, upd.status, upd.attempts, ord.ref, ord.contact, ord.total
    from upd join public.orders ord on ord.id = upd.order_id;
end;
$$;

-- p_outcome: 'sent' | 'retry' | 'failed' | 'skipped'. Only rows currently
-- 'sending' can be finished, so a late/duplicate report is a no-op. 'sent'
-- REQUIRES a provider message id — no acceptance proof, no 'sent'.
create or replace function public.finish_order_email(
  p_id uuid,
  p_outcome text,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max constant integer := 5;
  v_delay_minutes integer[] := array[1, 5, 30, 120, 360];
begin
  select attempts into v_attempts
    from public.order_email_outbox where id = p_id and state = 'sending' for update;
  if not found then return; end if;

  if p_outcome = 'sent' then
    if p_provider_id is null or p_provider_id = '' then
      raise exception 'sent requires a provider message id';
    end if;
    update public.order_email_outbox
       set state = 'sent', provider_message_id = p_provider_id, sent_at = now(),
           last_error = null, locked_at = null, updated_at = now()
     where id = p_id;
  elsif p_outcome = 'retry' and v_attempts < v_max then
    update public.order_email_outbox
       set state = 'pending', last_error = left(p_error, 120), locked_at = null,
           next_attempt_at = now() + make_interval(mins => v_delay_minutes[least(v_attempts, v_max)]),
           updated_at = now()
     where id = p_id;
  elsif p_outcome in ('retry', 'failed') then
    update public.order_email_outbox
       set state = 'failed', last_error = left(coalesce(p_error, 'retries_exhausted'), 120),
           locked_at = null, updated_at = now()
     where id = p_id;
  elsif p_outcome = 'skipped' then
    update public.order_email_outbox
       set state = 'skipped', last_error = left(p_error, 120),
           locked_at = null, updated_at = now()
     where id = p_id;
  else
    raise exception 'unknown outcome %', p_outcome;
  end if;
end;
$$;

revoke execute on function public.claim_order_emails(integer) from public, anon, authenticated;
revoke execute on function public.finish_order_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_order_emails(integer) to service_role;
grant execute on function public.finish_order_email(uuid, text, text, text) to service_role;

-- ============================================================================
-- 5. Admin retry (the only client-callable write path)
-- ============================================================================

create or replace function public.retry_order_email(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.order_email_outbox
     set state = 'pending', attempts = 0, next_attempt_at = now(),
         last_error = null, updated_at = now()
   where id = p_id and state = 'failed';

  if found then
    perform public.kick_order_email_worker();
  end if;
end;
$$;

revoke execute on function public.retry_order_email(uuid) from public, anon;
grant execute on function public.retry_order_email(uuid) to authenticated;

-- ============================================================================
-- 6. Retry sweep every minute (picks up backoff retries + unconfigured rows)
-- ============================================================================

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'order-email-worker', '* * * * *', 'select public.kick_order_email_worker()'
  );
exception when others then
  raise notice 'pg_cron unavailable (%): enable it in Database > Extensions, then re-run this block', sqlerrm;
end;
$$;

-- ============================================================================
-- 7. Lock down who can create / change orders
-- ============================================================================
-- Before: any signed-in user could read/update every order, and anon inserts
-- could set any status (e.g. insert straight as 'delivered' to trigger mail).
-- Now: guests may only create PENDING orders; staff = rows in public.admins.
-- >>> Make sure your admin user is in public.admins BEFORE running this, or
-- >>> the admin orders pages will show an empty list (see setup doc).

drop policy if exists "public can insert orders" on public.orders;
drop policy if exists "public can insert pending orders" on public.orders;
create policy "public can insert pending orders" on public.orders
  for insert to anon, authenticated with check (status = 'pending');

drop policy if exists "staff can read orders" on public.orders;
create policy "staff can read orders" on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists "staff can update orders" on public.orders;
create policy "staff can update orders" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff can read order status history" on public.order_status_history;
create policy "staff can read order status history" on public.order_status_history
  for select to authenticated using (public.is_admin());
