# Progress note — admin persistence branch

For whoever resumes this work. Branch: `feature/admin-persistence-complete`
(worktree `D:/Projects/Taybah-fix`). Do NOT push, merge to `main`, deploy, or
run any production SQL — see `docs/PRODUCTION_RUNBOOK.md` for the gated steps.

## Inventory phase 1 (local, NOT committed or applied)

- `supabase/migrations/0009_inventory.sql`: stock balances, append-only ledger,
  order reconciliation decisions, override-grant audit table, admin operations,
  order-history preflight report and reconciliation. Touches NO order behaviour.
- Hardened after review: strict idempotency payload comparison, user-key format
  (no `:`), catalog snapshot refresh, stricter guard (catalog flag object, valid
  product, no `CREATE` for untrusted roles), `service_role` write privileges and
  the ledger sequence revoked, narrowed `inventory_actor_email`.
- Inventory UI (local): `/admin/inventory` and `/admin/inventory/movements`
  (`src/features/admin/inventory/`), sidebar «المخزون». Writes only through the five
  approved RPCs; `/admin/inventory/reconciliation` (blockers, per-order decisions bound to
  `lines_hash`, opening-balance dry-run/import). Setup and the exact limits of what was
  verified: `docs/INVENTORY_SETUP.md`.
- Tests: `supabase/tests/inventory.test.ts` and `inventory.hardening.test.ts` (real
  Postgres via PGlite; the harness gained `auth.jwt()` and default sequence
  privileges). **Concurrency is unverified** — see DATABASE_SCHEMA.md.
- Inventory phase 2 (local, NOT applied): `supabase/migrations/0010_inventory_orders.sql` —
  online orders deduct on entering `delivered`, in-store `sold` deducts at creation, atomic,
  idempotent, per-product aggregation, audited admin shortage override, fail-closed
  activation guard (applying it IS the activation). UI: shortage override dialog on the
  order and in-store pages. Tests: `supabase/tests/inventory.orders.test.ts` (PGlite),
  `*.stock.test.tsx`, `InventoryReconciliationPage.test.tsx`. Multi-connection checks
  `supabase/tests/concurrency/inventory.concurrency.ts` are written but **never run**.
  Procedure: `docs/PRODUCTION_RUNBOOK.md` Phase G (**not executed**).

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

## Inventory — upload and release notes (prepared locally; nothing committed)

**Pushing to `main` publishes the site; it never touches the database.**
`.github/workflows/deploy.yml` runs on every push to `main`: `npm ci` -> `npm test` ->
`npm run build` -> GitHub Pages. There is no Supabase/migration step anywhere, so uploading
`0009`/`0010` to GitHub does NOT apply them; they run only when someone pastes them into the
SQL Editor. The published app is safe before the migrations exist: the inventory pages show
"migration missing" (no numbers), order pages behave as today (the shortage dialog only
appears after `0010` raises IS002), checkout is unchanged.
`npm test` must be green before a deploy; the default 5 s test timeout was raised to 30 s
(`vitest.config.ts`) because ~66 parallel files booting PGlite/jsdom timed out in CI-like load
(`npm test` was then green 3 times in a row). The multi-connection suite is NOT in `npm test`.

Suggested commits (a single commit is also fine; none have been made):
1. `feat(inventory): schema, ledger and admin operations (migration 0009)` —
   `supabase/migrations/0009_inventory.sql`, `supabase/tests/{pg.ts,inventory.test.ts,inventory.hardening.test.ts}`.
2. `feat(inventory): stock deduction from orders (migration 0010, not applied)` —
   `supabase/migrations/0010_inventory_orders.sql`, `supabase/tests/inventory.orders.test.ts`,
   `supabase/tests/concurrency/`, `vitest.concurrency.config.ts`, `package.json`.
3. `feat(inventory): admin UI, reconciliation and shortage override` — `src/**` (inventory
   folder, orders pages, `orderStore.ts`, `errors.ts`, router/nav, `client.mock.ts`, new tests)
   and `vitest.config.ts`.
4. `docs(inventory): setup, schema, runbook, progress` — `docs/*`.
Safest order: push 1-4 together or 4 last; the app is safe without the migrations either way.
Do NOT apply 0009/0010 until `docs/PRODUCTION_RUNBOOK.md` Phase G and the checklist in
`docs/INVENTORY_SETUP.md` are complete.
