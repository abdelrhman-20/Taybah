-- Taybah — catalog, homepage, and navigation schema (Phase 1: schema +
-- storage + RLS only — no data is seeded or migrated here; that is the
-- separate data-migration utility described alongside this file).
--
-- Run this once in the Supabase Dashboard: Project > SQL Editor > New query > paste > Run.
--
-- Purely additive: creates new tables/functions/a storage bucket. Touches
-- nothing in 0001_orders.sql / 0002_order_status_email_trigger.sql — orders
-- store a denormalized snapshot (jsonb) and have no FK into this schema, so
-- this migration can be rolled back independently (see the bottom of this
-- file for the rollback script, kept as a comment — not run automatically).

-- ============================================================================
-- 1. Admin allowlist — explicit, not "any authenticated user"
-- ============================================================================

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Deliberately zero policies: deny-all for every client role, admins
-- included. Managed only via SQL Editor by the project owner, e.g.:
--   insert into public.admins (user_id) values ('<auth user uuid>');

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Postgres grants EXECUTE to PUBLIC by default on a newly created function —
-- revoke that first, then grant only to the roles that actually need to
-- evaluate it inside RLS policies.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ============================================================================
-- 2. Core catalog tables
-- ============================================================================

create type public.availability_status as enum ('in_stock', 'low_stock', 'out_of_stock');

