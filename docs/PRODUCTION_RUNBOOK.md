# Production runbook — catalog persistence, order lockdown, order emails

**Nothing in this document has been executed against production.** Each phase
needs the owner's explicit go-ahead. Run the phases in order; each one is safe
to stop after.

State when this was written:

| Item | State |
|---|---|
| App on `main` (GitHub Pages) | Deployed. Works **without** migrations: when the catalog tables are missing it serves the built-in catalog. |
| Migration `0006_catalog_documents.sql` | **Not applied** (production answers `404 PGRST205` for `catalog_docs`/`app_settings`). |
| Migration `0005_order_email_outbox.sql` | **Not applied** (no `order_email_outbox`). |
| Migration `0008_in_store_orders.sql` | **Not applied.** Adds `orders.source`/`note`, status `sold`, the admin in-store insert policy. Requires 0001, 0003, 0005, 0006 (so Phases A and C first). **Never re-apply 0005 after it.** See Phase F. |
| Migration `0009_inventory.sql` | **Not applied, not scheduled.** Inventory phase 1 (tables and admin operations only; changes no order behaviour). Requires 0001, 0003, 0006 **with the catalog migrated** (the `catalog_initialized` object from `catalog_mark_initialized()` and at least one valid product), and 0008; it also **refuses to run** if `PUBLIC`/`anon`/`authenticated` have `CREATE` on schema `public` or `auth` (it will not change privileges for you). Never re-apply 0005 after 0008. |
| Edge Function `process-order-emails` | **Not deployed**. The old `send-order-status-email` function and trigger from `0002` are still live. |
| Resend | `RESEND_API_KEY` secret exists (per project notes); production sending **never verified**. |

> Replace `<ref>` with the Supabase project ref. The ref appears in
> `VITE_SUPABASE_URL` (`https://<ref>.supabase.co`). Project notes mention
> `mrnndtvhtxdjvpefayxa`; confirm in step 0.2 — do not assume.

All SQL runs in **Supabase Dashboard → SQL Editor** unless stated. CLI commands
use `npx supabase …` (no global install needed).

---

## Phase 0 — Pre-flight (read-only, no changes)

**0.1 Log in and link (interactive; you complete the browser login).**

```bash
npx supabase login
npx supabase link --project-ref <ref>
```

**0.2 Confirm this is the project the live site uses.** The live bundle embeds
the project URL; the ref must match the one you linked.

```bash
curl -s https://abdelrhman-20.github.io/Taybah/ar/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
curl -s https://abdelrhman-20.github.io/Taybah/assets/<that file> | grep -o 'https://[a-z0-9]*\.supabase\.co' | sort -u
```

**0.3 Back up the database.** Dashboard → *Database → Backups* (use a fresh
backup / PITR marker if your plan has it). Otherwise, at minimum export the
tables this runbook touches (Table Editor → Export as CSV): `orders`,
`order_status_history`, `home_sections`, `admins`. With Docker Desktop
available you can also run
`npx supabase db dump --linked -f schema-backup.sql` and
`npx supabase db dump --linked --data-only -f data-backup.sql`.
Keep the files off the repository.

**0.4 Verify the admin user** (this gates `0005`; an empty/wrong `admins` row
locks the orders admin).

```sql
select u.id, u.email, (a.user_id is not null) as is_admin
from auth.users u left join public.admins a on a.user_id = u.id
order by u.created_at;
```

Your login email must show `is_admin = true`. If not (use the `id` from the
row above):

```sql
insert into public.admins (user_id) values ('<your auth.users id>') on conflict do nothing;
```

**0.5 Check current state and extensions.**

```sql
select to_regclass('public.catalog_docs')       as catalog_docs,
       to_regclass('public.app_settings')       as app_settings,
       to_regclass('public.order_email_outbox') as outbox;      -- all NULL today

select extname from pg_extension
where extname in ('pg_net', 'pg_cron', 'supabase_vault');       -- pg_net exists from 0002
```

If `pg_cron` / `supabase_vault` are missing: *Database → Extensions → enable*.
(`0005` tolerates a missing `pg_cron` — it prints a notice and skips the
once-a-minute retry sweep; the immediate send on each status change still works.)

