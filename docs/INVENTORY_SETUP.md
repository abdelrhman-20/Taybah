# Inventory — admin UI and the setup a real database needs

Status: **local only**. Nothing here has been applied to any Supabase project,
committed, or deployed. Read this before enabling the inventory screens anywhere.

## What exists

| Piece | Where |
|---|---|
| Inventory page `/admin/inventory` | `src/features/admin/inventory/AdminInventoryPage.tsx` |
| Movement history `/admin/inventory/movements` | `InventoryMovementsPage.tsx` |
| Action dialog (opening, adjust, receive, return, threshold) | `InventoryActionDialog.tsx` |
| Reads + the only five write RPC wrappers | `inventoryStore.ts` |
| Pure rules (status, availability warnings) | `inventoryStatus.ts` |
| Sidebar entry «المخزون» (after «المنتجات») | `src/features/admin/layout/adminNav.ts`, routes in `src/app/router/index.tsx` |
| Reconciliation before activation `/admin/inventory/reconciliation` | `InventoryReconciliationPage.tsx`, `inventoryReconciliation.ts` |
| Shortage override dialog + RPC wrappers (0010) | `StockOverrideDialog.tsx`, `inventoryOverrides.ts`; wired into `OrderDetailsPage.tsx` and `InStoreOrderPage.tsx` |
| Database: tables, ledger, admin RPCs, reconciliation | `supabase/migrations/0009_inventory.sql` (**not applied anywhere**) |
| Database: stock deduction from orders (the activation) | `supabase/migrations/0010_inventory_orders.sql` (**not applied anywhere**) |
| Multi-connection concurrency checks (never run) | `supabase/tests/concurrency/inventory.concurrency.ts`, `npm run test:concurrency` |

The page shows, per catalog product: image, name, SKU, retail price, the
**admin-only wholesale price** (from `product_internal_pricing`, 0007), on-hand
quantity, minimum threshold and status (متوفر / منخفض / نفد / سالب / غير مُهيَّأ),
with search, status/category filters, sorting, 25-row pagination and a card layout
for narrow screens (Arabic, RTL). It warns — never changes anything — when the
**manual** storefront availability contradicts the real stock.

## What does NOT exist yet

* **Nothing is active.** `0010_inventory_orders.sql` exists and is tested on PGlite, but
  **applying it IS the activation** (no flag, no go-live timestamp): from that moment
  every delivery of an online order and every in-store sale deducts stock and is refused
  while a product has no explicit opening balance or stock is short. Until it is applied,
  orders deduct nothing and balances are managed by hand only. The migration refuses to
  run (changing nothing) while `inventory_activation_blockers()` returns any row.
* Checkout and order creation are untouched. The only order-UI changes are the shortage
  messages and the admin override dialog (orders page / in-store page).
* Suppliers, purchase cost, purchase-order screens, per-variant stock: not built (out of scope).

## Reconciliation before activation (`/admin/inventory/reconciliation`)

Admin-only; calls only `inventory_activation_blockers`, `inventory_preflight_report`,
`inventory_decide_order` and `inventory_import_opening`. It never invents data:

* **Blockers** — exactly what 0010 will refuse to run over, grouped (coverage / decision /
  integrity). «لا توجد عوائق» is shown only if the database returns none, and says that
  activation itself is still a separate decision.
* **Orders needing a decision** — every in-flight or ambiguous order, with all its
  products and quantities, history issues, and two radio choices with **no default**:
  *deduct on delivery* (the goods are inside the counted opening stock) or *already
  accounted* (the goods left outside the count: no deduction, audit only). A reason of
  5+ characters is required; the decision is bound to the `lines_hash` shown, so if the
  order's lines changed meanwhile the database refuses and the page asks to reload. A
  delivered order offers only *already accounted*. Unresolved orders stay unresolved.
* **Opening-balance import** — paste `product_id,quantity[,reason]` lines. A blank or
  non-numeric quantity is an **error, never zero**; zero must be typed. A dry run writes
  nothing; the real run is enabled only for the exact text that passed a clean dry run;
  it never overwrites an existing balance and reports catalog products missing from the
  batch instead of zero-filling them.

Templates (no quantities are invented — fill every value from a physical count):
`product_id,quantity,reason` (one line per catalog product) for balances, and for
decisions one row per order from the preflight report with the chosen decision and why.

## Safety properties of the UI

* **Writes only through the approved SECURITY DEFINER RPCs**: `inventory_set_opening`,
  `inventory_adjust`, `inventory_receive`, `inventory_record_return`,
  `inventory_set_threshold`. No insert/update/delete on an inventory table exists in
  the code, and the database grants no such privilege to any API role either (guarded
  by `inventoryExposure.test.ts` and `supabase/tests/inventory.hardening.test.ts`).
