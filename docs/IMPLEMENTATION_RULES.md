# Taybah — Implementation Rules

Engineering conventions for Phase 2+. Nothing here has been applied yet;
this sets expectations before code is written.

## 1. General Principles

- No hardcoded business assumptions in code (tax rates, shipping costs,
  low-stock thresholds, currency) — these live in `store_settings` or
  config, not literals in components.
- No frontend/database work starts until the open decisions in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) that block it are resolved.
- Every schema change ships as a tracked Supabase migration file, never a
  manual change via the Supabase dashboard on a shared environment.
- RLS is enabled on every table at creation time — a table is never left
  in a default-open state "temporarily."

## 1.1 Mobile-First & Bilingual Conventions

- Tailwind usage is mobile-first by construction: unprefixed utility
  classes target mobile, `md:`/`lg:` (or equivalent) variants layer on
  tablet/desktop — never the inverse (desktop-styled-by-default, mobile
  overridden with a smaller-screen variant).
- CSS uses logical properties (`ps-`/`pe-`, `ms-`/`me-` in Tailwind's
  RTL-aware utilities) instead of physical left/right utilities wherever
  direction-sensitive spacing is involved, so RTL is correct by
  construction rather than patched with a parallel `rtl:` override on
  every element.
- Bilingual database columns follow the `_ar`/`_en` suffix convention
  established in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) (e.g.
  `name_ar`/`name_en`) consistently across every new table — a new table
  with user-facing text does not introduce a different pattern (a
  `translations` side table, a `jsonb` blob) without updating this rule
  and the schema doc together.
- Role checks in application code call the same `has_role_at_least()`
  logic used in RLS policies ([SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.1)
  rather than re-implementing an `IN (...)` role list per call site.

## 2. Code Organization

- Shared types live in `src/features/shared/types/`, generated from the
  Supabase schema (`supabase gen types typescript`) plus hand-written
  domain types where the generated shape isn't ergonomic (e.g. a
  `ProductWithVariants` composed type).
- Storefront and admin code stay in separate feature directories
  (`src/features/storefront/`, `src/features/admin/`); only genuinely
  shared primitives (buttons, inputs, design-system tokens, hooks) live in
  `src/features/shared/`. See [ARCHITECTURE.md](./ARCHITECTURE.md) §2 for
  the full structure.
- Data access goes through typed query/RPC wrapper functions in
  `src/features/shared/services/`, not inline Supabase calls scattered
  across components — keeps query shape and RLS/RPC assumptions auditable
  in one place per entity. These wrappers are called **directly from the
  browser** (no application server in between, per
  [ARCHITECTURE.md](./ARCHITECTURE.md) §9) — which is exactly why keeping
  them centralized matters: it's the one place to audit what every
  feature actually sends to Supabase.
- Validation schemas (Zod) are defined once per entity and imported on
  both the client (form UX feedback) and inside the relevant Postgres
  RPC/Edge Function (the actual trust boundary — there is no middle
  server tier to also validate in) — never duplicated, and never assumed
  sufficient on the client side alone.

## 3. Naming & Conventions

- Database: `snake_case` tables/columns, singular enum values, plural
  table names.
- TypeScript: `camelCase` variables/functions, `PascalCase`
  components/types.
- Routes: kebab-case URL segments (`/product-care`, not `/productCare`).
- Branch naming / commit conventions: to be defined when git is
  initialized in Phase 2 (not yet decided — see
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) if a preference exists).

## 4. Testing Expectations (for Phase 2+)

- Business-critical logic (order total calculation, stock decrement,
  coupon application) requires unit/integration tests before being
  considered done — these are the places where a bug has direct financial
  impact.
- RLS policies are tested with representative role scenarios (anonymous,
  customer-own-data, customer-other-data, staff, admin) before being
  considered complete, not assumed correct from policy text alone.
- The anonymous-identity lifecycle (the guest-merge Edge Function's
  two-session-token verification, the `guest_merge_attempts`-mediated
  concurrency control — including recovery for an anonymous identity
  with **zero** cart/wishlist/order rows, which must behave identically
  to one with data, not as an untested special case — target-account
  binding across retries, and the `get_my_guest_merge_status`-based
  lost-response verification, the separate Postgres-transaction-vs-Auth-
  Admin-API-call recovery behavior, the `orders.customer_id` `RESTRICT`
  constraint, the cleanup job's exclusion query — concrete test
  scenarios enumerated in [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1
  item 4E), the image-upload state machine's idempotency under duplicate
  Storage events/retries including the `initiated`-state claim race and
  the private-bucket-with-conditional-read policy
  ([SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1–6.2), and the refund
  outbox worker's concurrent-claim behavior
  (`SELECT ... FOR UPDATE SKIP LOCKED` under multiple simulated workers)
  are all financially/data-integrity critical and require their own
  test coverage before being considered
  done — see [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §10.4 for
  the specific scenarios this review flagged as needing validation.

## 5. Dependency Discipline

- No dependency is added without a specific need tied to a feature in
  [FEATURES.md](./FEATURES.md) — the approved stack in
  [ARCHITECTURE.md](./ARCHITECTURE.md) is the default toolkit; deviations
  require a stated reason (e.g. "Postgres full-text search is
  insufficient for X, evaluating a dedicated search service").

## 6. Review Discipline

- Admin-side mutations (anything that changes catalog, orders, or store
  config) should go through server-side validation and RLS, as specified
  in [SECURITY_PLAN.md](./SECURITY_PLAN.md), with no shortcuts for
  "internal tool, lower risk" — admin compromise has outsized impact
  (catalog/pricing/order tampering).
- Any deviation from this document or the architecture docs during
  implementation should be reflected back into the docs, not left as
  undocumented drift.
