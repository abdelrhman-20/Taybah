# Taybah — Development Roadmap

This roadmap sequences work for after architectural approval. Nothing here
has started.

## Phase 1 — Discovery & Architecture (this phase)
- Workspace discovery, stack evaluation, architecture, schema, feature
  scope, design direction, security plan, documentation.
- **Gate: architectural approval required before Phase 2.**

## Phase 2 — Foundation Setup
- Initialize git repository and a **React + Vite + TypeScript + Tailwind +
  React Router** project (no Next.js — see
  [ARCHITECTURE.md](./ARCHITECTURE.md)), with the `/:locale` (`ar`/`en`)
  route segment and RTL/LTR direction handling (including the
  inline-script FOUC mitigation, [ARCHITECTURE.md](./ARCHITECTURE.md)
  §3.3) in place from the first page, not retrofitted later.
- Set up Supabase project (dev), apply initial schema migrations from
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — **explicit allowlist**,
  so Phase 2 cannot accidentally include a blocked mechanism by treating
  "apply the schema" as an unqualified instruction:
  - **Allowed in Phase 2**: `profiles`, `categories`, `products`,
    `product_categories`, `attributes`/`attribute_values`/
    `category_attributes`, `product_variants`/`variant_attribute_values`,
    `product_listing_summary`, `carts`/`cart_items`,
    `wishlists`/`wishlist_items`, `comparisons`/`comparison_items`,
    `orders`/`order_items`/`order_status_history`, `coupons`/
    `coupon_redemptions`, `homepage_sections`/`homepage_section_items`,
    `store_settings`, `payment_events`, `refund_requests` — plus
    Supabase anonymous sign-ins enabled for guest cart identification,
    and all `has_role_at_least()`-based RLS policies for the above.
    `product_images` (the table only — columns, not the upload
    pipeline) is also allowed, since it's a plain data table with no
    approval-pending mechanism of its own; it simply has no rows until
    Phase 3's upload pipeline (once approved) can create any.
  - **Must remain deferred — guest-identity-merge infrastructure**:
    `guest_merge_attempts` (table), the `merge-guest-identity` Edge
    Function, the `get_my_guest_merge_status` RPC, and any Auth Admin
    API wiring for anonymous-user deletion as part of a merge. None of
    this is created in Phase 2.
  - **Must remain deferred — image-upload infrastructure**:
    `pending_image_uploads` (table), the `product-images-quarantine`
    bucket and its policies, the `product-images` bucket's conditional-
    read policy (§6.2's `EXISTS`-based policy — not just its
    service-role write restriction), the validating Edge Functi for product
    images (quarantine or public) — bucket/policy setup is treated as
    part of the mechanism it serves, not generic infrastructure, since
    §6.2 showed that getting a bucket's access policy wrong is exactly
    where the real risk lives.
  - See [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §13.6 and §14
    for the full rationale.
- Configure RLS policies from [SECURITY_PLAN.md](./SECURITY_PLAN.md),
  including the uniform `customer_id = auth.uid()` cart/wishlist policy
  and the `has_role_at_least()` hierarchy function.
- Set up design tokens from [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) in
  Tailwind config, mobile-first by default (base styles target mobile,
  `md:`/`lg:` variants expand for tablet/desktop — not the reverse).
- Stand up the build/deploy-time prerendering and sitemap-generation
  scripts in skeleton form ([ARCHITECTURE.md](./ARCHITECTURE.md) §4) —
  even a minimal version early avoids SEO infrastructure becoming a
  last-minute Phase 8 scramble.
- Resolve open decisions in [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) that
  block schema finalization (payment provider, shipping model, currency,
  typeface pairing for Arabic/Latin, hosting target for the static SPA).

## Phase 3 — Admin Core (build data-entry tools before storefront needs data)
- Auth + role-based access for admin.
- Category management.
- Attributes & variations management.
- Product CRUD. **Image management's final upload/publishing pipeline
  (quarantine bucket, validating Edge Function, the full
  `pending_image_uploads` state machine, idempotency and reconciliation
  behavior in §6.1 items 3A–3F) must remain blocked — not built, not
  started — until that design is explicitly reviewed and approved** —
  see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 (status: Proposed) and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §13.6. If approval
  hasn't landed by the time this phase starts, product CRUD can proceed
  without image upload (or with a manual/interim admin-only upload path)
  rather than blocking the whole phase on it.
- CSV bulk import for initial catalog load.

**Rationale:** the storefront can't be meaningfully built or tested without
real catalog data; building admin product/category tools first gives the
team a way to populate 1,000+ products before or alongside storefront work.

## Phase 4 — Storefront Core
- Homepage (static sections first, admin-editable later in this phase).
- Category & subcategory pages.
- Product listing with filters, sort, pagination.
- Product detail page with variants, gallery, quick view.
- Search.
- **Every page in this phase is built and validated mobile → tablet →
  desktop, and in both Arabic (RTL) and English (LTR), before being
  considered done** — not built once in one locale/breakpoint and ported
  afterward. This is the phase where the mandatory mobile-first/bilingual
  strategy ([DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2) is actually
  exercised for the first time, so it is treated as a per-page acceptance
  criterion, not a follow-up pass.

## Phase 5 — Commerce Flow
- Cart (guest + account).
- Wishlist, comparison.
- Checkout (address, payment integration, order placement RPC with
  transactional stock decrement).
- Order confirmation + customer order history.
- Coupons at cart/checkout.
- Payment webhook handler (`payment_events` insert-and-apply-in-one-
  transaction logic) and the `refund_requests` outbox worker (claim
  query, retry/backoff, idempotency key reuse) — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1–5.2. The outbox worker's
  concurrent-claim behavior should be tested under multiple simulated
  workers before this phase is considered done, per
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §10.4.
- Guest-identity merge (cart/wishlist/order reassignment on account
  sign-in, via the two-session-token Edge Function design plus the
  `guest_merge_attempts` concurrency/recovery mechanism) — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1 and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4. **Status: Proposed
  — awaiting architecture approval. This must remain blocked — not
  built, not started — until the design (including the transaction-
  boundary, concurrency, and recovery detail in §2.1 items 4A–4E) is
  explicitly reviewed and approved** (see
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §13.6). Until
  approved, a guest who signs into an existing account simply keeps
  their guest cart/wishlist and orders separate from that account (the
  interim, lower-risk fallback) rather than this project shipping an
  unapproved merge mechanism.

## Phase 6 — Admin Operations
- Order management (list, detail, status updates, history), including
  cancellation and refund-request UI (showing `refund_requests.status`,
  never allowing a direct "mark refunded" action — see
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1).
- `resolve_payment_event` admin/owner review UI for `payment_events`
  flagged `requires_review` — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.2.
- Customer management.
- Coupon management.
- Inventory views (low-stock alerts).
- Dashboard analytics (v1 baseline).
- Anonymous-identity cleanup job (scheduled Edge Function/SQL job per
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.1) — not customer-facing,
  but an operational piece that belongs in this phase alongside other
  admin/ops tooling.

## Phase 7 — Content & Store Configuration
- Homepage content management (sections/items).
- Store settings (currency, tax, shipping).
- Staff accounts & permissions.

## Phase 8 — Hardening & Launch Prep
- SEO pass (structured data, sitemap, metadata audit) for **both locale
  trees**, plus explicit verification that the prerendered static HTML
  (not the generic SPA shell) is what's actually served to crawlers at
  each product/category path — via Search Console URL inspection, not
  assumed correct from the deployment config alone (see
  [ARCHITECTURE.md](./ARCHITECTURE.md) §4.2 and §12).
- Performance pass at realistic catalog volume (seed 1,000+ test products),
  measured on mobile devices/throttled connections first, given mobile is
  the primary experience.
- Accessibility audit, including RTL-specific checks (focus order, screen
  reader behavior in Arabic) — not just the English/LTR tree.
- Security review against [SECURITY_PLAN.md](./SECURITY_PLAN.md),
  including the owner-access and privilege-escalation checks from §3.1.
- Staging → production Supabase promotion, production deployment config.

## Phase 9 — Post-Launch (v2 candidates)
- Reviews, multi-warehouse inventory, loyalty, abandoned cart recovery,
  advanced analytics — per [FEATURES.md](./FEATURES.md) §C.

## Sequencing Notes
- Admin-before-storefront (Phase 3 before 4) is a deliberate choice: it
  avoids building storefront UI against fake/mock data and gives the
  business a tool to start real catalog entry early.
- RLS policies are written alongside schema (Phase 2), not bolted on later
  — retrofitting RLS onto an app already assuming open access is high-risk.
- Payment and shipping decisions are **blocking** for Phase 5 and should be
  resolved during Phase 2–3, not deferred to Phase 5 itself.
