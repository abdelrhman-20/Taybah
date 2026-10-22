# Taybah — Feature Breakdown

Status legend: all features below are **planned**, none implemented.
"v1" = required for initial launch. "v2" = explicitly deferred.

## 0. Mobile-First & Bilingual Baseline (Applies to Every Storefront Feature Below)

These are not a separate feature set — they are **cross-cutting
requirements every storefront item in Section A is built against**, per
the mandatory mobile-first strategy:

- Every storefront page/component below is designed and validated mobile
  → tablet → desktop, in that order (desktop is an intentional expansion,
  not a scaled-up mobile layout). See
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2.
- **Arabic (RTL) is the default locale; English (LTR) is a fully supported
  secondary locale** — not a v2 add-on. Every storefront page ships in
  both from v1.
- Responsive, touch-friendly navigation (large tap targets, a mobile nav
  drawer/bottom nav rather than a shrunk desktop nav bar).
- **Filters use a bottom sheet on mobile**, not a cramped sidebar
  squeezed into a small viewport; the sidebar presentation is
  desktop/tablet-only — see Product Listing below.
- **Product image galleries are touch/swipe-first on mobile** (swipe
  direction follows the active locale's reading direction — right-to-left
  swipe-to-advance in Arabic, left-to-right in English), with the
  desktop/tablet experience adding hover-zoom and thumbnail strips as an
  expansion, not the primary interaction.
- Product grids are responsive (e.g. 2 columns mobile → 3 tablet → 4+
  desktop, exact counts TBD during design), not a single fixed grid
  scaled by CSS.

## A. Customer Storefront

### Homepage (v1)
- Hero section (admin-editable via `homepage_sections`).
- Featured categories grid.
- Featured/curated product collections (admin-composed, not hardcoded).
- Editorial banners (brand storytelling — heritage, craftsmanship).

### Categories & Subcategories (v1)
- Hierarchical browsing (Category → Subcategory), breadcrumb navigation.
- Category landing pages with editorial header + product grid.
- A product can appear in multiple categories.

### Product Listing (v1)
- Grid layout, server-paginated, responsive column count (§0).
- Sort: price (asc/desc), newest, best-selling (v2 — needs order analytics),
  rating.
- Filters: category, price range, and **attributes relevant to the current
  category** (a rug listing filters by pile height/origin; a curtain
  listing filters by drop length/fabric — the filter set is driven by
  `category_attributes`, not one fixed attribute list forced onto every
  category, per [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.2),
  in-stock only.
- **Mobile: filters open in a bottom sheet** triggered by a filter button
  in the listing toolbar, with applied-filter count shown as a badge.
  **Tablet/desktop: filters are a persistent sidebar.** Same underlying
  filter state and URL params drive both presentations.
- Filter state reflected in URL (shareable, SEO-safe canonical handling),
  localized per the active locale's URL structure.

### Search (v1)
- Full-text search across product name/description (Postgres `tsvector`
  for v1; evaluate dedicated search service only if relevance becomes
  insufficient at scale).
- Search-as-you-type suggestions (debounced) — v2 if v1 timeline is tight.
- Empty-state and "no results" handling with related-category suggestions.

### Product Details (v1)
- Image gallery — touch/swipe on mobile (primary interaction), hover-zoom
  and thumbnail strip added on tablet/desktop (§0).
- Variant selector (size/color swatches) updating price & stock live. A
  product with only one variant and no customer-facing attributes (a
  "simple" product — see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2)
  shows no variant selector at all, not an empty/disabled one.
- Stock status per variant (in stock / low stock / out of stock).
- Rich bilingual description, specifications (material, origin, care
  instructions), dimensions — specification fields shown are whatever
  attributes apply to that product's category (§0, Product Listing).
- Related/similar products.
- Add to cart, add to wishlist, add to comparison.

### Wishlist (v1)
- Persisted per `customer_id` (`auth.uid()`) for both guests (anonymous
  Supabase Auth session) and registered accounts — not a client-side
  `localStorage` wishlist synced after the fact.
- **Merging a guest's wishlist/cart into an account they sign into is
  not automatic on login, and is not independent of the broader
  guest-identity-merge mechanism.** That mechanism (which also covers
  cart items and, separately, order ownership) is **Proposed — awaiting
  architecture approval**, not yet implemented — see
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4 and
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md). **Current, safe behavior
  until that mechanism is approved and built**: a guest's wishlist stays
  under their anonymous identity; signing into an existing account does
  not pull the guest wishlist into it, and does not lose the guest
  wishlist either — it simply remains where it was, reachable again only
  if the same anonymous session persists. This is a known, accepted
  interim limitation, not a bug to fix outside of approving the merge
  design.
- Add/remove from listing, detail, and quick view.

### Product Comparison (v1)
- Compare up to N products (proposed: 4) side by side on key attributes.

### Quick View (v1)
- Modal preview from listing grid without full page navigation —
  variant selection + add-to-cart from the modal.

### Cart (v1)
- Persistent cart via anonymous-or-registered Supabase Auth session (not a
  session-token cookie scheme) — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3.
