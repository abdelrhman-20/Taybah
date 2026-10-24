# Admin persistence — audit, root causes, architecture

This document records what was wrong with the admin panel's saving, what was
changed, and where every piece of admin data now lives. Operational steps
(migrations, deployment, rollback) are in
[PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md); order emails are in
[ORDER_EMAIL_SETUP.md](./ORDER_EMAIL_SETUP.md).

## 1. The reported problem and its causes

> "Admin changes don't consistently persist; I have to save repeatedly; a
> private window shows the same."

A private window starts with empty browser storage. Anything that was only in
`localStorage` / IndexedDB therefore "disappears" — so that observation did not
prove or disprove a database fault; it pointed at *where the data lived*.

### Confirmed root causes (code defects)

| # | Severity | Cause | Where |
|---|---|---|---|
| 1 | Critical | Products, categories, collections, attributes and navigation were saved **only in the browser** (`localStorage`). Uploaded images were stored **only in the browser's IndexedDB**. Nothing was shared across browsers/devices; a private window showed the built-in demo data. | `catalogStore`, `attributeStore`, `navStore`, `imageStore` |
| 2 | Critical | `localStorage` write failures (quota, blocked storage) were caught and ignored: the UI showed the edit, a reload lost it, no error. | same stores |
| 3 | High | Homepage store **applied the edit locally before the server confirmed it**, so a failed save looked saved until the next fetch reverted it. | `homeStore.persistImpl` |
| 4 | High | Homepage saves were built from a possibly stale in-memory copy and wrote **all 11 rows** → could overwrite newer data (other sections, other admins). | `homeStore` |
| 5 | High | The section editor copied its draft once at mount; a later server refresh left it editing stale content. | `HomeSectionEditPage` |
| 6 | High | Hidden sections are invisible to a not-yet-authenticated read and were filled with defaults; a save could write those defaults over the real rows. | `homeStore.homeContentFromRows` |
| 7 | High | Order status update ignored the affected-row count. Under RLS a denied update matches **zero rows without an error**, so the UI reported success and the database did not change. | `orderStore.updateOrderStatus` |
| 8 | Medium | Admin UI accepted any signed-in Supabase user; non-admins saw a full panel where every save failed or silently no-opped. | `AdminLayout` |
| 9 | Medium | A failed order load was shown as an **empty list / zero orders** (orders list, dashboard). | `orderStore`, `OrdersPage`, dashboard |
| 10 | Medium | Deleting a seeded size value was undone on every read (`migrate()` re-added missing defaults). | `attributeStore.migrate` |
| 11 | Medium | Login button stuck on "جارٍ الدخول" if the request threw; `getSession()` failure left an infinite spinner; sign-out failure was unhandled. | login page, `useAdminSession`, topbar |

### Configuration/migration problems (not code defects)

* Migration `0006` (catalog tables) and `0005` (email outbox + order lockdown)
  were **not applied** to production. Code that required the tables took the
  live storefront down (see commit `733010a`); it now falls back to the
  built-in catalog when the tables are missing.
* `public.admins` membership of the real admin user is unverified from outside
  the database (it is deny-all to the API). It must be checked before `0005`.

## 2. Where each admin module's data lives now

| Module | Source of truth | Write path | Authorization |
|---|---|---|---|
| Homepage sections | `home_sections` | `homeStore.persistEdit`: admin check → fresh read → write only changed rows → read-back → replace local state | RLS `is_admin()` + UI gate |
| Products, variants, prices, stock, availability | `catalog_docs` (kind `product`) | `catalog_write` RPC (revision-checked, atomic) | RPC checks `is_admin()`; clients have SELECT only |
| Categories, collections | `catalog_docs` (`category`, `collection`) | same | same |
| Attributes (colors, sizes, …) | `catalog_docs` (`attribute`) | same | same |
| Navigation (main + footer links) | `catalog_docs` (`nav`) | same | same |
| Product/category/homepage images | Supabase Storage bucket `storefront-media` (`media:<path>` refs) | `uploadImage` (validate → upload → verify) | storage RLS admin-only writes (migration 0003) |
| Orders, order status | `orders`, `order_status_history` | conditional update + `select()` + verification | RLS admin-only after `0005` |
| Order emails | `order_email_outbox` | DB trigger → Edge Function worker; admin retry RPC | admin read; service role writes |
| Migration / backup | n/a (tooling) | `catalog_import` RPC (never overwrites) | admin-only |

### Not implemented (and why)

* **Store settings / contact details / footer contact info / announcement bar**:
  hotline, social links, email, address and the top bar come from compile-time
  constants in `storefront/layout/storeContact.ts`. No admin screen exists and
  no requirement defines which fields to store, so nothing was invented.
  (Footer *link columns* are admin-editable through Navigation.)
* **Customers, Promotions, Settings** admin pages are honest "coming soon"
  placeholders; they save nothing.
* **Notifications bell** is derived from the catalog (incomplete size data);
  there is nothing to persist.
* **Customer cart / wishlist / recently viewed / language** stay in the
  customer's own browser by design — they are not admin data.
* **Customer-facing order page**: none exists (the confirmation page only works
  immediately after checkout, from memory), so emails link to the storefront.

## 3. Design

### Catalog document store (`supabase/migrations/0006_catalog_documents.sql`)

