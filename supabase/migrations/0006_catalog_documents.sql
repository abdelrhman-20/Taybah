-- Taybah — persistent catalog / attributes / navigation (document store).
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run.
-- Requires 0001 (touch_updated_at) and 0003 (admins / is_admin()).
--
-- WHY A DOCUMENT TABLE (and not the normalized 0003 catalog tables):
-- The frontend's catalog model (CatalogProduct, AttributeDef, nav items) is
-- richer than 0003's typed columns: string product ids that orders already
-- reference, per-variant ids, free-form attribute assignments that must be
-- *preserved* even when unknown, `local:`/http/relative image refs, legacy
-- colors/materials/sizes fields. Typed FKs would reject or drop that data.
-- This follows the same precedent as `orders` (0001) and `home_sections`
-- (0003): the jsonb `data` column mirrors the TypeScript shape field for
-- field, and only what the database must enforce is promoted to columns
-- (visibility for RLS, slug uniqueness, ordering, revision for concurrency).
-- The 0003 catalog tables (products, categories, ...) stay in place, empty
-- and unused; nothing here touches or drops them.
--
-- WRITE PATH: clients have SELECT only. Every write goes through the
-- admin-only RPCs below, which (a) check is_admin() server-side, (b) apply
-- many records in ONE transaction, (c) reject stale writes via `revision`,
-- and (d) raise explicit errors instead of silently affecting zero rows.

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table if not exists public.catalog_docs (
  kind text not null
    check (kind in ('product', 'category', 'collection', 'attribute', 'nav')),
  id text not null check (char_length(id) between 1 and 200),
  -- products / categories / collections only: unique per kind
  slug text,
  -- products: published; categories/collections: visible; others: true.
  -- Public reads only see visible rows (RLS); admins see everything.
  visible boolean not null default true,
  sort_order integer not null default 0,
  -- Optimistic concurrency: a write must present the revision it read.
  revision integer not null default 1 check (revision >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

create unique index if not exists catalog_docs_slug_uq
  on public.catalog_docs (kind, slug) where slug is not null;
create index if not exists catalog_docs_kind_order_idx
  on public.catalog_docs (kind, sort_order);

drop trigger if exists catalog_docs_touch_updated_at on public.catalog_docs;
create trigger catalog_docs_touch_updated_at
  before update on public.catalog_docs
  for each row execute function public.touch_updated_at();

-- Tiny key/value table; today it only holds the catalog cutover flag.
-- NOTHING SENSITIVE may ever be stored here: the flag row is world-readable.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. RLS: public read of visible rows, no direct client writes at all
-- ============================================================================

alter table public.catalog_docs enable row level security;
alter table public.app_settings enable row level security;

revoke all on table public.catalog_docs from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;
grant select on table public.catalog_docs to anon, authenticated;
grant select on table public.app_settings to anon, authenticated;

drop policy if exists "public can read visible catalog docs" on public.catalog_docs;
create policy "public can read visible catalog docs" on public.catalog_docs
  for select using (visible = true or public.is_admin());

drop policy if exists "public can read catalog flag" on public.app_settings;
create policy "public can read catalog flag" on public.app_settings
  for select using (key = 'catalog_initialized' or public.is_admin());

-- ============================================================================
-- 2b. SKU registry — database-enforced global SKU uniqueness
-- ============================================================================
-- Product SKUs and every variant SKU (active or not) share ONE namespace,
-- compared after trim + lowercase — exactly the app's skuTaken()/normalizeSku()
-- rule. The registry is written ONLY by catalog_write / catalog_import
-- (SECURITY DEFINER); clients cannot touch it. Its primary key is what makes
-- the rule safe under concurrency: two transactions claiming the same SKU
-- cannot both commit (the second waits for the first, then fails with a
-- unique violation, which catalog_write reports as CF005 duplicate_sku).
-- The foreign key frees a product's SKUs automatically when it is deleted.

create or replace function public.catalog_normalize_sku(p text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(coalesce(p, ''), '^\s+|\s+$', '', 'g')), '')
$$;

-- Every non-empty normalized SKU in a product document: its own (variant_id
-- null) plus one per variant. Malformed variants are ignored, never an error.
create or replace function public.catalog_product_skus(p_data jsonb)
returns table (sku text, variant_id text)
language sql
immutable
as $$
  select public.catalog_normalize_sku(p_data ->> 'sku') as sku, null::text as variant_id
   where public.catalog_normalize_sku(p_data ->> 'sku') is not null
  union all
  select public.catalog_normalize_sku(v ->> 'sku'), v ->> 'id'
    from jsonb_array_elements(
           case when jsonb_typeof(p_data -> 'variants') = 'array'
                then p_data -> 'variants' else '[]'::jsonb end
         ) v
   where jsonb_typeof(v) = 'object'
     and public.catalog_normalize_sku(v ->> 'sku') is not null
$$;

create table if not exists public.catalog_skus (
  sku text primary key,
  kind text not null default 'product' check (kind = 'product'),
  product_id text not null,
  variant_id text,
  foreign key (kind, product_id) references public.catalog_docs (kind, id) on delete cascade
);

create index if not exists catalog_skus_product_idx on public.catalog_skus (product_id);

alter table public.catalog_skus enable row level security;
-- Deny-all for API roles: no policies, and no table privileges either.
revoke all on table public.catalog_skus from anon, authenticated;
revoke execute on function public.catalog_normalize_sku(text) from public, anon, authenticated;
revoke execute on function public.catalog_product_skus(jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. catalog_write — atomic, revision-checked, admin-only
-- ============================================================================
-- p_ops: [{ "op": "put",    "kind", "id", "expected_revision": null|int,
--           "slug", "visible", "sort_order", "data": {...} },
--         { "op": "delete", "kind", "id", "expected_revision": int }]
-- expected_revision null on a put = INSERT (fails if the id exists).
-- Returns [{ kind, id, revision, deleted }] in op order.
-- Errors (SQLSTATE / message):
--   42501 forbidden · 22023 invalid_ops · CF001 revision_conflict ·
--   CF002 not_found · CF003 already_exists · CF004 duplicate_slug ·
--   CF005 duplicate_sku

create or replace function public.catalog_write(p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op jsonb;
  v_kind text;
  v_id text;
  v_expected integer;
  v_rev integer;
  v_results jsonb := '[]'::jsonb;
  v_constraint text;
  v_put_products text[] := '{}';
  v_detail text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array'
     or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 500 then
    raise exception 'invalid_ops' using errcode = '22023';
  end if;

  for op in select * from jsonb_array_elements(p_ops) loop
    v_kind := op ->> 'kind';
    v_id := op ->> 'id';
    v_expected := nullif(op ->> 'expected_revision', '')::integer;

    if op ->> 'op' = 'put' then
      if jsonb_typeof(op -> 'data') is distinct from 'object' then
        raise exception 'invalid_ops' using errcode = '22023', detail = 'data must be an object';
      end if;
      begin
        if v_expected is null then
          insert into public.catalog_docs (kind, id, slug, visible, sort_order, data)
          values (
            v_kind, v_id, nullif(op ->> 'slug', ''),
            coalesce((op ->> 'visible')::boolean, true),
            coalesce((op ->> 'sort_order')::integer, 0),
            op -> 'data'
          )
          returning revision into v_rev;
        else
          update public.catalog_docs
             set slug = nullif(op ->> 'slug', ''),
                 visible = coalesce((op ->> 'visible')::boolean, true),
                 sort_order = coalesce((op ->> 'sort_order')::integer, 0),
                 data = op -> 'data',
                 revision = revision + 1
           where kind = v_kind and id = v_id and revision = v_expected
          returning revision into v_rev;
          if not found then
            if exists (select 1 from public.catalog_docs where kind = v_kind and id = v_id) then
              raise exception 'revision_conflict' using errcode = 'CF001', detail = v_kind || '/' || v_id;
            end if;
            raise exception 'not_found' using errcode = 'CF002', detail = v_kind || '/' || v_id;
          end if;
        end if;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'catalog_docs_slug_uq' then
          raise exception 'duplicate_slug' using errcode = 'CF004', detail = v_kind || '/' || coalesce(op ->> 'slug', '');
        end if;
        raise exception 'already_exists' using errcode = 'CF003', detail = v_kind || '/' || v_id;
      end;
      if v_kind = 'product' then
        v_put_products := v_put_products || v_id;
      end if;
      v_results := v_results || jsonb_build_object('kind', v_kind, 'id', v_id, 'revision', v_rev, 'deleted', false);

    elsif op ->> 'op' = 'delete' then
      delete from public.catalog_docs
       where kind = v_kind and id = v_id
         and (v_expected is null or revision = v_expected);
      if found then
        v_results := v_results || jsonb_build_object('kind', v_kind, 'id', v_id, 'revision', null, 'deleted', true);
      elsif exists (select 1 from public.catalog_docs where kind = v_kind and id = v_id) then
        raise exception 'revision_conflict' using errcode = 'CF001', detail = v_kind || '/' || v_id;
      else
        -- already gone: the requested end state holds, report it honestly
        v_results := v_results || jsonb_build_object('kind', v_kind, 'id', v_id, 'revision', null, 'deleted', false);
      end if;
    else
      raise exception 'invalid_ops' using errcode = '22023', detail = 'unknown op';
    end if;
  end loop;

  -- SKU registry: after ALL documents of the batch are written, replace the
  -- registry rows of every product that was written, in one pass. Doing it
  -- last (not per operation) lets two products swap SKUs inside one batch.
  -- Products deleted in this batch were already released by the foreign key.
  -- A clash rolls back the entire batch (this function is one statement).
  if array_length(v_put_products, 1) is not null then
    begin
      delete from public.catalog_skus where product_id = any (v_put_products);
      insert into public.catalog_skus (sku, product_id, variant_id)
      select s.sku, d.id, s.variant_id
        from public.catalog_docs d
        cross join lateral public.catalog_product_skus(d.data) s
       where d.kind = 'product' and d.id = any (v_put_products);
    exception when unique_violation then
      get stacked diagnostics v_detail = pg_exception_detail;
      raise exception 'duplicate_sku' using errcode = 'CF005', detail = coalesce(v_detail, '');
    end;
  end if;

  return v_results;
end;
$$;

-- ============================================================================
-- 4. catalog_import — idempotent, never overwrites, reports conflicts
-- ============================================================================
-- p_docs: [{ kind, id, slug, visible, sort_order, data }]
-- Absent  -> inserted (unless dry run)
-- Present and identical -> unchanged
-- Present and different, slug used by another id, or a SKU already owned by
-- another product (or repeated inside the batch / inside the product)
--   -> conflict (the existing record is never touched). Reasons:
--   different_data · slug_taken · sku_taken · sku_duplicate_in_product
-- Safe to re-run any number of times. Does NOT flip the cutover flag.

create or replace function public.catalog_import(p_docs jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb;
  v_kind text;
  v_id text;
  v_slug text;
  v_existing public.catalog_docs;
  v_inserted jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_skus text[];
  v_reason text;
  v_clash text;
  v_batch_skus jsonb := '{}'::jsonb;  -- sku -> id of the document that claimed it in THIS call
  v_constraint text;
  v_failed boolean;
  s text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_docs is null or jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) > 5000 then
    raise exception 'invalid_ops' using errcode = '22023';
  end if;

  for d in select * from jsonb_array_elements(p_docs) loop
    v_kind := d ->> 'kind';
    v_id := d ->> 'id';
    v_slug := nullif(d ->> 'slug', '');
    v_reason := null;
    v_clash := null;
    v_failed := false;

    select * into v_existing from public.catalog_docs where kind = v_kind and id = v_id;
    if found then
      if v_existing.data = d -> 'data'
         and v_existing.slug is not distinct from v_slug
         and v_existing.visible = coalesce((d ->> 'visible')::boolean, true) then
        v_unchanged := v_unchanged || jsonb_build_object('kind', v_kind, 'id', v_id);
      else
        v_conflicts := v_conflicts || jsonb_build_object('kind', v_kind, 'id', v_id, 'reason', 'different_data');
      end if;
      continue;
    end if;

    if v_slug is not null and exists (
      select 1 from public.catalog_docs where kind = v_kind and slug = v_slug
    ) then
      v_conflicts := v_conflicts || jsonb_build_object('kind', v_kind, 'id', v_id, 'reason', 'slug_taken');
      continue;
    end if;

    -- SKU checks for products that WOULD be inserted. Existing products are
    -- never touched, so their SKUs are only ever compared against.
    if v_kind = 'product' then
      select coalesce(array_agg(x.sku), '{}') into v_skus
        from public.catalog_product_skus(d -> 'data') x;

      -- (1) the document repeats a SKU itself (own SKU vs a variant, or two variants)
      select u.sku into v_clash
        from unnest(v_skus) as u(sku) group by u.sku having count(*) > 1 limit 1;
      if v_clash is not null then
        v_reason := 'sku_duplicate_in_product';
      else
        -- (2) a stored product already owns one of these SKUs
        select k.sku into v_clash from public.catalog_skus k
         where k.sku = any (v_skus) and k.product_id <> v_id limit 1;
        if v_clash is not null then
          v_reason := 'sku_taken';
        else
          -- (3) an earlier document of THIS import claimed it (keeps dry runs accurate)
          select u.sku into v_clash from unnest(v_skus) as u(sku)
           where (v_batch_skus ->> u.sku) is not null and (v_batch_skus ->> u.sku) <> v_id limit 1;
          if v_clash is not null then
            v_reason := 'sku_taken';
          end if;
        end if;
      end if;
    end if;

    if v_reason is not null then
      v_conflicts := v_conflicts || jsonb_build_object('kind', v_kind, 'id', v_id, 'reason', v_reason, 'sku', v_clash);
      continue;
    end if;

    if not p_dry_run then
      -- Own subtransaction: if a concurrent writer wins a slug/SKU between the
      -- checks above and here, BOTH inserts roll back and it is reported as a
      -- conflict instead of aborting the whole import.
      begin
        insert into public.catalog_docs (kind, id, slug, visible, sort_order, data)
        values (
          v_kind, v_id, v_slug,
          coalesce((d ->> 'visible')::boolean, true),
          coalesce((d ->> 'sort_order')::integer, 0),
          d -> 'data'
        );
        if v_kind = 'product' then
          insert into public.catalog_skus (sku, product_id, variant_id)
          select x.sku, v_id, x.variant_id from public.catalog_product_skus(d -> 'data') x;
        end if;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        v_failed := true;
        v_conflicts := v_conflicts || jsonb_build_object(
          'kind', v_kind, 'id', v_id,
          'reason', case when v_constraint = 'catalog_skus_pkey' then 'sku_taken' else 'slug_taken' end
        );
      end;
    end if;

    if not v_failed then
      if v_kind = 'product' then
        foreach s in array v_skus loop
          v_batch_skus := v_batch_skus || jsonb_build_object(s, v_id);
        end loop;
      end if;
      v_inserted := v_inserted || jsonb_build_object('kind', v_kind, 'id', v_id);
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'inserted', v_inserted,
    'unchanged', v_unchanged,
    'conflicts', v_conflicts
  );
end;
$$;

-- ============================================================================
-- 5. Cutover flag (storefront switches from built-in demo catalog to the DB)
-- ============================================================================

create or replace function public.catalog_mark_initialized()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.app_settings (key, value)
  values ('catalog_initialized', jsonb_build_object('at', now(), 'by', auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Rollback lever: storefront falls back to the built-in catalog again.
-- Deletes NO catalog data.
create or replace function public.catalog_unmark_initialized()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.app_settings where key = 'catalog_initialized';
end;
$$;

-- Registry backfill for product documents that exist without registry rows
-- (e.g. a database that ran an earlier revision of this migration). Idempotent.
-- Duplicates already present in the data cannot be registered twice: they are
-- reported, NOT silently dropped or rewritten — fix them, then re-run this block.
do $$
declare
  v_dups text;
begin
  select string_agg(q.sku || ' (' || q.owners || ')', '; ') into v_dups
    from (
      select s.sku, string_agg(d.id, ', ') as owners
        from public.catalog_docs d
        cross join lateral public.catalog_product_skus(d.data) s
       where d.kind = 'product'
       group by s.sku
      having count(*) > 1
    ) q;
  if v_dups is not null then
    raise notice 'catalog_skus backfill: DUPLICATE SKUs already exist in catalog_docs and were NOT registered: %', v_dups;
  end if;

  insert into public.catalog_skus (sku, product_id, variant_id)
  select s.sku, d.id, s.variant_id
    from public.catalog_docs d
    cross join lateral public.catalog_product_skus(d.data) s
   where d.kind = 'product'
     and s.sku not in (
       select sku from (
         select s2.sku from public.catalog_docs d2
           cross join lateral public.catalog_product_skus(d2.data) s2
          where d2.kind = 'product' group by s2.sku having count(*) > 1
       ) dup
     )
  on conflict (sku) do nothing;
end;
$$;

revoke execute on function public.catalog_write(jsonb) from public, anon;
revoke execute on function public.catalog_import(jsonb, boolean) from public, anon;
revoke execute on function public.catalog_mark_initialized() from public, anon;
revoke execute on function public.catalog_unmark_initialized() from public, anon;
grant execute on function public.catalog_write(jsonb) to authenticated;
grant execute on function public.catalog_import(jsonb, boolean) to authenticated;
grant execute on function public.catalog_mark_initialized() to authenticated;
grant execute on function public.catalog_unmark_initialized() to authenticated;

-- ============================================================================
-- Rollback (NOT executed automatically). Purely additive: nothing else
-- references these objects.
-- ============================================================================
--   drop function if exists public.catalog_unmark_initialized();
--   drop function if exists public.catalog_mark_initialized();
--   drop function if exists public.catalog_import(jsonb, boolean);
--   drop function if exists public.catalog_write(jsonb);
--   drop table if exists public.app_settings;
--   drop table if exists public.catalog_skus;   -- derived data; rebuilt by the backfill block
--   drop function if exists public.catalog_product_skus(jsonb), public.catalog_normalize_sku(text);
--   drop table if exists public.catalog_docs;   -- DESTROYS saved catalog data: export first
