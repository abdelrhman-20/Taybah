-- Taybah — internal (admin-only) product pricing: wholesale price.
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0003 (admins / is_admin()) and 0006 (catalog_docs / catalog_write).
--
-- WHY A SEPARATE TABLE (and not a field inside catalog_docs.data):
-- catalog_docs is world-readable for visible rows — RLS is per ROW, not per
-- field, and the storefront fetches `data` in full. Any wholesale value placed
-- in a product document would be served to every visitor. Internal pricing
-- therefore lives in its own table that anon / non-admin roles cannot read at
-- all, and that no client can write directly.
--
-- READ:  admins only (RLS policy on is_admin(); anon has no privileges).
-- WRITE: only through catalog_write_product() below (SECURITY DEFINER,
--        is_admin() checked server-side). No INSERT/UPDATE/DELETE privilege
--        exists for any API role.
-- ATOMICITY: catalog_write_product() runs the EXISTING catalog_write() and the
--        wholesale upsert in one transaction, so the product (with its
--        revision check) and its wholesale price are saved together or not at
--        all. catalog_write() itself is untouched; every other write path
--        (attributes, categories, deletes, import) keeps calling it directly.
-- DELETE: the foreign key cascades, so deleting a product removes its price.

create table if not exists public.product_internal_pricing (
  kind text not null default 'product' check (kind = 'product'),
  product_id text primary key,
  -- A row exists only while a wholesale price is set; clearing it deletes the row.
  wholesale_price numeric(12, 2) not null check (wholesale_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (kind, product_id) references public.catalog_docs (kind, id) on delete cascade
);

drop trigger if exists product_internal_pricing_touch_updated_at on public.product_internal_pricing;
create trigger product_internal_pricing_touch_updated_at
  before update on public.product_internal_pricing
  for each row execute function public.touch_updated_at();

alter table public.product_internal_pricing enable row level security;

revoke all on table public.product_internal_pricing from anon, authenticated;
grant select on table public.product_internal_pricing to authenticated;

drop policy if exists "admins can read internal pricing" on public.product_internal_pricing;
create policy "admins can read internal pricing" on public.product_internal_pricing
  for select using (public.is_admin());

-- p_ops: exactly the array catalog_write() takes.
-- p_wholesale: null (leave pricing alone) or
--   { "product_id": "<id>", "price": <number >= 0 | null> }
--   price null clears the stored value. product_id must be a product that is
--   `put` in the same p_ops batch.
-- Returns catalog_write()'s result unchanged.
create or replace function public.catalog_write_product(p_ops jsonb, p_wholesale jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_results jsonb;
  v_pid text;
  v_price jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Validates p_ops, enforces revisions / slug / SKU rules, writes the docs.
  v_results := public.catalog_write(p_ops);

  if p_wholesale is not null then
    if jsonb_typeof(p_wholesale) <> 'object' then
      raise exception 'invalid_ops' using errcode = '22023', detail = 'wholesale must be an object';
    end if;
    v_pid := p_wholesale ->> 'product_id';
    v_price := p_wholesale -> 'price';

    if v_pid is null or not exists (
      select 1 from jsonb_array_elements(p_ops) o
       where o ->> 'op' = 'put' and o ->> 'kind' = 'product' and o ->> 'id' = v_pid
    ) then
      raise exception 'invalid_ops' using errcode = '22023',
        detail = 'wholesale product_id must be a product written in the same batch';
    end if;

    if v_price is null or jsonb_typeof(v_price) = 'null' then
      delete from public.product_internal_pricing where product_id = v_pid;
    elsif jsonb_typeof(v_price) <> 'number' or (v_price #>> '{}')::numeric < 0 then
      raise exception 'invalid_ops' using errcode = '22023',
        detail = 'wholesale price must be a number >= 0';
    else
      insert into public.product_internal_pricing (product_id, wholesale_price)
      values (v_pid, (v_price #>> '{}')::numeric)
      on conflict (product_id) do update set wholesale_price = excluded.wholesale_price;
    end if;
  end if;

  return v_results;
end;
$$;

revoke execute on function public.catalog_write_product(jsonb, jsonb) from public, anon;
grant execute on function public.catalog_write_product(jsonb, jsonb) to authenticated;

-- ============================================================================
-- Rollback (NOT executed automatically). Purely additive; destroys only the
-- wholesale prices — export them first if they matter.
-- ============================================================================
--   drop function if exists public.catalog_write_product(jsonb, jsonb);
--   drop table if exists public.product_internal_pricing;
