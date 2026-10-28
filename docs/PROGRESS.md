# Progress note — admin persistence branch

For whoever resumes this work. Branch: `feature/admin-persistence-complete`
(worktree `D:/Projects/Taybah-fix`). Do NOT push, merge to `main`, deploy, or
run any production SQL — see `docs/PRODUCTION_RUNBOOK.md` for the gated steps.

## In-store orders (local, NOT committed or applied)

- «إضافة طلب» on the Orders page (`/admin/orders/new`): pick products/variants,
  quantities, retail-price totals, optional customer + note; unavailable
  products can be sold with a warning. Saved by direct insert, then read back.
- Migration `0008_in_store_orders.sql`: `orders.source` / `note`, status `sold`
  («تم البيع»), admin-only insert policy + server-side price/total validation,
  no e-mail for in-store orders. Not applied anywhere — see Runbook Phase F.
- Tests: `supabase/tests/in-store-orders.test.ts` (real Postgres),
  `inStoreOrderStore.test.ts`, `InStoreOrderPage.test.tsx`,
  `OrdersPage.inStore.test.tsx`.

## Done (committed)

- Dimensions/options guard (`/admin/products/<id>/edit`): before the catalog
  migration is activated, the option manager (ألوان/خامات/مقاسات) shows the
  reason up front and disables add/save/delete instead of failing on save.
  Local browser persistence is deliberately NOT used — the product on screen
  is the built-in demo copy and `taybah:catalog` is read-only migration
  input. Tests: `ProductFormPage.dimensions.test.tsx`.
- DB-enforced SKU uniqueness: `catalog_skus` registry + `catalog_write`
  (CF005) + `catalog_import` (`sku_taken`, `sku_duplicate_in_product`) in
  migration `0006`; `duplicate_sku` error code in `errors.ts`; stale-tab
  resync in `catalogDocs.doWrite`; mock parity in `client.mock.ts`.
- Migration UI: `SkuResolution.tsx` — explicit admin-typed SKU replacements;
  unresolved duplicates block execution; backup ZIP keeps original values.
- Media library: local `local:` image deletion is blocked until
  `catalog_initialized` (`imageDeletionUnverifiedReason`), and raw legacy
  localStorage is substring-scanned for references before any deletion.
- Runbook: C3 rollback now warns that rolling back `0005` stops order emails
  until `0002`'s trigger is reapplied; full-removal list covers
  `catalog_skus` + helpers.
- Migration page: when `0006` is not applied (`docs.schemaMissing`) it shows the
  exact SQL-Editor steps, and dry run / import / activation are disabled (backup
  stays available). Test: `AdminMigrationPage.test.tsx` ("schema missing").
- Review of `0006` (read, not executed): depends only on 0001 `touch_updated_at`
  and 0003 `is_admin()`, NOT on 0005. Applying it creates tables, functions and
  policies only; no catalog data is imported and the `catalog_initialized` flag
  stays unset, so the storefront keeps serving the built-in catalog. The only DML
  at apply time is the `catalog_skus` backfill from the (empty) `catalog_docs`.
  Rollback = comment block at the end of the file; dropping `catalog_docs`
  destroys saved catalog data (export first).

## Verified locally (never on real Supabase)

- `npm test`: 777/777 (46 files; re-run 2026-10-24), incl. PGlite suite `supabase/tests/`.
- `npm run typecheck`: clean. `npm run lint`: clean (1 pre-existing warning
  in `PageTransition.tsx`). `npm run build`: passes.
- Known flake: `CheckoutPage.test.tsx` typing-heavy tests can time out under
  full-suite parallel load; they pass in isolation and in re-runs.

## Audit completed (read-only code review, 2026-10-24)

- Media: uploads validate type by magic bytes, 5 MB cap, never `upsert`, unique
  generated paths, and are read back (`verifyObject`); bucket + admin-only
  write policies come from 0003. Orphaned uploads (upload ok, record save
  failed) are possible and harmless; remove them in the Supabase Storage UI.
- Orders: `updateOrderStatus` is conditional on the status the admin saw and
  never reports success on zero rows (classifies unauthorized / conflict /
  not_found); load errors surface as an error state, not an empty list;
  checkout retry treats `orders_pkey` conflict as already-created (client-
  generated id), so no duplicate order or email (outbox `history_id` UNIQUE).
- 0005: depends on 0001 + 0003, aborts if `public.admins` is empty, drops the
  0002 trigger, locks orders to admins / pending-only anon inserts, adds
  outbox + worker RPCs (service_role only) + admin retry. Edge Function checks
  a timing-safe shared secret, returns counts only in logs.
- CI: workflow now runs `npm test` before build (local change, not pushed).
- NOT verifiable locally: real RLS on hosted Supabase, pg_net/pg_cron/Vault,
  Resend delivery, Storage on the real bucket, PostgREST schema-cache timing.

## Remaining

- Production rollout is untouched and gated behind `docs/PRODUCTION_RUNBOOK.md`
  phases 0→E (migrations 0006 + 0005, Edge Function deploy, Resend, end-to-end
  verification). Requires owner approval — never run autonomously.
- Live verification of real Supabase writes is still pending by design.

Last updated: after the dimensions fix + SKU registry session (2026-10-24).
