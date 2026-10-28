-- Taybah — owner notifications, part 2: EVERYTHING another admin changes.
-- Run once in the Supabase Dashboard, AFTER 0011: SQL Editor > New query > paste > Run.
-- Requires 0011 (activity_log). Re-runnable.
--
-- 0011 covered stock, product price / wholesale price / visibility / create / delete, order
-- status and in-store sales. This adds:
--   • product_updated   any other field of a product (name, description, images, variants...)
--   • doc_created / doc_updated / doc_deleted   categories, collections, attributes, navigation
--   • home_changed      a homepage section
--   • media_uploaded / media_deleted   the image library
--   • order_note        an order's note
--
-- Not to flood the owner, repeated changes are MERGED into the existing notification when the
-- same account does them again within 30 seconds (it jumps back to "new" with the latest
-- values and keeps the first "from"): ten category edits while reordering are one line.

do $$
begin
  if to_regclass('public.activity_log') is null then
    raise exception 'ABORT: migration 0012 needs public.activity_log (0011). Nothing was changed.';
  end if;
end;
$$;

-- ============================================================================
-- 1. More kinds
-- ============================================================================

alter table public.activity_log drop constraint if exists activity_log_kind_check;
alter table public.activity_log
  add constraint activity_log_kind_check check (kind in (
    'stock_changed', 'stock_tracked', 'stock_untracked',
    'price_changed', 'wholesale_changed', 'visibility_changed',
    'product_created', 'product_deleted', 'product_updated',
    'doc_created', 'doc_updated', 'doc_deleted',
    'home_changed', 'media_uploaded', 'media_deleted',
    'order_status', 'order_note', 'in_store_sale'
  ));

-- ============================================================================
-- 2. The writer, now with merging
-- ============================================================================

