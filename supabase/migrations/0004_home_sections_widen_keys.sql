-- 0003's home_sections.id CHECK only listed the seven original section ids —
-- the homepage has since grown four more ('shopCategories', 'collections',
-- 'bestSellers', 'story'; see HomeSectionKey in src/features/storefront/home/
-- homeStore.ts), so any upsert carrying them is rejected outright.
--
-- Run this once in the Supabase Dashboard: Project > SQL Editor > New query > paste > Run.
--
-- Rather than pinning a new hard-coded list (which would need another
-- migration for every future section), the CHECK is dropped entirely —
-- referential integrity doesn't depend on it, and the app layer already
-- validates keys against HOME_SECTION_KEYS.

alter table public.home_sections drop constraint if exists home_sections_id_check;
