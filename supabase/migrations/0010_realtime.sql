-- Taybah — live updates: tell Supabase Realtime to broadcast changes of the tables the app
-- keeps on screen, so open pages update by themselves (no refresh).
-- Run once in the Supabase Dashboard: SQL Editor > New query > paste > Run. Re-runnable.
--
-- Realtime applies each table's row-level security: visitors only receive catalog rows
-- they may read, and only admins receive orders. Nothing new becomes readable.
-- (public.stock is NOT published: clients have no read access to it. The storefront
-- re-reads stock_availability() every 30 s instead.)

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'ABORT: publication supabase_realtime not found — enable Realtime for the project first. Nothing was changed.';
  end if;
  foreach t in array array['catalog_docs', 'orders'] loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Rollback (NOT executed automatically):
--   alter publication supabase_realtime drop table public.catalog_docs;
--   alter publication supabase_realtime drop table public.orders;