The 0003 normalized catalog tables could not hold the frontend's real data
shape without losing it (string product ids referenced by orders, variant ids,
unknown-but-preserved attribute assignments, `local:`/http/relative image refs,
legacy `colors/materials/sizes`). Following the same precedent as `orders` and
`home_sections`, one table `catalog_docs(kind, id, slug, visible, sort_order,
revision, data jsonb)` mirrors the TypeScript shapes; only what the database
must enforce is a column (visibility for RLS, slug uniqueness, ordering,
revision for concurrency). The 0003 catalog tables remain, unused and empty.

* Clients have **SELECT only**. All writes go through `SECURITY DEFINER` RPCs
  that check `is_admin()` themselves.
* `catalog_write(ops)` applies many records in **one transaction**, each with an
  `expected_revision`; stale writes fail (`CF001`), missing records `CF002`,
  duplicate ids `CF003`, duplicate slugs `CF004`, duplicate SKUs `CF005`.
  No zero-row silent successes.
* `catalog_import(docs, dry_run)` is idempotent and **never overwrites**:
  differing records, taken slugs and taken/duplicated SKUs are returned as
  conflicts.
* SKU uniqueness is enforced in the database by the `catalog_skus` registry
  (product + variant SKUs, one namespace, trim + lowercase). It is written only
  by the RPCs; its primary key makes two concurrent claims impossible — the
  loser gets `CF005`/`sku_taken`. Products whose import is blocked by a SKU
  clash are resolved explicitly in the migration UI (the admin types the
  replacement; the backup keeps the originals).
* `app_settings.catalog_initialized` is the cutover flag. Until an admin has
  imported **and verified** the catalog and flipped it, the storefront serves
  the built-in catalog and admin catalog edits are refused. `catalog_unmark_initialized()`
  flips it back without deleting data.

### The save contract (all admin writes)

1. Validate in the form (nothing sent if invalid).
2. Busy state; duplicate submissions are ignored (`saveRunner`).
3. Send to the backend carrying the **revision the form was opened on**.
4. Treat zero affected rows / missing ids / RLS denial as **errors**.
5. **Read back** and build local state from what the database returned.
6. Show success (and navigate) only after 5.
7. On failure show a specific Arabic message (`describePersistenceError`),
   keep the draft, and leave displayed data unchanged.

### Loading and fallback

`DataGate` blocks rendering until the catalog and homepage have loaded (no flash
of demo content, no editing stale defaults). First-load failures are shown as
errors with cause-specific wording; a refresh that fails *after* a good load
keeps showing the last good data. **Only** "our catalog tables don't exist"
(`PGRST205` on `catalog_docs`/`app_settings`) is treated as "not migrated" and
falls back to the built-in catalog.

## 4. Data protection and migration

`Admin → النسخ الاحتياطي والترحيل`:

1. **Read** the browser's data without modifying or clearing it (or load a
   backup ZIP made elsewhere).
2. **Backup ZIP** (mandatory before running): raw `localStorage` strings
   verbatim + every IndexedDB image's actual bytes + restore instructions.
3. **Dry run**: shows inserts / unchanged / conflicts; writes nothing.
4. **Run**: upload images to `migrated/<id>.<ext>` (idempotent, never
   overwrites, size-verified) → import records with `local:` refs rewritten to
   `media:` (only for images that uploaded) → read back and compare.
5. **Homepage image refs** rewritten through the normal verified save path.
6. **Activate** (only with verification OK and zero conflicts), or **roll back**
   to the built-in catalog at any time. Local data is never deleted by the tool.

## 5. Verification status

| Layer | How | Real Supabase? |
|---|---|---|
| SQL (0001/0005/0006): RLS, grants, triggers, RPCs, constraints, idempotency, lockout guard | PGlite (real Postgres engine) running the actual migration files | No — Supabase roles/vault/pg_net are stubbed |
| Client stores, services, migration engine | vitest against an in-memory **mock** of the Supabase client | No |
| Admin screens (save/failure/stale/duplicate/auth states) | jsdom + Testing Library against the same mock | No |
| Edge Function handler | real `index.ts` with Deno/Supabase/Resend stubbed | No |
| Production read-only probes | HTTP GETs with the public key: tables missing (404 `PGRST205`), `home_sections`/`orders` reachable | **Yes, read-only** |
| Live storefront | headless Chrome rendering of the deployed site | **Yes** |

Nothing in this change was verified by writing to a real Supabase project.
`pg_cron` scheduling, real `pg_net` delivery, Supabase Storage policies, real
Resend delivery, and PostgREST error mapping are only exercised by the
production end-to-end checklist in the runbook.

## 6. Known limitations / residual risks

* SKU uniqueness is enforced by the `catalog_skus` registry inside the write
  RPCs. The form still pre-checks for a friendly message, and a refused write
  resyncs the tab so the second attempt is caught locally.
* Orders have no per-row revision; the status update is conditional on the
  status the admin was looking at (`expectedStatus`).
* Image uploads happen when a file is chosen, before the record is saved; if
  the save then fails, the file remains in Storage as an unreferenced object
  (visible in the media library, deletable there).
* Alt text for images does not exist in the data model, so none is preserved.
* Guest checkout lets anyone supply any email address; a confirmation can be
  sent to a third party. No rate limit exists.
* Deploys do not run tests (the Pages workflow only builds). Consider adding
  `npm test` to CI.
* Both Claude sessions share one working directory; concurrent `git add -A`
  commits swept unfinished work into `main` once. Use one session per branch /
  worktree.
