# Taybah — Security Plan

## 1. Principles

1. **RLS is the real security boundary, not application code.** The React
   Router route guard's role checks are a UX convenience (fast redirect,
   no flash of unauthorized content); the database must independently
   refuse unauthorized reads/writes even if client code has a bug — this
   matters more, not less, now that there is no application server to
   even optionally double-check first (see
   [ARCHITECTURE.md](./ARCHITECTURE.md) §9).
2. **Never trust client input for pricing, stock, or totals.** Cart totals
   and coupon validity are recalculated inside the order-placement
   Postgres RPC at checkout, never accepted from the client — there is no
   application server for this recalculation to happen in instead; the
   RPC is the only place it can happen.
3. **Service-role key never reaches the client or the Vite-bundled React
   app.** It is used only in Edge Functions / trusted CI contexts that
   need to bypass RLS deliberately (e.g. webhook processing, the refund
   outbox worker, the sitemap/prerendering build step) — never in
   anything Vite serves to a browser (see
   [ARCHITECTURE.md](./ARCHITECTURE.md) §12 on `VITE_`-prefixed env vars).

## 2. Authentication

- Supabase Auth for both customers and staff (single auth system, roles
  differentiate capability — see §4).
- Email/password at launch; social OAuth is a later addition if desired
  (open decision, not blocking).
- Password reset via Supabase Auth's standard flow.
- Session handling via `supabase-js`'s default browser behavior — the
  session (JWT) is stored in the browser (`localStorage`) and the access
  token is auto-refreshed before expiry by the SDK itself. There is no
  server-side session store or cookie-based SSR auth helper, since there
  is no server; this is the standard, supported way `supabase-js` is used
  in a pure client-side SPA, not a workaround.

## 2.1 Guest Cart Security — Revised Design

**The original design (a server-set httpOnly session token identifying a
guest cart row) is replaced.** It had a real gap: a bare session token is
just a bearer credential — anyone who obtains the cookie value (XSS, a
logging mistake, a shared device) can read/modify that cart with no
further check, and because it isn't a Supabase Auth identity, it falls
outside RLS entirely unless every guest-cart query is hand-written to trust
the token, which is exactly the kind of app-layer-only boundary §1 warns
against.

**Resolved design: Supabase Auth anonymous sign-ins.**

1. On first storefront visit, the client calls Supabase's anonymous
   sign-in, which creates a real `auth.users` row and returns a normal,
   signed session (JWT) — the same session mechanism used for registered
   customers, just for a user with `is_anonymous = true`.
2. `carts.customer_id` (and `wishlists`/`comparisons`) is **always**
   `auth.uid()` — see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3. This
   means the RLS policy is identical for guests and customers
   (`customer_id = auth.uid()`); there is no separate "trust this token"
   code path to get wrong.
3. **Why this closes the original gap:** the credential a guest holds is
   now a signed Supabase session (same expiry/refresh/revocation
   properties as any session), verified by Supabase Auth itself on every
   request — not a bare value an RLS policy would otherwise have to trust
   at face value. `auth.uid()` inside a policy is only ever populated from
   a verified JWT, so there is no way to "supply" a different guest's
   `auth.uid()` the way a copied cookie value could impersonate a
   token-based cart.