create table public.categories (
  slug text primary key,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  image_storage_path text,
  visible boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collections (
  slug text primary key,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  image_storage_path text,
  visible boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attributes (
  key text primary key,
  label_ar text not null,
  label_en text not null,
  kind text not null check (kind in ('color', 'material', 'size', 'custom'))
);

create table public.attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_key text not null references public.attributes (key) on delete cascade,
  value_key text not null,
  label_ar text not null,
  label_en text not null,
  hex text,
  display_order int not null default 0,
  unique (attribute_key, value_key)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  sku text unique not null,
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  category_slug text references public.categories (slug) on delete restrict,
  collection_slug text references public.collections (slug) on delete set null,
  price numeric(12, 2) not null check (price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  availability public.availability_status not null default 'in_stock',
  -- Additive only — does not change existing (manual) availability
  -- semantics. Null means "not tracked numerically", same as today.
  stock_quantity int check (stock_quantity is null or stock_quantity >= 0),
  featured boolean not null default false,
  published boolean not null default true,
  is_new boolean not null default false,
  variant_axes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category_slug);
create index products_collection_idx on public.products (collection_slug);
create index products_published_idx on public.products (published);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text unique not null,
  combo jsonb not null,
  price numeric(12, 2) check (price is null or price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  availability public.availability_status not null default 'in_stock',
  stock_quantity int check (stock_quantity is null or stock_quantity >= 0),
  active boolean not null default true
);

create index product_variants_product_idx on public.product_variants (product_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  storage_path text not null,
  alt_ar text,
  alt_en text,
  -- sort_order 0 = cover/primary image, 1 = the "hover" image ProductCard
  -- swaps in — mirrors the current `images[0]`/`images[1]` = `image`/
  -- `imageHover` convention exactly (verified against ProductCard.tsx and
  -- catalogData.ts before writing this), so storefront behavior is
  -- unchanged once the store layer reads from this table.
  sort_order int not null default 0,
  is_primary boolean not null default false,
  constraint product_images_single_owner check (
    (product_id is not null and variant_id is null) or
    (product_id is null and variant_id is not null)
  )
);

create index product_images_product_idx on public.product_images (product_id);
create index product_images_variant_idx on public.product_images (variant_id);

create unique index product_images_one_primary_per_product
  on public.product_images (product_id)
  where is_primary and product_id is not null;

create unique index product_images_one_primary_per_variant
  on public.product_images (variant_id)
  where is_primary and variant_id is not null;

create table public.product_attribute_values (
  product_id uuid references public.products (id) on delete cascade,
  attribute_key text not null,
  value_key text not null,
  primary key (product_id, attribute_key, value_key),
  foreign key (attribute_key, value_key)
    references public.attribute_values (attribute_key, value_key)
);

-- ============================================================================
-- 3. Global SKU uniqueness (products + variants share one namespace)
-- ============================================================================
--
-- A check-then-insert approach has a real race window under concurrent
-- writes. This instead relies on a real unique index (sku_registry's PK),
-- which Postgres enforces atomically — two concurrent transactions
-- claiming the same SKU can't both succeed, full stop.

create table public.sku_registry (
  sku text primary key,
  owner_type text not null check (owner_type in ('product', 'variant')),
  product_id uuid references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  constraint sku_registry_owner_match check (
    (owner_type = 'product' and product_id is not null and variant_id is null) or
    (owner_type = 'variant' and variant_id is not null and product_id is null)
  )
);

create or replace function public.sync_sku_registry()
returns trigger
language plpgsql
-- sku_registry has RLS enabled with zero client policies (like admins
-- above) — without SECURITY DEFINER this trigger would run as the
-- invoking role (e.g. an admin's "authenticated" session) and its own
-- insert/delete into sku_registry would be silently blocked by that same
-- RLS, breaking every product/variant write. SECURITY DEFINER runs it as
-- the function's owner (the table owner), which bypasses RLS on its own
-- tables by default.
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_type text := case when TG_TABLE_NAME = 'products' then 'product' else 'variant' end;
  v_id uuid := coalesce(new.id, old.id);
begin
  if TG_OP = 'DELETE' then
    delete from public.sku_registry where
      (v_owner_type = 'product' and product_id = v_id) or
      (v_owner_type = 'variant' and variant_id = v_id);
    return old;
  end if;

  if TG_OP = 'UPDATE' then
    delete from public.sku_registry where
      (v_owner_type = 'product' and product_id = v_id) or
      (v_owner_type = 'variant' and variant_id = v_id);
  end if;

  insert into public.sku_registry (sku, owner_type, product_id, variant_id)
  values (
    new.sku,
    v_owner_type,
    case when v_owner_type = 'product' then v_id end,
    case when v_owner_type = 'variant' then v_id end
  );
  return new;
end;
$$;

-- Not meant to be called directly as an RPC — only the triggers below
-- invoke it. Revoke the default PUBLIC execute grant accordingly.
revoke execute on function public.sync_sku_registry() from public;

create trigger products_sku_registry
  after insert or update of sku or delete on public.products
  for each row execute function public.sync_sku_registry();

create trigger variants_sku_registry
  after insert or update of sku or delete on public.product_variants
  for each row execute function public.sync_sku_registry();

-- ============================================================================
-- 4. Homepage sections
-- ============================================================================

create table public.home_sections (
  id text primary key check (
    id in ('hero', 'categories', 'products', 'brand', 'editorial', 'collection', 'newsletter')
  ),
  enabled boolean not null default true,
  display_order int not null default 0,
  -- Mirrors each section's existing TS shape (HomeContent in homeStore.ts)
  -- field-for-field — the store layer reconstructs the same object the
  -- components already expect, so FeaturedCategories/HeroSection/etc. don't
  -- need to change when this replaces localStorage.
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. Navigation
-- ============================================================================

create table public.nav_items (
  id text primary key,
  parent_id text references public.nav_items (id) on delete cascade,
  "group" text not null check ("group" in ('main', 'footer')),
  label_ar text not null,
  label_en text,
  kind text not null check (kind in ('internal', 'external')),
  path text not null default '',
  visible boolean not null default true,
  display_order int not null default 0
);

create index nav_items_parent_idx on public.nav_items (parent_id);
create index nav_items_group_idx on public.nav_items ("group");

-- ============================================================================
-- 6. updated_at triggers — reuses the touch_updated_at() function already
--    created in 0001_orders.sql instead of redefining it.
-- ============================================================================

create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function public.touch_updated_at();

create trigger collections_touch_updated_at
  before update on public.collections
  for each row execute function public.touch_updated_at();

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

create trigger home_sections_touch_updated_at
  before update on public.home_sections
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================

alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.attributes enable row level security;
alter table public.attribute_values enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.home_sections enable row level security;
alter table public.nav_items enable row level security;

-- categories / collections: public reads visible rows; admins read/write everything.
create policy "public can read visible categories" on public.categories
  for select using (visible = true or public.is_admin());
create policy "admins can write categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public can read visible collections" on public.collections
  for select using (visible = true or public.is_admin());
create policy "admins can write collections" on public.collections
  for all using (public.is_admin()) with check (public.is_admin());

-- attributes / attribute_values: shared vocabulary, not draft content —
-- readable by everyone, writable by admins only.
create policy "public can read attributes" on public.attributes
  for select using (true);
create policy "admins can write attributes" on public.attributes
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public can read attribute values" on public.attribute_values
  for select using (true);
create policy "admins can write attribute values" on public.attribute_values
  for all using (public.is_admin()) with check (public.is_admin());

-- products: public reads published rows; admins read/write everything.
create policy "public can read published products" on public.products
  for select using (published = true or public.is_admin());
create policy "admins can write products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- product_variants / product_images / product_attribute_values: gated on
-- the parent product's published status, not just admin-only — a public
-- visitor reading a published product should see its variants/images/attrs.
create policy "public can read variants of published products" on public.product_variants
  for select using (
    public.is_admin() or exists (
      select 1 from public.products p where p.id = product_variants.product_id and p.published = true
    )
  );
create policy "admins can write product variants" on public.product_variants
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public can read images of published products" on public.product_images
  for select using (
    public.is_admin() or exists (
      select 1 from public.products p where p.id = product_images.product_id and p.published = true
    ) or exists (
      select 1 from public.product_variants v
      join public.products p on p.id = v.product_id
      where v.id = product_images.variant_id and p.published = true
    )
  );
create policy "admins can write product images" on public.product_images
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public can read attribute values of published products" on public.product_attribute_values
  for select using (
    public.is_admin() or exists (
      select 1 from public.products p where p.id = product_attribute_values.product_id and p.published = true
    )
  );
create policy "admins can write product attribute values" on public.product_attribute_values
  for all using (public.is_admin()) with check (public.is_admin());

-- home_sections: public reads enabled sections; admins read/write everything.
create policy "public can read enabled home sections" on public.home_sections
  for select using (enabled = true or public.is_admin());
create policy "admins can write home sections" on public.home_sections
  for all using (public.is_admin()) with check (public.is_admin());

-- nav_items: public reads visible items; admins read/write everything.
create policy "public can read visible nav items" on public.nav_items
  for select using (visible = true or public.is_admin());
create policy "admins can write nav items" on public.nav_items
  for all using (public.is_admin()) with check (public.is_admin());

-- sku_registry has no client-facing policies at all — direct client
-- reads/writes are denied unconditionally. The only writer is
-- sync_sku_registry(), which is SECURITY DEFINER and so bypasses this on
-- its own (see its definition above).
alter table public.sku_registry enable row level security;

-- ============================================================================
-- 8. Storage — one bucket, folder-per-type convention
--
-- This bucket is PUBLIC (readable by anyone with the URL) by design, for
-- storefront imagery only. Never upload anything private/sensitive here —
-- there is no per-object access control, only admin-gated writes.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('storefront-media', 'storefront-media', true)
on conflict (id) do nothing;

create policy "public can read storefront media" on storage.objects
  for select using (bucket_id = 'storefront-media');

create policy "admins can upload storefront media" on storage.objects
  for insert with check (bucket_id = 'storefront-media' and public.is_admin());

-- UPDATE policy is required for the storage client's `upsert: true` option
-- (re-uploading to an existing path updates the row rather than erroring) —
-- both INSERT and UPDATE must allow it for upsert to actually work.
create policy "admins can update storefront media" on storage.objects
  for update using (bucket_id = 'storefront-media' and public.is_admin())
  with check (bucket_id = 'storefront-media' and public.is_admin());

create policy "admins can delete storefront media" on storage.objects
  for delete using (bucket_id = 'storefront-media' and public.is_admin());

-- ============================================================================
-- Rollback (NOT executed automatically — run manually if needed).
-- Purely additive migration: nothing here is referenced by orders, so this
-- is safe to run standalone without touching 0001/0002.
-- ============================================================================
--
-- drop policy if exists "public can read storefront media" on storage.objects;
-- drop policy if exists "admins can upload storefront media" on storage.objects;
-- drop policy if exists "admins can update storefront media" on storage.objects;
-- drop policy if exists "admins can delete storefront media" on storage.objects;
-- -- Deleting the bucket row does NOT delete its objects — they would be
-- -- orphaned (or the delete may simply be refused while objects remain,
-- -- depending on Supabase storage version). Remove the objects first:
-- delete from storage.objects where bucket_id = 'storefront-media';
-- delete from storage.buckets where id = 'storefront-media';
--
-- drop table if exists public.sku_registry cascade;
-- drop function if exists public.sync_sku_registry() cascade;
-- drop table if exists public.nav_items cascade;
-- drop table if exists public.home_sections cascade;
-- drop table if exists public.product_attribute_values cascade;
-- drop table if exists public.product_images cascade;
-- drop table if exists public.product_variants cascade;
-- drop table if exists public.products cascade;
-- drop table if exists public.attribute_values cascade;
-- drop table if exists public.attributes cascade;
-- drop table if exists public.collections cascade;
-- drop table if exists public.categories cascade;
-- drop type if exists public.availability_status;
-- drop function if exists public.is_admin() cascade;
-- drop table if exists public.admins cascade;
