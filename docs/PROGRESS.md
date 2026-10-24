# Progress note — admin persistence branch

For whoever resumes this work. Branch: `feature/admin-persistence-complete`
(worktree `D:/Projects/Taybah-fix`). Do NOT push, merge to `main`, deploy, or
run any production SQL — see `docs/PRODUCTION_RUNBOOK.md` for the gated steps.

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

## Remaining

- Production rollout is untouched and gated behind `docs/PRODUCTION_RUNBOOK.md`
  phases 0→E (migrations 0006 + 0005, Edge Function deploy, Resend, end-to-end
  verification). Requires owner approval — never run autonomously.
- Live verification of real Supabase writes is still pending by design.

Last updated: after the dimensions fix + SKU registry session (2026-10-24).