**0.6 Back up the data that lives only in a browser.** On the browser/profile
where you entered catalog data and uploaded images: sign in to `/admin` →
**النسخ الاحتياطي والترحيل** → *قراءة بيانات هذا المتصفح* → *تنزيل النسخة
الاحتياطية*. Keep the `.zip` safe. Do **not** clear that browser's site data.

---

## Phase A — Catalog persistence (migration 0006 + data migration)

This is the fix for "changes don't persist". It is purely additive.

**A1. Apply the schema.** Run `supabase/migrations/0006_catalog_documents.sql`.
(No effect on the live site yet: the cutover flag is unset, so the storefront
keeps serving the built-in catalog.)

**A2. Verify (read-only).**

```sql
select count(*) from public.catalog_docs;                         -- 0
select * from public.app_settings;                                 -- no rows
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'catalog_docs' and grantee in ('anon','authenticated');  -- SELECT only
```

Reload the live site: still works, still the built-in catalog. In `/admin` the
banner changes from "migration 0006 not applied" to "catalog not yet migrated".

**A3. Migrate the data** (admin UI — on the browser that holds the data, or
upload the backup ZIP on any browser):

1. **قراءة بيانات هذا المتصفح** (or *رفع نسخة احتياطية*). Parts that were never
   saved there are reported as "built-in content will be imported".
2. **تنزيل النسخة الاحتياطية** (required — the later buttons stay disabled).
3. **تشغيل الفحص التجريبي** — expect *conflicts 0*. Anything else: stop and read
   the conflict list (existing DB records are never overwritten).
4. **بدء الترحيل** — uploads images to `migrated/…`, imports records, re-reads the
   database and compares. Wait for «تم التحقق».
5. If the homepage still references local images: **تحديث صور الصفحة الرئيسية**.
6. **اعتماد وتفعيل** — only enabled when verification passed with zero conflicts.
   From this moment the storefront and admin read the database.

**A4. Verify like a customer.** Open the storefront in a **private window** and
on a second device: products, categories, product pages, images, navigation
and footer all appear. In admin, edit one product and one nav link: each shows
a success message only after saving; reload and in a private window — the
change is there.

**A5. Rollback (any time, lossless).** In the migration page press
**الرجوع إلى الكتالوج المدمج**, or run:

```sql
-- SQL editor (runs as postgres; the app button uses catalog_unmark_initialized(),
-- which requires a signed-in admin and so cannot be called from here):
delete from public.app_settings where key = 'catalog_initialized';
```

The storefront returns to the built-in catalog; no data is deleted. A full
removal is only for an empty/abandoned migration (this **destroys saved
catalog data** — export first):
`drop function public.catalog_unmark_initialized(), public.catalog_mark_initialized(), public.catalog_import(jsonb, boolean), public.catalog_write(jsonb), public.catalog_product_skus(jsonb), public.catalog_normalize_sku(text); drop table public.app_settings, public.catalog_skus, public.catalog_docs;`

Local browser data is untouched by every step above. Delete it only after
Phase A is verified **and** you are happy with the backup.

---

## Phase B — Order-email infrastructure (no database policy change yet)

**B1. Resend.** Add and verify a sending domain (Resend → Domains) and create
an API key. **Sandbox rule:** until a domain is verified, the sender
`onboarding@resend.dev` delivers **only to the email address of the Resend
account owner**; any other recipient is rejected (HTTP 403 → the order's email
shows «فشل الإرسال»). A test order must therefore use that address. Real
customer delivery needs a verified domain.

**B2. Secrets** (server-side only; never in `.env`/GitHub secrets):

```bash
npx supabase secrets list                      # RESEND_API_KEY should be listed (names only)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # copy output = <WORKER_SECRET>
npx supabase secrets set ORDER_EMAIL_WORKER_SECRET=<WORKER_SECRET>
npx supabase secrets set STOREFRONT_URL=https://abdelrhman-20.github.io/Taybah/
# sandbox test: omit EMAIL_FROM (defaults to Taybah <onboarding@resend.dev>)
# with a verified domain:
# npx supabase secrets set EMAIL_FROM="Taybah <orders@your-domain.com>"
```