* **Nothing is reported as saved unless the database answered.** A rejected, failed
  or malformed response keeps the dialog open with every typed value; a lost response
  is retried with the same idempotency key (UUID, accepted by the key format) and
  reported as «سُجِّلت سابقًا ولم تُكرَّر»; a changed request gets a new key.
* **A damaged return never raises the balance** (`return_damaged`, delta 0); the
  resaleable/damaged choice has no default.
* **Quantities and wholesale prices are never public**: admin-only tables under RLS,
  not part of `catalog_docs`, not imported by any storefront module (static guard).
  A signed-in non-admin is refused by `is_admin()` *before* any stock or wholesale
  request (RLS would otherwise return empty lists that look like "nothing initialized").
* **Storefront `availability` stays manual.** The page only warns on conflicts.

## Exact setup for a real database

Do **not** assume any of this has been done. Check each item against the project.

1. `public.admins` contains your admin user (migration 0003); `is_admin()` exists.
2. **Catalog migrated into the database** (0006 applied, the one-time catalog
   migration completed so `app_settings.catalog_initialized` holds the object
   `catalog_mark_initialized()` writes, and at least one valid product exists).
   Until then the page shows the built-in demo catalog and **disables every action**.
3. Order infrastructure: 0001, 0005 (order e-mail outbox), 0008 (in-store orders).
   **Never re-apply 0005 after 0008** (it would overwrite the in-store e-mail
   suppression; if it ever must be re-applied, re-run 0008 straight after).
4. Optional: 0007 for wholesale prices (the page shows «—» and a note when the table is absent).
5. Before 0009, the project owner confirms untrusted roles cannot create objects in
   `public` or `auth` (the migration refuses to run otherwise and changes nothing):
   `select r, s, has_schema_privilege(r, s, 'CREATE') from
   unnest(array['public','anon','authenticated']) r, unnest(array['public','auth']) s;`
   — every row must be `false`.
6. Apply `supabase/migrations/0009_inventory.sql` (SQL Editor). Re-runnable; its guard
   aborts before any change if a prerequisite is missing.
7. Deploy the app. Deploying it *before* step 6 is safe: the inventory pages explain
   that migration 0009 is missing and show no numbers (never an "empty inventory").
8. In the UI, initialize an **explicit opening balance for every product** (zero is a
   valid, explicit balance). Uninitialized products show «غير مُهيَّأ». Opening
   balances must account for goods already shipped but not delivered (see
   `docs/DATABASE_SCHEMA.md`, "Inventory") before 0010 is ever enabled.
9. On `/admin/inventory/reconciliation`, record an explicit decision for every in-flight
   or ambiguous order until the blockers list is empty. Only then is 0010 applicable.
   The ordered production procedure is in `docs/PRODUCTION_RUNBOOK.md` (Phase G) —
   **not executed**.

## How this was tested, and what that does NOT prove

* UI tests run against `src/lib/supabase/client.mock.ts`, the in-memory **mock** that
  `vitest.setup.ts` swaps in. It models the five RPCs, their error codes (22023 /
  IS001 / IS005), the ledger fields, idempotency and the "no direct writes" rule. It is
  test-only and is not part of the production bundle. There is **no runtime mock
  adapter**: with a database that lacks 0009 the real UI shows the explicit
  "migration missing" state instead.
* The real SQL (constraints, locks, RLS, ACLs, atomicity) is verified against Postgres
  (PGlite) in `supabase/tests/inventory.test.ts` and `inventory.hardening.test.ts`.
* 0010's SQL (triggers, atomicity, idempotency, overrides, the *ordering* of locks, ACLs,
  RLS) is verified against PGlite in `supabase/tests/inventory.orders.test.ts`, plus
  scripted mutation checks (a deliberately broken copy of each guarantee must fail a test).
* **Not verified — concurrency.** PGlite has one connection, so races (two deliveries
  competing for the same stock, one order delivered twice at once, one attempt key raced across different orders, parallel retries with
  one attempt key, concurrent returns against a cap, deadlock freedom of the sorted lock
  order) are **UNVERIFIED**. `supabase/tests/concurrency/inventory.concurrency.ts` holds
  those six scenarios on several real connections; it has **never been run** (no
  PostgreSQL server, Docker or Supabase CLI exists on this machine). It runs only against
  a local, empty, disposable database whose name ends `_test`/`_scratch`/`_disposable`
  with `INVENTORY_CONCURRENCY_CONFIRM=I_UNDERSTAND_THIS_DB_IS_DISPOSABLE`; otherwise it is
  skipped (non-local hosts throw). Never point it at Supabase or production.
