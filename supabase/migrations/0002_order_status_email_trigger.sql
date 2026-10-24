-- SUPERSEDED by 0005_order_email_outbox.sql, which drops this trigger. Kept only as history;
-- do not run it on a fresh project (it hardcodes a key and has no retry/auth).
-- Order-status email notifications, implemented directly with pg_net
-- instead of the Database Webhooks UI feature — that feature was failing
-- to create hooks on this project ("schema supabase_functions does not
-- exist", a Supabase platform-side issue at the time this was written).
-- This does the same thing a Webhook would: fire an HTTP POST at the
-- send-order-status-email Edge Function on every insert into
-- order_status_history (i.e. on order creation and every status change,
-- per the triggers in 0001_orders.sql).
--
-- Run this once in the Supabase Dashboard: Project > SQL Editor > New query > paste > Run.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_order_status_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://mrnndtvhtxdjvpefayxa.supabase.co/functions/v1/send-order-status-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_LgkzUxc1IYga9d87AjLEyA_nKE7W7v-'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'order_status_history',
      'record', jsonb_build_object(
        'id', new.id,
        'order_id', new.order_id,
        'status', new.status,
        'created_at', new.created_at
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists order_status_history_notify_email on public.order_status_history;
create trigger order_status_history_notify_email
  after insert on public.order_status_history
  for each row execute function public.notify_order_status_email();