create or replace function public.activity_log_event(p_kind text, p_subject text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_id bigint;
  v_old jsonb;
  v_names jsonb;
begin
  if v_actor = '' or v_actor = 'nehro@info.com' then
    return;
  end if;

  if p_kind in ('doc_created', 'doc_updated', 'doc_deleted') then
    -- One line per kind of document: «edited 3 categories: A, B, C»
    select id, detail into v_id, v_old
      from public.activity_log
     where actor = v_actor and kind = p_kind
       and detail ->> 'docKind' = v_detail ->> 'docKind'
       and created_at > now() - interval '30 seconds'
     order by id desc limit 1;
    if found then
      v_names := coalesce(v_old -> 'names', '[]'::jsonb);
      if jsonb_array_length(v_names) < 5 and not (v_names ? (v_detail ->> 'name')) then
        v_names := v_names || jsonb_build_array(v_detail ->> 'name');
      end if;
      update public.activity_log
         set created_at = now(), seen_at = null,
             detail = v_old || jsonb_build_object(
               'count', coalesce((v_old ->> 'count')::integer, 1) + 1, 'names', v_names)
       where id = v_id;
      return;
    end if;
    v_detail := v_detail || jsonb_build_object('count', 1, 'names', jsonb_build_array(v_detail ->> 'name'));
  else
    -- Same account, same kind, same subject, within 30 s: one notification, latest values.
    select id, detail into v_id, v_old
      from public.activity_log
     where actor = v_actor and kind = p_kind and subject is not distinct from p_subject
       and created_at > now() - interval '30 seconds'
     order by id desc limit 1;
    if found then
      if v_old ? 'from' then
        v_detail := v_detail || jsonb_build_object('from', v_old -> 'from');
      end if;
      if jsonb_typeof(v_old -> 'fields') = 'array' and jsonb_typeof(v_detail -> 'fields') = 'array' then
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_names
          from jsonb_array_elements((v_old -> 'fields') || (v_detail -> 'fields')) x;
        v_detail := v_detail || jsonb_build_object('fields', v_names);
      end if;
      update public.activity_log
         set created_at = now(), seen_at = null, detail = v_detail
       where id = v_id;
      return;
    end if;
  end if;

  insert into public.activity_log (actor, kind, subject, detail)
  values (v_actor, p_kind, p_subject, v_detail);
end;
$$;

revoke execute on function public.activity_log_event(text, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. Catalog documents: every kind, every change
-- ============================================================================

create or replace function public.log_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.catalog_docs;
  v_name text;
  v_fields jsonb;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_name := coalesce(v_row.data -> 'name' ->> 'ar', v_row.data -> 'label' ->> 'ar', v_row.id);

  if tg_op = 'INSERT' then
    if new.kind = 'product' then
      perform public.activity_log_event('product_created', new.id,
        jsonb_build_object('name', v_name, 'price', new.data -> 'price'));
    else
      perform public.activity_log_event('doc_created', new.id,
        jsonb_build_object('docKind', new.kind, 'name', v_name));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.kind = 'product' then
      perform public.activity_log_event('product_deleted', old.id, jsonb_build_object('name', v_name));
    else
      perform public.activity_log_event('doc_deleted', old.id,
        jsonb_build_object('docKind', old.kind, 'name', v_name));
    end if;
    return old;
  end if;

  -- UPDATE
  if new.kind = 'product' then
    if (old.data -> 'price') is distinct from (new.data -> 'price') then
      perform public.activity_log_event('price_changed', new.id,
        jsonb_build_object('name', v_name, 'from', old.data -> 'price', 'to', new.data -> 'price'));
    end if;
    if old.visible is distinct from new.visible then
      perform public.activity_log_event('visibility_changed', new.id,
        jsonb_build_object('name', v_name, 'visible', new.visible));
    end if;
    if jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object' then
      select coalesce(jsonb_agg(ks.k order by ks.k), '[]'::jsonb) into v_fields
        from (
          select jsonb_object_keys(old.data) as k
          union
          select jsonb_object_keys(new.data)
        ) ks
       where ks.k <> 'price' and (old.data -> ks.k) is distinct from (new.data -> ks.k);
      if jsonb_array_length(v_fields) > 0 then
        perform public.activity_log_event('product_updated', new.id,
          jsonb_build_object('name', v_name, 'fields', v_fields));
      end if;
    end if;
  elsif old.data is distinct from new.data or old.visible is distinct from new.visible then
    perform public.activity_log_event('doc_updated', new.id,
      jsonb_build_object('docKind', new.kind, 'name', v_name));
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 4. Orders: a changed note too
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
      perform public.activity_log_event('in_store_sale', new.ref, jsonb_build_object('total', new.total));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public.activity_log_event('order_status', new.ref,
      jsonb_build_object('from', old.status, 'to', new.status, 'source', new.source));
  end if;
  if new.note is distinct from old.note then
    perform public.activity_log_event('order_note', new.ref, '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_log_activity on public.orders;
create trigger orders_log_activity
  after insert or update of status, note on public.orders
  for each row execute function public.log_order_activity();

-- ============================================================================
-- 5. Homepage sections
-- ============================================================================

create or replace function public.log_home_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.data is not distinct from old.data
     and new.enabled is not distinct from old.enabled
     and new.display_order is not distinct from old.display_order then
    return new;
  end if;
  perform public.activity_log_event('home_changed', coalesce(new.id, old.id),
    jsonb_build_object('enabled', coalesce(new.enabled, old.enabled)));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.home_sections') is not null then
    drop trigger if exists home_sections_log_activity on public.home_sections;
    create trigger home_sections_log_activity
      after insert or update or delete on public.home_sections
      for each row execute function public.log_home_change();
  end if;
end;
$$;

-- ============================================================================
-- 6. Image library (storage). Skipped quietly if this project does not let SQL add
-- a trigger on storage.objects — everything else still works.
-- ============================================================================

create or replace function public.log_media_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.bucket_id = 'storefront-media' then
      perform public.activity_log_event('media_uploaded', new.name, '{}'::jsonb);
    end if;
    return new;
  end if;
  if old.bucket_id = 'storefront-media' then
    perform public.activity_log_event('media_deleted', old.name, '{}'::jsonb);
  end if;
  return old;
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop trigger if exists storage_objects_log_activity on storage.objects;
    create trigger storage_objects_log_activity
      after insert or delete on storage.objects
      for each row execute function public.log_media_change();
  end if;
exception when others then
  raise notice 'image-library notifications skipped: %', sqlerrm;
end;
$$;

-- ============================================================================
-- Rollback (NOT executed automatically): back to the 0011 behaviour.
-- ============================================================================
--   drop trigger if exists storage_objects_log_activity on storage.objects;
--   drop trigger if exists home_sections_log_activity on public.home_sections;
--   drop function if exists public.log_media_change();
--   drop function if exists public.log_home_change();
--   -- then re-run 0011 to restore the narrower log_product_change / log_order_activity /
--   -- activity_log_event, and delete the new kinds from activity_log first.