* **Not verified — the UI against a real Supabase project.**
* **Not verified — visually.** The pages were checked in jsdom (structure, text,
  behaviour, ARIA roles), not in a browser: no browser-automation tool is installed here
  and the app has no runtime mock adapter (deliberately), so a rendered check needs a real
  or local Supabase. RTL layout (logical `ms-/ps-/text-start` classes are used throughout),
  responsive breakpoints and the card/table switch have not been eyeballed.

## Verification checklist (to be run by a human; nothing below has been run)

Status of each item stays **NOT RUN** until you paste evidence into the "Evidence" column
of your own copy. Never use Supabase or production for any of it.

### 1. Concurrency on a disposable local PostgreSQL (6 scenarios)

1. Install/start PostgreSQL 15+ **locally** (your decision; this repo installs nothing).
2. Create an empty database whose name ends `_test`, `_scratch` or `_disposable`, e.g.
   `createdb -h localhost -U postgres tybah_inventory_concurrency_test`.
3. **Confirm the target identity before anything destructive** (all three must be true):
   `psql "$INVENTORY_CONCURRENCY_DB_URL" -Atc "select current_database(), inet_server_addr(), (select count(*) from pg_class where relnamespace = 'public'::regnamespace)"`
   -> database name ends in `_test|_scratch|_disposable`, address is `127.0.0.1`/`::1`/NULL
   (unix socket), and the table count is `0`. The suite re-checks host, name suffix, the
   confirmation variable and that `public.orders` does not exist, and refuses otherwise.
4. Run (PowerShell: `$env:NAME='value'`; bash: `NAME=value`):
   ```
   INVENTORY_CONCURRENCY_DB_URL=postgres://postgres:<pw>@localhost:5432/tybah_inventory_concurrency_test
   INVENTORY_CONCURRENCY_CONFIRM=I_UNDERSTAND_THIS_DB_IS_DISPOSABLE
   npm run test:concurrency
   ```
   Without those variables the suite is skipped (6 skipped), which is **not** a pass.
5. Pass criteria — all six green, run it 3 times (races are probabilistic):

| # | Scenario | Pass means | Evidence |
|---|---|---|---|
| 1 | Two orders race for scarce stock | exactly one delivered, other `insufficient_stock`, balance = before - 7 | |
| 2 | Same order delivered by 8 connections | one `sale` movement, balance reduced once | |
| 3 | 6 parallel overrides, one attempt key, one order | one `sale` movement; others replay | |
| 4 | One attempt key across two different orders/products | exactly one wins, loser `IS005`, grants reference one order | |
| 5 | Opposite-order multi-product deliveries | neither fails with SQLSTATE `40P01` | |
| 6 | 4 parallel returns of 1 unit against 1 sold | at most one succeeds | |

6. Drop the database afterwards. Record: PostgreSQL version (`select version()`), command,
   full output, date.

**Lock ordering (the contract the code relies on):** attempt-key advisory lock
(`hashtextextended('inventory_override:' || key, 0)`, override RPCs only) -> `orders` row ->
`stock_levels` rows in `product_id` order. Plain deliveries/in-store sales skip the first
step. No path acquires them in another order. A 64-bit hash collision between two keys
would only make those requests wait for each other.

### 2. Manual RTL / responsive browser checks (separate test environment)

Environment: local Supabase or a throw-away project with 0001-0009 only (never production),
an admin user, a few test products. Record pass/fail + a screenshot per row.

| Page / width | Check | Result / evidence |
|---|---|---|
| `/admin/inventory` @ 1280px | page `dir=rtl`; table columns right-to-left; numbers readable; sidebar on the right | |
| same @ 375px | table switches to cards; no horizontal page scroll; buttons reachable | |
| same | search, status/category filter, sorting, pagination (25/page) | |
| action dialogs (opening / adjust / receive / return / threshold) | Esc closes; focus trapped; empty and invalid input show Arabic errors; typed values survive a failed save | |
| return dialog | resaleable/damaged has no default | |
| `/admin/inventory/movements` | filters, kind labels, order link; read-only | |
| `/admin/inventory/reconciliation` | blockers list; radios unselected by default; reason required; blank quantity rejected in import; real import disabled until dry run passes | |
| non-admin account | all three pages show the permission message, no quantities | |
| keyboard only | Tab order logical in RTL; visible focus | |

### 3. Evidence rules
Record PASS only for what you saw. A skipped suite, a mocked/PGlite run or a jsdom run is
not evidence for sections 1-2.
