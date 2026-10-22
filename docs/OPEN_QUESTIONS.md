# Taybah — Assumptions & Open Business Decisions

Tracked separately per the discovery brief. Nothing below has been decided
unilaterally where it affects schema, security, or business logic — these
are either explicit assumptions made to keep planning moving, or questions
that need a business/stakeholder answer before Phase 2 implementation can
finalize that area.

## Status Labels Used Below

To avoid overloading "resolved" for things at very different levels of
certainty, every item below uses one of these:
- **Resolved** — the design is specified, internally consistent, and not
  expected to change absent new information.
- **Proposed — awaiting architecture approval** — a specific design
  exists and is documented, but has not been implemented, tested, or
  explicitly approved; it should not be treated as final.
- **Open — requires business decision** — a technical design can't
  proceed (or shouldn't be assumed) without a business/stakeholder
  answer.
- **Blocked — requires technical dependency** — resolution depends on
  the answer to a different open item (cross-referenced).

## Resolved / Proposed Since Phase 1, Step 1

- ~~Market/currency/locale — is Arabic/RTL in scope?~~ **Resolved:** Arabic
  (RTL) is the default storefront locale, English (LTR) is a fully
  supported secondary locale, both mandatory for v1. See
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2. **Currency is still open**
  (see #3 below) — resolving language did not resolve currency.
- ~~Guest cart identification mechanism~~ **Resolved:** Supabase Auth
  anonymous sign-ins replace the original httpOnly session-token design.
  See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1.
- ~~Materialized view refresh strategy~~ **Resolved:** a trigger-maintained
  table (`product_listing_summary`) replaces the materialized-view
  proposal. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §7 and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §C.
- ~~Variant duplicate-combination mechanism~~ **Resolved:** a canonical,
  sorted `attribute_value_ids uuid[]` column replaces the earlier
  `attribute_combination_hash` (MD5) design, with explicit input
  validation (dedup, existence, one-value-per-attribute). See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.3 and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §10.
- ~~Anonymous-user order *deletion* safety~~ **Resolved — split out from
  a previous item that incorrectly bundled this with the (still
  unapproved) merge mechanism.** This item covers only: `orders.
  customer_id` is `ON DELETE RESTRICT` (an order can never be silently
  deleted by deleting the identity that placed it), and the custom
  anonymous-identity cleanup job excludes any identity that owns an
  order from its deletion candidates. Both are independent of whether
  guest-identity merge is ever approved — they hold regardless. See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.2.
- ~~Guest order *reassignment* via identity merge~~ **Proposed —
  awaiting architecture approval (not Resolved; see the next item,
  which this is the same mechanism as).** Reassigning a guest's orders
  from their anonymous identity to a target account only happens as
  part of the guest-identity-merge mechanism below — it does not happen
  automatically just because a guest logs in, and does not happen at
  all independent of that mechanism being approved and built. Until
  then, a guest's orders remain attached to their anonymous identity
  (fully retained per the item above, just not reachable from a
  separate account they later sign into).
- ~~Refund outbox worker crash/multi-worker safety~~ **Resolved:** lease-
  based claiming (`SELECT ... FOR UPDATE SKIP LOCKED`), a distinct
  `provider_accepted` state, and a reused (never regenerated) idempotency
  key. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3,
  `refund_requests`.
- ~~Lifetime duplicate-refund protection~~ **Resolved:** a second partial
  unique index (`WHERE status = 'succeeded'`), distinct from the
  concurrent-request index. See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2.
- ~~Frontend framework~~ **Resolved — explicit technology decision, not a
  re-evaluation:** React + Vite replaces Next.js throughout. See
  [ARCHITECTURE.md](./ARCHITECTURE.md) (entire document) and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §11 for the full
  rationale and migration detail.
- ~~Secure anonymous-identity merge mechanism~~ **Proposed — awaiting
  architecture approval (corrected from an earlier, incorrect "Resolved"
  label).** The `guest_merge_tickets` bearer-token design previously
  marked this resolved; on review, it wasn't secure (a stolen/intercepted
  token could be redeemed into an attacker's own account, since it was
  never bound to a specific target account — short expiry and single-use
  don't address that). That table and mechanism are **retired**. The
  current design verifies two independent session tokens (the live
  anonymous session plus a freshly obtained target-account token) inside
  a Supabase Edge Function, closing the specific gap above. A further
  pass added the concurrency/recovery mechanism this still needed (a
  `guest_merge_attempts` mutex row, since Auth user deletion is a
  separate, non-atomic step after the Postgres reassignment transaction
  — not "one transaction" as an earlier revision incorrectly claimed) —
  see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4A–4E. **A further
  pass corrected an unsafe crash-recovery heuristic** (an empty-cart/
  empty-order guest identity could not be reliably distinguished from a
  "never ran" attempt by row-counting — fixed to rely on the
  transactional `status` column instead), **made the target account
  permanently bound only after commit** (not before, so a failed
  attempt's retry may freely use a different target), **and replaced an
  unreliable "auth failure means success" inference with an explicit
  target-session-verified status check** (`get_my_guest_merge_status`) —
  see [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §14.3–14.5.
  Still not implemented or tested, and has its own stated residual
  limits (full browser/device compromise still defeats it, as it would
  any client-side scheme). See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1,
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4, and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §14.
- ~~Image upload content validation boundary~~ **Proposed — awaiting
  architecture approval.** An earlier revision incorrectly described a
  Postgres `SECURITY DEFINER` function as validating uploaded file
  *content* — not possible, since Postgres never receives the file
  bytes. The corrected design uses a private quarantine bucket plus a
  trusted Edge Function that genuinely inspects file bytes before
  promoting validated files and creating their `product_images` row —
  with an explicit initiation sequence (the DB row exists before the
  file does), a full state machine, idempotency for duplicate Storage
  events/retries, and distributed-failure recovery for every
  Storage-vs-Postgres mismatch. **A further pass closed two remaining
  gaps**: the event-claim query previously required a client-side
  status update that could race the Storage event itself (fixed to
  accept either pending state plus an independent object-existence
  check — [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §14.1),
  and the destination bucket was described as "public" in a way that
  didn't actually prevent direct-URL access before the DB row existed
  (fixed: the bucket is private, with an RLS policy conditioned on
  `product_images` row existence, not Supabase's public-bucket type —
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §14.2). See
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1–6.2 items 3A–3F. Not yet
  implemented or tested. See
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2
  (`pending_image_uploads`), and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §14.

## Decisions Needed Before Phase 2 (Blocking)

1. **Payment provider.** Stripe, Paymob (common in Egypt-market
   e-commerce), or another gateway? Affects checkout flow, webhook
   security design, and whether multi-currency matters at launch.
2. **Shipping model.** Flat rate, rule-based by region/weight, or a
   carrier-calculated rate? Affects `store_settings` shape and checkout
   logic. Assumption used in this plan: simple flat-rate or admin-
   configured rule-based shipping for v1.
3. **Currency.** Single currency assumed (EGP, given the reference site's
   market) — needs explicit confirmation; affects `store_settings` and
   price formatting per locale (Arabic numeral/currency formatting
   conventions vs. English).
4. **Email/notification provider.** For order confirmations, password
   reset, admin alerts (low stock) — and whether transactional emails are
   sent in the customer's `preferred_locale` (Arabic/English) or a single
   fixed language. Options: Supabase's built-in email, Resend, SendGrid,
   etc.
5. **Hosting target.** Any static host/CDN capable of serving a Vite SPA
   build with SPA-fallback rewrite rules (Vercel, Netlify, Cloudflare
   Pages, S3+CloudFront) — reframed from the earlier Next.js-era framing
   (which was about ISR/Node-runtime behavior); the decision now mostly
   affects deployment pipeline setup and how easily the prerendering step
   ([ARCHITECTURE.md](./ARCHITECTURE.md) §4) wires into CI, not framework
   compatibility. See [ARCHITECTURE.md](./ARCHITECTURE.md) §12.
6. **Arabic/Latin typeface pairing.** [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
   §4 needs a licensed/final typeface decision for *both* scripts,
   evaluated together (not Latin chosen first and an Arabic font picked to
   "match" afterward) — needed before Phase 2 design-token setup.
7. **Logo wordmark form.** Does the supplied logo asset include a distinct
   Arabic wordmark (طيبة) for the RTL storefront, or one direction-neutral
   mark used in both locales? Needed before
   [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §7 can be finalized.

### What Each Blocking Item Actually Blocks

The seven items above are all labeled "blocking," but they don't all block
the *same thing* — this table makes that explicit rather than leaving
"blocking" undifferentiated.

| # | Item | What it affects | What it actually blocks | Latest safe point to resolve it |
|---|---|---|---|---|
| 1 | Payment provider | Checkout integration code, `payment_events.provider` values, refund API shape | Phase 5 (Commerce Flow) implementation and the outbox worker's provider-call code. Does **not** block Phase 2 schema migrations — `payment_events`/`refund_requests` are provider-agnostic as designed. | Before Phase 5 begins (safe to resolve as late as end of Phase 3/4). |
| 2 | Shipping model | `store_settings` values, checkout total calculation in the order-placement RPC | Phase 5 checkout logic only. Does **not** block Phase 2 — `store_settings` is already key-value/`jsonb`, so it doesn't need a shape decision up front. | Before Phase 5 begins. |
| 3 | Currency | `store_settings` seed value, price formatting components (locale-aware) | Phase 2's `store_settings` seed data, and Phase 4 price-display components. Does **not** block the catalog/variant schema itself (`price numeric(10,2)` has no currency-specific shape). | Before Phase 2 `store_settings` seeding, and before Phase 4 price-display work. |
| 4 | Email/notification provider | Order confirmation flow, password reset templates, low-stock alerts | Phase 5 (order confirmation) and Phase 6 (admin alerts). Does **not** block Phase 2 or schema. | Before Phase 5 begins. |
| 5 | Hosting target | Static-host/CDN config (SPA fallback rewrites, prerendered-file-vs-fallback ordering), deployment pipeline | Phase 2 project scaffolding decisions and Phase 8 deployment setup. **Does** block finishing Phase 2 cleanly, since rewrite-rule syntax is host-specific. | Before Phase 2 is considered complete. |
| 6 | Arabic/Latin typeface pairing | Tailwind design tokens, font-loading strategy, `DESIGN_SYSTEM.md` §4 | Phase 2 design-token setup specifically — this **does** block finalizing Tailwind config, unlike several items above. | Before Phase 2 design-token setup (i.e., early in Phase 2, not deferred to Phase 4). |
| 7 | Logo wordmark form | `DESIGN_SYSTEM.md` §7, storefront header/nav component design | Phase 4 (storefront nav/header built around the logo). Does **not** block Phase 2 or schema. | Before Phase 4 begins (earlier if the logo is needed for anything outside this codebase, e.g. marketing). |

Item #14 (admin mobile usage, below) is a non-blocking-but-flagged
decision with its own latest-safe-point noted inline.

## Decisions Needed Before Phase 3–5 (Not Immediately Blocking)

8. **Guest checkout vs. account-required.** Assumed guest checkout is
   allowed (common e-commerce expectation); confirm this is acceptable for
   the business (e.g. for marketing/remarketing purposes, an account-
   required flow might be preferred).
9. **Reviews.** Deferred to v2 in [FEATURES.md](./FEATURES.md) — confirm
   this is acceptable, since `avg_rating` exists as a schema placeholder
   but no collection UI is planned for v1.
10. **Comparison limit.** Assumed cap of 4 products compared at once —
    confirm or adjust.
11. **Staff permission granularity.** Assumed three tiers beyond customer
    (staff/admin/owner) per [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3 —
    confirm this matches how the business will actually staff the admin
    tool (e.g. is a "fulfillment-only" role needed?).
12. **Audit logging scope.** Order status history is in schema by default;
    a general `audit_log` table for all admin actions is proposed but not
    committed — confirm whether compliance/ops needs this at launch or v2.
13. **`category_attributes` strictness.** Whether it should become a hard
    DB-enforced constraint (a variant literally cannot use an attribute not
    mapped to its product's category) rather than the current advisory
    mapping that only drives the admin UI's form — see
    [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.2. (Bilingual
    `alt_text_ar`/`alt_text_en` was an inconsistency found during this
    audit and has been corrected directly in
    [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — not left as an open
    question.)
14. **Admin dashboard mobile usage.** The current design treats the admin
    dashboard as **desktop-primary with reasonable tablet support, and not
    mobile-first** — unlike the storefront, where mobile-first is
    mandatory and already decided. This was carried forward as a working
    assumption so Phase 1 planning could proceed, but it is **explicitly
    flagged here, not assumed, because this review found no business
    confirmation of it either way**: if staff/admin (e.g. warehouse or
    delivery staff checking orders/stock on a phone) are expected to use
    the admin dashboard primarily or significantly on mobile devices, this
    changes [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §5's admin layout
    principle and should be decided before Phase 3 (Admin Core) begins,
    not discovered partway through building it. If desktop/tablet-primary
    admin usage is confirmed as correct, no document needs to change —
    this item exists so that confirmation is explicit rather than implied.
15. **Anonymous-identity cleanup threshold and guest-order data retention
    period.** [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 illustrates
    a 30-day inactivity threshold for cleaning up anonymous identities
    that own no orders — not a committed value. Separately, and more
    significantly: anonymous identities that *do* own orders are retained
    indefinitely by design (never deleted by this project's own cleanup
    job) until a business decides on an actual data-retention period for
    that order data — this may be a legal/tax/compliance question
    (how long must order records be kept, regardless of account status)
    rather than a purely technical one, and is not answered here. Needed
    before Phase 3 (Admin Core) if the business wants retention/cleanup
    tooling built then, otherwise safe to resolve later since the default
    behavior (indefinite retention) is the conservative one.
16. **Guest order lookup without an account.** A guest who completes
    checkout, never creates an account, and later loses their original
    browser session (cleared cookies, different device) currently has no
    way to look up that order through the storefront as scoped in
    [FEATURES.md](./FEATURES.md) — no "look up my order by order number +
    email" feature exists in the v1 feature set. Surfaced during the
    anonymous-user lifecycle review in
    [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §10; whether this
    is acceptable for v1 or needs a feature addition is a product
    decision, not assumed either way. Needed before Phase 5 (Commerce
    Flow) if the answer is "yes, build it," since it would be part of the
    checkout/account feature set built in that phase.
17. **Refund policy: one successful refund per order, or multiple partial
    refunds under an aggregate cap?** The current schema's
    lifetime-duplicate-refund protection
    ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2) implicitly commits
    to "at most one successful (full) refund per order" via a partial
    unique index. This was a reasonable default to make that protection
    concrete, but **it has not been confirmed as the actual business
    policy** and is flagged here rather than left as a silent assumption
    — see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.3. If partial refunds
    are wanted, the constraint changes materially (an aggregate-amount
    check instead of a single-row uniqueness check), so this should be
    resolved before Phase 5/6 builds against one assumption or the other.
18. **Refund reconciliation when a `provider_accepted` refund request
    never receives a webhook confirmation.** A scheduled reconciliation
    job polling the provider's refund-status API is the recommended
    architectural resolution ([SECURITY_PLAN.md](./SECURITY_PLAN.md)
    §5.3), but it depends on the chosen payment provider (item #1)
    actually exposing a status-lookup API — if it doesn't, the fallback
    is a manual ops runbook rather than automation. Not resolved here;
    depends on item #1's answer. Needed before Phase 5/6 (whichever phase
    builds the refund outbox worker).
19. **SEO prerendering/sitemap tooling — Blocked (an engineering
    validation risk, not a business decision).** The build/deploy-time
    prerendering strategy ([ARCHITECTURE.md](./ARCHITECTURE.md) §4) is a
    design, not working software — the prerender script, the sitemap
    generator, and the rewrite-rule ordering that makes them actually
    reach crawlers have not been implemented or tested. This is **not**
    something a business stakeholder needs to decide; it's tracked here
    because it must not be assumed solved before launch. Acceptance
    criteria for calling it done, listed in full in
    [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §12.4: correct
    per-locale HTML (Arabic and English), correct `lang`/`dir` in the
    initial (pre-JS) HTML, product/category titles and descriptions
    present without client-side JS, correct canonical URLs, valid
    structured data, a sitemap covering all eligible canonical URLs, a
    correct `robots.txt`, prerendered files actually served ahead of the
    SPA fallback rewrite, and no silent empty-shell response for a
    missing/failed prerendered page. Needed before Phase 8 sign-off, not
    before Phase 2 (the roadmap already treats Phase 2's prerender setup
    as a skeleton, not a finished system).

## Assumptions Made to Keep Planning Moving (Flag if Wrong)

- **Single warehouse/location** inventory model for v1 (no multi-location
  stock splitting). [ARCHITECTURE.md](./ARCHITECTURE.md) §6.
- **No multi-currency** at launch (currency itself is still open — see
  blocking item #3).
- **No mobile app or public API** consumer in v1 — architecture doesn't
  preclude it later, but nothing is built against that requirement now.
- **Brand logo** has not yet been supplied as an asset — referenced as a
  dependency in [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §7 (see also
  blocking item #7 on whether it includes a distinct Arabic wordmark).
- **Admin dashboard is LTR/English-only for v1**, not bilingual — see
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2.2 and §4. (Whether it should
  also be mobile-first, rather than desktop-primary, is a *separate*
  question not assumed here — see blocking-adjacent item #14.)
- **Git repository does not exist yet** for this project — assumed it
  will be initialized at the start of Phase 2, not during Phase 1
  (discovery/planning only, per the explicit rules for this phase).
- **Single React + Vite SPA** containing both storefront and admin
  (feature-based structure, with a `/:locale` route segment for `ar`/`en`
  on storefront routes only — see [ARCHITECTURE.md](./ARCHITECTURE.md)
  §2–3) rather than two separate deployed apps — assumed appropriate at
  current scope; revisit only if a third application (e.g. a separate
  mobile client) enters scope.

## How to Resolve

These should be answered by whoever owns business/product decisions for
Taybah before or during Phase 2 kickoff. None of them block finishing
Phase 1 documentation, but several (#1–#7) block writing real schema
migrations, finalizing design tokens, and starting checkout-related
implementation.
