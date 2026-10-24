# Taybah (طيبة) — Project Handoff for ChatGPT

> **Purpose of this document:** a self-contained briefing for an AI assistant
> continuing work on the Taybah codebase. It describes the project, the *actual*
> current implementation (verified against the source code on 2026-10-24), and
> the design documents that govern future work.
>
> **Critical context, read first:** `docs/` contains a very thorough Phase 1
> architecture/design set — but it describes the **target** architecture, not the
> current one. The codebase was subsequently built with several deliberate scope
> reductions (Arabic-only, cash-on-delivery only, localStorage-backed catalog,
> no customer accounts). **Where docs and code disagree, the code is the current
> truth; the docs are the aspirational design.** The `docs/PREMIUM_DESIGN_DIRECTION.md`
> file was written *after* implementation began and accurately describes the
> current code — treat it as the most code-accurate doc. The other docs are still
> authoritative for *how* the full backend should eventually be built.

---

## 1. Project Overview

Taybah (English) / طيبة (Arabic) is a premium e-commerce platform for rugs,
carpets, curtains, and home furnishings, positioned as **"Luxury Editorial with
Modern Royal influences"** — an editorial, photography-first aesthetic, not a
generic marketplace template. Reference for functional expectations only:
carpetlandeg.com/shop.

Two applications live in **one React SPA**:

- **Storefront** — customer-facing shopping experience (Arabic RTL).
- **Admin dashboard** — internal tool for staff to run the store (also Arabic
  RTL in the current build, despite the original docs specifying LTR/English).

