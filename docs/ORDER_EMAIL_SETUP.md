# Order email notifications — setup & operations

Customers get an Arabic RTL email when an order is created and whenever an
admin changes its status (`pending`, `confirmed`, `processing`, `shipped`,
`delivered`, `cancelled`).

## How it works

```
orders INSERT / UPDATE(status)         (0001 triggers, only on a real change)
  → order_status_history row
    → enqueue_order_email()            one order_email_outbox row per history row
                                       (UNIQUE history_id ⇒ no duplicate emails)
      → kick_order_email_worker()      pg_net → Edge Function process-order-emails
  + pg_cron sweep every minute         retries / backoff / unconfigured rows
```

- The Edge Function claims due rows (`claim_order_emails`), sends through
  Resend with `Idempotency-Key = order-email-<outbox id>`, and records the
  result (`finish_order_email`). A row becomes `sent` **only** when Resend
  returns a message id (enforced in both the function and SQL).
- Failures never block the status change. Transient failures retry with
  backoff (1m, 5m, 30m, 2h, 6h); after 5 attempts, or on a permanent provider
  error (401/403/4xx), the row is `failed` and the admin sees a retry button.
- No customer email / invalid address → row is `skipped` (`no_customer_email`).
- A stale retry is skipped (`superseded`) if a newer status email for the same
  order was already accepted, so customers never get statuses out of order.
- The browser can only **read** delivery state (admins) and call
  `retry_order_email`. It cannot send mail, call the function, or write the
  outbox. Function secret + Resend key live only in Supabase secrets/Vault.
- There is no customer-facing order page yet, so emails link to the storefront
  (`STOREFRONT_URL`), not to an order.

## One-time setup

1. **Resend**: create an account, add and verify your sending domain
   (Domains tab), create an API key. Until a domain is verified the sandbox
   sender `onboarding@resend.dev` only delivers to the Resend account owner.
2. **Install the Supabase CLI**, then `supabase login` and
   `supabase link --project-ref <your-project-ref>`.
3. **Function secrets** (server-side only):
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set ORDER_EMAIL_WORKER_SECRET="$(openssl rand -hex 32)"   # note the value
   supabase secrets set EMAIL_FROM="Taybah <orders@your-verified-domain.com>"
   supabase secrets set STOREFRONT_URL="https://<your-storefront-url>/"
   ```
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
4. **Deploy** (the shared secret is the auth gate, so no JWT check):
   ```bash
   supabase functions deploy process-order-emails --no-verify-jwt
   ```
5. **Vault secrets** (SQL Editor) so the database can call the function:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/process-order-emails', 'order_email_worker_url');
   select vault.create_secret('<same value as ORDER_EMAIL_WORKER_SECRET>', 'order_email_worker_secret');
   ```
6. **Make sure you are in `public.admins`** (needed by 0003 already):
   ```sql
   insert into public.admins (user_id) values ('<your auth user uuid>') on conflict do nothing;
   ```
   Migration 0005 restricts order read/update to admins. It **aborts before
   changing anything** if `public.admins` is empty, so you cannot lock yourself
   out by forgetting this step — but you must still be *the* user listed
   there to see orders afterwards.
7. **Run `supabase/migrations/0005_order_email_outbox.sql`** in the SQL Editor
   (Database → Extensions: `pg_cron` and `pg_net` must be enabled). Do this
   **after** steps 3–5: it removes the old trigger, so the new pipeline must be
   ready to take over. The full recommended order, with the catalog migration,
   is in [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md).
8. **Retire the old function** — it accepts the publishable key from anyone:
   ```bash
   supabase functions delete send-order-status-email
   ```
   and consider rotating the publishable key that was committed in
   migration 0002 if you treat it as exposed.

## End-to-end test (required before relying on it)

1. Place a test order on the storefront with your own email (use the Resend
   account owner's address if still on the sandbox sender).
2. Within ~1 minute you should receive the confirmation; admin → order →
   «إشعارات البريد الإلكتروني» shows «قبِل مزوّد البريد الرسالة».
3. Change the status in admin; receive the matching email.
4. Failure path: temporarily set a bad `RESEND_API_KEY`, change a status →
   row shows «فشل الإرسال»; restore the key and press «إعادة المحاولة».
5. Check `supabase functions logs process-order-emails` — logs contain only
   batch counts and error codes (no addresses, names or secrets).

Inspect the queue in SQL: `select state, count(*) from order_email_outbox group by 1;`
Rows stuck in `pending` mean the Vault secrets or function deploy are missing.

## Tests

All of these run in `npm test`. **None of them talks to a real Supabase or
Resend account** — that is what the end-to-end test above is for.

- Email rendering (all six statuses, escaping, RTL), provider-response
  classification, worker behaviour — `supabase/functions/_shared`.
- The deployed handler itself (`process-order-emails/index.ts`) with Deno,
  Supabase and Resend stubbed: shared-secret auth (fails closed), Resend key
  and idempotency header, outcome mapping (403→failed, 429/5xx→retry, 2xx
  without a message id→never `sent`), batch isolation, and that logs contain no
  secrets or customer data — `supabase/tests/process-order-emails.test.ts`.
- The SQL state machine (enqueue, dedupe, RLS, claim/finish/retry/backoff/
  supersede, admin-only retry, the 0005 lockout guard, idempotent re-runs) on a
  real Postgres engine (PGlite) — `supabase/tests/migrations.test.ts`. Roles,
  `auth.uid()`, Vault and `pg_net` are stubs; `pg_cron` is not exercised.
- The admin email panel (accepted ≠ delivered wording, failure + retry,
  unavailable outbox) — `OrderEmailLog.test.tsx`.

Outbox ordering uses a monotonic `seq` column rather than `created_at`, because
`now()` is the transaction start time and can tie.

## In-store orders send no e-mail

Orders with `source = 'in_store'` (status `sold` / `cancelled`, migration
`0008`) are recorded in `order_email_outbox` as `skipped` with
`last_error = 'in_store_order'`, whatever contact data they hold. The worker
never claims them, and `sold` has no e-mail template (the Edge Function would
skip it as `unknown_status` anyway). The Edge Function does not need
redeploying for this.