**B3. Deploy the worker** (the shared secret is the auth gate → no JWT check):

```bash
npx supabase functions deploy process-order-emails --no-verify-jwt
```

**B4. Let the database call it** (Vault):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/process-order-emails', 'order_email_worker_url');
select vault.create_secret('<WORKER_SECRET>', 'order_email_worker_secret');
```

**B5. Smoke-test the function's gate** (the queue does not exist yet, so this
cannot send anything):

```bash
curl -i -X POST https://<ref>.supabase.co/functions/v1/process-order-emails                 # expect 401
# with the secret it will try to claim from a table that doesn't exist yet -> 500 worker_failed (expected before Phase C)
```

---

## Phase C — Order lockdown + outbox (migration 0005)

Do this **after** Phase B so the new pipeline is ready the moment the old
trigger is removed.

**C1.** Re-run the check from 0.4 (admin listed). Then run
`supabase/migrations/0005_order_email_outbox.sql`. It first checks
`public.admins` is non-empty and aborts before changing anything if not.

It then: drops the old `0002` trigger; creates `order_email_outbox` and its
functions; schedules the once-a-minute sweep; and **restricts orders** — guests
may only create `pending` orders, and reading/updating orders requires
`public.admins`.

**C2. Verify.**

```sql
select to_regclass('public.order_email_outbox');                       -- not null
select policyname, cmd from pg_policies where tablename = 'orders';    -- "public can insert pending orders", staff read/update = admin only
select jobname, schedule from cron.job where jobname = 'order-email-worker';   -- if pg_cron is enabled
```

Sign in to `/admin/orders`: the order list loads (not empty if orders exist).
Change one test order's status: the change persists; an unauthorized user would
get an error, not a fake success.

Existing orders are **not** emailed — only new status changes from now on.

**C3. Rollback (restores the previous, looser behaviour).** Only if needed:

```sql
drop trigger if exists order_status_history_enqueue_email on public.order_status_history;
select cron.unschedule('order-email-worker');
drop policy if exists "public can insert pending orders" on public.orders;
drop policy if exists "staff can read orders" on public.orders;
drop policy if exists "staff can update orders" on public.orders;
drop policy if exists "staff can read order status history" on public.order_status_history;
create policy "public can insert orders" on public.orders for insert to anon, authenticated with check (true);
create policy "staff can read orders" on public.orders for select to authenticated using (true);
create policy "staff can update orders" on public.orders for update to authenticated using (true) with check (true);
create policy "staff can read order status history" on public.order_status_history for select to authenticated using (true);
-- optional, destroys the email log:  drop table public.order_email_outbox cascade;
```

**Warning — rollback stops order emails.** `0005` dropped the old `0002`
trigger (`order_status_history_notify_email`). The block above removes the new
outbox trigger but recreates nothing, so after a rollback **no order-status
emails are sent at all** until you either re-apply `0005`, or re-run
`supabase/migrations/0002_order_status_email_trigger.sql` to reinstall the old
trigger. The 0002 path only works while the old `send-order-status-email`
Edge Function is still deployed — which is why Phase E deletes it **only**
after Phase D has verified the replacement end to end.

---

> **If `0008` (Phase F) has been applied, do not re-apply `0005`** — it would
> overwrite the in-store e-mail suppression. Re-run `0008` straight after if you must.

## Phase D — End-to-end verification (required before relying on emails)

Use the Resend account owner's address as the order's customer email while on
the sandbox sender.

| # | Do | Expect |
|---|---|---|
| 1 | Place a test order on the live storefront (private window). | Order created; confirmation page shown. |
| 2 | Within ~1 min check the inbox; admin → that order → «إشعارات البريد الإلكتروني». | Arabic RTL confirmation email; panel shows «قبِل مزوّد البريد الرسالة». |
| 3 | Change status → «قيد التجهيز» (then «تم الشحن», «تم التسليم»). | Each change persists; a matching email arrives; panel adds a row each time. |
| 4 | Click apply twice quickly / re-apply the same status. | One update, one email. |
| 5 | Place an order with a non-owner email (sandbox). | Row «فشل الإرسال» with a provider-rejected reason; **the order itself is fine**. Fix → «إعادة المحاولة». |
| 6 | Place an order with no/invalid email (edit via SQL if the form blocks it). | Row «لم تُرسل — لا يوجد بريد إلكتروني صالح». |
| 7 | `npx supabase functions logs process-order-emails`. | Only counts and error codes — no addresses, names or keys. |
| 8 | `select state, count(*) from order_email_outbox group by 1;` | No rows stuck `pending`/`sending`. |
| 9 | Signed-out `curl` of `…/rest/v1/orders` and `…/rest/v1/order_email_outbox` with the anon key. | `[]` / permission error — never order data. |
| 10 | Signed-in **non-admin** account tries `/admin`. | «ليس لديك صلاحية المسؤول». |

If step 2 never arrives and rows stay `pending`: the Vault secrets (B4) or the
function deploy (B3) are missing — fix and the sweep/next status change
re-attempts. A pending row is never lost.

---

## Phase E — Clean up

```bash
npx supabase functions delete send-order-status-email
```

The old function accepted the committed publishable key from anyone. Consider
rotating the publishable key (it appears in `0002`'s history) and updating the
GitHub secret `VITE_SUPABASE_ANON_KEY`, then redeploying Pages.

---

## GitHub Pages / CI

* No new build configuration is needed. The workflow builds with the existing
  secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and deploys on every
  push to `main`.
* **Only the anon/publishable key belongs there.** Never put the service-role
  key, `RESEND_API_KEY` or `ORDER_EMAIL_WORKER_SECRET` in Vite env or GitHub
  Pages secrets.
* The workflow now runs `npm test` before the build (added on this branch, not
  yet on `main`), so a failing suite blocks the deploy. The suite uses PGlite
  and mocks only; it never contacts Supabase. If a timing-sensitive
  `CheckoutPage` test flakes in CI, re-run the job before changing code.
* `0006` needs only `0001` + `0003`; `0005` needs `0001` + `0003` and at least
  one row in `public.admins` (it aborts otherwise). They are independent: apply
  `0006` first, `0005` only in Phase C.
* `0008` needs `0001`, `0003`, `0005` **and** `0006` (it aborts otherwise) and must
  never be followed by a re-run of `0005` — see Phase F. Apply it before deploying
  the app version that records in-store sales.
* One session at a time should commit/push to `main`; the Pages deploy is
  triggered by any push.

## Recovery quick reference

| Symptom | Likely cause | Action |
|---|---|---|
| Storefront shows the old demo catalog after migrating | Cutover flag not set | Finish step A3.6 |
| Storefront shows "رمز: …" error screen | Real backend/auth problem (not "tables missing") | Read the code; check Supabase status / keys |
| Admin shows «ليس لديك صلاحية المسؤول» | User not in `public.admins` | 0.4 |
| Orders list empty/error after 0005 | Not in `admins`, or session expired | 0.4; sign in again |
| Emails stuck `pending` | Vault secrets / function missing | B3–B4 |
| Emails `failed` `provider_http_403` | Sandbox sender to a non-owner address, or unverified domain | B1 |
| Need to undo catalog cutover | — | A5 (lossless) |

---

## Phase F — In-store orders (migration 0008)

Not executed. **Requires Phase A and Phase C first** — «إضافة طلب» prices and
validates every line against `catalog_docs`, so it cannot work until the catalog
has been migrated into the database, and `0008` replaces the `enqueue_order_email()`
function created by `0005`.

### Complete order (database, then app)

| # | Step | Where |
|---|---|---|
| 1 | Verify the admin user is in `public.admins` (`0003` applied) | Phase 0.4 |
| 2 | Apply `0006_catalog_documents.sql` and run the catalog data migration until the catalog is marked initialized | Phase A |
| 3 | Order-email infrastructure: Edge Function, secrets, Vault | Phase B |
| 4 | Apply `0005_order_email_outbox.sql` | Phase C |
| 5 | End-to-end verification | Phase D |
| 6 | **Apply `0008_in_store_orders.sql`** | this phase |
| 7 | **Then** deploy the app (push to `main`) | CI |

`0007` (wholesale pricing) is independent of `0008`; apply it whenever you want
the wholesale field.

### Apply `0008`

1. Run `supabase/migrations/0008_in_store_orders.sql` in the SQL Editor. Its
   pre-flight check **aborts before changing anything** if `public.orders`,
   `public.is_admin()`, `public.order_email_outbox` / `kick_order_email_worker()`
   (`0005`) or `public.catalog_docs` (`0006`) is missing, and says which.
2. It is re-runnable and additive: existing orders become `source = 'online'`;
   no data is rewritten.
3. Deploy the app **after** the migration. Deploying first keeps the order list
   and online checkout working (legacy columns fallback) but «إضافة طلب» cannot
   save until the migration exists. The page also refuses to submit, with an
   explanation, while the catalog is not migrated.

> **WARNING — never re-apply `0005` after `0008`.** `0008` replaces
> `enqueue_order_email()` with a version that never e-mails customers for in-store
> sales. `0005` contains the old version, so re-running it silently removes that
> suppression and in-store orders that carry an e-mail address could queue customer
> e-mails again. If `0005` ever must be re-applied, **re-run `0008` immediately
> afterwards**, and check that in-store orders still land in `order_email_outbox`
> as `skipped` / `in_store_order`.

### Verify

* «إضافة طلب» on the Orders page → add a product → save → the order shows
  «من المتجر» / «تم البيع» and survives a refresh.
* No row with state `pending` appears in `order_email_outbox` for it.
* A normal storefront order still shows «أونلاين» / «قيد الانتظار» and still
  queues its confirmation e-mail.

### Rollback

See the comment at the end of the migration (delete in-store orders first, then
restore the `enqueue_order_email()` definition from `0005`).

## Phase G — Inventory (migrations 0009 and 0010) — **NOT EXECUTED**

> Nothing below has been run against any real project. It is a procedure for the owner,
> to be done only after explicit approval. Applying **0010 is the activation** of stock
> deduction: from that commit, every delivery and in-store sale deducts stock and is
> refused when a product has no opening balance or stock is short.

Ordered steps (each depends on the previous):

1. **Phase 0-F are done** (0001, 0003, 0005, 0006 + catalog migrated, 0008). Never
   re-apply 0005 after 0008.
2. **Read-only checks**: untrusted roles have no `CREATE` on `public`/`auth` (query in
   `docs/INVENTORY_SETUP.md`); take a database backup / point-in-time-recovery marker.
3. **Apply `0009_inventory.sql`** (SQL Editor). Changes nothing about orders.
4. **Deploy the app** (after 0009; deploying earlier shows the "migration missing" state).
5. **Count the warehouse physically.** Enter an explicit opening balance for every
   product (zero counts) via `/admin/inventory` or the import on
   `/admin/inventory/reconciliation` (dry run first). Account for goods shipped but not yet
   delivered.
6. **Decide every in-flight / ambiguous order** on the reconciliation page (deduct on
   delivery vs already accounted), with a reason. Leave nothing guessed.
7. **Check readiness (read-only)**: `select * from inventory_activation_blockers();` as an
   admin -> must return **no rows**; `select * from inventory_reconcile_summary();` ->
   `clean = true`.
8. **Quiet window**: no deliveries/in-store sales in flight; decide when to activate.
9. **Apply `0010_inventory_orders.sql`** - the activation. If the guard lists blockers it
   changes nothing; fix them and retry.
10. **Verify with one supervised delivery** of a real order: the balance falls by exactly the
    ordered quantity, one `sale` movement appears, a second delivery attempt changes
    nothing; an in-store sale deducts; an e-mail for an in-store sale is still suppressed.
11. **Run `inventory_reconcile_summary()`** again -> `clean = true`.

**Before step 9 (required, not optional):** complete the verification checklist in
`docs/INVENTORY_SETUP.md` (six multi-connection scenarios on a disposable local PostgreSQL,
plus the manual RTL/responsive checks). Both have never been run; until they pass the system is
NOT production-ready. Rollback of 0010: the
comment at the end of the file (stock already deducted stays; reconcile by hand).