**Brand values** (from the app's own About page): authenticity (الأصالة),
quality first (الجودة أولًا), visual calm (الهدوء البصري), transparency
(الشفافية). Differentiators: curated-not-endless catalog, Arabic-first design,
documented sizes/materials.

---

## 2. Current Implementation Status (verified against code)

### What actually works today

- **Storefront pages (Arabic RTL only):** home (composable sections), product
  listing (`/ar/products`), category pages (`/ar/category/:slug`), collections
  listing + detail, product detail (`/ar/products/:slug`), cart page + drawer,
  wishlist page, search, checkout, order confirmation, plus content pages
  (about, contact, FAQ, privacy, terms, shipping-returns).
- **Product model:** products with categories, **collections** (a grouping
  concept that exists in code but is NOT in the design docs' schema — see §9),
  attribute assignments (color/material/size + custom attributes), and a real
  variant system (1–3 axes, ≤60 combinations, per-variant SKU/price/
  availability/image).
- **Cart:** localStorage-persisted, cross-tab synced, variant-aware, with a
  blocked-item system (hidden/unavailable lines stay visible but can't be
  checked out).
- **Checkout:** guest-only, **cash-on-delivery only** ("الدفع عند الاستلام").
  No payment provider, no customer accounts. Order inserts go to Supabase
  `public.orders` (anon-key INSERT allowed by RLS).
- **Orders admin:** list + detail, status updates
  (`pending → confirmed → processing → shipped → delivered`, or `cancelled`),
  backed by real Supabase reads/writes. Order status history is written by DB
  triggers and fires a `pg_net` webhook to a `send-order-status-email` Edge
  Function that emails the customer via **Resend** (sandbox sender:
  `onboarding@resend.dev` — can only reach the Resend account owner's inbox
  until a domain is verified).
- **Admin auth:** Supabase Auth email/password login at `/admin/login`. Route
  guard redirects unauthenticated users. **Two authorization models coexist**:
  orders tables treat "any authenticated user" as staff; the newer catalog
  migration adds an `admins` allowlist table + `is_admin()` function.
- **Catalog/admin CRUD:** products, categories, collections, attributes,
  homepage sections, navigation items — all working admin UIs, but **backed by
  localStorage stores, not Supabase** (see §5). Includes a variant-matrix
  editor, image picker, and media library.
- **Images:** admin uploads are stored as blobs in **IndexedDB** and referenced
  as `local:<assetId>` strings — purely browser-local, never uploaded to a
  server. External http(s) URLs (the seeded picsum.photos placeholders) pass
  through unchanged.
- **Tests:** 13 test files, **315 tests, all passing** (vitest, node
  environment, pure store/logic tests). Typecheck passes (`tsc -b`). ESLint:
  1 warning (a `react-refresh/only-export-components` warning in
  `PageTransition.tsx`).

### What does NOT exist yet (despite being in the design docs)

- No customer accounts/registration at all — no `/account` routes exist.
- No English storefront (`SUPPORTED_LOCALES = ['ar']` only; `en` fields exist
  in data records but are never rendered).
- No payment provider integration, no `payment_status` field, no coupons,
  no promotions, no comparison feature, no reviews, no CSV import.
- No server-persisted cart/wishlist (localStorage only) — the anonymous-auth
  guest-cart design from the docs is not implemented.
- No numeric stock decrement on order; availability is a **manual** per-product/
  per-variant enum (`in_stock`/`low_stock`/`out_of_stock`). A `stockQuantity`
  numeric field exists but is advisory-only — nothing decrements it.
- No SEO prerendering, sitemap, or `robots.txt` (no `public/` dir yet).
- No role hierarchy (`profiles`/`has_role_at_least()` not built — the `admins`
  allowlist is the interim mechanism).
- None of the docs' "Proposed — awaiting architecture approval" mechanisms are
  built: no guest-merge Edge Function, no image quarantine pipeline. (Image
  uploads go to IndexedDB; the migration-created `storefront-media` Supabase
  Storage bucket is public and currently unused by the frontend.)

### Partially built / in-progress

- Supabase catalog schema (migration `0003`) exists in the database but the
  frontend does not read/write it — the app still runs on the localStorage
  catalog store. A "data-migration utility" is referenced in that migration's
  comments but does not exist in the repo.
- `pg` is a devDependency but is unused in committed code (likely for ad-hoc
  scripts).
- Uncommitted local change in `src/features/storefront/components/ProductCard.tsx`
  (a `max-h` tweak on the image link) — active UI polish in progress.

---

## 3. Tech Stack (actual)

| Layer | Reality |
|---|---|
| Build/dev | Vite 8 (`vite.config.ts` — react plugin + `@tailwindcss/vite`) |
| UI | React 19 + TypeScript (strict mode; `noUnusedLocals`, `verbatimModuleSyntax`) |
| Routing | React Router 8 (`createBrowserRouter`, `src/app/router/index.tsx`) |
| Styling | Tailwind CSS v4 (theme tokens in `src/styles/globals.css` `@theme`) |
| Icons | lucide-react |
| Backend | Supabase (`@supabase/supabase-js`), used only for: orders table, admin auth, one Edge Function |
| Email | Resend via Edge Function `send-order-status-email` (Deno) |
| Tests | Vitest 5 (node env; `client.mock.ts` swapped in via `vitest.setup.ts`) |
| State | Hand-rolled `useSyncExternalStore` stores + localStorage/IndexedDB — no Redux/Zustand/TanStack Query (docs recommend TanStack Query for the future real data layer) |
| Validation | None installed — no Zod yet (docs prescribe shared Zod schemas for the future RPC layer) |

Commands: `npm run dev` · `npm run build` (`tsc -b && vite build`) ·
`npm run lint` · `npm test` (vitest run) · `npm run typecheck`.

Env: `.env.local` must contain `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
(see `.env.example`). The app **throws at startup without them** — even though
most of the app is local, `orderStore` imports the client at module scope.

---

## 4. Directory Structure (actual)

```
src/
├── main.tsx                       # entry; wraps router in ErrorBoundary
├── app/
│   ├── router/index.tsx           # full route tree (see §6)
│   ├── router/RootRedirect.tsx    # '/' → '/ar' (stored pref); locale-prefixed /admin fixer
│   └── layouts/
│       ├── StorefrontLayout.tsx   # sets html lang/dir; header/footer/drawer shell
│       └── AdminLayout.tsx        # auth guard; sets lang=ar dir=rtl; sidebar shell
├── features/
│   ├── storefront/
│   │   ├── home/                  # HomePage + section components + homeStore (localStorage)
│   │   ├── catalog/               # listing/filters/sort, category/collection pages,
│   │   │                          # catalogData (MOCK SEED), catalogStore (localStorage),
│   │   │                          # attributeStore, variants.ts (core variant logic), useProductFilters
│   │   ├── product/               # ProductPage, ProductInfo, ProductGallery, Lightbox,
│   │   │                          # QuantityStepper, useRecentlyViewed (localStorage)
│   │   ├── cart/                  # useCart (localStorage), CartPage, CartDrawer
│   │   ├── checkout/              # CheckoutPage (guest COD), OrderConfirmationPage,
│   │   │                          # orderStore (SUPABASE-backed), checkoutData
│   │   ├── search/                # searchCatalog (client-side, Arabic-normalized), SearchPage
│   │   ├── wishlist/              # useWishlist (localStorage), WishlistPage
│   │   ├── layout/                # header/nav/footer/drawer, navStore, AnnouncementBar,
│   │   │                          # SocialSidebar, PageTransition, BrowseMenu, etc.
│   │   ├── pages/                 # About/Contact/FAQ/Privacy/Terms/ShippingReturns (static copy)
│   │   └── components/            # ProductCard, QuickViewModal
│   ├── admin/
│   │   ├── auth/                  # AdminLoginPage (Supabase email/password), useAdminSession
│   │   ├── dashboard/             # stats from orders only
│   │   ├── orders/                # OrdersPage, OrderDetailsPage (Supabase-backed)
│   │   ├── catalog/               # products/categories/collections CRUD + variant matrix editor
│   │   ├── attributes/            # attribute & value management
│   │   ├── homepage/              # homepage section composer
│   │   ├── navigation/            # nav item editor
│   │   ├── media/                 # media library (IndexedDB assets)
│   │   ├── layout/                # sidebar/topbar/nav config
│   │   └── components/            # shared admin UI; AdminPlaceholderPage for unbuilt sections
│   └── shared/
│       ├── assets/                # imageStore (IndexedDB blob store), assetRefs (usage scan)
│       ├── components/            # Button, Container, Breadcrumb, AssetImage, ErrorBoundary, …
│       ├── hooks/useStorefrontLocale.ts
│       └── utils/                 # locale.ts, format.ts (EGP price), id.ts, emphasize.tsx
├── lib/supabase/
│   ├── client.ts                  # real browser client (VITE_ env vars)
│   └── client.mock.ts             # in-memory test double (orders table only)
├── assets/taybah-logo.png
└── styles/globals.css             # Tailwind theme tokens + custom CSS

supabase/
├── migrations/                    # run MANUALLY in the dashboard SQL editor (no CLI link)
│   ├── 0001_orders.sql            # orders + order_status_history + RLS + triggers
│   ├── 0002_order_status_email_trigger.sql  # pg_net webhook → Edge Function
│   └── 0003_catalog_schema.sql    # catalog/homepage/nav schema + storefront-media bucket
└── functions/send-order-status-email/index.ts  # Deno; Resend API call
```

---

## 5. Data Layer — Three Different Stores (understand this before touching anything)

1. **localStorage stores** (pattern: module-level `useSyncExternalStore` store,
   seeded defaults, persisted under `taybah:*` keys, cross-tab synced via the
   `storage` event):
   - `catalogStore` — `taybah:catalog` — products/categories/collections
   - `attributeStore` — `taybah:attributes` — attribute definitions & values
   - `homeStore` — `taybah:homepage` — homepage sections
   - `navStore` — `taybah:navigation` — header/footer nav items
   - `useCart` — `taybah:cart` — cart lines
   - `useWishlist` — `taybah:wishlist` — product ids
   - `useRecentlyViewed` — recently viewed product ids
   - locale pref — `taybah:locale`
2. **IndexedDB** (`imageStore`, db `taybah-assets`) — admin-uploaded image blobs,
   referenced as `local:<id>` strings inside catalog/homepage records. Object
   URLs resolved via `useImageUrl()`/`AssetImage`. `assetRefs.ts` scans every
   entity for `local:` references to block deleting in-use assets.
3. **Supabase (real backend, partial)** — `public.orders` +
   `order_status_history` only. `orderStore.ts` deliberately mirrors the old
   localStorage store's API so pages didn't change. Guests can INSERT but
   cannot SELECT their own order — the confirmation page reads the order from
   the **in-memory** store (a page refresh on `/order-confirmation/:id` shows
   404 for guests; this is a known limitation of the current shape, not a bug
   to "fix" by opening up reads — the docs' design solves it via
   `customer_id = auth.uid()` with anonymous auth).

**Consequence:** the admin "CMS" is a single-browser illusion — catalog edits
live in that browser's localStorage only. Orders are the only truly shared data.
This is intentional scaffolding pending the real Supabase catalog layer.

---

## 6. Routing & Locale Model (actual)

- Storefront: `/:locale/...` where **only `ar` is valid**. Any other locale
  value redirects to `/ar/<same path>`. `/` redirects to `/<stored-or-default>`
  (always `ar` today). The `en` copy exists inside many components' `copy`
  objects but is unreachable — `SUPPORTED_LOCALES = ['ar']`.
- `index.html` ships `<html lang="ar" dir="rtl">` plus an inline script that
  reads `taybah:locale` and sets `dir` before the bundle loads (the FOUC
  mitigation the docs prescribed — kept, though moot while Arabic-only).
- Admin: `/admin/*` sibling tree, **Arabic RTL** (`AdminLayout` sets
  `lang='ar' dir='rtl'`), session-gated via `useAdminSession`.
- Locale-prefixed admin URLs (`/ar/admin/...`) redirect into `/admin/...`.
- Catch-all `*` → `NotFoundPage` inside storefront; under `/admin/*` redirects
  to `/admin`.
- URL filter params on listings: `sort` (`featured|price-asc|price-desc|newest`),
  `price` (bucket key), `in-stock`, `color`, `material`, `size`, `category`,
  and `attr_<key>` for custom filterable attributes.

---

## 7. Supabase Schema (as actually migrated — differs from docs)

**`0001_orders.sql`** — `orders(id, ref unique, status check
(pending|confirmed|processing|shipped|delivered|cancelled), contact jsonb,
address jsonb, delivery jsonb, lines jsonb, subtotal, total, created_at,
updated_at)` and `order_status_history`. RLS: **anon+authenticated INSERT**,
**authenticated-only SELECT/UPDATE**. Triggers write history rows on insert
and on status change. Note: `ref`/`lines`/customer data are nested jsonb —
deliberately mirroring the frontend `GuestOrder` shape instead of the docs'
normalized `order_items`/`customer_id` model. There is no `customer_id`,
no `payment_status`, and `confirmed` is a status the docs' enum doesn't have.

**`0002_order_status_email_trigger.sql`** — `pg_net` trigger POSTing every
`order_status_history` insert to the Edge Function. **Hardcodes the Supabase
project URL and a `sb_publishable_` key in the migration** (publishable keys
are low-sensitivity, but the values are pinned to project
`mrnndtvhtxdjvpefayxa` — update if the project ever changes). Written this way
because Supabase's Database Webhooks UI was broken on the project at the time.

**`0003_catalog_schema.sql`** — `admins` (allowlist + `is_admin()` SECURITY
DEFINER), `categories`, `collections`, `attributes`, `attribute_values`,
`products`, `product_variants` (with `combo jsonb`), `product_images`,
`product_attribute_values`, `home_sections`, `nav_items`, `sku_registry`
(global SKU uniqueness across products+variants via trigger), RLS policies
(public reads scoped to published/visible; `is_admin()` for writes), and a
**public** `storefront-media` Storage bucket with admin-only writes.
`stock_quantity` columns exist but nothing decrements them. None of this is
wired to the frontend yet.

**`send-order-status-email` Edge Function** — Deno, service-role Supabase
client, Resend API. Requires `RESEND_API_KEY` env secret; `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` are auto-provided. No signature/auth verification
on incoming requests beyond the implicit publishable-key `Authorization` header
sent by the trigger — acceptable for the internal trigger path, but note it
accepts any request bearing that header.

---

## 8. Variant & Catalog Business Rules (implemented, tested)

From `variants.ts` / `catalogStore.ts` / `attributeStore.ts` — this logic is
real, tested (315 tests), and should not be rewritten casually:

- `variantAxes`: 1–3 attribute keys; `variants[]` combos cover each axis once;
  `comboKey` = JSON of sorted key pairs; ≤60 purchasable combos per product.
- Reserved attribute keys `color`/`material`/`size` map to legacy product
  fields (`colors`/`materials`/`sizes`); custom attributes live in
  `product.attributes: Record<attrKey, valueKey[]>`.
- `variant.price/compareAtPrice = null` → inherits product-level price.
  Compare-at must exceed effective price.
- Purchasability = `active` AND `availability !== 'out_of_stock'` AND every
  attribute/value the combo touches is still enabled (`comboValuesEnabled`).
  `hasPurchasableVariant` is the single source of truth used by both PDP and
  listing badges — never duplicate this logic.
- `syncVariantMatrix` merges a regenerated combo matrix into stored variants:
  matched combos keep all stored fields; dropped combos stay stored but
  `active: false` (never deleted — orders may reference them).
- SKU uniqueness is global across product + variant SKUs, case-folded
  (`skuTaken`), mirrored in DB by `sku_registry`.
- Public discoverability: product must be `published` AND its category AND
  collection `visible` (`productIsPublic`). Hidden products stay reachable for
  existing cart lines but appear in no listing/search.
- Cart lines re-resolve live prices every render (`resolveCartLines`);
  stored name/price/image are only fallbacks for deleted products.
- Deletion rules: products are always deletable (soft refs degrade
  gracefully); categories/collections are **blocked in UI** while products
  reference them; variants are never hard-deleted once order-referenced.
- Search: client-side, Arabic text normalized (diacritics/tatweel stripped,
  alef/ya/taa-marbuta forms folded), prefix-word matching (not substring) to
  avoid noisy matches.

---

## 9. Design System (current tokens — code-verified)

From `src/styles/globals.css` (`@theme`, Tailwind v4):

| Token | Value | Use |
|---|---|---|
| `porcelain` `#F7F5F0` | warm off-white | primary background |
| `white` `#FFFFFF` | — | cards/elevated surfaces |
| `burgundy` `#681D20` | primary brand | CTAs, key accents |
| `gold` `#B58A43` | **accent only** | thin rules, icon accents, focus rings — never button fills or large surfaces |
| `espresso` `#29221E` | near-black warm | primary text |
| `taupe` `#D8CFC1` | muted | borders/secondary surfaces |

Fonts (Google Fonts, loaded in `index.html`): base (RTL): **IBM Plex Sans
Arabic** (body) + **Amiri** (display/headings). LTR override block exists:
Inter + Fraunces. Note this differs from `PREMIUM_DESIGN_DIRECTION.md`'s
recommendation (El Messiri + Cairo/Plex Sans Arabic under Direction A) —
Amiri was chosen as the display face in implementation; the design-direction
doc predates that choice and its "Georgia has no Arabic glyphs" finding has
since been fixed.

Rules: mobile-first Tailwind (`md:`/`lg:` layer up), logical properties
(`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`) for direction-sensitive spacing,
`dir="ltr"` wrappers around prices/SKUs inside Arabic text, `prefers-reduced-motion`
respected in custom animations, generous whitespace, ~44px touch targets,
prices formatted via `formatPrice` → `12,450 ج.م` (Western numerals + ج.م).

Conventions in code: per-component `copy` objects keyed `{ ar, en }`;
single-char SVG/icon usage via lucide; custom CSS lives in `globals.css` only
when Tailwind can't express it; comments explain *why*, not what.

---

## 10. The Docs (`docs/`) — what they are and how to trust them

| Doc | Role today |
|---|---|
| `PROJECT_OVERVIEW.md` | Brand, goals, success criteria. §2 "empty directory" is stale — code exists now. |
| `ARCHITECTURE.md` | Target architecture (React+Vite SPA, Supabase, RLS-first, prerendering-for-SEO). Still the right target for the backend build-out; describes things not yet built. |
| `DATABASE_SCHEMA.md` | Target schema — much richer than current migrations (profiles, anonymous auth, coupons, refund outbox, payment_events, guest_merge_attempts, pending_image_uploads, category_attributes, variant attribute_value_ids array). Read before any real-backend work. |
| `SECURITY_PLAN.md` | Target security model — the most carefully reasoned doc; RLS policies, SECURITY DEFINER rules, guest-merge two-token design, image quarantine design (both "Proposed — awaiting approval"). |
| `FEATURES.md` | v1/v2 feature list vs. the docs' scope — the current build deliberately descoped (no bilingual, no accounts, COD only). |
| `DESIGN_SYSTEM.md` | Brand/color/typography direction — mostly matches code (fonts differ: Amiri was actually chosen). Its "Arabic default + English required" stance predates the Arabic-only descoping. |
| `DEVELOPMENT_ROADMAP.md` | Phase plan (admin-before-storefront, RLS-alongside-schema, schema allowlist). Sequencing logic still sound; phases partially done out of order. |
| `IMPLEMENTATION_RULES.md` | Conventions — still the right rules for future backend work. |
| `OPEN_QUESTIONS.md` | Business decisions tracker — some items were effectively resolved by implementation (see §11). |
| `ARCHITECTURE_REVIEW.md` | 5-pass audit history of the target design — valuable rationale, but §1–10 describe the retired Next.js era; read §11+ for current thinking. |
| `PREMIUM_DESIGN_DIRECTION.md` | **Most code-accurate doc** — written against the actual codebase; contains catalog/brand analysis and three redesign directions (A "Heritage Atelier" recommended, not yet approved/implemented). |

---

## 11. Decisions Effectively Made by Implementation (docs contradict these)

These are real, in-code decisions — treat them as the current scope unless the
owner says otherwise:

1. **Arabic-only v1.** `SUPPORTED_LOCALES = ['ar']`; admin is Arabic RTL too.
   Docs wanted bilingual mandatory — deferred in practice. Data records keep
   `en` fields "for internal compatibility/future tooling."
2. **COD-only, guest-only checkout.** No accounts, no payment provider —
   resolves open questions #1, #4 (email = Resend, sandbox), #8 (guest
   checkout allowed — there is no other kind yet).
3. **Currency = EGP** (formatPrice hardcodes ج.م/EGP; prices in EGP range
   380–12,450) — resolves open question #3 in practice.
4. **No numeric inventory.** Availability is a manual enum; `stockQuantity` is
   optional metadata — contradicts the docs' transactional stock-decrement
   model.
5. **Collections** (diwan/heritage/atelier) are a first-class entity in code +
   migration — absent from the docs' schema entirely.
6. **Flat categories** (no parent hierarchy, no localized slugs) — the docs'
   self-referencing categories + `slug_ar`/`slug_en` are not implemented.
7. **Orders are denormalized jsonb** snapshots — deliberately, to mirror the
   frontend shape; not the docs' normalized `order_items` model.
8. **Admin authorization** = `admins` allowlist (`is_admin()`) for catalog
   tables; "any authenticated user" for orders — not the docs' 4-tier
   `has_role_at_least()` hierarchy.
9. **Image uploads** = IndexedDB local blobs + a public `storefront-media`
   bucket — the docs' quarantine-pipeline design was never approved/built.

---

## 12. Known Limitations & Sharp Edges

- **Guest order confirmation is session-memory only** — refresh → 404 (see §5).
- **localStorage catalog means multi-browser/multi-device divergence** — admin
  edits on one machine are invisible elsewhere. Not a bug; the designed state.
- **No input sanitation beyond validation** on checkout fields; order `lines`
  contain client-supplied snapshots (price/name) — fine for a demo, but a real
  order RPC must recompute prices server-side (as the docs specify) before this
  is trustworthy for real money.
- **"Staff = any authenticated user"** on orders tables — the `admins`
  allowlist only protects the newer catalog tables.
- **Resend sandbox sender** — order emails only reach the Resend account
  owner until a verified domain replaces `onboarding@resend.dev`.
- **`useAdminSession` is UX-only** — real protection is the (thin) RLS above.
- **No pagination anywhere** — fine at 24 mock products; required before real
  catalog scale.
- **`skipLabel[locale]`** in StorefrontLayout indexes only-valid-`ar` — if `en`
  is ever re-enabled, every `copy[locale]` object and locale-dependent helper
  must be re-audited, not just the constant.
- Docs' Phase-2-blocked mechanisms (guest merge, image quarantine) require
  explicit owner approval before building — see `DEVELOPMENT_ROADMAP.md` and
  `ARCHITECTURE_REVIEW.md` §13–14.

---

## 13. How to Continue Working on This Project

**Rules for you (the assistant):**

- **Do not "fix" doc/code divergence by rewriting code to match the old
  docs** — the Arabic-only/COD-only descoping was deliberate. Ask before
  restoring any documented-but-descoped feature (accounts, English, payments).
- **Do not rewrite the store layer** (`useSyncExternalStore` + localStorage
  pattern) piecemeal — every store intentionally shares one shape; changes
  should preserve that shape or migrate the whole layer deliberately.
- **Match existing conventions:** `copy = { ar: {...}, en: {...} }` objects;
  logical CSS properties; `useCatalog`/`getCatalog` for catalog reads;
  `resolveCartLines` for anything cart-related; `variants.ts` helpers for all
  purchasability/SKU/combo logic; tests live beside the module
  (`x.test.ts`, pure TS, node env).
- **Verify claims in code, not docs.** When a doc and the code disagree, trust
  the code and say so explicitly.
- **Preserve Arabic-first quality.** All customer-facing and admin-facing text
  is Arabic; new UI copy needs real Arabic strings, not placeholders.
- **Run `npm test` + `npm run typecheck` + `npm run lint`** after changes.
- **Ask before:** changing data models that affect order snapshots or cart
  line identity (`lineKey`), touching anything in `variants.ts`'s invariants,
  enabling a second locale, adding dependencies, or building any mechanism the
  docs mark "Proposed — awaiting approval."
- Migrations are applied **manually via the Supabase SQL Editor** (header
  comments say so) — there is no `supabase link`/CLI workflow set up.

**Most useful source files to read for any given task:**

- Store pattern: `catalogStore.ts`, `useCart.ts`, `imageStore.ts`
- Variant logic: `variants.ts` (+ its ~2000-line test file)
- Routing/locale: `router/index.tsx`, `locale.ts`, `StorefrontLayout.tsx`
- Orders: `orderStore.ts`, `CheckoutPage.tsx`, `0001_orders.sql`, `0002_*.sql`
- Admin: `AdminLayout.tsx`, `useAdminSession.ts`, `ProductFormPage.tsx`,
  `VariantMatrixSection.tsx`, `adminNav.ts`
- Design tokens: `globals.css`, `format.ts`, `navData.ts`

---

## 14. Open Questions for the Business Owner (condensed)

Carried from `docs/OPEN_QUESTIONS.md` — still genuinely unresolved:

- Real payment provider & shipping model & fees (delivery methods are
  placeholders; shipping is "TBD" in checkout).
- Whether bilingual (English) must return, and when.
- Refund policy shape; payment events/refund outbox are designed but the
  provider choice gates them.
- Real product photography (all imagery is picsum placeholder or local uploads).
- The premium redesign direction (A/B/C in `PREMIUM_DESIGN_DIRECTION.md`) —
  none approved yet.
- Logo: `src/assets/taybah-logo.png` exists now (the "not supplied" note in
  the docs is stale).
- Guest order lookup without a session; data-retention policy for orders.
- `category_attributes` strictness; admin-on-mobile decision; audit-log scope.
