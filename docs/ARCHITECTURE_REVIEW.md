# Taybah — Architecture Review (Phase 1, Step 2)

Principal-architect audit of the Phase 1 Step 1 documentation set, performed
before any implementation. No code, migrations, or Supabase project changes
were made. This document records what was found, what changed, and what is
still open.

> **Historical-record notice (added when §11 was written):** §1–10 below
> describe audits performed while **Next.js** was still the approved
> frontend framework. They are preserved as an accurate record of what was
> decided and why *at the time* — including the Next.js-specific
> mechanisms they discuss (SSR/SSG/ISR, Next.js middleware, Server
> Actions) — and are **not** a description of the current target
> architecture. Next.js was subsequently replaced with **React + Vite**;
> every other document (`ARCHITECTURE.md`, `SECURITY_PLAN.md`,
> `DATABASE_SCHEMA.md`, etc.) has been updated to reflect that and is the
> current source of truth. **§11 is the record of that replacement** and
> should be read as superseding any Next.js-specific statement below it,
> without the sections below having been rewritten to pretend Next.js was
> never there.

## 1. Executive Summary

The original architecture (Next.js/React/TypeScript/Tailwind/Supabase,
route-group separation of storefront and admin, variant-based catalog
model, RLS-first security) is **sound and is not being replaced.** This
audit found eight areas (A–H, per the audit brief) where the original
design was either underspecified, contained a mechanism that doesn't
actually work as described, or hadn't yet accounted for two new binding
requirements: the **Taybah/طيبة rebrand** and the **mandatory mobile-first,
Arabic-RTL-default storefront strategy.**

The most consequential finding is **not** a security hole in the sense of
"data is exposed" — the original docs were already RLS-first and
reasonably careful. It's that two of the originally-proposed *mechanisms*
don't hold up under scrutiny: a `REFRESH MATERIALIZED VIEW CONCURRENTLY`
invoked from inside a write trigger/transaction is not something Postgres
supports that way, and a bare httpOnly session token for guest carts sits
outside RLS and is a bearer credential with no independent verification.
Both are resolved below with mechanisms that are actually implementable
and that *tighten* the RLS-first posture rather than complicate it
(particularly the guest-cart fix, which collapses two code paths —
guest and customer — into one uniform RLS rule).