- Mobile: cart as a full-screen view or slide-up drawer with large touch
  targets for quantity change/remove; tablet/desktop may add a persistent
  mini-cart affordance (design detail for Phase 4, not decided here).
- Quantity adjustment, stock-aware (cannot exceed available stock).
- Coupon code entry with live validation.

### Checkout (v1)
- Guest checkout + account checkout.
- Address entry (shipping/billing), order summary, payment step.
- Payment provider: **open decision**, see
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).
- Order confirmation page + email (email provider: open decision).

### Customer Accounts (v1)
- Registration/login (Supabase Auth), password reset.
- Profile management (name, phone, addresses).
- Order history with status tracking.
- Saved addresses for faster future checkout.

### Coupons & Discounts (v1, customer-facing side)
- Apply coupon at cart/checkout.
- Clear feedback on invalid/expired/ineligible codes.

## B. Admin Dashboard

### Dashboard Analytics (v1 baseline, v2 depth)
- v1: order count, revenue, low-stock alerts, recent orders — simple,
  queryable directly from existing tables.
- v2: trend charts, best-sellers, customer cohort analysis — may warrant
  dedicated aggregation tables if query cost grows.

### Product CRUD (v1)
- Create/edit/archive products, rich description editor, SEO fields.
- Manage images (upload, reorder, set primary, alt text). Upload goes
  through quarantine-then-validation before an image appears in the
  gallery (not instant) — see [SECURITY_PLAN.md](./SECURITY_PLAN.md)
  §6.1; this mechanism is **Proposed, not yet implemented**, so the
  admin UI should show upload status (pending/approved/rejected), not
  assume an upload is live the instant the file picker closes.
- Manage variants inline (add/edit/remove size-color-etc. combinations,
  per-variant price & stock).
- Bulk actions: bulk status change, bulk category assignment (v2 if needed
  for 1,000+ catalog onboarding — likely **v1-adjacent**, see roadmap).
- Bulk import (CSV) for initial catalog load of 1,000+ products — **v1,
  high priority**, since manual entry of 1,000 products is impractical.
  Import format carries both `name_ar`/`name_en` (and other bilingual
  fields) as separate columns — not a single-language import backfilled
  with translation later.

### Categories Management (v1)
- Create/edit/reorder/nest categories, assign hero images, SEO fields.

### Attributes & Variations (v1)
- Define attribute types (size, color, material, drop length, pile height,
  etc.) and their bilingual values.
- Assign which attributes apply to which category (`category_attributes`)
  so the product form only shows relevant pickers — rugs, carpets,
  curtains, and furnishings are not forced through one shared attribute
  template. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.2.
- Generate variant combinations from selected attribute values, with
  duplicate-combination attempts rejected at creation (database-enforced,
  safe under concurrent staff edits — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.3).
- A product can also have **no customer-facing variations** (a single
  implicit variant) — the admin product form doesn't force every product
  through a variant-builder step.

### Inventory Management (v1)
- Per-variant stock editing, low-stock threshold configuration.
- Low-stock dashboard view/alert.
- Stock history/audit trail (v2 — nice to have, not launch-blocking).

### Order Management (v1)
- Order list with filter/search by **fulfillment status and payment
  status independently** (two separate filter dimensions, not one
  combined status — see
  [ARCHITECTURE.md](./ARCHITECTURE.md) §7.1), customer, date, order number.
- Order detail view, status updates, status history/audit trail.
- Cancellation (pre-shipment) and refund-request handling: staff/admin
  action requests the cancellation/refund; completion is confirmed by the
  payment provider webhook, not asserted immediately by the UI action —
  see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1. Exact provider
  integration tied to the payment provider decision in
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

### Customer Management (v1)
- Customer list/search, view profile + order history.
- Manual account actions (e.g. reset password trigger) — v2 if not
  required at launch.

### Coupons (v1)
- Create/edit coupons (type, value, constraints, validity window, usage
  limits).
- Usage/redemption reporting.

### Homepage Content Management (v1)
- Compose homepage sections (hero, featured categories/products, banners)
  without a deploy.
- Reorder, activate/deactivate sections.

### Store Configuration (v1)
- Currency, tax rate, shipping rule basics, contact info, social links.
- Shipping is likely **flat-rate or simple rule-based for v1** — see
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

### Staff Accounts & Permissions (v1)
- Invite staff, assign role (owner/admin/staff).
- Role-based access to admin sections (e.g. staff can manage orders/
  inventory but not store settings or other staff accounts).

## C. Explicitly Deferred to v2+

- Product reviews/ratings submission flow (schema has `avg_rating` as a
  placeholder; collection UI is v2).
- Multi-warehouse/location inventory.
- Multi-currency. (**Not** multi-language — Arabic + English are both v1,
  mandatory, per §0. A third language beyond Arabic/English would be v2.)
- Loyalty/rewards program.
- Abandoned cart recovery automation.
- Advanced analytics/BI dashboards.
- Mobile app / public API for third parties.
