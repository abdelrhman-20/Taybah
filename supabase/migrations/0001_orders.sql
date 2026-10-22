-- Taybah — orders schema (v1: COD only, no payment provider yet).
-- Run this once in the Supabase Dashboard: Project > SQL Editor > New query > paste > Run.
--
-- Mirrors the existing frontend GuestOrder shape (src/features/storefront/
-- checkout/orderStore.ts) almost exactly, storing contact/address/delivery/
-- lines as jsonb rather than fully normalizing them — the admin UI and
-- checkout form already work entirely in terms of that nested shape, so
-- this keeps the database a drop-in replacement for the old localStorage
-- store instead of forcing a parallel data model.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  contact jsonb not null,
  address jsonb not null,
  delivery jsonb not null,
  lines jsonb not null,
  subtotal numeric(12, 2) not null,
  total numeric(12, 2) not null
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;

-- Checkout works without an account: anyone can create an order.
create policy "public can insert orders" on public.orders
  for insert to anon, authenticated with check (true);

-- Reading/updating orders is staff-only for v1 (any signed-in Supabase
-- Auth user = staff, since there is no role hierarchy yet). Create the
-- first admin login under Authentication > Users in the dashboard.
create policy "staff can read orders" on public.orders
  for select to authenticated using (true);

create policy "staff can update orders" on public.orders
  for update to authenticated using (true) with check (true);

create policy "staff can read order status history" on public.order_status_history
  for select to authenticated using (true);

-- Keep `updated_at` honest on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- Every status (including the initial 'pending') is logged automatically —
-- this is what the email-notification trigger (added separately, once the
-- email provider is wired up) will react to.
create or replace function public.log_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_status_history (order_id, status) values (new.id, new.status);
  return new;
end;
$$;

drop trigger if exists orders_log_created on public.orders;
create trigger orders_log_created
  after insert on public.orders
  for each row execute function public.log_order_created();

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status) values (new.id, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_log_status_change on public.orders;
create trigger orders_log_status_change
  after update on public.orders
  for each row execute function public.log_order_status_change();