4. **Account merge — revised again. Status: Proposed — awaiting
   architecture approval, not Resolved.** A prior revision of this
   document introduced a bearer `guest_merge_tickets` token (issued while
   anonymous, redeemed after signing into the target account) and
   described it as closing the gap left by a caller-supplied-id design.
   **On inspection, that ticket design did not actually close the gap it
   claimed to**: short expiry and single-use protection stop a token from
   being replayed, but they do nothing to stop whoever *first* possesses
   the token from redeeming it into *any* account they can authenticate
   into — the ticket was never bound to a specific target account, so a
   leaked/intercepted token could still be used to merge a victim's guest
   cart and order history into an attacker's own account. That table and
   function are **retired by this revision**, not merely patched — see
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 for the removal.

   **Why a target-unbound bearer token can't be fixed by tightening
   expiry/reuse rules:** the property missing is proof that *the same
   party* redeeming the token is *also* the one who just authenticated as
   the target account — expiry and single-use only constrain *when* and
   *how many times* a token can be used, not *who* is allowed to use it.
   Closing this requires the redemption step to independently verify
   **both** identities in the same operation, not trust a single bearer
   secret to vouch for one of them.

   **Revised design: a two-token verification performed inside a
   Supabase Edge Function, not a plain Postgres RPC.** This is a
   structural change, not a parameter tweak: PostgREST (and therefore any
   `SECURITY DEFINER` RPC called through it) only ever sees **one** JWT
   per request — the one that establishes `auth.uid()` for that request.
   A second, independently-supplied token passed as a plain function
   argument is just inert text to Postgres; there is no built-in SQL
   primitive for verifying an arbitrary Supabase session JWT's signature
   and current validity against Supabase Auth. Only a context with the
   Supabase Admin/service-role capability — i.e., an Edge Function — can
   call back into Supabase Auth to verify a second token. This is the
   same category of mistake as the image-upload issue in §6: assuming a
   component can inspect/verify something it structurally has no access
   to.

   **Flow:**
   1. While still anonymous, the client uses a **second, throwaway
      Supabase client instance** (so it doesn't replace the main client's
      active anonymous session) to sign in to the target account — email/
      password or OAuth, whatever the UI offers. This returns a target-
      account access token (`target_jwt`) **without the browser's main
      session being replaced yet.**
   2. The client calls a Supabase Edge Function, `merge-guest-identity`,
      **using the main client** (so the request's own `Authorization`
      header is still the *anonymous* session's JWT) and passes
      `target_jwt` in the request body as data — not as the request's
      auth.
   3. Inside the Edge Function: the anonymous identity is derived from
      `auth.uid()` of the *actual authenticated request* (verified by
      Supabase's own request verification, exactly as any RLS-governed
      call would be — not client-asserted). The target identity is
      derived by calling Supabase Auth's admin verification
      (`supabase.auth.getUser(target_jwt)` using the Edge Function's
      service-role client) — this independently confirms `target_jwt` is
      a currently valid session and returns *its* subject, again not
      client-asserted. The function also confirms the target user's
      `is_anonymous = false` (merging into another anonymous identity
      makes no sense and is rejected).
   4. **Only once both identities are independently verified from their
      own tokens** does the Edge Function perform the merge, using its
      service-role Postgres connection (which bypasses RLS by design, the
      same trust model already used for the payment webhook handler and
      refund outbox worker). **This is two separate operations, not one
      transaction** — see 4A below for exactly why and for the
      `guest_merge_attempts` mechanism that makes the two-step sequence
      safe: (a) one Postgres transaction reassigns
      `cart_items`/`wishlist_items`/`orders.customer_id` from the
      anonymous id to the target id; (b) only after that commits, a
      separate Auth Admin API call deletes the anonymous `auth.users`
      row.
   5. On a clean, direct success response from the Edge Function call
      itself, the client calls `setSession()` on its main client with the
      target session — this is the point the anonymous session is
      actually abandoned client-side, deliberately after the server-side
      merge has already succeeded. **On any ambiguous outcome** (timeout,
      dropped connection, an error that doesn't clearly mean "did not
      run"), the client does **not** guess from that ambiguity — it
      falls through to the explicit verification flow in 4C (calling
      `get_my_guest_merge_status` from the still-held, still-
      authenticated-as-target throwaway client) before deciding whether
      to switch sessions.

   **Why this actually proves what the old ticket didn't:** redemption now
   requires simultaneously holding a **currently valid anonymous session**
   (proven by it being the literal auth context of the Edge Function
   request — not a copyable bearer string handed over separately) **and**
   a **currently valid target-account session** (independently verified
   against Supabase Auth, not asserted). An attacker who merely intercepts
   one artifact in transit (e.g. a copied `target_jwt` without also
   controlling the anonymous session that calls the function, or vice
   versa) cannot complete the exchange — they would need to control *both*
   sessions at once, which is a materially different bar than "possess one
   stolen token," and is exactly the "prove possession of both the
   original anonymous session and the authenticated target account"
   requirement this revision was asked to satisfy.

   **4A. Transaction boundaries — stated precisely, not assumed
   atomic.** Two separate operations happen, in two separate
   trust/transaction domains, and this document does not claim they are
   one atomic unit:
   - **One real Postgres transaction**: reassigns `cart_items`/
     `wishlist_items`/`orders.customer_id` from the anonymous id to the
     target id, and — in the *same* transaction — advances
     `guest_merge_attempts.status` from `in_progress` to `data_merged`
     (see `guest_merge_attempts` below). This part genuinely is atomic:
     either all of it commits or none of it does, ordinary Postgres
     `BEGIN`/`COMMIT` guarantees.
   - **A separate call to the Supabase Auth Admin API**
     (`supabase.auth.admin.deleteUser()`), made **after** that
     transaction commits, to delete the anonymous `auth.users` row. This
     is a different service, over HTTP, with its own internal
     transaction boundary that does not — and cannot — participate in
     the Postgres transaction above. **This document previously implied
     the deletion was part of "one transaction" with the reassignment;
     that was incorrect and is corrected here.** The two steps are
     sequential and independently observable, not a single atomic unit.

   **4B. Concurrency control — a durable mutex row, not "the transaction
   serializes it."** A new table, `guest_merge_attempts`
   ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1), keyed by
   `anonymous_user_id` as its primary key, is the actual mechanism: the
   Edge Function's first action is `INSERT ... ON CONFLICT
   (anonymous_user_id) DO NOTHING RETURNING *`. If the insert succeeds
   (no conflict), this request owns the merge and proceeds. If it
   conflicts (a row already exists for this `anonymous_user_id`), this
   request does **not** proceed independently — it reads the existing
   row's `status` and responds accordingly (see 4C). The primary-key
   constraint, not a comment about transactions, is what makes this a
   real mutex: Postgres guarantees at most one `INSERT` can win a PK
   conflict race, full stop.

   **4C. Partial failure and recovery — every case named, not left
   implicit:**
   - **Data reassigned successfully, but Auth user deletion fails**:
     `guest_merge_attempts.status` is already `data_merged` (set in the
     same transaction as the reassignment, §4A) — this is **not** a
     failure state. The merge's user-visible goal already succeeded. The
     stray anonymous `auth.users` row (now owning zero data) is left for
     either (a) the existing anonymous-identity cleanup job (§2.2 below),
     which will reap it once inactive, since it no longer owns any
     orders, or (b) a dedicated reconciliation sweep that retries
     `deleteUser()` for rows stuck at `data_merged` past a bounded age —
     recommended, since (a) alone could leave a merged-but-undeleted
     identity around for the full cleanup inactivity window. Either way,
     retrying the deletion is safe to repeat: deleting an already-deleted
     user is a no-op/404 from the Admin API, not a destructive repeat.
   - **Auth user deletion succeeds, but the client never receives the
     response** (network drop) — **corrected; the earlier design was not
     reliable here.** A prior revision treated "the anonymous session's
     auth now fails" as evidence the merge probably succeeded, and had
     the client proceed on that basis. **This is not safe**: anonymous
     authentication can fail for reasons unrelated to a successful merge
     (the token naturally expired, a transient server error, rate
     limiting, an unrelated bug) — treating any such failure as "merge
     succeeded" risks the client switching to the target session while
     believing a merge happened that didn't. **Corrected design**: the
     client never infers success from the anonymous side failing. Instead,
     it verifies the *durable result* directly, using the **target**
     session it already holds:
     1. The throwaway client from step 1 (already authenticated as the
        target account, never discarded during this flow) calls a
        read-only verification RPC, `get_my_guest_merge_status
        (anonymous_user_id)` — the `anonymous_user_id` is client-held
        from before the merge attempt (plain memory, not a trust
        decision: see below for why this is safe to accept as a
        parameter here).
     2. The RPC requires the caller to be a non-anonymous authenticated
        user (verified from the request's own `auth.uid()`, as always)
        and looks up `guest_merge_attempts` for the given
        `anonymous_user_id`. **It returns the row's status only if that
        row's `target_user_id` equals the caller's own verified
        `auth.uid()`** — otherwise it returns "not found," regardless of
        whether a row actually exists for some *other* target. This is
        what makes accepting a client-supplied `anonymous_user_id` safe:
        the function never reveals or acts on anything beyond "was my
        own (already-authenticated, independently verified) account the
        target of a merge from this anonymous id" — a caller cannot use
        this to probe or confirm merges belonging to other accounts, and
        confirming their own merge status requires no privilege they
        don't already have (they can already see the resulting cart/
        orders via normal RLS-governed reads).
     3. **`data_merged`/`completed`** → confirmed: the main client now
        safely calls `setSession()` with the target session, and the
        formerly-anonymous session is abandoned only now, after
        confirmation — not optimistically beforehand.
     4. **`in_progress`** → the merge may still be running; the client
        polls this same check again shortly rather than concluding
        anything.
     5. **`failed` or not-found** → the merge did **not** succeed. The
        client does not switch sessions yet — if the original anonymous
        session (on the main client) is still intact, it can retry the
        merge flow from scratch; if not, it falls back to the documented
        interim behavior (switch to target, leave the guest cart/
        wishlist behind as a separate, still-accessible-only-via-its-own-
        anonymous-session state) — never silently assumed merged.
   - **The Edge Function times out mid-processing**: if the timeout
     occurs before the Postgres transaction commits, Postgres's own
     rollback-on-disconnect behavior undoes it entirely — safe to retry
     from scratch (the `guest_merge_attempts` row stays `in_progress`,
     recoverable per the stale-timeout rule below). If the timeout occurs
     after the transaction commits but before/during the Auth deletion
     call, this is the same case as "data reassigned, deletion not yet
     confirmed" above — `data_merged`, recoverable by the reconciliation
     sweep.
   - **The client retries the same merge request**: the
     `guest_merge_attempts` PK conflict (4B) catches this — a retry
     while a prior attempt is still genuinely `in_progress` gets "try
     again shortly"; a retry after the prior attempt reached
     `data_merged`/`completed` gets an immediate success response
     (idempotent — no re-execution of the reassignment logic, which
     matters because re-running the wishlist/cart quantity-summing logic
     a second time *would* double-count if it weren't blocked here).
   - **Two requests arrive concurrently**: covered by 4B — exactly one
     wins the `INSERT`, the other reads the resulting row and responds
     without touching data.
   - **The target account "changes" between attempts** (user signs in
     to a *different* existing account on a retry than the first
     attempt used): if the first attempt already reached `data_merged`/
     `completed`, the stored `target_user_id` on the `guest_merge_attempts`
     row is authoritative — a later attempt with a different target is
     rejected ("this guest identity was already merged into a different
     account"), not silently re-merged into the new one. This prevents a
     confused or malicious retry from re-routing already-merged data.
   - **Stale `in_progress` row** (Edge Function crashed without reaching
     `data_merged` or `failed`) — **corrected; the earlier recovery logic
     here was unsafe.** A prior revision had the reconciliation sweep
     infer whether the reassignment committed by checking "do any cart/
     wishlist/order rows still reference `anonymous_user_id`?" **This is
     wrong**: a guest with an empty cart, no wishlist, and no orders
     produces zero matching rows *regardless* of whether the transaction
     ever ran, so this check cannot distinguish "committed, nothing to
     move" from "never ran" for an empty guest identity — exactly the
     case the audit asked to be handled correctly. **Corrected logic:
     the `status` column itself is the authoritative evidence, full
     stop — no row-counting needed.** Because the transition to
     `data_merged` happens *inside* the same Postgres transaction as the
     reassignment (4A), Postgres's atomicity guarantee means: if that
     transaction committed, `status` already reads `data_merged` (not
     `in_progress`); if it didn't commit, `status` is still
     `in_progress`. A row still observed at `in_progress` past the
     bounded timeout is therefore proof, by construction, that the
     transaction never committed — there is nothing else to check. The
     sweep simply resets it to `failed` (clearing `target_user_id`, per
     4F below) and allows a clean retry. This is correct identically for
     a guest with substantial cart/order data and a guest with none —
     the fix removes the dependency on data volume entirely.

   **4D. Token validity — what deleting an Auth user does and does not
   guarantee.** Deleting a Supabase Auth user does **not** instantly
   invalidate every already-issued, unexpired access token everywhere by
   some global blacklist the moment the row is deleted — this document
   does not assume that guarantee exists. What actually happens, and
   what must be verified rather than assumed:
   - **Auth user deletion** removes the `auth.users` row (and, via
     `ON DELETE CASCADE`, the `profiles` row — see §4, `profiles`).
   - **Existing access-token expiration** is unaffected by the deletion
     — a short-lived access token issued before deletion may still pass
     local signature/expiry verification at the PostgREST layer until it
     naturally expires.
   - **Server-side identity verification** (`auth.uid()` resolving for a
     request bearing such a token) may still technically resolve to the
     deleted id for the remainder of that token's natural lifetime,
     depending on Supabase's exact token-validation implementation — not
     relied upon to be instantly revoked.
   - **Authorization checks against current database state** are what
     actually render a lingering token harmless, not token revocation:
     every cart/wishlist/order row that referenced the deleted anonymous
     id was already reassigned (§4A) before deletion, so an RLS query
     filtering `customer_id = auth.uid()` for that stale id matches
     **zero rows** — there is nothing left to read or write, regardless
     of whether the token itself is "truly" revoked. Similarly, any
     `has_role_at_least()` check joins through `profiles`, which no
     longer has a row for the deleted id (cascaded), so role checks
     default-deny rather than default-permit for a lingering token. The
     security property here is **"nothing left to access," not
     "token proven invalid"** — an important distinction this document
     states explicitly rather than conflating.

   **4E. Required implementation tests** (concrete scenarios, to be
   written as real tests in Phase 2+, not implied by this design alone):
   1. Two concurrent merge requests for the same anonymous identity →
      exactly one proceeds past the `guest_merge_attempts` insert; the
      other receives a non-error "in progress, retry shortly" or
      "already merged" response; verify no double-reassignment and no
      doubled cart-item quantities.
   2. Simulate Auth deletion failure after a successful data-reassignment
      commit → verify the client-visible merge is still reported as
      successful, the `guest_merge_attempts` row is `data_merged`, and
      the reconciliation sweep (or the ordinary cleanup job) eventually
      deletes the orphaned anonymous user.
   3. Simulate a lost response after both the DB commit and the Auth
      deletion succeed → client calls `get_my_guest_merge_status` from
      its already-authenticated-as-target throwaway client → verify it
      returns `data_merged`/`completed` and the main client only then
      switches sessions — and, separately, verify that an *unrelated*
      anonymous-auth failure (e.g. a simply-expired anonymous token with
      no merge attempted) does **not** cause the client to conclude a
      merge succeeded.
   4. Kill the Edge Function before the Postgres transaction commits →
      verify full rollback, zero residual state, clean retry.
   5. Kill the Edge Function after commit but before updating
      `guest_merge_attempts`/calling delete → verify the reconciliation
      sweep correctly reads `status = 'data_merged'` (not re-derived from
      row counts) and resolves the stuck row accordingly; separately,
      repeat with an anonymous identity that owns **zero** cart/wishlist/
      order rows and verify the sweep's behavior is identical (no
      row-counting dependency).
   6. Submit an expired/invalid `target_jwt` → verify clean rejection,
      zero partial state written.
   7. Attempt a second merge for the same anonymous identity into a
      *different* target account after the first already completed →
      verify rejection referencing the original `target_user_id`, not a
      silent re-merge. Separately, attempt a second merge with a
      *different* target after the first attempt was reset to `failed`
      (never committed) → verify this one is allowed, confirming
      `target_user_id` was correctly cleared on reset.
   8. Query data as a lingering (not-yet-garbage-collected,
      already-reassigned) anonymous identity's stale token → verify
      zero rows returned from every cart/wishlist/order query and a
      default-deny result from any role check, confirming the "nothing
      left to access" property of §4D rather than assuming it.
   9. Call `get_my_guest_merge_status` authenticated as account A,
      passing an `anonymous_user_id` whose `guest_merge_attempts.
      target_user_id` is actually account B → verify the response is
      "not found," not account B's real status, confirming the function
      cannot be used to probe other accounts' merge outcomes.

   **4F. Target-account binding — explicit rules** (full detail and
   rationale: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1,
   `guest_merge_attempts`): `target_user_id` is provisional until the
   reassignment transaction commits, and permanently bound afterward.
   Before commit, a reset-after-failure clears it, so a retry is free to
   use a different target. After commit, any later request for the same
   anonymous identity is answered from the already-bound
   `target_user_id` — a matching target gets idempotent success, a
   different one gets explicit rejection, and neither case re-executes
   the reassignment. This is what guarantees reassigned data can never
   be redirected to a second account after the fact, addressed in test
   #7 above.

   **Rate limiting**: the Edge Function endpoint is rate-limited per
   anonymous-session and per-IP (mechanism TBD in Phase 2) to bound abuse
   of repeated merge attempts.

   **If Supabase's architecture is the limiting factor, say so plainly**:
   true cross-service atomicity between a Postgres transaction and an
   Auth Admin API call is **not achievable** with Supabase's current
   architecture — they are different services with independent
   transaction boundaries, and no amount of application-level code
   changes that. The design above does not pretend otherwise; it
   achieves a weaker but sufficient guarantee (the DB-side merge is
   genuinely atomic; identity deletion is a best-effort, retryable,
   eventually-consistent follow-up whose failure doesn't compromise
   correctness, only delays cleanup) rather than hiding this limitation
   behind the word "atomic."
5. **Session-transition behavior, stated explicitly for every case asked
   about, not left implicit:**
   - **Guest signs into an existing account**: the two-token Edge
     Function flow above, with the `guest_merge_attempts`-mediated
     concurrency/recovery behavior in 4A–4D.
   - **Guest creates a new account**: unaffected by this revision —
     Supabase's anonymous-to-permanent identity linking keeps the *same*
     `auth.uid()`, so there is no second identity to prove possession of
     and no merge step at all. This path has no ticket-theft-shaped risk
     and no `guest_merge_attempts` row, because there is only ever one
     identity.
   - **A fresh sign-in replacing the anonymous session** only happens
     client-side *after* the Edge Function reports success — the
     anonymous session is deliberately kept alive client-side until the
     server-side data reassignment has already committed, so there is no
     window where the client has "given up" the anonymous session's
     proof before the merge that needs it has happened.
   - **The target token expires before redemption**: covered in 4C.
   - **The redemption request is retried**: covered in 4C/4B.
   - **Two redemption requests arrive concurrently**: covered in 4B.
   - **The browser closes between obtaining `target_jwt` and calling the
     Edge Function**: no `guest_merge_attempts` row is created until the
     Edge Function call actually happens, so nothing is orphaned — the
     guest remains anonymous with their original session (if its own
     storage persisted) or loses it entirely (same as any anonymous-
     session loss unrelated to this mechanism); retrying from the start
     is always safe.
6. **Anonymous-identity cleanup does not rely on Supabase's platform
   default as-is.** This review does not assume that feature's built-in
   candidate selection is aware of this application's `orders` table, so
   a custom scheduled job is specified instead — see §2.2 below and
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 for the exact candidate
   query.

**Remaining security limitations, stated honestly rather than implied
away:**
- **No client-side scheme is theft-proof against a fully compromised
  browser.** If the device is compromised (malware, a malicious browser
  extension, physical access) or the application has an XSS
  vulnerability *at the exact moment* both the anonymous session and the
  `target_jwt` are live in memory, an attacker who can execute arbitrary
  JS in that page can exfiltrate both and complete the exchange exactly
  as the legitimate user would — this mechanism raises the bar from
  "possess one bearer token" to "possess two, simultaneously, during a
  short window," it does not make the exchange cryptographically
  impossible to intercept. No purely browser-side design can fully close
  this; it is a structural limit of SPA-based auth flows, not a flaw
  specific to this mechanism.
- **This narrows, rather than eliminates, the attack surface the original
  ticket design left wide open.** The prior design's flaw — *any* holder
  of the bearer token could redeem it into *any* account they chose —
  is closed (redemption is now bound to whichever account the holder can
  *currently* authenticate as, verified independently, not asserted).
  What remains is the generic, unavoidable risk that a sufficiently
  compromised browser can impersonate its own legitimate user — a risk
  that exists for every authenticated action in the application, not one
  specific to guest-identity merge.
- **Network-level interception** (a non-HTTPS connection, a
  misconfigured CORS/CSP policy exposing the page to injection) is
  mitigated by standard transport security (HTTPS everywhere, a correct
  CSP) which this document assumes but does not itself enforce — that
  enforcement is a Phase 2 deployment-configuration task, not a
  guarantee this design provides on its own.
- **This design is Proposed, not Resolved**, specifically because it has
  not been implemented or tested — the two-token exchange is sound on
  paper but introduces real engineering surface (two Supabase client
  instances in one page, an Edge Function verifying a second JWT) that
  needs to be built and security-tested, not assumed correct from this
  description. See [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) for the
  tracked status.

## 2.2 Order Retention & Anonymous Identity Deletion Safety

This resolves a gap the original guest-cart design didn't address: nothing
in §2.1 as first written said what happens to an anonymous identity's
**orders** (as opposed to its cart/wishlist) when that identity is merged
or cleaned up. Full detail: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
§3.1. Summary of the guarantees:

- **`orders.customer_id` is `ON DELETE RESTRICT`**, not `CASCADE`. The
  database itself refuses to delete any `auth.users` row — anonymous or
  not — while an order still references it. This is enforced independently
  of whatever application code does or doesn't check first, which is the
  point: a cleanup job's own candidate-selection bug cannot silently
  destroy order history, because the database's own constraint is the
  final backstop, not just the job's query logic.
- **The cleanup job's candidate query excludes any anonymous identity that
  owns an order** (`NOT EXISTS (SELECT 1 FROM orders WHERE customer_id =
  u.id)`), so in normal operation the `RESTRICT` constraint is never even
  triggered — it exists as a safety net for the case where the query logic
  is ever wrong, not as the primary mechanism.
- **An anonymous identity that owns an order is retained indefinitely by
  this exclusion** — not deleted on a schedule this project controls —
  until a separate, explicit data-retention policy (not assumed or
  invented here) says otherwise. This is the documented retention
  restriction requested in place of assuming Supabase's built-in
  anonymous-cleanup default is already aware of this constraint.
- **Guest orders that are never merged into an account remain fully
  accessible via the anonymous identity's own session** for as long as
  that session/browser persists, and are never deleted regardless of how
  long it's been — but a guest who loses that session (cleared cookies,
  different device) and never created an account has no current
  storefront path to look the order up again. This is flagged as a
  product gap in [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md), not resolved
  by assuming it doesn't matter.

## 3. Authorization Model

| Role | Scope |
|---|---|
| `customer` | Own profile, own orders, own cart/wishlist. No catalog write access. |
| `staff` | Catalog management (products, categories, inventory), order management, customer lookup (read-only on customer PII beyond what's needed for support). Cannot manage other staff accounts or store settings. |
| `admin` | Everything `staff` can do, plus coupons, homepage content, store settings. |
| `owner` | Everything `admin` can do, plus staff account management (invite/role changes/deactivation). |

- Role stored on `profiles.role`, set only by `admin`/`owner` via a
  restricted update path (never self-assignable by the user).
- Admin UI routes gated by a React Router guard checking role via the
  session; **this is UX only** — the authoritative check is RLS on every
  table/RPC the admin UI calls.

### 3.1 Enforcing the Same Hierarchy at Every Layer

The role hierarchy (`owner > admin > staff > customer`) must produce the
**same answer** whether it's evaluated in the React Router route guard or
in an RLS/RPC check. The risk being guarded against is drift: a guard
written as "allow admin or owner" and an RLS policy written as "allow
staff or above" for the *same* feature would give a different, silently
inconsistent answer depending on which layer actually stops the request —
and whichever layer is loosest wins in practice. (With no application
server tier — see [ARCHITECTURE.md](./ARCHITECTURE.md) §9 — there are now
only two layers to keep in agreement instead of three, which narrows
where this drift could even occur.)

Resolution:
- **A single Postgres function is the one definition of the hierarchy**:
  `has_role_at_least(min_role text) returns boolean`, `STABLE`, reading the
  caller's own role (`SELECT role FROM profiles WHERE id = auth.uid()`,
  which the caller is always allowed to read under their own
  self-`SELECT` policy — see §4, `profiles`) and comparing it against a
  fixed ordering (`owner > admin > staff > customer`). It runs as
  `SECURITY INVOKER` (the default) — it does not need `SECURITY DEFINER`,
  since it only ever reads the calling user's own row, which RLS already
  permits.
- `owner` is modeled as a superset of `admin`, not a parallel/separate
  role, specifically so a policy written for `admin` automatically
  includes `owner` through the hierarchy function rather than requiring
  every policy to remember to list both. This is the direct fix for the
  "ensure owner access works correctly" requirement: owner access failures
  in practice almost always come from a policy that lists roles explicitly
  (`role IN ('admin')`) and simply forgets `owner`, not from a logic error
  — using the hierarchy function removes that failure mode by construction.
- **Where each layer actually gets its answer from — resolved, not left
  ambiguous:**
  - **RLS policies**: call `has_role_at_least(...)` directly in the
    policy's `USING`/`WITH CHECK` clause. This is the authoritative check.
  - **Other `SECURITY DEFINER` RPCs** (e.g. `create_variant`,
    `cancel_order`): call `has_role_at_least(...)` explicitly as the first
    statement in the function body. This is **not optional/defensive** —
    it is the *only* authorization check that runs for these functions,
    because a `SECURITY DEFINER` function executes with the privileges of
    its owner and **bypasses RLS on the tables it touches**. A
    `SECURITY DEFINER` function that omits this check is a privilege-
    escalation hole regardless of what RLS says, since RLS is never
    consulted inside it.
  - **There is no application-server layer left to call this function
    "on behalf of" the client** — the browser calls the RPC directly
    (see [ARCHITECTURE.md](./ARCHITECTURE.md) §9). This is a
    simplification versus the old Next.js-era design, not a gap: that
    design's "Next.js server re-checks the role via the same RPC before
    calling the real RPC" step was always a second look at a check the
    real RPC was going to perform again anyway. Removing the middle step
    removes a redundant round trip, not a check.
  - **The React Router route guard** is the one deliberate exception, and
    is explicitly scoped to UX only: it reads the role claim already
    cached in the client-side auth context (no extra round trip, for a
    fast pre-navigation redirect) and compares it locally. This is safe
    specifically *because* it is not treated as authoritative anywhere —
    every mutation and every sensitive read it might let through still
    passes through RLS or a `SECURITY DEFINER` RPC's own
    `has_role_at_least()` call, either of which can and will refuse what
    the guard let through. The guard is documented here as "allowed to be
    cheap and slightly stale" — not as a second source of truth.
- Privilege escalation is prevented at the data layer, not just by hiding
  UI: `profiles.role` is excluded from the set of columns a user can
  change on their own row (§4, `profiles`), so even a direct authenticated
  API call attempting `UPDATE profiles SET role = 'owner' WHERE id =
  auth.uid()` is rejected by the policy itself, independent of what the
  admin UI does or doesn't expose.

### 3.2 `SECURITY DEFINER` Function Safety

Every `SECURITY DEFINER` function in this system (`create_variant`,
`update_variant_attributes`, the order-placement RPC, `cancel_order`,
`resolve_payment_event`, `get_my_guest_merge_status` (§2.1 item 4C's
lost-response fix — needs `SECURITY DEFINER` to read
`guest_merge_attempts`, which has no client-facing RLS grant at all, but
internally filters its result to rows where `target_user_id =
auth.uid()`, so the elevated read is never exposed beyond the caller's
own outcome), and any future one) follows the same two hardening rules,
not just the role check in §3.1. **Guest-identity merge *itself* is
deliberately not in this list**: per §2.1 item 4, the merge operation
runs as a Supabase Edge Function using its own service-role Postgres
connection,
which bypasses RLS by design (the same trust model as the payment
webhook handler and refund outbox worker) rather than being a
client-callable `SECURITY DEFINER` RPC — there is no `EXECUTE` grant to
reason about for it, because no client role is ever granted the ability
to call its underlying database operation directly.

1. **`SET search_path = public, pg_temp`** declared on the function itself
   (`CREATE FUNCTION ... SECURITY DEFINER SET search_path = public,
   pg_temp AS $$ ... $$`). Without a fixed `search_path`, a
   `SECURITY DEFINER` function resolves unqualified table/function names
   using the *caller's* `search_path` at call time — which a malicious or
   compromised caller role could manipulate (e.g. creating a same-named
   object in a schema earlier in their own search path) to redirect what
   the function actually reads or writes while it's running with the
   owner's elevated privileges. Fixing `search_path` on the function
   definition removes this class of attack entirely.
2. **`EXECUTE` is revoked from `PUBLIC` and granted only to the roles that
   should be able to call it** — `REVOKE EXECUTE ON FUNCTION ... FROM
   PUBLIC;` followed by an explicit `GRANT EXECUTE ... TO authenticated`
   (Supabase's standard signed-in Postgres role, which anonymous-sign-in
   guests hold too, per [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3) for
   customer-facing RPCs like order placement, or left ungranted entirely
   for functions only ever invoked by a service-role context (the
   `refund_requests` outbox worker's internal update logic, for example,
   is plain `SECURITY INVOKER` SQL run by the service role, not a
   client-callable RPC at all). Fine-grained staff/admin/owner
   restriction beyond "any authenticated user" is enforced by the
   `has_role_at_least()` call inside the function body (§3.1) — Postgres
   `GRANT`/`REVOKE` controls *who can call the function at all*, the
   in-function check controls *what they're allowed to do once inside*.
   Both are required; neither alone is sufficient.

## 4. Row Level Security — Policy Direction

(Mirrors [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §8, stated as policy intent.)

- **Catalog tables** (`products`, `categories`, `category_attributes`,
  `product_variants`, `product_images`, `attributes`, `attribute_values`):
  - `SELECT`: public, but scoped to `status = 'active'` for anonymous/
    customer roles; staff/admin/owner see all statuses (including drafts).
  - `INSERT/UPDATE/DELETE`: `staff`/`admin`/`owner` only, via
    `has_role_at_least('staff')` (§3.1).
  - `product_listing_summary`: public `SELECT`; **no role** has
    `INSERT/UPDATE/DELETE` — only its maintaining trigger writes it
    (`SECURITY DEFINER`).
- **`orders` / `order_items` / `order_status_history`:**
  - Customers: `SELECT` where `customer_id = auth.uid()` only. No direct
    `INSERT` — orders are created via a Postgres function (RPC) that
    validates stock and pricing server-side, not via a raw table insert
    from the client.
  - Staff/admin/owner: full `SELECT`, `status` `UPDATE` only (never edit
    historical `order_items` pricing). `payment_status` is **not** in the
    set of columns staff/admin/owner can update directly — only the
    webhook handler (service role) changes it. See §5.1.
- **`payment_events`:** no access for `customer`/`staff`. `admin`/`owner`
  may `SELECT` (to see flagged events) and may call the
  `resolve_payment_event` RPC (§3.2) — there is **no direct `UPDATE`
  grant on the table** for any role; the RPC performs the write itself
  under its own `SECURITY DEFINER` check. The automatic insert-and-apply
  path for non-flagged events remains service-role only, bypassing RLS
  entirely from the Edge Function.
- **`refund_requests`:** staff/admin/owner may `SELECT` (surfacing refund
  status in the admin order view); `INSERT` only via the `cancel_order`/
  refund-retry RPC; `UPDATE` of outcome/lease fields only by the
  service-role outbox worker — no role can mark a refund `succeeded` or
  `provider_accepted` directly. See §5.1–5.2 and
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.
- **`profiles`:**
  - A user may `SELECT`/`UPDATE` their own row, but **cannot update their
    own `role` or `is_anonymous` columns** (enforced via a restrictive
    column-level policy or a trigger that rejects the change, not just
    app-layer omission — see §3.1).
  - `admin`/`owner` may update any profile's `role`.
- **`coupons`:**
  - No direct public `SELECT` of the full table (would leak all active
    codes). Validation happens through a restricted RPC that returns only
    whether a given code is currently valid, not the full coupon list.
  - Full CRUD restricted to `admin`/`owner` (not `staff` — coupon creation
    is an admin-tier action, see §3).
- **`carts`/`cart_items`/`wishlists`/`wishlist_items`/`comparisons`/
  `comparison_items`:**
  - A **single uniform policy**: `customer_id = auth.uid()`. There is no
    guest-vs-customer branch and no session-token comparison, because
    guests hold a real (anonymous) `auth.uid()` — see §2.1 and
    [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.
- **`store_settings`, `homepage_sections`, `homepage_section_items`:**
  - Public `SELECT`. Write restricted to `admin`/`owner`.

## 5. Checkout & Payment Security

- Order placement (stock check, price calculation, coupon application,
  stock decrement) runs inside a single Postgres transaction (function
  called via RPC) with row-level locks on the affected variants, preventing
  race conditions (double-spend of last unit of stock under concurrent
  checkouts) and preventing a client from submitting a tampered total.
- Payment provider integration (provider TBD — see
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)) is handled via:
  - Client-side tokenization (card details never touch our server) if using
    a provider like Stripe.
  - Server-side/Edge Function webhook verifying the provider's signature
    before marking `payment_status = 'paid'` — **payment status is never
    set based on a client-reported "success."**

### 5.1 Payment Status vs. Order Status, Cancellation, Refunds — System Boundary

- `orders.status` (fulfillment lifecycle) and `orders.payment_status` are
  separate fields updated by separate code paths — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) and
  [ARCHITECTURE.md](./ARCHITECTURE.md) §7.1. This is a deliberate
  resolution so "mark as shipped" (a staff action on `status`) can never
  accidentally also flip `payment_status`, and so a payment webhook can
  never accidentally change fulfillment state.
- **Cancellation** (customer, while `status = 'pending'`, or staff/admin at
  any pre-shipment status) runs through a `cancel_order` Postgres RPC:
  sets `status = 'cancelled'`, restores the reserved stock to the relevant
  variants, and — if `payment_status = 'paid'` — **enqueues a
  `refund_requests` row** (`status = 'pending'`) in the *same* transaction.
  The RPC refuses cancellation once `status` has reached `shipped` or
  later (handled as a return/refund process instead, not a cancellation).
- **Corrected system boundary — this RPC never calls the payment provider
  directly.** A Postgres function/RPC runs inside a database transaction
  and has no business making outbound HTTP calls from there: a slow or
  failing provider API call made from inside that transaction would hold
  the lock on the order/variant rows for as long as the external call
  takes, blocking unrelated order operations, and a DB transaction is not
  a safe place to retry a flaky network call. **`cancel_order`'s job ends
  at writing the `refund_requests` row** — a durable, transactional record
  of "a refund needs to happen" (the transactional-outbox pattern). The
  actual provider API call is made by a separate trusted process (a
  Supabase Edge Function, triggered by a Database Webhook on
  `refund_requests` insert, or a scheduled poller) running outside any
  database transaction, with its own retry/backoff and idempotency key
  (the `refund_requests.id`, passed to the provider so a retried call
  can't double-refund). Full lifecycle, retry behavior, and failure
  handling: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3,
  `refund_requests`.
- **Refunds are only ever recorded as `payment_status = 'refunded'` after
  the payment provider confirms the refund** (via webhook, same signature-
  verification path as a payment confirmation) — a refund is never marked
  complete purely because staff clicked "refund" in the admin UI, and not
  purely because the outbox worker's synchronous call to the provider
  returned an accepted response either: that response only advances
  `refund_requests.status` to `provider_accepted` (a deliberately distinct
  state from `succeeded`), while `orders.payment_status` changes only on
  the provider's own *asynchronous* webhook confirmation, which is also
  what moves `refund_requests.status` the rest of the way to `succeeded`.
  Two independent signals have to agree before the order is treated as
  refunded in the data customers and staff see. Full state machine
  (including worker-crash/lease-expiry recovery and why the idempotency
  key is reused unchanged across every retry):
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3, `refund_requests`.
- **Lifetime duplicate-refund protection is not the same guarantee as
  "no two concurrent requests."** A second partial unique index —
  `UNIQUE (order_id) WHERE status = 'succeeded'` — makes a second
  successful refund for the same order impossible regardless of elapsed
  time, independent of the index that only blocks *overlapping* requests.
  A retry after a `failed` attempt is explicitly allowed (via an audited
  admin "retry refund" action, not an automatic loop), but a retry after a
  `succeeded` one is not — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2.

### 5.2 Webhook Idempotency and Failure Recovery

Expanding on §7.2 of [ARCHITECTURE.md](./ARCHITECTURE.md) and the
`payment_events`/`refund_requests` design in
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3:

- **Duplicate webhook delivery**: the `payment_events` unique constraint
  on `(provider, provider_event_id)` makes redelivery (which providers
  explicitly document as possible) a safe no-op, **because** the insert
  and the business-effect update are statements in one transaction — see
  below.
- **Event recorded but processing fails / transaction rollback**: the
  design deliberately avoids ever marking an event "processed" before its
  business effect is committed. The `INSERT INTO payment_events` and the
  effect it triggers (e.g. `UPDATE orders SET payment_status = 'paid'`)
  are statements in the **same** transaction. If the effect fails, the
  whole transaction — including the `payment_events` insert — rolls back.
  Nothing is left half-applied, and because the insert itself didn't
  survive, the event is not considered processed: the handler returns a
  failure status to the provider, which retries delivery per its normal
  webhook retry policy, and that retry runs against a clean slate.
- **Retry after temporary failure**: covered by the above — a transient
  failure (e.g. a lock timeout) simply means the transaction wasn't
  committed, so provider-side retry is the recovery mechanism; no separate
  local retry queue is needed for this path. (`refund_requests` has its
  own retry loop for the *outbound* provider call, which is a different
  direction of communication — see §5.1.)
- **Out-of-order payment events** (e.g. a refund-confirmation event
  arriving before the system's own expectation of a prior state): the
  handler checks that the event's implied transition is valid for the
  order's current `payment_status` before applying it. If not, the event
  is still recorded (so it's never silently lost) but flagged
  `requires_review = true` and the business effect is **not** applied
  automatically — it surfaces for manual `admin`/`owner` resolution via
  the audited `resolve_payment_event` RPC rather than guessing at the
  correct order of events. That RPC checks `effect_applied_at IS NULL`
  before acting, which is what prevents a flagged event from ever being
  applied twice — once automatically (impossible, since it was flagged
  instead of auto-applied) and once manually, or twice manually via a
  double-submitted resolution. Full lifecycle:
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2.
- **Duplicate refund requests — two distinct guarantees, not one**:
  (1) *concurrent* duplicates are prevented by a partial unique index on
  `refund_requests(order_id)` covering outstanding statuses, and by the
  provider idempotency key (`refund_requests.id`, reused unchanged across
  every retry, never regenerated) passed on every call to the provider's
  refund API, so even a retried call from our own outbox worker can't
  cause the provider to issue the refund twice; (2) *lifetime* duplicates
  (a brand-new request created long after an earlier one already
  succeeded) are prevented by the separate `succeeded`-only partial
  unique index — a different mechanism, because the first index's
  coverage doesn't include `succeeded`. See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2.
- **Why this approach (transactional outbox + idempotent webhook handling)
  and not, e.g., a message queue**: at this scale (a single Postgres
  database already holding all order state), writing the "intent to call
  an external API" as a row in the same transaction as the state change it
  depends on gives the strongest consistency guarantee available without
  adding new infrastructure — the intent cannot be lost even if the
  process crashes immediately after commit, because it's already durable
  in Postgres. The tradeoff is that the actual delivery (the outbox
  worker) is a separate moving part that needs its own monitoring (stuck
  `pending`/`in_flight` rows are the symptom to alert on), rather than
  getting delivery guarantees "for free" from a managed queue — judged
  acceptable for the current scale and revisited only if refund volume or
  reliability requirements grow enough to justify a managed queue.
- PCI scope is minimized by never storing raw card data — delegated
  entirely to the payment provider.

### 5.3 Two Previously-Identified Gaps That Remain Explicitly Open

These are **not resolved by this document** — they are restated here so
they stay visible rather than being quietly implied as handled by the
`refund_requests` state machine above.

1. **Refund reconciliation when a `provider_accepted` request never
   receives a webhook.** The state machine in
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 moves a refund from
   `provider_accepted` to `succeeded`/`failed` only via the provider's
   asynchronous webhook — but says nothing about what happens if that
   webhook is simply never delivered (provider-side failure, a
   misconfigured endpoint, an event lost outside the documented
   at-least-once-delivery guarantee). **Recommended architectural
   resolution, not yet implemented or verified**: a scheduled
   reconciliation job queries `refund_requests` where
   `status = 'provider_accepted' AND provider_accepted_at < now() -
   interval 'N hours'` and, for each, actively calls the provider's
   refund-status-lookup API (if one exists) rather than continuing to
   wait for a push notification that may never arrive; the result is
   applied through the same idempotent, transactional path as a webhook
   (so a webhook that *does* eventually arrive late is still a safe
   no-op against a reconciliation-job-applied result, and vice versa).
   **This depends directly on [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)
   item #1 (payment provider choice) and its capabilities**: not every
   provider necessarily exposes a
   status-lookup API, in which case the fallback is a manual ops
   reconciliation runbook (an admin-visible "stuck refund, provider
   status unknown" state) rather than an automated job — which capability
   the chosen provider actually has is not assumed here.
2. **Refund policy: one successful refund per order, or multiple partial
   refunds under an aggregate cap?** The current schema's partial unique
   index — `UNIQUE (order_id) WHERE status = 'succeeded'`
   ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2) — **implicitly
   commits to "at most one successful (full) refund per order."** This
   was reasonable as a default to make the lifetime-duplicate-prevention
   mechanism concrete, but it has not actually been confirmed as the
   business's intended policy, and this document flags that rather than
   letting the schema's existing shape silently stand in for a decision
   nobody made. **If partial refunds with an aggregate cap are wanted
   instead**, the mechanism would need to change from "at most one
   `succeeded` row" to a check (likely a trigger or the refund-creating
   RPC itself) that `SUM(amount)` over all `succeeded` `refund_requests`
   rows for that order never exceeds `orders.grand_total` — a materially
   different constraint, not a small tweak, so this is worth resolving
   before Phase 5/6 builds against one assumption or the other. Tracked
   as open business decision item #17 in
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

## 6. Data Protection

- Customer PII (addresses, phone) stored with access restricted by RLS as
  above; admin access is scoped to what support/fulfillment needs, not
  exposed broadly to all staff by default (owner can restrict further via
  role granularity if needed post-launch).
- Addresses on orders are stored as a `jsonb` snapshot, not a live FK to a
  mutable address table — preserves historical accuracy and limits blast
  radius if a customer's saved address table is compromised later (orders
  remain correct/immutable).
- **`product-images` is not an unconditionally-public bucket — corrected
  in §6.2.** It is a private (RLS-governed) bucket whose read policy
  requires a matching `product_images` row to already exist; write
  access is service-role only. No customer-uploaded content is in scope
  for v1 (no user-generated images), simplifying the storage threat
  model.

### 6.1 Image Upload Validation — Corrected Trust Boundary

**A prior revision of this document claimed that "a validating
`SECURITY DEFINER` function" sniffs actual file content around the
upload flow. That claim was wrong and is retracted here, not
reworded.** A Postgres function — `SECURITY DEFINER` or otherwise —
never receives the uploaded file's bytes: Supabase Storage uploads go
directly from the browser to Storage's own API, bypassing Postgres
entirely. The only thing a database function could ever see about an
upload is a row in `storage.objects` recording *metadata* the uploader
self-reported (declared size, declared content-type) — which is exactly
the client-controlled, spoofable information real content validation is
supposed to defend against, not a substitute for it. This document now
distinguishes four things the original text conflated:

1. **File metadata validation** (declared size, declared MIME type) —
   checkable from `storage.objects`, but self-reported and spoofable;
   useful only as a cheap first filter, never as the security boundary.
2. **Actual content validation** (does this file's bytes genuinely decode
   as a JPEG/PNG/WebP of a sane size, with no embedded payload) — requires
   reading the actual bytes, which only something that receives them
   (an Edge Function, or Storage itself if it offers this) can do.
3. **Storage authorization** (who can write to which bucket/path) —
   Supabase Storage policies, unaffected by this correction, still the
   right tool for this and used below.
4. **Trusted processing** (promoting a validated file to its public,
   permanent location) — must happen in a context with elevated
   privilege, after content validation succeeds, never before.

**Two approaches were evaluated:**

| | **Option A: direct upload to a private quarantine bucket, then trusted post-upload validation (recommended)** | Option B: all uploads routed through a trusted Edge Function |
|---|---|---|
| Upload path | Browser → Storage directly (quarantine bucket), full Storage feature support (resumable uploads, progress, no intermediary) | Browser → Edge Function → Storage (every byte transits the function) |
| Product-photography fit | Handles large, high-resolution originals (rug/carpet photography can run several MB per image) without hitting a function's request-size/memory/timeout limits | Edge Function runtime limits (request body size, execution timeout, memory) are a real constraint for large originals and batch admin uploads across a 1,000+ product catalog |
| Security | Quarantine bucket is private (no public read), so nothing unvalidated is ever publicly reachable; validation happens before promotion | Equivalent security outcome, but at the cost of the constraint above |
| Operational complexity | One additional bucket, one validating Edge Function triggered on upload, one promotion/cleanup step | Simpler topology (no quarantine bucket) but the function must handle the full file transfer, doubling bandwidth (in and back out to Storage) and holding the whole file in memory |
| Scalability (1,000+ products, bulk admin uploads) | Scales with Storage's own upload handling, not the function's | Every upload bottlenecked through function concurrency/limits |
| **Recommendation** | **Chosen** | Documented as evaluated and not chosen, for the reasons above |

**Chosen design — quarantine bucket plus trusted post-upload validation:**

1. A **private** `product-images-quarantine` bucket. Storage policy:
   `staff`/`admin`/`owner` (via `has_role_at_least('staff')`) may `INSERT`
   an object at a path prefixed by their own `auth.uid()`
   (`{uploaded_by}/{pending_image_uploads.id}.{ext}` — see §3A below for
   why the path embeds the DB row's id rather than a random value);
   **no role may `SELECT` from this bucket** — not even the uploader
   reading their own file back — only the service role can. This is
   what makes "temporary exposure" during the unvalidated window a
   non-issue: the bucket is never publicly readable, and not even
   privileged-but-non-service-role readable, at any point.
2. **The `product-images` bucket's write access is service-role only,
   and — corrected in §6.2 — it is not an unconditionally-public bucket
   for reads either.** `staff`/`admin`/`owner` do **not** have a direct
   write policy on this bucket at all. Every object that ever lands
   here passed through the state machine below first, and — per §6.2 —
   is not actually *readable* by anyone until a `product_images` row
   references it, regardless of the object's physical presence in the
   bucket.

### 6.2 Public Object Exposure — Corrected Access Boundary

**A prior revision of this document claimed "the `product_images` row,
and therefore the public-facing gallery, is created only after
validation succeeds — never before, never speculatively," and treated
this as the thing that kept an unapproved object from being publicly
reachable. That claim does not hold on its own and is corrected here,
not reworded.** Whether an object is *publicly fetchable* is a property
of the Storage bucket/policy configuration, not of whether any
particular database row happens to reference it yet. If `product-images`
were configured as Supabase's "public" bucket type (which skips RLS
entirely for reads), then the instant the validating Edge Function
copies a file into it, **that object is fetchable by its direct URL by
anyone who has or guesses that URL — independent of whether the
`product_images` row insert that was supposed to happen "at the same
time" has actually landed yet.** The original design's ordering
(copy, then write the row) does not prevent this: a client-facing public
URL for the copied object works the moment the copy completes, whether
or not a database write ever follows it.

**Corrected design: `product-images` is a *private* Storage bucket with
an RLS-style read policy conditioned on `product_images` — not a public
bucket.** Supabase Storage buckets support row-level-security-style
access policies even when not marked "public"; marking a bucket "public"
is specifically a shortcut that *skips* policy evaluation for reads,
which is the behavior being removed here. The read policy for
`product-images` is:

```sql
-- SELECT policy on storage.objects for the product-images bucket
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM product_images
    WHERE product_images.storage_path = storage.objects.name
  )
)
```

granted to the `anon`/`authenticated` roles (so ordinary storefront
visitors can still read it — this is not a signed-URL scheme, and the
URL shape/caching behavior visitors see is unchanged from a plain public
bucket). **The access boundary this actually creates**: an object
physically copied into `product-images` is not readable by *anyone*,
regardless of role, until a `product_images` row exists with a matching
`storage_path` — the condition that grants read access and the
condition that makes the storefront aware of the image are now **the
same condition**, not two separately-timed events that merely tend to
happen close together. This is a guarantee enforced by Postgres/Storage
policy evaluation on every read, not a claim about operation ordering.

**This also changes what "promoted but not yet recorded" means for the
better**: in 3D below, the case where the Storage copy succeeds but the
`product_images` row-creation transaction fails is **not a public-
exposure incident** under this corrected design — the object sits in
`product-images`, physically present, but the read policy's `EXISTS`
check fails (no row yet), so it is exactly as unreachable as it was in
the quarantine bucket. The urgency of "finish the DB write quickly" that
the original design implicitly needed is gone; the reconciliation sweep
can complete it on its own schedule without a live exposure window to
worry about.

**Deletion — corrected to not claim cross-system atomicity.** The
original design described deleting a `product_images` row and its
Storage object as "one operation... for the same atomicity reason as
before" — restated precisely here: these are **two separate operations**
(a Postgres `DELETE` and a Storage object delete), not one transaction,
and this document does not claim otherwise. **Ordering is what matters,
not atomicity**: the `product_images` row is deleted **first**. Because
of the read policy above, this is the instant the object becomes
unreadable — the `EXISTS` check fails as soon as the row is gone,
*before* the physical Storage object is necessarily deleted. The
subsequent Storage delete is then pure space-reclamation, not a
security-relevant step:
- **DB delete succeeds, Storage delete fails**: the object is already
  unreadable (policy-enforced); it's an orphaned, inert blob until a
  cleanup sweep retries the physical delete — safe to retry any number
  of times (delete-if-exists).
- **DB delete fails**: nothing changed; the object remains exactly as
  accessible (or not) as it was before the attempt; safe to retry the
  whole operation.
- There is no ordering that creates a window where the object is both
  deleted from the DB's perspective and still readable — the policy
  check is what readability depends on, and it's gone the instant the
  row is.

**3A. Upload initiation and event handling — corrected to close a
race condition this document previously left open.** The DB row's
*existence* (and the exact path it reserves) is created before the file
does — the client first calls an RLS-permitted `INSERT` into
`pending_image_uploads` (`uploaded_by = auth.uid()`, role ≥ `staff`),
which generates the row's `id` and returns a `quarantine_path`
deterministically derived from that `id` — `status = 'initiated'` —
and only then uploads the actual file to that exact path.

**The race this ordering does *not* by itself close, which a prior
revision missed**: the Storage event that triggers validation fires the
instant Storage finishes writing the object — independent of, and not
waiting for, the client's own separate `initiated → uploaded` status
update. That update can legitimately still be in flight (or have failed
to land) when the event arrives, so the event handler cannot require
`status = 'uploaded'` as its claim condition — doing so would mean a
perfectly legitimate, just-completed upload is ignored because the
client hasn't finished its own bookkeeping yet. **Corrected event
handling, in order:**
1. Look up `pending_image_uploads` by `quarantine_path`.
2. **No row matches at all** → this path was never reserved by a
   legitimate `INSERT` — treat as unauthorized/orphaned and delete the
   object immediately, without processing. This is the *only* case in
   which deletion on event arrival is correct.
3. **A row matches with `status IN ('initiated', 'uploaded')` and
   `storage_event_id IS NULL`** → before claiming anything, independently
   verify the object actually exists and is fully written (a direct
   Storage metadata/HEAD check — not inferred from trusting the event
   payload alone, since a resumable/multipart upload could in principle
   fire an event before every byte has landed). If that verification
   fails (object missing or incomplete), **do nothing and exit — the row
   is left exactly as it was, never deleted.** A row matching here is
   affirmative evidence of a legitimate, still-in-progress upload, not
   evidence of anything wrong; a later genuine completion (another
   event, or the next sweep) retries the claim normally.
4. **If verification confirms a complete object**, claim atomically:
   `UPDATE pending_image_uploads SET status='validating',
   storage_event_id=$1 WHERE id=$2 AND status IN ('initiated','uploaded')
   AND storage_event_id IS NULL RETURNING id`. Zero rows returned (lost
   a race to another invocation, or already claimed) is a safe no-op.
5. **A row that already has `storage_event_id` set, or a `status`
   already past `validating`**, matches the "duplicate event" case in
   3C below, not step 2 or 3 — it is not treated as unauthorized and is
   not deleted; it's simply already being or already been handled.

This is a materially different fix from "move the client-side status
update earlier" — moving the update earlier only narrows the race
window, it does not close it (the client-side write can still be
arbitrarily delayed or fail outright). The fix that actually closes it
is accepting `initiated` as a valid claim state **and** independently
verifying object completeness before acting on any claim, rather than
trusting either the client's status field or the event payload alone.
Full column/state detail:
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2, `pending_image_uploads`.

**3B. State machine**: `initiated → uploaded → validating → approved →
promotion_pending → published` (happy path), with `rejected` and
`failed` as terminal/retry branches — full transition table (trigger,
required checks, retryability, failure handling per transition) in
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.

**3C. Idempotency — duplicate events and client retries must not create
duplicate public objects or inconsistent records:**
- **Duplicate Storage events** (the same upload-completion event
  delivered more than once — platforms that use webhooks commonly
  document at-least-once delivery, same as payment webhooks): the claim
  step (3A, step 4) matches on `status IN ('initiated','uploaded')`
  **and** `storage_event_id IS NULL` — a second delivery for the same
  object finds the row no longer matches (`status` has moved on, or
  `storage_event_id` is already set) and exits as a no-op. The unique
  constraint on `storage_event_id` is a second line of defense if two
  different event payloads somehow both claim to be "the" event for one
  object.
- **Repeated Edge Function invocations** (e.g. a platform-level retry of
  a function that appeared to fail): the same claim step protects
  against re-validating an already-claimed row; the promotion step
  (copy to public bucket) is idempotent by construction, since copying
  to the same deterministic destination path twice is just an overwrite
  with identical bytes, not a duplicate object at a different path.
- **Client retries** (admin re-submits the same upload): if the client
  retries by calling `INSERT` again for a *new* logical upload, that's
  a new row/new path — no conflict, by design (it's a new upload
  attempt, not a replay). If the client instead polls/retries against
  the *same* `pending_image_uploads.id`, it just re-reads the current
  status — no duplicate processing is triggered by reading.

**3D. Distributed failure handling — Storage operations and Postgres
transactions are explicitly not one atomic unit:**
- **Upload succeeds, DB update fails** (the `uploaded` status update
  doesn't land): the object sits in quarantine, private, unreferenced.
  A stale `initiated`/`uploaded` row past a bounded age is picked up by
  the cleanup sweep, which deletes the orphaned quarantine object.
- **Validation succeeds, promotion fails** (bytes passed but the copy to
  the public bucket errors): row stays `approved`; the reconciliation
  sweep retries the copy — safe to retry since it's an idempotent
  overwrite to the same destination (§3C).
- **Promotion succeeds, DB update fails** (the file is now in the
  `product-images` bucket, but `status`/`public_path`/the
  `product_images` row never got written): recoverable without any
  exposure risk, per the corrected access boundary in §6.2 — the
  bucket's read policy requires a matching `product_images` row, which
  doesn't exist yet, so the object is physically present but not
  readable by anyone (not "inert because nothing happens to query it,"
  but inert because the policy check fails). The reconciliation sweep
  checks for this exact state (object exists at the expected path, no
  matching `product_images` row) and completes the DB write, rather
  than re-copying.
- **Edge Function crashes mid-processing**: covered by the state-specific
  recovery above — whichever step it crashed after determines which
  stuck-state recovery applies.
- **Duplicate events arrive**: covered in 3C.
- **A pending upload becomes stale** (abandoned at `initiated`/
  `uploaded` — e.g. the admin never actually completed the browser
  upload): cleaned up past a bounded age; harmless, since nothing public
  or DB-referenced depends on it.
- **Cleanup partially succeeds** (e.g. the quarantine object is deleted
  but the row's `quarantine_deleted` flag update fails, or vice versa):
  both operations are safe to retry independently and in either order —
  deleting an already-deleted Storage object is a no-op/404, and setting
  an already-`true` flag again is a no-op; the next sweep simply
  finishes whichever side didn't complete.

**3E. Object ownership and authorization:**
- **The uploader cannot choose an arbitrary public destination** — there
  is no client-controlled "public path" input anywhere in this flow; the
  public path is derived server-side (by the validating Edge Function)
  from the `pending_image_uploads.id`, never from client input.
- **The object path is bound to the pending-upload record** by
  construction (3A) — the path is generated from the row's own `id` at
  row-creation time, before any file exists at that path.
- **Validation checks actual file bytes**, not declared metadata or
  extension (§6.1 intro, point 2) — this is the entire reason this
  correction pass exists; restated here for completeness, not
  re-litigated.
- **Public publication occurs only after validation succeeds** — the
  `product_images` row (the only thing the storefront ever reads) is
  created exclusively in the `approved`/`promotion_pending → published`
  transition, never before.
- **Unapproved files remain inaccessible publicly** — the quarantine
  bucket has no public-read policy for any role, at any point in the
  state machine; there is no state in which an unvalidated file is
  reachable by a public request.

**3F. Cleanup — quarantine and public storage, without ever deleting a
valid/retrying object:**
- **Quarantine bucket**: objects behind `rejected` or `published` rows
  are safe to delete immediately (the source copy is dispensable once
  either terminal outcome is reached). Objects behind a non-terminal
  row stuck past a bounded age are **not** blindly deleted — the sweep
  first checks real state (does a public copy already exist? does a
  `product_images` row exist?) before deciding whether to resume
  promotion, reset to `failed`, or delete — per the state-specific
  recovery in 3D. This is what prevents the cleanup process from ever
  deleting a valid object that's actually mid-retry.
- **`product-images` bucket**: no upload-pipeline-driven cleanup logic
  applies here — a published file is permanent until an admin explicitly
  deletes it. That deletion is the two-step, DB-row-first sequence
  specified in §6.2 (not one atomic operation) — the row delete is what
  revokes read access immediately via the policy; the Storage delete
  afterward is reclamation, retryable independently of whether it
  succeeds on the first attempt.

**This design is Proposed — awaiting architecture approval, not
Resolved.** It has not been implemented or tested; the quarantine-bucket
policies, the validating Edge Function's actual content-sniffing logic,
the reconciliation sweep's state-checking logic, and the cleanup job are
all new engineering surface. See
[ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §13 for the explicit
approval conditions.
- Alt text is bilingual (Arabic/English) per
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2 — relevant here because
  accessibility/SEO coverage that only exists in one language is a gap in
  both the security-adjacent "no unlabeled content" sense and the SEO
  strategy, not purely a content concern.

## 7. Application-Layer Hardening

- Every mutation entry point — which, with no application server, means
  every `SECURITY DEFINER` Postgres RPC and every Edge Function — validates
  its input itself; the same Zod schemas used for client-side UX feedback
  are not the trust boundary, only a convenience. The RPC/Edge Function is
  the only remaining place input is actually validated before it can have
  an effect — see [ARCHITECTURE.md](./ARCHITECTURE.md) §8's "Form
  validation" row.
- Rate limiting on auth endpoints (login, password reset, coupon
  validation) to mitigate brute force / coupon enumeration — mechanism
  (Supabase's own built-in rate limiting, or logic inside the relevant
  RPC/Edge Function, since there is no middleware tier to put it in
  anymore) to be decided in Phase 2.
- Admin actions that change state (role changes, order status changes,
  coupon creation) should be logged (`order_status_history` covers orders;
  a general `audit_log` table is a candidate addition — flagged in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) rather than assumed).

## 8. Secrets & Environment

- Supabase anon key: the only Supabase credential ever given a
  `VITE_`-prefixed environment variable (so it's the only one Vite bundles
  into the client) — safe for client exposure because RLS makes it safe
  by design, but only once RLS policies above are actually in place —
  **no table should be left at default-open policy during development.**
- Supabase service-role key: lives only in Edge Function/CI environment
  configuration, used only in Edge Functions/trusted CI contexts (webhook
  handling, the refund outbox worker, the sitemap/prerendering build
  step) — never given a `VITE_` prefix, never referenced from anything
  Vite builds, never bundled into client code. See
  [ARCHITECTURE.md](./ARCHITECTURE.md) §12.
- Payment provider secret keys: same treatment as the service-role key —
  Edge Function/CI-only, never `VITE_`-prefixed, never bundled.

## 9. Out of Scope for This Phase

No Supabase project exists yet; no policies have been written or applied.
This document is the policy design that Phase 2 implements and reviews
before any table is created without RLS enabled.