**Recommendation: approve this revised architecture and proceed to Phase
2**, contingent on the blocking business decisions in
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) (#1–#7) being resolved before
schema migrations are written, since several of them (currency, typeface
pairing, payment provider) change column shapes or token decisions rather
than being purely cosmetic.

## 2. Critical Findings

1. **Materialized view refresh was not viable as specified.**
   `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside the same
   transaction that modifies the view's source tables, and a non-concurrent
   refresh locks the view against reads for its duration — unacceptable on
   a live storefront. The original doc proposed both "refreshed via
   trigger" and "on-demand `REFRESH ... CONCURRENTLY`" without resolving
   that they're incompatible. **Resolved in §C below** by replacing the
   materialized view with a trigger-maintained real table.
2. **Guest cart identification was outside the RLS security boundary.** A
   bare session token is a bearer credential with no independent
   verification — it doesn't produce an `auth.uid()`, so every guest-cart
   RLS policy would have needed a separate, hand-trusted branch instead of
   the uniform `customer_id = auth.uid()` rule used everywhere else,
   which is exactly the kind of app-layer-only boundary the original
   Security Plan's own Principle 1 warns against. **Resolved in §B below**
   using Supabase Auth anonymous sign-ins.
3. **Duplicate variant-combination prevention was explicitly left as an
   application-layer check**, which is unsafe under concurrent creation
   (two staff members, or a double-submitted form, can both pass a
   check-then-insert race). **Resolved in §D below** with a real unique
   database constraint.

## 3. Important Findings

4. **Guest checkout's nullable `customer_id` on `orders` and `carts`**
   became unnecessary once guest identification moved to anonymous auth —
   every order/cart now has a real `auth.uid()`, so the nullable-FK special
   case was removed rather than kept alongside the new mechanism.
5. **`order.status` originally conflated fulfillment and payment** in a
   single enum value set (`pending, paid, processing, shipped, delivered,
   cancelled, refunded`), which makes states like "shipped but unpaid"
   structurally invisible and makes refund/cancellation logic harder to
   reason about correctly. Split into `status` (fulfillment) and
   `payment_status` (payment), per §F.
6. **No idempotency mechanism was specified for payment webhooks**,
   despite payment providers explicitly documenting at-least-once
   delivery. Added `payment_events` with a unique constraint on
   `(provider, provider_event_id)`, per §F.
7. **Catalog content (names, descriptions, slugs, SEO fields) was
   single-language**, which is incompatible with the now-mandatory
   Arabic-default/English-secondary storefront. Resolved with paired
   `_ar`/`_en` columns across `products`, `categories`, and
   `product_images.alt_text` (the last one was an inconsistency caught
   during this pass — fixed directly rather than left open).
8. **One fixed attribute set was implied for all products**, which doesn't
   fit rugs, carpets, curtains, and furnishings sharing one schema without
   forcing irrelevant fields onto every category. Resolved with
   `category_attributes`, per §E.
9. **Role-hierarchy consistency across layers (middleware, server code,
   RLS) was asserted but not mechanized** — each layer would have been free
   to encode its own `IN (...)` role list, which is exactly how an `owner`
   permission silently goes missing from one layer while present in the
   others. Resolved with a single `has_role_at_least()` function used
   everywhere, per §C.

## 4. Technical Resolutions (Detail per Audit Section)

### A. Materialized View Strategy → See §7 above (Critical Finding #1) and
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §7 for the full comparison
table (regular view vs. materialized view vs. maintained table) and the
chosen design: `product_listing_summary` as a real table, kept current by
an `AFTER INSERT/UPDATE/DELETE` trigger on `product_variants`/`products`
that `UPSERT`s only the affected product's row. Consistency guarantee: the
summary row is correct as of the commit of the transaction that changed
the underlying variant/product — there is no refresh-lag staleness window,
unlike a periodically-refreshed materialized view, and no lock contention,
unlike a synchronous `REFRESH`.

### B. Guest Cart Security

Replaced the httpOnly session-token design with **Supabase Auth anonymous
sign-ins** (full detail: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3,
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1). Key points:
- Every guest is a real `auth.users` row (`is_anonymous = true`) with a
  normal, signed Supabase session — not a custom credential scheme.
- `carts`/`wishlists`/`comparisons` are keyed by `customer_id = auth.uid()`
  uniformly for guests and registered customers — one RLS rule, not a
  guest/customer branch.
- Login merges guest state via one of two paths: identity-linking (keeps
  the same `auth.uid()`, no merge needed) when the guest creates a new
  account, or a `SECURITY DEFINER` `merge_guest_cart` RPC (re-parents cart/
  wishlist rows) when the guest signs into a pre-existing account. The
  merge RPC only acts on the session's own immediately-prior anonymous
  identity — never an arbitrary caller-supplied "whose cart" parameter —
  so it cannot be used to pull a stranger's cart into another account.
- This directly prevents unauthorized guest cart access: there is no
  bearer value that, if intercepted, grants cart access independent of a
  verified session — the exact gap in the original design.

### C. Authorization Consistency

A single `has_role_at_least(min_role)` Postgres function is the one
definition of the role hierarchy (`owner > admin > staff > customer`),
used directly inside RLS policies and exposed for server-side (Next.js)
checks, so middleware, Server Actions/Route Handlers, and RLS all evaluate
the same ordering instead of three independently-maintained role lists.
`owner` is modeled as a strict superset of `admin` through this hierarchy,
which is the direct fix for "ensure owner access works correctly" — owner
access gaps in practice come from a policy written as `role IN ('admin')`
that forgot to add `'owner'`, not from a logic bug, and the hierarchy
function removes that failure mode structurally. Privilege escalation is
blocked at the data layer: `profiles.role` (and `is_anonymous`) are
excluded from the columns a user can change on their own row, so a direct
API call attempting self-promotion is rejected by the policy itself. Full
detail: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.1,
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §8.

### D. Product Variations

- **Products without variations**: every product has at least one
  `product_variants` row (a "simple" product has exactly one, with no
  `variant_attribute_values`), so cart/order/stock-decrement code is
  written once and works identically for simple and variant-bearing
  products — no separate table or code path for "simple" products.
- **Variant-specific SKU, pricing, inventory**: unchanged from the
  original design — each `product_variants` row carries its own `sku`,
  `price`, and `stock_quantity`. Confirmed correct, not revised.
- **Duplicate combination prevention**: a generated
  `attribute_combination_hash` column plus a unique index on
  `(product_id, attribute_combination_hash)` makes a duplicate
  size/color (etc.) combination a real database constraint violation.
- **Concurrent creation protection**: because the above is a genuine
  unique index rather than an app-layer check, Postgres resolves the race
  at the index level — two simultaneous attempts to create the same
  combination result in one success and one constraint-violation error,
  never two silently-coexisting duplicate variants. Full detail:
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.3.

### E. Catalog Flexibility

New `category_attributes` join table (category_id, attribute_id,
is_required) drives which attribute pickers the admin product form shows
per category — rugs get pile height/origin, curtains get drop
length/fabric, furnishings get whatever applies to them, without forcing a
shared schema-wide attribute set or a migration per new category type.
Deliberately kept **advisory** (not a hard DB constraint on
`variant_attribute_values`) for now, since enforcing it strictly was
judged premature rigidity while the catalog is still being onboarded —
flagged as open item #13 in [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) if the
business wants it hardened later.

### F. Inventory and Orders

- **Atomic stock operations / overselling prevention**: order placement
  runs in one Postgres transaction with row-level locks
  (`SELECT ... FOR UPDATE`) on the affected variants — confirmed correct
  from the original design, made explicit here.
- **Order cancellation**: a `cancel_order` RPC restores reserved stock and,
  if the order was already paid, enqueues a `refund_requests` outbox row in
  the same transaction — it does not call the payment provider directly
  (that boundary is corrected in §9.1, row 4, of this document) — rather
  than cancellation and payment state changing independently with no
  defined relationship.
- **Refunds**: only recorded as `payment_status = 'refunded'` once the
  payment provider's webhook confirms it — an admin "refund" click
  *requests* the refund, it does not itself mark the order refunded.
- **Payment status vs. order status**: split into two fields (§3,
  Important Finding #5) updated by two different code paths — staff/admin
  action for `status`, payment-webhook only for `payment_status` — making
  impossible states (e.g. "shipped but unpaid" implied by a single enum)
  structurally unrepresentable as a *silent* combination; both fields are
  visible and independently filterable in the admin order list.
- **Duplicate payment webhooks**: `payment_events` records the provider's
  event id under a unique constraint before any state change is applied,
  making redelivery (which providers explicitly document as possible) a
  safe no-op.

### G. Performance

Original indexing/pagination/caching strategy was largely sound; revised
for the schema changes above:
- Indexes added for `attribute_combination_hash`, `payment_events`
  idempotency, and `orders(payment_status)` as an independent filter
  dimension from `orders(status)`.
- Full-text search split into **separate** Arabic and English `tsvector`
  indexes rather than one combined index, since Postgres text-search
  configurations are language-specific (stemming/stopwords) and a single
  shared index would degrade relevance in both languages.
- N+1 prevention is structural (aggregation table + batched variant/image
  queries), not dependent on per-query vigilance — unchanged in substance
  from the original proposal, restated with the corrected aggregation
  mechanism from §A.
- No additional caching layer (e.g. Redis) is recommended for v1 at
  1,000-product scale — ISR + the maintained aggregation table + CDN-cached
  images are judged sufficient; revisit only if profiling says otherwise.

### H. Storage

- Upload validation (content-type sniffed server-side, not trusted from
  client-reported MIME type; size-capped) added — the original doc
  mentioned write-restriction but not upload content validation.
- Primary-image and ordering logic (`is_primary` partial unique index,
  `display_order`) confirmed correct from the original design.
- Alt text made bilingual (`alt_text_ar`/`alt_text_en`) — the one
  outright inconsistency found during this audit (every other
  customer-facing text field was already bilingual in the original
  revision pass; this one was missed and is now corrected).
- Deletion defined explicitly as one server-side operation removing both
  the `product_images` row and the Storage object together — the original
  doc didn't specify this, leaving room for orphaned rows or files.
- Image optimization (responsive `srcset`, Next.js `<Image>` + Supabase
  transformation/CDN) reconfirmed and elevated in priority: given mobile
  is now the primary storefront experience, unoptimized photography on a
  mobile connection is called out as the single largest risk to the
  mobile-first performance goal.

## 5. Revised Architectural Decisions (Summary of What Changed)

| Area | Original | Revised |
|---|---|---|
| Guest identification | httpOnly session token | Supabase Auth anonymous sign-in (real `auth.uid()`) |
| Listing aggregation | Materialized view, refresh mechanism unspecified/unsafe | Trigger-maintained real table (`product_listing_summary`) |
| Variant duplicate prevention | Application-layer check | DB unique constraint on a generated combination hash |
| Order status | Single enum mixing fulfillment + payment | Two fields: `status` (fulfillment) + `payment_status` (payment) |
| Webhook handling | Signature verification only | Signature verification + `payment_events` idempotency table |
| Catalog content | Single-language columns | Paired `_ar`/`_en` columns, locale-segmented routing |
| Attribute model | One implied shared attribute set | `category_attributes` mapping, per-category attribute relevance |
| Role authorization | Per-layer role checks, no shared definition | Single `has_role_at_least()` hierarchy used everywhere |
| Brand identity | CarpetLand | Taybah (English) / طيبة (Arabic) |
| Design strategy | Desktop-oriented, LTR-only implied | Mobile-first (mobile→tablet→desktop), RTL-default/LTR-secondary mandatory |

## 6. Remaining Business Questions

Not decided by this audit — tracked in
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md):
payment provider, shipping model, currency, email/notification provider,
hosting target, Arabic/Latin typeface pairing, logo wordmark form, guest-
checkout-vs-account-required, reviews timing, comparison item cap, staff
permission granularity, audit-log scope, and `category_attributes`
strictness. None of these were invented or assumed resolved by this audit.

## 7. Technical Risks

- **Mobile image performance** is the single largest risk to the
  mobile-first goal given a photography-led brand — mitigated by design
  (responsive images, CDN transformation) but not yet validated against
  real photography at real file sizes; should be load-tested in Phase 4/8
  with representative assets, not assumed from the architecture alone.
- **Arabic/Latin typeface pairing** is unresolved and blocks finalizing
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) tokens — a late typeface decision
  risks a design-token rework mid-Phase-2.
- **`category_attributes` as advisory, not enforced**: if catalog data
  entry (especially the 1,000+ product CSV import) isn't disciplined, the
  admin UI's per-category attribute guidance can be bypassed, leading to
  inconsistent attribute usage across the catalog. Worth revisiting after
  initial catalog load if this becomes a real data-quality problem, since
  tightening it later means a cleanup pass across whatever's already been
  entered rather than a clean constraint from day one.
- **Supabase anonymous sign-in cleanup**: anonymous users/carts need an
  active cleanup policy (Supabase supports this) or the `auth.users` table
  accumulates abandoned guest sessions indefinitely at scale.
- **RLS/role consistency is only as good as discipline in Phase 2+**: the
  `has_role_at_least()` function solves the "three independently-encoded
  role lists" problem structurally, but still requires every new
  table/route to actually use it rather than reintroducing an ad-hoc check
  — worth a lint/review checklist item in Phase 2, not assumed to be
  self-enforcing.

## 8. Final Approval Recommendation

**Approve and proceed to Phase 2**, on the following basis:
- No original architectural decision is being discarded wholesale —
  Next.js/Supabase/RLS-first/variant-based-catalog all stand.
- The three critical findings (materialized view mechanism, guest-cart
  security boundary, duplicate-variant race condition) are resolved with
  concrete, implementable mechanisms, not just flagged.
- The Taybah/طيبة rebrand and mobile-first/RTL-default mandate are now
  threaded consistently through every document rather than living only in
  the new instructions.
- Nothing in this audit required inventing a business decision — payment,
  shipping, currency, and the remaining open items stay explicitly open in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) pending stakeholder input.

Phase 2 should not begin schema migrations until the blocking items in
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) (#1–#7) are answered, since
several of them change column shapes (currency formatting, typeface
tokens) rather than being purely operational choices made later without
cost.

---

## 9. Final Consistency Review (Phase 1, Step 2.1)

A follow-up documentation-only pass, performed after §1–8 above, to catch
contradictions that the Step 2 audit introduced fixes for in some
documents but not all of them, and to tighten three mechanisms (variant
hash lifecycle, refund execution boundary, webhook failure recovery) that
were directionally correct but not fully specified. No code, migrations,
or Supabase changes were made in this pass either.

### 9.1 Confirmed Contradictions and Their Resolutions

| # | Contradiction found | Where | Resolution |
|---|---|---|---|
| 1 | `ARCHITECTURE.md` §8 still described guest carts as identified by an "opaque, httpOnly, signed session token" — the design this review's predecessor (Step 2) had already replaced everywhere else. | `ARCHITECTURE.md` §8 | Rewritten to describe Supabase Auth anonymous sign-ins, matching [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 and [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 exactly. |
| 2 | `ARCHITECTURE.md` §9 still described `alt_text` as one field and pointed to an open question about whether it should be bilingual — but [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) already specifies `alt_text_ar`/`alt_text_en` as resolved. | `ARCHITECTURE.md` §9 | Rewritten to state the bilingual columns directly; the stale open-question pointer removed. |
| 3 | `attribute_combination_hash` was specified as `NOT NULL` and "trigger-or-RPC maintained" without saying which, or how a `NOT NULL` column is ever satisfied if a trigger on `variant_attribute_values` is what computes it (the variant row would have to exist, non-null, before its attributes are attached — a real ordering problem, not just an omission). | `DATABASE_SCHEMA.md` §2.3 | Rewritten as a precise lifecycle: the hash is computed from the *complete* input attribute-value list **before** the `product_variants` row is inserted, in the same `create_variant` RPC call, so the column is never `NULL` at any committed or intermediate point. Simple products use a fixed sentinel hash (not `NULL`) so the same unique constraint also caps a product at one "simple" variant. Updates go through a parallel `update_variant_attributes` RPC that changes the attribute rows and the hash together, in one transaction. No trigger is used — the RPC already has the complete information a trigger would have to infer from partial state. |
| 4 | The design described `cancel_order` as "initiating a refund request to the payment provider" from inside a Postgres RPC — conflating atomic database state change with an external HTTP call, which Postgres transactions should not perform. | `SECURITY_PLAN.md` §5.1, `ARCHITECTURE.md` §7/§7.1, `DATABASE_SCHEMA.md` §2 | `cancel_order` now only writes a `refund_requests` outbox row in the same transaction as the cancellation; a separate trusted Edge Function/worker performs the actual provider call, with its own retry/backoff and an idempotency key. `payment_status` still only becomes `'refunded'` on the provider's webhook confirmation — never on the outbox worker's local success response. |
| 5 | Webhook idempotency was described as "the handler checks `payment_events` before applying any state change," which is ambiguous about whether the check-and-apply happens atomically — read literally, it could describe two separate steps, which would reopen a race between checking and applying. | `ARCHITECTURE.md` §7.2, `SECURITY_PLAN.md` §5.2, `DATABASE_SCHEMA.md` §2 | Clarified explicitly: the `payment_events` insert and the business-effect update are statements in the *same* transaction, so a failure anywhere rolls back both together, and a duplicate delivery's insert fails fast on the unique constraint. Out-of-order events and duplicate refund requests are now each given an explicit handling rule (`requires_review` flag; partial-unique-index + provider idempotency key, respectively) rather than being unaddressed. |
| 6 | Authorization consistency asserted "all three layers agree" without saying whether Next.js server code calls the shared Postgres function or reimplements the comparison — leaving open exactly the kind of drift §3.1 was meant to prevent. | `SECURITY_PLAN.md` §3.1 (new) | Clarified per layer: RLS and other `SECURITY DEFINER` RPCs call `has_role_at_least()` directly (authoritative); Next.js server code calls the *same* function via `supabase.rpc(...)` for anything authoritative; only middleware uses a local comparison, and it is explicitly scoped to non-authoritative UX redirects, never the deciding check for a mutation or sensitive read. |
| 7 | `SECURITY DEFINER` functions were introduced (`create_variant`, `cancel_order`, `merge_guest_cart`, the order-placement RPC) without stating the two hardening rules such functions need — an omission, not a stated contradiction, but a gap the audit brief specifically asked to close. | `SECURITY_PLAN.md` §3.2 (new) | Added: every `SECURITY DEFINER` function sets a fixed `search_path` (prevents search-path-hijacking privilege escalation) and has `EXECUTE` revoked from `PUBLIC` with explicit grants only to the roles that should call it. |
| 8 | The admin dashboard's "desktop-primary, not mobile-first" design was stated as a working assumption, but the audit brief asked this to be explicitly flagged as needing a business decision, not silently assumed correct. | `OPEN_QUESTIONS.md` | Promoted from the unnumbered assumptions list to a numbered, explicitly-flagged decision item (#14) with its own latest-safe-point (before Phase 3, Admin Core, begins). |

### 9.2 Remaining Decisions Requiring the Business Owner

Unchanged in substance from §6 above, restated with the one addition from
this pass:

payment provider, shipping model, currency, email/notification provider,
hosting target, Arabic/Latin typeface pairing, logo wordmark form, guest-
checkout-vs-account-required, reviews timing, comparison item cap, staff
permission granularity, audit-log scope, `category_attributes` strictness,
**and (new in this pass) whether admin/staff are expected to use the
dashboard meaningfully on mobile devices** — see
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #14. None of these were
invented or assumed resolved by either review pass.

### 9.3 Final Recommendation

**Ready for Phase 2 — documentation-only work, no code changes required
by this pass.**

Reasons:
- All five confirmed cross-document contradictions (9.1, rows 1–5) are
  now resolved consistently across every document that touches them —
  verified by re-reading `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`,
  `SECURITY_PLAN.md`, `FEATURES.md`, and `OPEN_QUESTIONS.md` together
  after the edits, not just the file each fix was made in.
- The two previously underspecified mechanisms this pass was asked to
  tighten — the variant-hash insertion lifecycle and the refund/webhook
  system boundary — now have a complete, implementable, transaction-safe
  design each, with explicit answers to every sub-question the audit
  brief raised (insertion order, `NOT NULL` satisfaction, simple-product
  representation, concurrent-creation safety, provider-call boundary,
  retry/idempotency, out-of-order events, duplicate refunds).
- No approved business or design decision (brand identity, colors, visual
  direction, mobile-first mandate, RTL-default/LTR-secondary) was altered
  — this pass only removed stale/contradictory text and specified
  mechanisms more precisely.
- Nothing in this pass required inventing a business answer; the one new
  item surfaced (admin mobile usage) was added to
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) as a flagged question, not
  resolved unilaterally.

This recommendation covers documentation readiness only. The seven
Phase-2-blocking items in [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md),
and now also item #14, still need business-owner answers at the
latest-safe-points listed there before the corresponding implementation
work (not all of Phase 2) begins — "ready for Phase 2" means the
architecture and schema design are sound and internally consistent enough
to start building against, not that every business input has been
collected yet.

---

## 10. Phase 1 Final Technical Gap Review

A third, narrowly-scoped documentation pass, covering four mechanisms that
§9 did not fully specify: the anonymous-user/order lifecycle, the refund
outbox worker's crash/multi-worker safety, the variant-combination
canonicalization approach, and lifetime (not just concurrent) duplicate-
refund and manual-review handling. Documentation-only, as before — no
code, migrations, or Supabase changes were made, and this section does
not claim any of the below has been run or tested; it is a design
specification, not a verification report.

### 10.1 Each Remaining Gap and Its Resolution

| # | Gap | Resolution | Where |
|---|---|---|---|
| 1 | Guest checkout's orders had no defined fate when the anonymous identity that placed them is merged into an existing account or reaches Supabase's automatic anonymous-cleanup criteria — `merge_guest_cart` only ever touched cart/wishlist rows, and nothing stated `orders.customer_id`'s `ON DELETE` behavior. | `merge_guest_identity` (renamed, widened) now reassigns the anonymous identity's orders to the target account in the same transaction as the cart/wishlist merge, before deleting the anonymous row. `orders.customer_id` is explicitly `ON DELETE RESTRICT` (every other auth.users-referencing FK's behavior is also now stated explicitly, in a table). A custom cleanup job (not Supabase's default, used as-is) excludes any anonymous identity that owns an order from its deletion candidates. | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3, §3.1; [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1–2.2; [ARCHITECTURE.md](./ARCHITECTURE.md) §8 |
| 2 | `refund_requests` had no mechanism for multiple workers, worker crashes, indefinite `in_flight` rows, or distinguishing the provider's synchronous "accepted" response from asynchronous confirmed completion; polling only `pending` rows would never recover a crashed worker's claimed row. | Added `claimed_by`/`claimed_at`/`lease_expires_at`/`next_retry_at`/`provider_accepted_at` columns, a `SELECT ... FOR UPDATE SKIP LOCKED` claim query that also reclaims rows with an expired lease, a new `provider_accepted` status distinct from `succeeded`, and an explicit rule that the idempotency key (`refund_requests.id`) is reused unchanged on every retry (which is also what makes a lost-response-after-provider-processed scenario safe to retry). | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3, `refund_requests`; [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1; [ARCHITECTURE.md](./ARCHITECTURE.md) §7 |
| 3 | `attribute_combination_hash` (MD5) was asked to be compared against storing the canonical form directly, and the creation/update RPCs had no specified validation for nonexistent ids, duplicate input ids, multiple values for one attribute, or how `category_attributes` relates to variant creation. | Replaced the hash with a canonical, sorted, deduplicated `attribute_value_ids uuid[]` column (directly comparable/indexable in Postgres, no collision risk, self-describing) and specified `create_variant`/`update_variant_attributes` validation: dedupe-and-sort first, verify every id exists, verify no two ids share an `attribute_id` (today's one-value-per-attribute rule, since no attribute is multi-select in v1), and **explicitly left `category_attributes` advisory, not enforced** — the business decision was not resolved, per the audit's instruction not to. | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.3 |
| 4 | `requires_review` events had no defined reviewer, resolution mechanism, or protection against being applied twice through the manual path; the existing partial unique index on `refund_requests` was implicitly assumed to prevent all duplicate refunds, but it only covers *concurrent* ones, not a brand-new request created after an earlier one already `succeeded`. | Added `effect_applied_at`/`reviewed_by`/`reviewed_at`/`resolution_notes` to `payment_events` and a `resolve_payment_event` `SECURITY DEFINER` RPC (admin/owner only) that checks `effect_applied_at IS NULL` before acting — making resolution idempotent and auditable. Added a **second** partial unique index, `UNIQUE (order_id) WHERE status = 'succeeded'` on `refund_requests`, which is the actual mechanism preventing a lifetime second successful refund — explicitly distinct from the first index, which only blocks overlapping requests. A new request after a `failed` attempt remains allowed (via an explicit admin retry action); after a `succeeded` one, it is not. | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2; [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.2, §5.1–5.2 |

### 10.2 New Schema Fields, Constraints, RPCs, and State Transitions Proposed in This Pass

- **Columns added**: `product_variants.attribute_value_ids` (replaces
  `attribute_combination_hash`); `refund_requests.claimed_by`,
  `claimed_at`, `lease_expires_at`, `next_retry_at`,
  `provider_accepted_at`; `payment_events.effect_applied_at`,
  `reviewed_by`, `reviewed_at`, `resolution_notes`.
- **Constraints added**: unique index on
  `product_variants(product_id, attribute_value_ids)` (replacing the hash
  unique index); `orders.customer_id` explicitly `ON DELETE RESTRICT`
  (and every other auth.users/orders-adjacent FK given an explicit stated
  behavior, not left to default); a **second** partial unique index on
  `refund_requests(order_id) WHERE status = 'succeeded'`, alongside the
  existing one covering outstanding statuses (now also including
  `provider_accepted`).
- **RPCs added or renamed**: `merge_guest_identity` (renamed/widened from
  `merge_guest_cart` — now also reassigns orders);
  `resolve_payment_event(event_id, action, resolution_notes)` (new,
  `admin`/`owner`-only, `SECURITY DEFINER`).
- **State transitions added**: `refund_requests.status` gained
  `provider_accepted` as a distinct state between `in_flight` and
  `succeeded`; the claim/lease/retry transitions described in
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3's state-machine diagram.
- **Non-schema artifact proposed**: a custom anonymous-identity cleanup
  job (SQL query specified in
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1) — not a schema object
  itself, but a scheduled process this design now depends on existing
  rather than relying on a platform default.

### 10.3 Unresolved Business Decisions (Unchanged in Substance, Restated for Completeness)

Still open, still not invented by any of the three review passes:
payment provider, shipping model, currency, email/notification provider,
hosting target, Arabic/Latin typeface pairing, logo wordmark form, guest-
checkout-vs-account-required, reviews timing, comparison item cap, staff
permission granularity, audit-log scope, `category_attributes` strictness
(explicitly reaffirmed as still open in §10.1, row 3, above), and admin
mobile usage ([OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) items #1–#14 in
full). **Two additions surfaced in this pass, both flagged rather than
answered:**
- **Anonymous-identity cleanup inactivity threshold** (illustrated as 30
  days in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1, not a
  committed value) and any longer-term data-retention period for guest
  orders tied to an abandoned identity — a legal/tax/compliance question,
  not a technical one.
- **Guest order lookup without an account** (order-number-plus-email
  lookup or similar) for a guest who loses their original session and
  never created an account — currently no storefront path exists for
  this in [FEATURES.md](./FEATURES.md); whether it's needed for v1 is a
  product decision, not assumed either way.

### 10.4 Implementation Risks Still Requiring Engineering Validation

Nothing below has been built or tested — these are risks to validate
once Phase 2 implementation begins, not findings about working code:

- **The `SELECT ... FOR UPDATE SKIP LOCKED` claim query's behavior under
  real concurrent worker load** (lock contention, actual throughput of
  the claim-then-call cycle) is a standard, well-documented Postgres
  pattern, but this review's description of it is a design specification,
  not a benchmark — it should be load-tested with multiple concurrent
  worker instances before being trusted at production refund volume.
- **The `attribute_value_ids uuid[]` unique index's actual performance**
  at 1,000+ products with many variants each is expected to behave like
  any other unique btree index on Postgres, but array-column index
  behavior should be verified against the real catalog size during Phase
  2/3, not assumed from this document alone.
- **The anonymous-identity cleanup job's exclusion query correctness**
  depends on `orders.customer_id` always being populated correctly for
  every checkout path (including any future alternate checkout flow) —
  a new checkout path that somehow bypasses the standard order-placement
  RPC would be a way for this exclusion to be silently wrong; this is a
  reason to keep order creation centralized through one RPC (already the
  design, per [ARCHITECTURE.md](./ARCHITECTURE.md) §7), not a new risk
  introduced by this pass, but worth re-confirming once that RPC is
  actually built.
- **`resolve_payment_event`'s reliance on `has_role_at_least('admin')`**
  inherits whatever risk already existed in that function's own
  correctness (§9.1, row 6, of this document) — this pass adds a new
  caller of it, not a new risk category.
- **Whether every attribute truly stays single-valued long-term** (the
  assumption underpinning the §2.3 "no two ids share an attribute_id"
  validation) is a product/catalog-content risk, not a schema risk: if a
  genuinely multi-valued attribute type is introduced later, that
  validation rule needs to become attribute-type-conditional — flagged in
  the schema's own text, not newly discovered here, but worth restating
  as something Phase 3 catalog modeling should watch for.

### 10.5 Final Recommendation

**Ready for Phase 2 — documentation-only work completed; no code was
written or validated by this pass.**

Reasons:
- All four gaps named in this review's scope (anonymous-user/order
  lifecycle, refund outbox worker recovery, variant canonicalization and
  validation, webhook manual review and lifetime duplicate-refund
  protection) now have complete, consistent, cross-document designs with
  explicit field-level and state-transition detail, not just restated
  principles.
- The one business decision this pass was explicitly told not to resolve
  (`category_attributes` advisory vs. strict) was **not** resolved — it
  remains open, reaffirmed rather than quietly closed.
- No approved brand, design, or prior architectural decision was altered;
  changes in this pass replace an underspecified mechanism
  (`attribute_combination_hash`, the original `refund_requests`/
  `merge_guest_cart` designs) with a more complete one addressing the
  same requirement, not a reversal of any decision the business already
  approved.
- Two new product-level questions surfaced (cleanup inactivity threshold
  and data-retention period; guest order lookup without an account) and
  were added to [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)-equivalent
  tracking in this document (§10.3) rather than answered unilaterally.
- The implementation risks in §10.4 are appropriately flagged as things
  to validate *during* Phase 2/3, not blockers to *starting* Phase 2 —
  they describe what engineering should confirm once code exists, which
  is consistent with this review never having claimed runtime validation.

This recommendation, like §9's, covers documentation and design
readiness only. The business-owner decisions tracked in
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) (including the two new ones
surfaced in §10.3) still need answers at their respective latest-safe-points
before the implementation work they affect begins.

---

## 11. Architecture Revision: Next.js Removed, React + Vite Adopted

**This is an explicit technology decision, not a re-evaluation this review
is being asked to validate or second-guess.** The task was to carry the
decision through every document consistently, not to weigh Next.js
against React+Vite as competing options. Documentation-only, as with
every prior pass in this file — no code, migrations, dependencies, or
Supabase changes were made.

### 11.1 Why Next.js Was Removed

Not a finding of this review — stated here only to give the architectural
changes below their reason, per the task's own framing: Next.js is no
longer wanted as part of this stack.

### 11.2 Why React + Vite Was Selected

Per the approved stack: React (UI), TypeScript, Vite (build tool/dev
server), Tailwind CSS (styling, unaffected), React Router (routing),
Lucide React (icons, unaffected), Supabase (unaffected at the backend
level). Vite's role is specifically as a **build tool**, not a
replacement framework providing SSR/SSG/ISR — the project explicitly does
not get those capabilities back under a different name; §11.4 covers how
SEO is handled without them.

### 11.3 Architectural Changes Required

| Area | Before (Next.js) | After (React + Vite) |
|---|---|---|
| Rendering model | Server-rendered (SSG/ISR/SSR per page type) | Client-side SPA + build/deploy-time prerendering for SEO-critical pages |
| Routing | Next.js App Router (file-based, route groups, `[locale]` segment) | React Router (explicit route tree, `/:locale` path segment for storefront only) |
| Project structure | `app/`, `app/api/` (Route Handlers), `components/`, `lib/` | Feature-based `src/features/{storefront,admin,shared}/`, `src/app/{router,providers,layouts}/`, `src/lib/supabase/` — see [ARCHITECTURE.md](./ARCHITECTURE.md) §2 |
| "Server-side request handling" layer | Next.js Server Actions / Route Handlers re-checking auth before calling an RPC | **Removed entirely, not replaced** — the browser calls `SECURITY DEFINER` RPCs directly; see §11.5 for why this is a simplification, not a gap |
| Image component | `next/image` | Native `<img>`/`<picture>` with `srcset`, Supabase image transformation/CDN, native `loading="lazy"` |
| Sitemap | `sitemap.ts` (Next.js convention) | Standalone Node script querying Supabase, run in the deploy pipeline |
| Deployment target | Node-capable host or Vercel (for SSR/ISR) | Any static host/CDN (no Node runtime required for the frontend) |
| Session handling | Supabase SSR auth helpers (cookie-based, server-refreshed) | `supabase-js` browser default (`localStorage`, client-refreshed) |

Full detail for every row: [ARCHITECTURE.md](./ARCHITECTURE.md) §1–4, §9,
§12.

### 11.4 SEO and Rendering Trade-offs

A plain CSR SPA was rejected outright — SEO is a stated project goal
([PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) §6) and a 1,000+ product
catalog has direct commercial reliance on discoverability. Three options
were evaluated (plain CSR, build/deploy-time prerendering, third-party
prerendering service) — full comparison table:
[ARCHITECTURE.md](./ARCHITECTURE.md) §4.1.

**Recommendation: build/deploy-time prerendering, owned by this project.**
A script boots the built SPA in a headless browser per active product/
category/locale URL and writes the fully rendered HTML into the static
build output, regenerated on a scoped basis when admin content changes —
functionally replacing what Next.js's ISR revalidation did, implemented
as a standalone tool rather than a framework capability. A third-party
prerendering service (e.g. Prerender.io) is documented as a viable
fallback if the custom pipeline isn't ready in time, not as the primary
plan, because it trades a one-time engineering cost for an indefinite
recurring one on something core to the business.

**What this does not fully recover, and is named as a limitation rather
than glossed over**: a Next.js server could set `<html dir="rtl">` before
any byte reached the browser; a prerendered snapshot gets this right for
the exact pages it covers, but the *live* SPA (post-hydration navigation,
or any page not in the prerendered set) still risks a brief
direction/flash-of-wrong-content regression on a cold, no-cached-
preference visit, mitigated but not eliminated by an inline
`index.html` script — see [ARCHITECTURE.md](./ARCHITECTURE.md) §3.3.
Crawling verification (that bots actually receive the prerendered file,
not the SPA shell) is a deployment-configuration risk requiring
post-launch confirmation, not a property the architecture alone
guarantees — see §11.7.

### 11.5 Security Implications

**The removal of Next.js's server tier does not remove a security
boundary, because that tier was never the real one.** RLS and
`SECURITY DEFINER` Postgres functions were always the authoritative
checks (per every security-plan revision before this one); the Next.js
"server-side re-check" layer was a second look at a check the called RPC
was going to perform again regardless — removing it removes a redundant
round trip, not a boundary. The authorization model collapses from three
described layers to two real ones plus a UX convenience:

1. React Router route guard (client-side) — UX only, replacing the old
   Next.js middleware role, same non-authoritative framing.
2. RLS (default boundary for direct table access) and `SECURITY DEFINER`
   RPCs (checking `has_role_at_least()` as their first action, for
   privileged/multi-step operations) — called **directly from the
   browser**, safe because the function itself is the trusted execution
   context, not because anything sits in front of it.

Full detail: [ARCHITECTURE.md](./ARCHITECTURE.md) §9,
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.1.

**Payment webhook processing and the refund outbox worker are
unaffected in kind** — they were always Edge Function/service-role
responsibilities, never Next.js server responsibilities, so removing
Next.js changes nothing about their design (still: webhook signature
verification, `payment_events` insert-and-apply-in-one-transaction,
`refund_requests` as a transactional outbox claimed via
`SELECT ... FOR UPDATE SKIP LOCKED` with a lease). See
[ARCHITECTURE.md](./ARCHITECTURE.md) §8.1–8.2 and
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1–5.3.

**Guest identity merge security was tightened, not just carried over**:
this pass specified a short-lived, single-use, server-issued ticket
(`guest_merge_tickets`) bound to the anonymous session at issuance,
replacing an earlier design that would have asked the client to supply
the anonymous user's id directly after sign-in — a real gap, since the
previous description ("read server-side from the session that existed
before sign-in") had no concrete mechanism once there's no server holding
request state across that transition. See
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 and
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4.

**[Correction, added in §12]: the ticket design described above was not
actually secure** — it closed the "caller-supplied id" gap it names, but
left a different one open (the ticket was never bound to a specific
*target* account, so a leaked/intercepted token could still be redeemed
into an attacker's own account). It has been retired and replaced by a
two-session-token Edge Function design — see §12.1. This paragraph is
left as written, not deleted, as an accurate record of this pass's
conclusion at the time.

**Secrets handling is unchanged in principle, restated for the new
bundler**: only the Supabase anon key is ever `VITE_`-prefixed (and thus
bundled to the browser); the service-role key and payment provider
secrets live only in Edge Function/CI configuration, never in anything
Vite builds. See [SECURITY_PLAN.md](./SECURITY_PLAN.md) §8.

### 11.6 Deployment Implications

The frontend becomes a static artifact (`vite build` output, plus the
prerendering step's additional files) rather than a Node server process —
**any static host/CDN works, no Node-capable host is required for the
frontend anymore**, a genuine operational simplification versus the
Next.js-era requirement. The one deployment-configuration detail that
must be gotten right, flagged explicitly because getting it wrong has no
obvious symptom: a path **with** a prerendered file must serve that file
directly; a path **without** one falls back to `index.html` for React
Router to handle — reversing this ordering would silently serve crawlers
the generic SPA shell instead of the rendered content. Full detail:
[ARCHITECTURE.md](./ARCHITECTURE.md) §12.

### 11.7 Remaining Risks and Unresolved Decisions (This Pass)

**Newly surfaced by the migration itself:**
- RTL/LTR flash-of-wrong-direction risk on a SPA cold load, mitigated
  but not eliminated by an inline script (§11.4,
  [ARCHITECTURE.md](./ARCHITECTURE.md) §3.3) — needs validation once
  built, not assumed solved by this document.
- Prerendered-file-vs-SPA-fallback rewrite-rule ordering (§11.6) — a
  deployment-configuration detail to verify, not guaranteed by the
  architecture description alone.
- Code-splitting storefront vs. admin bundles is now a deliberate Vite/
  Rollup setup task (`React.lazy()`/dynamic `import()`), since Next.js's
  automatic per-route bundling no longer does this implicitly — flagged
  as a Phase 2/4 engineering task, not assumed to happen automatically.
- The custom build/deploy-time prerendering script and the sitemap
  generator are both new, self-owned tooling this project now depends on
  — neither has been built or tested by this review; the third-party
  prerendering-service fallback exists specifically because of this risk.

**Explicitly preserved, not resolved, per the task's instruction not to
silently close them:**
1. Secure anonymous identity merge — **specified** in this pass (the
   ticket mechanism, §11.5) but not implemented or tested; the mechanism
   itself is new enough to warrant its own scrutiny before being trusted.
2. Refund reconciliation for `provider_accepted` requests with no
   webhook — a scheduled polling-reconciliation job is the recommended
   design, but it depends on the (still open) payment provider choice's
   capabilities; no provider-specific implementation exists.
   [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.3,
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #18.
3. Refund policy — one full refund per order (the schema's current
   implicit default) vs. multiple partial refunds under an aggregate cap
   — **not decided**, flagged explicitly rather than left as a silent
   schema default. [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #17.
4. Payment-provider-specific capabilities and limitations — unresolved;
   the provider itself is still open ([OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)
   item #1), and items 2–3 above both depend on its answer.
5. Every existing open business decision in
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) (items #1–#18, including the
   two added by this pass) — none were resolved, invented, or removed by
   this architecture revision.
6. Whether the admin dashboard must also be mobile-first —
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #14, unchanged and
   unresolved by this pass; the framework change doesn't bear on this
   question either way.

### 11.8 Validation Performed

Per the task's explicit validation checklist:

1. **Searched the entire documentation set for "Next.js"** — found and
   addressed in `ARCHITECTURE.md`, `SECURITY_PLAN.md`,
   `DEVELOPMENT_ROADMAP.md`, `OPEN_QUESTIONS.md`, `IMPLEMENTATION_RULES.md`
   (folder-structure alignment), and this file (`ARCHITECTURE_REVIEW.md`,
   where it remains only as historical record per the banner at the top
   of this document and the explanatory "before/after" framing in §11.3).
   `PROJECT_OVERVIEW.md`, `DATABASE_SCHEMA.md`, `FEATURES.md`, and
   `DESIGN_SYSTEM.md` contained no Next.js references to begin with
   (confirmed by search, not assumed) and needed no changes for this
   reason — though `DATABASE_SCHEMA.md` did gain the
   `guest_merge_tickets` table for the §11.5 security fix, unrelated to
   the framework change itself.
2. **Searched for Next-specific terminology** (App Router, Route Groups,
   Server/Client Components, Server Actions, middleware, SSR/SSG/ISR,
   `revalidatePath`/`revalidateTag`, `next/image`, `sitemap.ts`, Vercel-
   as-assumed-host) — every live (non-historical) instance was replaced
   with its React+Vite equivalent per §11.3's table.
3. **Confirmed no Next.js architecture remains in the proposed
   solution** — `ARCHITECTURE.md` now states the stack as React + Vite +
   TypeScript + Tailwind + React Router + Supabase throughout, with an
   explicit banner at its top pointing to this section.
4. **Confirmed React + Vite is consistently documented** — the rendering
   model (§4), routing (§3), structure (§2), and deployment (§12)
   sections of `ARCHITECTURE.md` all describe the same SPA-plus-
   prerendering architecture, cross-referencing each other rather than
   describing conflicting models.
5. **Verified all ten documents agree** — read together after editing:
   `PROJECT_OVERVIEW.md`, `FEATURES.md`, `DESIGN_SYSTEM.md`,
   `DATABASE_SCHEMA.md` needed no framework-specific changes and are
   consistent by construction (they were already framework-agnostic);
   `ARCHITECTURE.md`, `SECURITY_PLAN.md`, `DEVELOPMENT_ROADMAP.md`,
   `OPEN_QUESTIONS.md`, `IMPLEMENTATION_RULES.md`, and this file were
   each updated and cross-checked against the others' terminology
   (`merge_guest_identity`'s ticket parameter, the two-boundary
   authorization model, `/:locale` routing, the prerendering strategy).
6. **Verified original business and design decisions remain intact** —
   brand identity (Taybah/طيبة), the Luxury Editorial/Modern Royal
   direction, the approved color palette, mobile-first storefront,
   Arabic RTL default/English LTR secondary, the product/category/
   attribute/variant model, category-specific attributes, the canonical
   `attribute_value_ids` array, order/payment status separation, the
   `payment_events`/`refund_requests` idempotency design, and
   `has_role_at_least()` were all read back from the updated documents
   and confirmed unchanged in substance — only the *execution context*
   around them (which layer calls what) changed where Next.js's removal
   actually required it.
7. **Verified unresolved questions remain documented** — all 16
   pre-existing [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) items are
   present; 2 new items (#17 refund policy, #18 refund reconciliation)
   were added, not substituted for existing ones.
8. **Checked the roadmap's logical ordering for the new architecture** —
   [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)'s phase sequence
   (admin-before-storefront, RLS-alongside-schema) is unaffected by the
   framework change; only Phase 2's initialization step and Phase 8's SEO
   verification step needed content changes, not reordering.

### 11.9 Final Recommendation

**Ready for architecture approval on the React + Vite revision —
documentation-only work; nothing here has been implemented or run.**

- The Next.js removal is complete and consistent across every document
  that referenced it; the few remaining mentions are explicitly
  historical (this file's pre-§11 sections, with a banner saying so) or
  comparative ("before/after" framing), not leftover target-architecture
  claims.
- The architectural simplification this change produces (one fewer,
  partially-redundant authorization layer) is a genuine upside, not a
  rationalization — it was already true that the old Next.js
  "server-side re-check" was re-doing a check the RPC performed anyway.
- SEO is addressed with a concrete, owned mechanism (build/deploy-time
  prerendering) rather than assumed away or silently downgraded to "SEO
  doesn't matter for an SPA" — with honest limitations stated (§11.4,
  §11.7), not hidden.
- Two real security gaps surfaced and were resolved with specified
  mechanisms (the merge ticket) or given an explicit recommended design
  pending a dependent business decision (refund reconciliation) — neither
  was glossed over to make the revision look more finished than it is.
  **[Correction, added in §12]: "resolved with specified mechanisms (the
  merge ticket)" was itself incorrect — the ticket design did not
  actually close the gap it claimed to. See §12.1–12.2 for the finding
  and the corrected design. This line is left in place, not deleted, as
  an accurate record of what this pass concluded at the time.**
- Nothing required inventing a business decision: the refund-policy
  question this pass surfaced was added to
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) rather than resolved by
  picking a default and calling it done.

**What must be decided before implementation**, beyond the
already-tracked Phase-2-blocking items in
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md): nothing *new* is strictly
blocking as a result of this framework change — the hosting-target item
(#5) was already open and is simply reframed around static hosting now,
not newly introduced by this revision. The sequencing-sensitive items are
the same ones already tracked (payment provider, affecting items #17–#18
above; typeface pairing, affecting Phase 2 design tokens).

---

## 12. Focused Security and Consistency Corrections

A follow-up, narrowly-scoped pass correcting two specific findings in
§11: the guest-identity-merge mechanism was not actually secure despite
being described that way, and the image-upload design asked a Postgres
function to do something it structurally cannot do. Documentation-only —
no code, migrations, dependencies, or Supabase changes were made. §1–11
above are preserved as historical record, including the now-incorrect
conclusion flagged inline at the end of §11.9.

### 12.1 Guest Identity Merge Redesign

**Finding**: the `guest_merge_tickets` design (§11.5, §2.1 item 4 of
[SECURITY_PLAN.md](./SECURITY_PLAN.md) as it stood before this pass) was
a bearer token — random, single-use, short-lived — bound only to the
*anonymous* identity it came from, never to a specific *target* account.
Single-use and short expiry constrain *when* and *how many times* a
token works; they do nothing to constrain *who* is allowed to redeem it.
Whoever obtained the token first — not necessarily the legitimate guest
— could redeem it into any account they could authenticate into,
transferring the victim's guest cart and order history to an attacker's
account. Describing this as closing the "caller-supplied anonymous-id"
gap was accurate as far as it went, but the document then claimed the
result was safe, which overstated what the mechanism actually achieved.

**Resolution — retired, not patched.** The `guest_merge_tickets` table
and its issuing/redeeming functions are removed from the schema design
entirely (see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1). In their
place: a **Supabase Edge Function** that independently verifies **two**
session tokens in one call — the live anonymous session (as the
request's own auth context, exactly as any RLS-governed call proves
identity) and a freshly obtained target-account token (passed as request
data, verified via `supabase.auth.getUser()` against Supabase Auth's own
admin verification, not asserted by the caller). Only once both are
independently confirmed does the function perform the merge, using its
service-role Postgres connection, in one transaction: reassign cart/
wishlist/orders, then delete the anonymous `auth.users` row.
**[Correction, added in §13]: "in one transaction" incorrectly implied
the Auth user deletion was part of the same atomic unit as the data
reassignment — it structurally cannot be (separate service, separate
transaction boundary). See §13.1 for the corrected sequencing and the
`guest_merge_attempts` mechanism this required.** Full flow,
session-transition behavior for every case asked about (new account,
existing account, expiry, retry, concurrency, browser closing mid-flow),
and the architectural reason this *must* be an Edge Function rather than
a plain RPC (PostgREST only ever presents one JWT per request; a second
token passed as a parameter is inert text to Postgres, which has no
built-in way to verify it against Supabase Auth):
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4.

**Status: Proposed — awaiting architecture approval.** Not Resolved —
this has not been implemented or tested, and introduces real new
engineering surface (two Supabase client instances in one page flow, an
Edge Function verifying a second JWT) that needs building and
security-testing before it can be trusted, not just read as sound on
paper.

### 12.2 Image Upload Validation Decision

**Finding**: the architecture described a Postgres `SECURITY DEFINER`
function as sniffing uploaded file content. This is not something a
database function can do — Supabase Storage uploads go directly from
the browser to Storage's API, bypassing Postgres entirely; the only
thing a database function could ever see is self-reported metadata in
`storage.objects` (declared size/content-type), which is exactly the
attacker-controlled information real content validation must not trust.
This conflated four distinct things: file metadata validation, actual
content validation, storage authorization, and trusted processing — see
the corrected breakdown in [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1.

**Two options were evaluated** — direct upload to a private quarantine
bucket with trusted post-upload validation (Option A), versus routing
every upload through a trusted Edge Function end-to-end (Option B). Full
comparison table: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1.
**Option A is recommended**: product photography (rug/carpet imagery)
runs to several MB per original, and a 1,000+ product catalog means
heavy admin batch uploads — routing every byte through an Edge Function
(Option B) hits request-size/memory/timeout constraints that direct-to-
Storage uploads don't, for no compensating security benefit (both
options achieve the same validation guarantee; Option A just does the
bulk transfer the way Supabase Storage is actually designed for).

**Resolved design**: a private `product-images-quarantine` bucket
(write-only for `staff`/`admin`/`owner`, readable by no client role at
all — closing the "temporary exposure" concern by making the quarantine
window categorically non-public, not just briefly public); a new
`pending_image_uploads` tracking table for upload-progress UI; a Storage-
event-triggered Edge Function that downloads the quarantined object,
genuinely inspects its bytes, and — only on success — promotes it to the
public `product-images` bucket and creates the `product_images` row in
the same transaction as marking the tracking row `approved`; on failure,
deletes the quarantine object and marks the row `rejected`. The public
bucket's write access moves to **service-role only** — `staff`/`admin`/
`owner` no longer write to it directly, closing the gap where a
direct-write policy would let an unvalidated file reach the public
bucket regardless of what validation code existed elsewhere. A scheduled
cleanup job handles orphaned quarantine objects from a crashed
validation run. Full detail: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1,
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.

**Status: Proposed — awaiting architecture approval.** Not implemented
or tested.

### 12.3 Cross-Document Consistency Corrections

| Document | What changed |
|---|---|
| `SECURITY_PLAN.md` | §2.1 item 4 rewritten (two-token Edge Function design, session-transition cases, honest residual limitations); §3.2 updated (guest merge removed from the `SECURITY DEFINER` RPC list, with reasoning); §6 and new §6.1 rewritten (quarantine bucket + validating Edge Function, corrected trust boundary) |
| `DATABASE_SCHEMA.md` | `guest_merge_tickets` table removed, replaced by an explanatory "retired, not patched" note in §3.1; merge description in §3 updated to the Edge Function flow; new `pending_image_uploads` table added in §2; ER diagram, indexing (§6), and RLS summary (§8) updated to match both changes |
| `ARCHITECTURE.md` | §9 guest-identity paragraph and the §9.1 RPC example list updated (guest merge no longer listed as a plain RPC; a new §9.1 point 4 added for the Edge Function trust tier); §10 Image Storage rewritten with the corrected trust-boundary framing and a retraction of the original false claim |
| `OPEN_QUESTIONS.md` | The guest-merge and image-upload items' status corrected from an inaccurate "Resolved" to **Proposed — awaiting architecture approval**, with the specific flaw stated; a status-label legend added for consistent use going forward; new item #19 (SEO/prerendering validation risk, Blocked/engineering-validation category) added |
| `DEVELOPMENT_ROADMAP.md` | Phase 2's schema-setup bullet no longer references the retired ticket table; Phase 3's image-management bullet and Phase 5's guest-merge bullet both now state the approval-gating explicitly, with an interim fallback behavior named for each (manual/interim upload path; two separate carts) so Phase 2 doesn't have to stall waiting on them |
| `FEATURES.md` | Admin image-management bullet notes the quarantine/validation flow and its Proposed status, so the feature description doesn't imply instant-live uploads |
| `IMPLEMENTATION_RULES.md` | Testing-expectations bullet's terminology updated from `merge_guest_identity`'s RPC framing to the Edge Function's two-token verification |

**Guest identity merge — verified consistent**: all of the above now
describe the same Edge Function mechanism, the same "Proposed" status,
and the same residual limitation (full browser compromise still defeats
it). No document still describes the retired ticket as the live design
or as secure. Schema (`DATABASE_SCHEMA.md`) and the function's actual
behavior (`SECURITY_PLAN.md` §2.1 item 4) agree: no ticket table, two
independently-verified tokens, Edge Function (not RPC) execution
context. The roadmap (`DEVELOPMENT_ROADMAP.md` Phase 5) explicitly gates
implementation on approval rather than treating the design as already
cleared to build.

**Image uploads — verified consistent**: one upload flow described
identically in `ARCHITECTURE.md` §10, `SECURITY_PLAN.md` §6.1, and
`DATABASE_SCHEMA.md` (`pending_image_uploads`, the two-bucket split).
Bucket policies (quarantine: write-only for staff, unreadable by any
client role; public: service-role-write-only) and validation
responsibility (Edge Function, not a database function) are explicit in
all three. Public/private boundaries are unambiguous: nothing in
`product-images` exists that didn't pass through validation first.
Cleanup (orphaned quarantine objects) and failure (rejected uploads,
with a reason, no DB row) are both documented, not left implicit.

**Decision status labels applied consistently**: every item touched by
this pass in `OPEN_QUESTIONS.md` now carries one of the four labels
defined there (§"Status Labels Used Below"); no existing unresolved
question was removed, and no business requirement was silently changed
— the refund-policy and refund-reconciliation items from §10/§11
(now items #17–#18) are untouched by this pass.

### 12.4 SEO and Prerendering — Validation Risk, Not Implementation

Unchanged in design from §11.4/§11.7 — restated here with explicit,
checkable acceptance criteria, since the task asked for them and they
hadn't previously been enumerated this concretely. **None of the
following has been implemented or tested; this is the checklist future
implementation work should be measured against, not a report of current
state:**

- Arabic and English routes each produce correct, complete HTML at
  their prerendered paths (not a shared/generic snapshot).
- The initial (pre-JS-execution) HTML carries the correct `lang` and
  `dir` attributes for its locale.
- Product and category titles and meta descriptions are present in that
  initial HTML without requiring client-side JavaScript to render them.
- Canonical URLs in the prerendered HTML are correct, including for
  filtered/paginated listing variants resolving to their unfiltered
  canonical.
- Product structured data (schema.org `Product`/`Offer`) in the
  prerendered HTML validates against schema.org's own validator/Google's
  Rich Results Test.
- The generated sitemap includes every eligible canonical product/
  category URL, in both locales, and excludes non-canonical/filtered
  variants.
- `robots.txt` correctly disallows `/admin/`, `/account/`, `/cart`,
  `/checkout` and allows storefront/catalog paths.
- Prerendered files are confirmed (via direct request, not just
  configuration review) to be served ahead of the SPA-fallback rewrite
  rule at their exact paths.
- A missing or failed prerendered page does **not** silently fall
  through to an empty SPA shell for a crawler — it should be
  distinguishable (e.g. a proper error status, or exclusion from the
  sitemap until it exists) rather than indistinguishable from a
  successful but content-light page.

This item is tracked as [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item
#19 — categorized as a **Blocked (engineering-validation)** item rather
than a business decision, since no stakeholder input is needed to
resolve it, only building and testing the thing.

### 12.5 Remaining Security Limitations (Stated, Not Resolved Away)

- **No client-side mechanism is theft-proof against a fully compromised
  browser.** This applies to the guest-merge redesign (§12.1) exactly as
  it would to any authenticated action in the app — a device with
  malware, a malicious extension, or an exploitable XSS at the precise
  moment both tokens are live in memory can impersonate the legitimate
  user. The redesign raises the bar (two simultaneously-valid,
  independently-verified sessions instead of one copyable bearer string)
  but does not make interception impossible.
- **The image-upload redesign's content validation is only as good as
  the Edge Function's actual byte-inspection logic**, which has not been
  written yet — "genuinely inspects file bytes" is a requirement this
  document imposes on the implementation, not a property any design
  document can itself guarantee. A naive implementation that still just
  trusts a library's "is this a valid image" check without defending
  against crafted/polyglot files would not fully satisfy the intent here
  — this is called out as an implementation-quality risk to watch for in
  review, not assumed away by the architecture.
- **Rate limiting for both the guest-merge Edge Function and the image-
  upload-request path is noted as needed but not designed in detail** —
  mechanism TBD in Phase 2, consistent with how rate limiting is already
  tracked elsewhere in [SECURITY_PLAN.md](./SECURITY_PLAN.md) §7.
- **Transport-layer security (HTTPS, CSP) is assumed, not enforced by
  anything in this document** — a Phase 2 deployment-configuration task,
  not a property of the application-layer designs above.

### 12.6 Phase 2 Implications

Per the explicit instruction not to let Phase 2 silently implement an
unapproved security mechanism:

- Phase 2 **may** establish the React + Vite foundation, project
  structure, Tailwind/design tokens, React Router skeleton, Supabase
  project setup, core schema migrations (excluding the retired
  `guest_merge_tickets` table), RLS policies for already-settled tables,
  and skeleton prerendering/sitemap tooling (explicitly already scoped
  as a skeleton, not a finished system, in
  [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) Phase 2).
- Phase 2 **may not** implement the guest-identity-merge Edge Function —
  that belongs to whichever phase builds account sign-in
  (Phase 5, per the roadmap), and only after this design is approved.
  Until then, [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)'s Phase
  5 entry specifies an explicit interim fallback: a guest who signs into
  an existing account simply ends up with two separate carts, rather
  than the project shipping an unapproved merge mechanism to avoid that
  inconvenience.
- Phase 2 **may not** implement the final image-upload pipeline
  (quarantine bucket, validating Edge Function) — that belongs to Phase
  3 (Product CRUD), and only after approval; the roadmap's Phase 3 entry
  specifies that product CRUD can proceed without image upload, or with
  a manual/interim admin-only path, rather than blocking the whole phase.
- Phase 2 **may not** treat the SEO prerendering system as verified —
  it remains an engineering-validation risk (§12.4) to be tested in
  Phase 8, not a checked box after Phase 2's skeleton setup.
- Existing phase ordering is otherwise unchanged — no phase was
  reordered; the two security mechanisms and the SEO system simply have
  their approval/verification gates made explicit where they weren't
  before.

### 12.7 Final Architecture Recommendation

**Conditionally ready, with explicitly listed conditions:**

1. The React + Vite architecture itself (§11) remains approved and
   unaffected by this pass's findings.
2. The guest-identity-merge Edge Function design (§12.1) and the
   image-upload quarantine design (§12.2) are **Proposed, not Resolved**
   — they should not be implemented until explicitly approved as their
   own decision, separate from approving this document as a whole. Both
   are sound, implementable designs on paper, with honestly-stated
   residual limitations (§12.5), not open-ended research problems — the
   condition is approval-before-building, not further design work being
   required first.
3. The SEO/prerendering system (§12.4) is unimplemented and must be
   validated against its stated acceptance criteria before Phase 8
   sign-off — this was already true before this pass; it is now stated
   as explicit, checkable criteria rather than a general caveat.
4. No other condition blocks proceeding: every other previously-tracked
   open item (payment provider, shipping, currency, typeface, logo,
   refund policy, refund reconciliation, admin mobile usage, etc.)
   remains exactly as open as it was, unresolved by and unaffected by
   this pass.

This recommendation covers documentation and design correctness. The
two corrected mechanisms are ready to be *built against* as specified —
they are not ready to be treated as already secure in production without
the implementation and testing work §12.1–12.2 and §12.5 call for.

**[Correction, added in §13]: "ready to be built against as specified"
overstated what was actually specified.** §12 corrected the *ownership-
proof* and *content-validation* flaws but left transaction boundaries,
concurrency control, and idempotency under-specified for both
mechanisms — in particular, §12.1 described the guest-merge RPC as doing
its work "in one transaction" including Auth user deletion, which is not
achievable (Auth Admin API calls and Postgres transactions are different
trust/transaction domains). See §13 for the corrected specification.
This line is left in place, not deleted, as an accurate record of what
this pass concluded at the time.

---

## 13. Transaction, Concurrency, and Idempotency Corrections

A fourth pass, narrower than §12 but correcting a real category of
overclaim §12 made: describing both mechanisms' *data* correctness (one
Postgres transaction's worth of writes) as if it extended to operations
that are structurally outside any single transaction (an Auth Admin API
call; a Storage object operation). Documentation-only — no code,
migrations, dependencies, or Supabase changes were made. §1–12 remain
preserved as historical record, with inline corrections added at the
two specific overclaims identified (linked above) rather than rewritten.

### 13.1 Guest Merge: Transaction Boundaries, Concurrency, Recovery

**What §12 got right**: the two-token verification (closing the
ownership-proof gap) stands, unchanged.

**What §12 got wrong**: it described the data reassignment and the Auth
user deletion as "one transaction." They cannot be — `supabase.auth.
admin.deleteUser()` is an HTTP call to a separate service (Supabase
Auth/GoTrue) with its own transaction boundary, not a SQL statement
Postgres can wrap into the same `BEGIN`/`COMMIT` as an `UPDATE orders
SET customer_id = ...`. **This is a genuine limitation of Supabase's
architecture, not a gap in this project's design that more careful SQL
could close** — stated plainly rather than hidden behind "atomic."

**Corrected specification**:
- **One real Postgres transaction**: reassigns cart/wishlist/order rows
  and advances a new `guest_merge_attempts` row from `in_progress` to
  `data_merged` — genuinely atomic, ordinary transaction guarantees.
- **A separate, subsequent Auth Admin API call** deletes the anonymous
  user — best-effort, retryable, and *allowed to fail* without
  compromising correctness, because the user-visible goal (data under
  the target account) already committed in the step above.
- **Concurrency control**: a durable mutex — `INSERT ... ON CONFLICT
  (anonymous_user_id) DO NOTHING` on `guest_merge_attempts` — not "the
  transaction serializes it." The primary-key constraint is what
  actually prevents two concurrent attempts for the same anonymous
  identity from both proceeding; a losing attempt reads the winning
  row's status and responds accordingly rather than retrying
  independently.
- **Partial failure recovery**: every case the audit brief named (data
  reassigned/deletion failed; deletion succeeded/response lost; function
  timeout; client retry; concurrent requests; target account changing
  between attempts) is given an explicit, named recovery path — not left
  to "the transaction handles it." Full detail:
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 items 4A–4E.
- **Token validity**: this document no longer assumes Auth user deletion
  instantly invalidates every outstanding token everywhere. The actual
  safety property is that reassigned data leaves nothing for a lingering
  token to access (RLS matches zero rows) and a cascaded-deleted
  `profiles` row makes role checks default-deny — "nothing left to
  access," explicitly distinguished from "token proven revoked."

**New schema artifact**: `guest_merge_attempts`
([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1) — a concurrency/
recovery mutex, not an ownership-proof mechanism (that remains the
two-token verification from §12.1; this table does not reintroduce a
bearer-secret risk, since no client ever reads or presents a value from
it).

**Approval conditions for this mechanism** — all of the following must
hold before it is approved for implementation, not merely "designed":
1. The two-token ownership-proof verification (§12.1) — unchanged,
   already specified.
2. The `guest_merge_attempts` mutex and its four state transitions
   (§13.1 above) — specified in this pass.
3. The reconciliation sweep's exact recovery logic for a stuck
   `in_progress` row — **corrected in §14.3 below**: it reads the
   `guest_merge_attempts.status` column as authoritative evidence of
   whether the reassignment transaction committed, *not* by inferring
   commit from whether any cart/wishlist/order rows still reference the
   anonymous id (an earlier version of this condition described that
   row-counting check; it was unsafe for an anonymous identity that
   owns no data at all, since it would show zero matching rows either
   way — fixed, not merely noted, in §14.3). Specified, not yet
   implemented.
4. Target-account binding rules (§14.4) and the lost-response
   verification redesign (§14.5) — both specified in that later pass,
   not yet implemented.
5. All nine test scenarios in
   [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4E pass against a
   real implementation before this is treated as production-ready.

### 13.2 Image Upload: Idempotent State Machine

**What §12 got right**: the metadata-vs-content-validation distinction,
the quarantine-bucket approach, and the Option A vs. B recommendation
all stand, unchanged.

**What §12 under-specified**: it described a four-step happy path
without addressing how a Storage event and a Postgres transaction
(two independent systems, each with its own failure modes) stay
consistent with each other under race conditions, duplicate delivery,
or a crash between steps.

**Corrected specification** — a full state machine (`initiated →
uploaded → validating → approved → promotion_pending → published`, with
`rejected`/`failed` branches), with, for every transition: who/what
triggers it, what must pass, whether it's retryable, and what happens on
failure. Full table: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2,
`pending_image_uploads`; full narrative (initiation sequence,
idempotency, distributed-failure handling, ownership/authorization,
cleanup): [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 items 3A–3F.

**The specific race condition §12 didn't fully address, and §13 itself
only partly fixed — corrected in §14.1–14.2 below.** §12/§13 established
that the DB row is created *before* the client is given a path to
upload to, which prevents a Storage event from arriving for a path with
**no** row at all. That part stands. What remained wrong until §14: the
claim query required `status = 'uploaded'` to process an event — but
the Storage event fires the instant Storage finishes writing the
object, independent of whether the client's own, separate `initiated →
uploaded` status update has landed yet. A legitimately-completed upload
whose client-side status update is merely slow, or never arrives, would
have been **ignored by the validator**, not processed — the opposite of
the "unauthorized object" case, and a real functional bug, not a
security one, but incorrect either way. §14.1 corrects the claim to
accept `status IN ('initiated','uploaded')` and adds an independent
Storage-side existence/completeness check before claiming, so a
genuinely-in-progress upload is never deleted and a genuinely-complete
one is never ignored.

**Idempotency, stated explicitly rather than assumed**: duplicate
Storage events are caught by the corrected atomic claim (§14.1) plus a
unique constraint on `storage_event_id`; repeated promotion attempts are
safe because copying to a deterministic destination path twice is an
idempotent overwrite, not a duplicate object.

**Approval conditions for this mechanism**:
1. The metadata/content/authorization/trusted-processing distinction and
   the Option A recommendation (§12.2) — unchanged, already specified.
2. The full state machine and its idempotency guarantees (§13.2 above,
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2) — specified in this
   pass.
3. The reconciliation sweep's state-checking logic (does the object
   already exist in `product-images`? does a `product_images` row
   exist?) before taking any recovery action — specified, not yet
   implemented.
4. A real implementation of the validating Edge Function's byte-
   inspection logic is reviewed for robustness against crafted/polyglot
   files, not just "does a library say this looks like a JPEG" — flagged
   in §12.5 and unchanged by this pass.
5. The corrected event-claim logic (`initiated`/`uploaded`, with an
   independent object-existence check — §14.1) and the corrected public-
   access boundary (`product-images` as a private, policy-gated bucket,
   not a public one — §14.2) — both specified in that later pass, not
   yet implemented.

### 13.3 Distinguishing Decision Categories (Per This Pass's Instruction)

- **Architecturally approved**: React + Vite over Next.js (§11); RLS as
  the default boundary; the overall two-bucket image-storage split;
  `has_role_at_least()` as the single role-hierarchy source of truth.
- **Proposed designs awaiting approval**: guest-identity merge (full
  mechanism, §12.1 + §13.1); image upload/publishing (full mechanism,
  §12.2 + §13.2).
- **Known limitations** (not defects to fix, properties to accept):
  no client-side scheme is theft-proof against full browser compromise
  (§12.5); Auth user deletion is not instantly global-revocation
  (§13.1); true Postgres/Auth-API or Postgres/Storage atomicity is not
  achievable with Supabase's architecture (§13.1, §13.2).
- **Unresolved technical questions**: the reconciliation sweeps'
  scheduling/frequency (Phase 2 implementation detail, not specified
  further here); rate-limiting mechanism for the merge Edge Function
  (TBD Phase 2).
- **Requirements still needing implementation and testing**: everything
  in both mechanisms — neither has been built or run; the test
  scenarios in §13.1/§13.2's approval conditions are the acceptance bar.

### 13.4 Final Recommendation

**Not ready for production approval of either mechanism; ready for
architecture approval of the corrected designs, with implementation and
testing as the explicit remaining gate.**

This sharpens, rather than contradicts, §12's "Conditionally ready"
conclusion: the conditions in §12.7 were necessary but not sufficient —
they named "approval before building" without the transaction/
concurrency/idempotency detail that approval should actually be
evaluated against. That detail now exists (§13.1–13.2's approval-
condition lists). Neither mechanism should be described as "secure,"
"production-ready," or "approved" until every condition in those lists
is met and verified against a real implementation — this document does
not claim that status for either one.

**[Correction, added in §14]: §13's own approval-condition lists were
still incomplete.** The event-claim race (§14.1), the public-access
boundary (§14.2), the crash-recovery heuristic (§14.3), target-account
binding (§14.4), and lost-response verification (§14.5) were all either
unaddressed or specified incorrectly at the time §13 was written. See
§14 for the corrected specifications and its own final recommendation,
which supersedes this one. Left in place, not deleted, as an accurate
record of this pass's conclusion at the time.

---

## 14. Targeted Critical Fixes

A fifth pass, correcting five specific, concrete defects §13 either
missed or got wrong, plus an explicit Phase 2 schema allowlist to make
sure none of this is accidentally built early. Documentation-only — no
code, migrations, dependencies, or Supabase changes were made. §1–13
remain preserved as historical record, with inline corrections added at
the specific overclaims identified (linked above) rather than rewritten.

### 14.1 Image Upload: The Upload/Event Race, Actually Closed

**The defect**: the validating Edge Function's claim query required
`status = 'uploaded'`. But the Storage event that triggers it fires the
instant Storage finishes writing the object — independent of, and not
waiting for, the client's own separate database write that advances
`initiated → uploaded`. That client-side write can be slow, can fail,
or can simply not have happened yet when the event arrives. Requiring
`'uploaded'` specifically meant a real, complete, legitimate upload
could be ignored by the validator rather than processed — the opposite
of the intended "reject the unauthorized case" behavior, and not fixed
by "move the client-side update earlier," which only narrows the
window, since the update can always be delayed or lost regardless of
when it's attempted.

**The fix**: the claim query now matches `status IN
('initiated','uploaded')`, **and**, before claiming anything, the
function independently verifies the object actually exists and is
fully written via a direct Storage metadata check — not inferred from
trusting the event payload. A row matching with the object not yet
confirmed complete is left untouched (not deleted, not claimed) — a
matching row is evidence of a legitimate, in-progress upload, not of
anything wrong. **Deletion on event arrival is now correct only for the
one case where no row matches the path at all** — a true orphan with no
legitimate origin. Duplicate events remain idempotent via the same
claim query (a second delivery finds the row already past the matching
states) plus the unique constraint on `storage_event_id`. Full
corrected transition table and narrative:
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2, `pending_image_uploads`;
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 item 3A.

### 14.2 Image Upload: Public Object Exposure, Actually Closed

**The defect**: this document (§12.2, restated in §13.2) claimed an
object wasn't "publicly visible" until the `product_images` row existed
— treating database-row timing as if it controlled Storage read access.
It doesn't. If `product-images` were Supabase's "public" bucket type
(which skips access-policy evaluation for reads entirely), an object is
fetchable by direct URL the instant it's copied there, regardless of
whether any database write about it has happened, is happening, or ever
happens. The original design's "copy, then write the row" ordering does
not prevent a public GET of the copied object in between.

**The fix**: `product-images` is redesigned as a **private** bucket with
an RLS-style `SELECT` policy requiring a matching `product_images` row
to exist (`EXISTS (SELECT 1 FROM product_images WHERE storage_path =
storage.objects.name)`), granted to `anon`/`authenticated` — not
Supabase's "public" bucket shortcut. The condition that grants read
access and the condition that makes the storefront aware of the image
are now the literal same condition, enforced by policy evaluation on
every read, not merely correlated by operation ordering. This also
resolves the "promoted but not recorded" partial-failure case
cleanly: the object is physically present but genuinely unreadable
(policy check fails, not merely unqueried) until the DB write lands —
no exposure window, no urgency to race the DB write ahead of anything.
Full policy and rationale: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2.

**Also corrected**: deletion of a `product_images` row and its Storage
object is **not** one atomic operation, as an earlier revision claimed
— it's two sequential operations, DB-row-delete first (which is what
actually revokes read access, immediately, via the policy above), then
a Storage delete that's pure space-reclamation and safe to retry
independently if it fails.

### 14.3 Guest Merge: Crash Recovery, Corrected

**The defect**: the reconciliation sweep for a stuck `in_progress`
`guest_merge_attempts` row inferred whether the reassignment transaction
had committed by checking whether any cart/wishlist/order rows still
referenced the anonymous identity. **This is unreliable**: an anonymous
guest who never added anything to a cart, never wishlisted anything,
and never placed an order would show zero matching rows *whether or not
the transaction ever ran* — the check cannot distinguish "committed,
there was nothing to move" from "never ran" for an empty guest identity.

**The fix — simpler than the defect it replaces, not merely patched**:
the `status` column itself is the authoritative evidence, and no
row-counting is needed at all. Because the transition to `data_merged`
happens *inside* the same Postgres transaction as the reassignment
(§13.1's correctly-atomic piece), Postgres's own atomicity guarantee
means these are not two things that need separate checking — if the
transaction committed, `status` already reads `data_merged`; if it
didn't, `status` is still `in_progress`, unconditionally. A row
observed at `in_progress` past the bounded timeout is, by construction,
proof the transaction never committed. The sweep resets it to `failed`
and allows a clean retry — correct identically for a guest with
substantial data and a guest with none, since the fix removes the
dependency on data volume entirely rather than handling the empty case
as a special branch. Full detail:
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1,
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4C.

### 14.4 Guest Merge: Target-Account Binding, Made Explicit

Previously implicit; now stated as explicit rules
([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1,
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4F):
- Before the reassignment transaction commits, `target_user_id` is
  provisional — a reset-after-`failed` clears it, so a retry may use a
  different target account freely, since nothing was committed to
  protect.
- Once the transaction commits, `target_user_id` is **permanently
  bound** — any later request for the same anonymous identity, with any
  target, is answered from the existing row (matching target: idempotent
  success; different target: explicit rejection), never re-executed.
  This is the mechanism that guarantees reassigned data cannot be
  redirected to a second account after the fact.
- A request arriving while a previous attempt is genuinely
  `in_progress` is rejected by the mutex (§13.1) regardless of what
  target it presents — there is no window where two different targets
  race toward committing for the same anonymous identity.

### 14.5 Guest Merge: Lost-Response Recovery, Made Reliable

**The defect**: the design treated "the anonymous session's
authentication now fails" as evidence that a merge probably succeeded,
and had the client proceed to switch to the target session on that
basis. **This is not reliable evidence** — anonymous authentication can
fail for reasons that have nothing to do with a successful merge (a
naturally expired token, a transient error, rate limiting, an unrelated
bug), so treating any such failure as "merge succeeded" risks the
client acting on an assumption that happens to be wrong.

**The fix**: the client never infers success from the anonymous side
failing. It verifies the durable result directly, using the **target**
session it already independently holds (via the throwaway client from
step 1, kept alive for exactly this purpose) — a new read-only RPC,
`get_my_guest_merge_status(anonymous_user_id)`, returns the stored
`guest_merge_attempts` status **only if** that row's `target_user_id`
matches the caller's own verified `auth.uid()`, otherwise "not found" —
which is what makes accepting a client-supplied `anonymous_user_id`
here safe: the function never reveals or acts on anything beyond "was
my own, already-authenticated account the target of this merge," never
another account's outcome. Only a confirmed `data_merged`/`completed`
result causes the client to switch sessions; `in_progress` triggers a
short poll-and-recheck; `failed`/"not found" means the merge did not
happen, and the client falls back to the documented separate-carts
interim behavior rather than assuming anything succeeded. Full detail
and the new required test scenarios (including one that deliberately
tests an *unrelated* anonymous-auth failure to confirm it is not
mistaken for a successful merge): [SECURITY_PLAN.md](./SECURITY_PLAN.md)
§2.1 items 4C and 4E.

### 14.6 Phase 2 Schema Allowlist

To make sure none of §14.1–14.5's still-unapproved mechanisms can be
built by treating "apply the schema" as unqualified: an explicit
allowlist now exists in
[DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) Phase 2, naming
exactly which tables/infrastructure are in scope (the core catalog,
commerce, and content schema, plus `payment_events`/`refund_requests`
from earlier phases' already-reviewed designs) and which are explicitly
deferred (`guest_merge_attempts`, `pending_image_uploads`, both Storage
buckets and all their policies, the `merge-guest-identity` and
validating Edge Functions, `get_my_guest_merge_status`). Storage bucket/
policy setup is called out specifically as requiring its own approval
even though it might look like "just infrastructure" — §14.2 is exactly
why: a bucket policy is where the real risk in this whole pass turned
out to live.

### 14.7 Final Recommendation

**Conditionally ready for architecture approval of the corrected
designs — same category as §13's conclusion, now resting on
specifications that are actually complete rather than ones that looked
complete.**

1. All five defects named in this pass's scope (event race, public
   exposure, crash-recovery heuristic, target-account binding, lost-
   response verification) now have corrected, specific designs — not
   restated principles, concrete mechanisms with explicit failure-mode
   coverage.
2. Neither mechanism is claimed as secure, production-ready, or
   approved by this document — both remain **Proposed**, pending
   implementation and the test scenarios in
   [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4E and §6.1's
   narrative passing against real code.
3. The Phase 2 allowlist (§14.6) is a concrete, checkable boundary —
   not a restated intention — for what cannot be accidentally built
   before approval.
4. No business decision was invented or resolved by this pass; every
   previously-tracked open item in
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) remains exactly as open as
   before.

This document has now gone through five corrective passes on these two
mechanisms (§11 removing Next.js and introducing them; §12 fixing their
core security flaws; §13 and §14 fixing increasingly specific
transaction/concurrency/idempotency defects). That pattern — each pass
finding something real the previous one missed — is itself a reason to
require actual implementation and adversarial testing before either
mechanism is trusted in production, not a reason to assume a sixth pass
would find nothing: this document does not claim these designs are now
exhaustively correct, only that the specific defects raised in each
pass have been addressed.
