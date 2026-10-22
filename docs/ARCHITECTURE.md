# Taybah — Architecture

**Stack decision: React + Vite, not Next.js.** This document reflects the
approved React SPA architecture. See
[ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §11 for the full
rationale behind replacing Next.js and the architectural changes that
followed from it.

## 1. Technology Stack Evaluation

| Layer | Choice | Verdict | Rationale |
|---|---|---|---|
| Build tool / dev server | **Vite** | **Confirmed** | Fast dev server (native ESM, instant HMR), straightforward static production build (`vite build` → a plain `dist/` folder), no framework server runtime to operate. |
| UI framework | **React + TypeScript** | **Confirmed** | Type safety matters with 1k+ products, many variant combinations, and two apps (storefront + admin) sharing types. Rendering model: a client-side SPA (no built-in SSR/SSG — see §4 for how SEO is handled without it). |
| Routing | **React Router** | **Confirmed** | Standard client-side routing for a React SPA; used to express the storefront/admin/locale route boundaries in §3. |
| Styling | Tailwind CSS | **Confirmed** | Fast to build a consistent, restrained design system (critical: gold-as-accent-only requires discipline that utility classes + design tokens enforce well). Unaffected by the framework change. |
| Icons | Lucide React | **Confirmed** | Lightweight, tree-shakeable, matches a clean editorial aesthetic without decorative noise. Unaffected by the framework change. |
| Backend/DB | Supabase (Postgres) | **Confirmed, with caveats** | Gives managed Postgres, Auth, Storage, RLS, and Edge Functions in one platform. Caveat, **strengthened by the framework change, not weakened**: with no application server of any kind, *all* cross-entity business logic (order totals, coupon stacking, inventory holds, refund orchestration) must live in Postgres functions/RPCs or Edge Functions — there is no longer even the option of putting it in a framework server layer, so the discipline this caveat always asked for is now structurally enforced rather than merely recommended. |
| Auth | Supabase Auth | **Confirmed** | Native RLS integration (`auth.uid()`), supports email/password + OAuth if needed later, and the browser-side client library (`@supabase/supabase-js`) is a first-class SPA integration — if anything, a better fit for a pure-client app than it was for Next.js's dual client/server auth-helper split. |
| Storage | Supabase Storage | **Confirmed** | Product image galleries, served from a private bucket with a policy granting conditional read access (not Supabase's unconditionally-public bucket type — see §10 and [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2 for why); signed URLs for admin-only assets if ever needed. Unaffected by the framework change. |
| Edge Functions | Supabase Edge Functions | **Confirmed, now carrying more weight** | Used for logic needing privileged (service-role) access or third-party calls: payment webhook handling, the refund outbox worker, order placement transaction (where it needs service-role escalation beyond what a `SECURITY DEFINER` RPC alone provides). **With Next.js removed, Edge Functions and Postgres RPCs are the only trusted backend execution contexts left** — see §9 for why this is a simplification, not a gap. |

**Overall verdict: the stack is React + Vite + Tailwind + React Router +
Supabase, with no Next.js anywhere in it.** The architectural discipline
this document already required — RLS as the real boundary, business logic
in Postgres/Edge Functions, never trusting the client — carries over
unchanged; what changes is that there is no framework server tier to even
tempt a "put it in the server layer" shortcut. See §9 for the full
authorization-layer rework.

## 2. Application Structure: React + Vite, Feature-Based

A **single Vite-built React SPA** containing both the storefront and the
admin dashboard, rather than two separate deployed apps — same reasoning
as before the framework change: both share types (Product, Order,
Customer), a single Supabase client setup, and most of the database
schema; splitting them into separate apps would duplicate that sharing
infrastructure for no present benefit. This can be revisited if the
project grows a third app (e.g., a mobile client) — see
[DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md).

**Project structure** (feature-based, as directed — refined slightly from
the suggested structure, with reasons stated inline):

```
src/
├── app/
│   ├── router/              # React Router route tree (see §3)
│   ├── providers/           # AuthProvider (Supabase session/role context), QueryClientProvider, etc.
│   └── layouts/             # StorefrontLayout (locale-aware, RTL/LTR), AdminLayout
│
├── features/
│   ├── storefront/
│   │   ├── home/
│   │   ├── catalog/         # listing, filters, search
│   │   ├── products/        # detail, gallery, variant selector, quick view
│   │   ├── cart/
│   │   ├── checkout/
│   │   ├── account/         # profile, addresses
│   │   └── orders/          # order history (customer-facing)
│   │
│   ├── admin/
│   │   ├── dashboard/
│   │   ├── products/        # includes variant/attribute management
│   │   ├── categories/
│   │   ├── orders/          # includes cancellation/refund-request UI, payment_events review
│   │   ├── customers/
│   │   ├── inventory/
│   │   ├── coupons/
│   │   ├── content/         # homepage sections
│   │   └── settings/        # store settings, staff accounts
│   │
│   └── shared/
│       ├── components/      # design-system primitives used by both apps
│       ├── hooks/
│       ├── services/        # typed Supabase query/RPC call wrappers per entity
│       ├── types/           # generated Supabase types + domain types
│       └── utils/
│
├── lib/
│   └── supabase/            # one browser Supabase client factory — see note below
│
├── assets/
├── styles/
└── main.tsx
```

**Deviation from the suggested structure, with reason:** the suggested
structure's `lib/supabase/` is kept as a **single** client factory, not a
"client/server" split — there is no server-side Supabase client in this
architecture, only the one browser client (using the public anon key,
governed by RLS). A second, privileged Supabase client (using the
service-role key) exists only inside Edge Functions, which are a
**separate codebase** (`supabase/functions/`, deployed independently via
the Supabase CLI) — not part of this `src/` tree at all, and never
bundled by Vite. This is called out explicitly because the old
Next.js-era structure had a "client/server Supabase factories" comment
that doesn't map onto an SPA; getting this distinction right matters for
§9's security model.

**Coupons** moved into `features/admin/coupons/` rather than nesting under
`orders/`, since coupon management (create/edit, usage reporting) is its
own admin section per [FEATURES.md](./FEATURES.md), not a sub-feature of
order management — a direct refinement of the suggested structure's
flatter admin list, not a departure from it.

## 3. Routing Architecture (React Router)

### 3.1 Route Boundaries

| Route group | Examples | Auth requirement |
|---|---|---|
| **Public storefront** | `/:locale`, `/:locale/category/:slug`, `/:locale/products/:slug`, `/:locale/search` | None — works for an anonymous (guest) session or a registered one identically, per the anonymous-auth design in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 |
| **Cart & checkout** | `/:locale/cart`, `/:locale/checkout` | Any session (anonymous or registered) — guest checkout is supported |
| **Customer account** | `/:locale/account`, `/:locale/account/orders`, `/:locale/account/addresses` | A **registered** session specifically (`profiles.is_anonymous = false`) — an anonymous guest hitting these routes is redirected to sign in/register, since there is no persistent account to show |
| **Admin** | `/admin/login`, `/admin/dashboard`, `/admin/products`, `/admin/orders`, `/admin/customers`, `/admin/coupons`, `/admin/content`, `/admin/settings` | `role IN ('staff','admin','owner')` at minimum; `/admin/settings` and `/admin/staff` further require `admin`/`owner` (not `staff`) — see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3 |

**Admin routes are not nested under `/:locale`** — the admin dashboard is
LTR/English-only for v1 (unchanged decision, see
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2.2 and
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #14), so `/admin/*` is a
sibling top-level route tree, not a locale-scoped one.

### 3.2 Unauthorized and Not-Found Handling

- A route-guard component wraps each protected route subtree, reading the
  current session/role from a client-side auth context (populated by
  Supabase's `onAuthStateChange` plus a cached `profiles` row fetch) and
  redirecting — to `/admin/login` for no session, or to an `/unauthorized`
  page for a session with insufficient role — **before** rendering the
  protected content.
- A catch-all route (`*`) renders a 404 page for any unmatched path.
- **This guard is explicitly UX only, exactly as the old Next.js
  middleware was** — it exists to avoid a flash of admin UI before
  redirecting a customer away, not to protect data. The actual data
  reads/writes those routes trigger are governed by RLS (and, for
  privileged operations, by the called RPC's own internal role check) —
  see §9. A user who bypasses the guard entirely (disabling JS routing,
  calling the Supabase API directly) gets exactly the same data access
  they would have gotten through the UI: whatever RLS and the RPCs allow,
  nothing more.

### 3.3 Arabic RTL / English LTR Routing Strategy

- **Locale is a URL path segment** (`/ar/...` default, `/en/...`
  secondary) for all storefront routes, matching the mandatory
  mobile-first/RTL strategy in [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2 —
  unchanged in substance from the previous Next.js-based design, just
  expressed as React Router path segments instead of a Next.js `[locale]`
  route-tree segment.
- A locale-aware layout component (`StorefrontLayout`) sets
  `document.documentElement.dir`/`lang` based on the resolved `:locale`
  param on mount/navigation.
- **New risk introduced by dropping server rendering, flagged
  explicitly:** a Next.js server could set `<html dir="rtl">` before any
  byte reached the browser; a pure client-side SPA cannot — the direction
  can only be set once React has mounted and resolved the route, which
  risks a brief flash of the wrong text direction (a real, if small,
  regression versus the SSR-era design). Mitigation: an inline script in
  `index.html` (before the React bundle loads) reads a locale
  cookie/`localStorage` preference synchronously and sets
  `document.documentElement.dir`/`lang` immediately, so only a genuinely
  first-ever visit with no stored preference (and no prerendered snapshot
  — see §4) is exposed to the flash. This is a concrete engineering task
  for Phase 2/4, not assumed solved by this document alone.
- Root path `/` redirects client-side to `/ar` (the default) unless a
  stored preference says `en` — this redirect does not apply to
  prerendered snapshots (§4), which are generated per-locale directly at
  their final locale-prefixed path.

## 4. Rendering & SEO Strategy for a React SPA

**Next.js's SSR/SSG/ISR are gone; they are not replaced by "the same
thing under a different name."** A plain React + Vite SPA ships an
(almost) empty `index.html` and renders everything client-side after the
JS bundle loads and executes. For a catalog-driven, SEO-dependent
storefront with 1,000+ products, **shipping nothing but client-rendered
HTML is not acceptable** — it was explicitly a stated goal
([PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) §6: "SEO-indexable") before
this stack change, and the stack change does not relax that goal.

### 4.1 Options Evaluated

| Option | How it works | SEO quality | Engineering cost | Ongoing cost/risk |
|---|---|---|---|---|
| Plain CSR, no mitigation | Ship the SPA as-is; rely on crawlers executing JS | Weak — modern Googlebot does execute JS, but with delay/variability, and other crawlers (social-media link previews, some secondary search engines) often don't execute JS at all, breaking Open Graph previews and non-Google indexing | None | Rejected outright for this project — SEO is a stated goal, and 1,000+ product discoverability has direct commercial value |
| **Build/deploy-time prerendering (recommended)** | A script (headless-browser-based, e.g. Puppeteer, or an equivalent static-HTML-snapshot tool) runs the built SPA for every active product/category/locale combination and saves the resulting fully-rendered HTML to disk, which the static host then serves at that exact path instead of the generic SPA shell | Strong — crawlers and link-preview bots receive complete HTML with correct meta/structured data on the very first response, no JS execution required | Moderate — a prerendering script to build and maintain, plus a deploy-pipeline step to run it and a re-prerender trigger on catalog writes | A new, self-owned moving part to operate (not a new framework — a build tool), but no ongoing third-party dependency or cost |
| Third-party prerendering service (e.g. Prerender.io) in front of the SPA | An edge/CDN rule detects bot user agents and proxies them to a hosted rendering service that executes the SPA server-side and returns HTML, while real users still get the live SPA | Strong, same end result as the row above | Low — mostly configuration, no custom rendering pipeline to build | Ongoing third-party cost and a dependency on an external service for something core to the business (product discoverability); also a user-agent-sniffing architecture that must be kept accurate as crawler UAs change |
| Adopt a meta-framework with SSR (Remix, Astro, Next.js again under another name) | Reintroduces a server-rendering framework | Strong | High — this is exactly what the stack decision explicitly rejected | Explicitly out of scope per this task's instructions — not evaluated further |

### 4.2 Recommendation

**Build/deploy-time prerendering, owned by this project, as the primary
mechanism — not a third-party prerendering service, and not reintroducing
a server-rendering framework.** Specifically:

- A Node script (run in the deploy pipeline, after `vite build`) reads
  the list of active product and category slugs per locale from
  Supabase, boots the built SPA in a headless browser for each
  `/:locale/products/:slug` and `/:locale/category/:slug` URL (plus the
  homepage and top-level category pages), waits for the app to finish its
  data fetch and render, and writes the resulting HTML to the matching
  path in the build output (e.g. `dist/ar/products/bokhara-rug/index.html`).
- This is a **tool this project owns**, not a framework — it does not
  reintroduce routing, data-fetching conventions, or a server runtime; it
  is a thin script around a headless browser and the already-built SPA.
- **Regeneration on content change** mirrors the purpose the old
  Next.js ISR revalidation served: an admin catalog write (product/
  category create, update, status change) triggers a scoped
  re-prerender of just the affected page(s) in both locales — implemented
  as a small server-side job (an Edge Function, or a CI pipeline webhook
  trigger) that re-runs the prerender step for the specific changed
  slugs and republishes just those files, not a full site rebuild.
- **A third-party prerendering service is a reasonable fallback/interim
  option** if the custom pipeline isn't ready by the time Phase 4/8
  needs it, but is not the primary recommendation, given it trades a
  one-time engineering cost for an indefinite recurring one on something
  core to the business. This is flagged as an engineering-sequencing
  decision for Phase 4/8, not resolved here as a business decision.
- **Meta tags, canonical URLs, Open Graph tags, and structured data**
  (schema.org `Product`/`Offer`/`BreadcrumbList` JSON-LD) are built by a
  single, plain-TypeScript function per page type (no React/browser-only
  API dependency), **imported by both** the live SPA's client-side head
  manager (e.g. updating `document.title`/meta tags on navigation, via a
  small hook or a lightweight library such as `react-helmet-async` — not
  Next-specific) **and** the Node prerender script — one source of truth
  for the tag content, so the prerendered snapshot crawlers see and the
  live client-rendered head tags never drift apart.
- **`sitemap.xml`** is generated by a standalone script (not Next's
  `sitemap.ts`) querying active products/categories per locale from
  Supabase and writing the sitemap file(s) (split into a sitemap index
  plus per-type sitemaps if the catalog grows large) into the build
  output — run in the same deploy step as prerendering, since it needs
  the same data.
- **`robots.txt`** is a plain static file in Vite's `public/` directory —
  no framework/dependency involved — disallowing `/admin/`, `/account/`,
  `/cart`, `/checkout` from crawling, allowing storefront/catalog paths.
- **Crawling verification is a deployment-configuration risk, not a
  guarantee of the architecture alone**: the static host/CDN must
  actually serve the prerendered HTML file at its exact path instead of
  falling back to the generic SPA shell (see §12's fallback-rule ordering)
  — this needs to be verified post-launch via Search Console URL
  inspection, not assumed correct from this design.
- **Core Web Vitals**: the prerendered HTML gives a fast meaningful first
  paint without requiring JS execution; the live SPA bundle is code-split
  per top-level route (storefront vs. admin, at minimum, via
  `React.lazy()`/dynamic `import()`) so a storefront visitor never
  downloads admin code and vice versa — this code-splitting must be set
  up deliberately in Phase 2/4, since Vite/Rollup do not do this
  automatically across the whole app the way Next's per-route bundling
  did.
- **Catalog loading & caching in the live SPA** (after initial
  load/hydration) uses a client-side data-fetching/caching library
  (TanStack Query recommended — framework-agnostic, pairs naturally with
  direct Supabase client calls) for stale-while-revalidate behavior on
  listing/detail reads, request deduplication, and cache invalidation on
  write — the browser-side analogue of what the old ISR data cache gave
  at the edge, now living in the client instead.

### 4.3 What Does Not Change

- Canonical URLs still resolve filtered/paginated listing pages to the
  unfiltered listing page's canonical, to avoid duplicate-content issues
  at 1,000+ SKU scale.
- Structured data content and fields are unchanged from the original
  design — only *where* they're emitted (prerendered static HTML, not a
  Next.js server render) changed.
- Per-product/per-category metadata is still sourced from product data,
  not hardcoded, and still bilingual (Arabic/English meta title/
  description, per [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2).

## 5. Product & Variant Model (Architectural Summary)

See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for full schema. Architecturally:

- A **Product** is the sellable concept (e.g., "Bokhara Hand-Knotted Rug").
  A product may have **zero variants that the customer sees as "options"**
  (a simple product with exactly one implicit variant holding its SKU,
  price, and stock) or **many variants** (size × color combinations). The
  schema does not special-case "simple" products as a separate table — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2 for the resolved model.
- A **Variant** is a specific purchasable combination of attributes (size,
  color) with its **own SKU, price override, and stock count**, uniquely
  identified by a canonical, sorted `attribute_value_ids` array — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2.3.
- Listing pages query products with an aggregated price range
  (`MIN(variant.price)`–`MAX(variant.price)`) and an aggregated "in stock"
  flag, read from a **maintained aggregation table**
  (`product_listing_summary`), not computed live or via a materialized
  view — see §11 and [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §C.
  This read happens as a **direct browser-to-Supabase query**, governed
  by RLS, not through any application server — see §9.
- Attributes (size, color, material, pile height, origin) are modeled
  generically, and **which attributes apply is category-dependent** (a
  curtain has "drop length," a rug has "pile height" — not every product
  carries every attribute) so new attribute types and new product
  categories (rugs, carpets, curtains, furnishings) don't require schema
  migrations. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2,
  `category_attributes`.

## 6. Category Hierarchy

- Self-referencing `categories` table (`parent_id`), supporting unlimited
  depth, but UI/UX targets 2–3 levels (Category → Subcategory → optional
  refinement) to stay editorial rather than taxonomy-heavy.
- A product can belong to multiple categories (many-to-many) — e.g., a rug
  can appear under "Rugs" and under a seasonal/editorial collection
  simultaneously, which Admin content management needs for homepage curation.

## 7. Inventory Management

- Stock is tracked **per variant**, never per product.
- A single `stock_quantity` column per variant for v1 (single-warehouse
  assumption — see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)).
- Stock decrement happens **transactionally at order placement**, inside a
  Postgres function invoked via RPC directly from the browser (no
  application server in between — see §9), with a row-level lock to
  prevent overselling under concurrent checkouts.
- Admin can see low-stock thresholds and get a dashboard alert; threshold is
  configurable per variant or store-wide default.

## 8. Where Business Logic Lives

| Logic | Location | Why |
|---|---|---|
| Access control (who can read/write what row) | Postgres RLS policies | Enforced regardless of which client calls the DB; cannot be bypassed by a bug in app code — and, with no application server, this is *more* load-bearing than before, not less |
| Data integrity (stock can't go negative, price > 0) | Postgres constraints/triggers | Guaranteed at the data layer |
| Order placement, stock decrement, coupon application | Postgres function, called via Supabase RPC **directly from the browser**, wrapped in a transaction with row-level locks (`SELECT ... FOR UPDATE`) on affected variants | Must be atomic; must not depend on client honesty; prevents overselling under concurrent checkout. Calling it directly from the browser is safe because the function is `SECURITY DEFINER` and checks its own preconditions — there is no intervening "trusted server" needed, nor was there ever one that did anything this RPC doesn't already do itself |
| Payment provider webhook handling | Edge Function (uses service role, verifies webhook signature, checks an idempotency key before applying) | Needs to run outside any user auth context and verify external signatures — this was always an Edge Function's job, never the (now-removed) Next.js server's |
| Order status transitions (cancellation) | Postgres function (`cancel_order`), separate from `payment_status` | Order lifecycle status and payment status are tracked as two distinct fields updated by two distinct triggers (customer/staff action vs. payment provider event) — see §8.1 |
| Refund execution (the actual provider API call) | Trusted server/Edge Function — **never** the browser, and never the Postgres RPC that cancels the order | A database transaction cannot safely make an external HTTP call; `cancel_order` only writes a durable `refund_requests` outbox row, and a separate Edge Function process performs and retries the provider call, claiming rows via `SELECT ... FOR UPDATE SKIP LOCKED` with a lease so multiple workers can't double-claim — see §8.1 and [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3, `refund_requests` |
| Search, filtering, sorting, pagination | **Direct browser-to-Supabase queries** (via `supabase-js`, governed by RLS), backed by the maintained aggregation table | Standard read path; with no application server to proxy through, the browser talks to Postgres directly through Supabase's PostgREST layer, with RLS as the only — and sufficient — access boundary. Client-side caching (TanStack Query, §4.2) avoids re-fetching on every render, but every fetch that does happen is still RLS-governed, not server-cached-then-trusted |
| Form validation | Shared Zod schemas, validated both client (UX feedback) and **inside the relevant Postgres RPC** (trust boundary) | Never trust client-only validation. **With no application server, there is no middle validation tier** — the trust boundary that used to be "the Next.js server" collapses onto the RPC itself, which is the only place client input is ever truly validated before it has an effect |

### 8.1 Order Status vs. Payment Status

These are **deliberately separate fields on `orders`**, not one combined
status enum:

- `status` — the fulfillment lifecycle: `pending → processing → shipped →
  delivered`, or `cancelled`. Driven by staff/admin action (and
  customer-initiated cancellation while still `pending`).
- `payment_status` — `unpaid → paid → refunded` (or `failed`). Driven only
  by the payment provider webhook (Edge Function with service role), never
  by a client request claiming "payment succeeded."

Keeping them separate avoids an impossible state like "shipped but unpaid"
being silently implied by a single enum, and makes **cancellation** and
**refund** independently reasoned about: a cancellation before shipment with
a captured payment **enqueues** a refund request (a `refund_requests`
outbox row, written in the same transaction as the cancellation — see
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3) rather than calling the
provider directly from the Postgres RPC, and `payment_status = refunded`
is set only once the provider confirms it via webhook — the two states
change on their own triggers, not in lockstep, and the actual provider
call happens outside the database transaction entirely. Full detail in
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1–5.2 and
[ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §D.

### 8.2 Duplicate Webhook Protection & Failure Recovery

Every payment webhook handler inserts into a `payment_events` table (event
id from the provider, unique constraint) **as a statement in the same
transaction as the business effect it triggers** — not as a prior,
separately-committed step. This means: a duplicate event's `INSERT` hits
the unique constraint and is safely ignored (idempotent — re-processing
the same event id is a no-op); and if the business effect fails, the
*entire* transaction — insert included — rolls back, so an event is never
left recorded without its effect having been applied, and provider-side
webhook retry is the recovery path for that failure. Providers (Stripe and
most alternatives) explicitly document at-least-once delivery, so this is
treated as a certainty to defend against, not an edge case. Out-of-order
events and duplicate refund requests are handled per
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.2.

## 9. Authentication & Authorization

**With Next.js removed, there is no application server tier — this
simplifies the authorization model rather than weakening it**, because
the real security boundary was never the Next.js server; it was always
RLS and `SECURITY DEFINER` RPC functions, with the Next.js server-side
re-check being a second, somewhat redundant look at a check the called
RPC was going to perform again regardless. Removing that redundant layer
removes a layer, not a boundary.

### 9.1 Two Real Boundaries, One UX Convenience

1. **React Router route guard (client-side)** — reads the session/role
   from an auth context and redirects away from a route the current
   session shouldn't see, before rendering it. **UX only; not a security
   boundary.** Exactly the role the old Next.js middleware played,
   expressed in React Router instead — this did not change in kind, only
   in which library implements it.
2. **Direct Supabase access, governed by RLS** — most reads and simple
   per-row writes go straight from the browser to Postgres via
   Supabase's PostgREST layer, with the public anon key. RLS is the
   entire enforcement mechanism for this path; there is nothing else in
   front of it, by design, and nothing else is needed, since RLS was
   always the authoritative check regardless of what called it.
3. **`SECURITY DEFINER` Postgres RPCs, called directly from the browser,
   for anything needing privileged or multi-step logic** (order
   placement, `cancel_order`, `create_variant`, `resolve_payment_event`,
   etc.) — each RPC checks `has_role_at_least(...)` (or the equivalent
   ownership check) as its **first action**, before doing anything else.
   Calling these directly from an untrusted browser is safe specifically
   because the function itself refuses unauthorized callers — the
   function *is* the trusted execution context, the same way it already
   was before Next.js was removed; Next.js's "server-side re-check" was
   never the thing making this safe.
4. **Supabase Edge Functions, for anything a plain RPC structurally
   cannot do** — specifically, verifying a *second* bearer credential the
   browser supplies as data rather than as the request's own auth (guest-
   identity merge, §9.2), or inspecting file bytes Postgres never
   receives (image upload validation, §10). These are a distinct trust
   tier from RPCs, not an alternative naming for the same thing: they run
   with service-role capability and bypass RLS entirely by design, the
   same model already used for the payment webhook handler and refund
   outbox worker.

All RLS policies and all RPC-internal checks use the **same centralized
role hierarchy function**, `has_role_at_least()` — see
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.1–3.2 for the full definition,
`SECURITY DEFINER` hardening rules (`search_path`, `EXECUTE` grants), and
the `owner`-is-a-superset-of-`admin` design that prevents a policy from
accidentally omitting `owner`. The React Router guard in step 1 reads the
*same* role value (fetched from `profiles` once per session and cached in
the auth context) so its redirect decisions agree with what steps 2–3
will actually allow — but it remains advisory, never authoritative.

### 9.2 Staff Permissions and Guest Identity

- Staff permissions are role-based (owner/admin vs. limited staff), detailed
  in [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.
- **Guest carts are identified via Supabase Auth anonymous sign-ins, not a
  custom session token.** A guest's first storefront visit (a plain
  `supabase.auth.signInAnonymously()` call from the browser — no server
  involved) creates a real `auth.users` row (`is_anonymous = true`) with a
  normal, signed Supabase session, so
  `carts.customer_id`/`wishlists.customer_id`/`orders.customer_id` is
  always `auth.uid()` — the same RLS rule (`customer_id = auth.uid()`)
  applies to guests and registered customers alike, with no separate
  token-trusting code path. **Merging a guest identity into an existing
  account is not a plain RPC call** — it's a Supabase Edge Function
  verifying two independent session tokens at once (the anonymous
  session's own and a freshly obtained target-account session), because a
  PostgREST-fronted RPC only ever sees one JWT per request and cannot
  verify a second one supplied as a parameter. Full design, status
  (**Proposed — awaiting architecture approval**, not implemented or
  tested), and the honestly-stated residual limitations:
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4, and
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).
- **Guest orders are never silently lost.** `orders.customer_id` is
  `ON DELETE RESTRICT`, so no anonymous-identity cleanup process (custom
  job, not Supabase's platform default used as-is — see
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.2) can delete an identity that
  still owns an order; such identities are retained indefinitely by the
  cleanup job's own exclusion rule, not deleted on a timer, until a
  separate data-retention policy says otherwise. Full design in
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §3 and §3.1,
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1–2.2, and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §B.
- **Session persistence in the browser**: `supabase-js`'s default
  behavior (session stored in `localStorage`, access token auto-refreshed
  before expiry) is used as-is — this is the SPA-native equivalent of
  what Supabase's Next.js SSR auth helpers did for cookie-based sessions
  on the server; there is no cookie/server-session complexity to manage
  now, only the standard browser-SDK session lifecycle.

## 10. Image Storage

**Corrected trust boundary — a prior revision of this document claimed a
Postgres `SECURITY DEFINER` function validates uploaded file content.
That was wrong: a database function never receives the uploaded bytes,
since the browser uploads directly to Supabase Storage, bypassing
Postgres entirely. A function can only ever see self-reported metadata
(`storage.objects`'s declared size/content-type), which is exactly the
attacker-controlled information real content validation has to not
trust. Full corrected design: [SECURITY_PLAN.md](./SECURITY_PLAN.md)
§6.1 — summarized here.**

- **Two buckets, both private — `product-images` is not actually
  "public," corrected from an earlier claim.** A private
  `product-images-quarantine` bucket, where `staff`/`admin`/`owner` may
  upload directly (Storage policy, path-scoped to their own `auth.uid()`)
  but **no role may read back** — only the service role can; and
  `product-images` itself, write-restricted to service-role only, **and
  read-restricted by an RLS-style policy requiring a matching
  `product_images` row to exist** — not Supabase's "public" bucket type,
  which would skip that check entirely. The read policy's condition and
  "the storefront knows about this image" are the same condition, not
  two separately-timed things that merely tend to coincide — see
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2 for the exact policy and
  why the original design's "created only after validation succeeds"
  framing didn't, by itself, prevent direct-URL access to an already-
  copied-but-not-yet-recorded object.
- **Content validation happens in a trusted Edge Function, triggered by
  Storage events on the quarantine bucket — handling both `initiated`
  and `uploaded` rows, with an independent object-existence check, to
  close a race the original design had** (a Storage event can fire
  before the client's own status update lands — requiring `status =
  'uploaded'` to claim a row would silently ignore a legitimate,
  already-complete upload). Full corrected sequence:
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 item 3A. The function
  downloads the object (it genuinely has the bytes now, unlike a
  Postgres function), verifies real file-format signatures (not the
  declared content-type), checks size/dimensions, and only on success
  copies the file to `product-images`, then creates the `product_images`
  row — **two separate operations in that order, not one atomic unit;
  a Storage copy and a Postgres write cannot be wrapped in the same
  transaction** — but, per the corrected access boundary above, the gap
  between them is not a public-exposure risk, only a recoverable
  incomplete-publish state. The full idempotent state machine is in
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 and
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2,
  `pending_image_uploads`. On validation failure, the quarantine object
  is deleted and the `pending_image_uploads` row is marked `rejected`
  with a reason, so the admin UI has something to show progress/failure
  against.
- **This is Proposed — awaiting architecture approval, not implemented.**
  A reconciliation sweep for stuck/orphaned intermediate state (crashed
  validation or promotion runs) is part of the design but, like the
  rest of it, not yet built — see
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 for the full state
  machine, idempotency, and recovery detail, and
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §13.2 for the
  explicit approval conditions.
- Images referenced by path in a `product_images` table (ordered via
  `display_order`, exactly one row per product marked `is_primary` —
  enforced by a partial unique index, not just application convention)
  rather than storing arrays in the product row, so galleries can scale and
  be reordered without rewriting the product record.
- Alt text is **bilingual**: `alt_text_ar` and `alt_text_en` on
  `product_images` (not a single-language field), matching the paired
  `_ar`/`_en` column pattern used throughout the catalog schema — see
  [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) §2. Both are required at the
  application-validation layer for new uploads via the admin UI, needed
  for accessibility and for SEO in both locale trees (including the
  prerendered snapshots in §4).
- **Deletion** removes the `product_images` row **first**, then the
  underlying Storage object — **two sequential operations, not one
  atomic unit (corrected from an earlier claim)**. The ordering is what
  matters, not atomicity: deleting the row first is what revokes public
  read access immediately, since §6.2's read policy's `EXISTS` check
  fails the instant the row is gone — the subsequent Storage delete is
  space-reclamation, safe to retry independently if it fails. Full
  detail: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2.
- **Responsive image delivery without Next.js `<Image>`**: a plain
  `<img>`/`<picture>` element using `srcset`/`sizes`, with the different
  resolution variants generated via Supabase's image transformation API
  (or a CDN layer in front of Storage) rather than a framework-provided
  component. Lazy loading uses the native `loading="lazy"` attribute (no
  library needed for the common case) or an `IntersectionObserver`-based
  hook for cases needing finer control. This is **the primary lever for
  mobile performance** given mobile is the primary storefront experience
  — unchanged in importance from before, just implemented with
  web-platform primitives instead of a framework component.

## 11. Performance & Scalability (1,000+ products)

- Listing queries paginate (cursor or offset) at the Supabase query level
  — never load the full catalog client-side, regardless of there being no
  server to paginate "for" the client anymore; the browser's own query
  still asks for one page at a time.
- Filter/sort/search backed by proper Postgres indexes (category, price
  range, attribute values) and, if full-text relevance becomes a bottleneck,
  Postgres full-text search (`tsvector`) before reaching for an external
  search service.
- Aggregate values (price range, in-stock flag, review rating) are read from
  a **maintained aggregation table** (`product_listing_summary`), kept
  current by a trigger-driven `UPSERT` on every variant/product write —
  not computed per-request, and read via a direct, RLS-governed browser
  query (§8) rather than through any server-side cache. See
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §C for the full
  comparison of regular views, materialized views, and maintained
  aggregation tables, and why the latter was chosen (unaffected by the
  framework change).
- Images are the dominant performance risk for a photography-led brand —
  mitigated via responsive `srcset`, lazy loading below the fold, and a
  CDN/image transformation layer (§10).
- Admin data tables (orders, products) use paginated, filtered Supabase
  queries from day one — never "load all 1,000 products into a client
  table," regardless of there being no server to enforce that boundary;
  it's enforced by how the admin UI's queries are written.
- **Caching layers, explicitly, revised for the new stack**: (1) a
  client-side data cache (TanStack Query, §4.2) for the live SPA's
  listing/detail reads — the SPA-native analogue of the Next.js data
  cache, now living in the browser; (2) the prerendered static HTML
  snapshots (§4) acting as a zero-JS-execution cache for first paint and
  crawlers; (3) the `product_listing_summary` aggregation table acting as
  an application-level cache of otherwise-expensive cross-variant
  aggregates; (4) HTTP caching headers on Supabase Storage image
  responses (CDN-cacheable, content-addressed paths so a cache-buster
  isn't needed). No separate Redis/cache layer is proposed for v1 at
  1,000-product scale; revisit only if profiling shows the above
  insufficient.
- **N+1 prevention** is structural, not query-by-query vigilance: listing/
  search pages query the aggregation table (one row per product, already
  joined), and product detail pages fetch variants/images/attributes via a
  small number of batched queries (or a single RPC returning a composed
  JSON shape) rather than one query per variant.

## 12. Deployment Topology (Vite Static SPA)

- **Build output**: `vite build` produces a static `dist/` folder
  (hashed-filename JS/CSS, an `index.html` shell) — then the prerendering
  step (§4.2) runs against that build and writes additional, fully
  rendered HTML files into `dist/` at their specific locale/product/
  category paths, before the final artifact is published. There is no
  Node server process to run in production for the frontend itself.
- **Static hosting requirements**: any static host/CDN capable of serving
  a directory of files with configurable rewrite rules — Vercel, Netlify,
  Cloudflare Pages, or S3+CloudFront/Nginx all satisfy this; **no
  Node-capable host is required anymore**, which is a genuine cost/
  operational simplification versus the Next.js-era requirement for a
  Node runtime (or a managed platform providing one). No specific
  provider is committed to here — see
  [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #5, now reframed around
  this static-hosting requirement rather than Next.js/ISR behavior.
- **SPA fallback / rewrite rules, with an ordering requirement that
  matters**: any path **without** a prerendered static file at it must
  rewrite to `/index.html` so React Router can handle it client-side (the
  one non-negotiable requirement for any SPA, expressed differently per
  host — Vercel `vercel.json` rewrites, Netlify `_redirects`, Cloudflare
  Pages `_redirects`, Nginx `try_files`). **A path that *does* have a
  prerendered file must serve that file directly, not the SPA fallback**
  — getting this ordering backwards would silently defeat the entire
  prerendering effort (crawlers would receive the generic SPA shell
  instead of the rendered content) without any obvious symptom short of
  a Search Console inspection catching it. This is called out as a
  deployment-configuration detail requiring explicit verification before
  launch, not an assumption this document can guarantee on its own.
- **Environment variables**: Vite only exposes `VITE_`-prefixed variables
  to the client bundle (`import.meta.env.VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`). The anon key is meant to be public (RLS
  makes it safe). **Nothing else — the service-role key, payment provider
  secret keys — is ever given a `VITE_` prefix or referenced from
  anything Vite bundles**; those exist only in Edge Function/CI
  environment configuration, never in a browser-delivered file.
- **Preview and production environments**: branch/PR preview deployments
  (natively supported by most static hosts) point at a staging Supabase
  project; production points at the production Supabase project — same
  environment-separation principle as before, now expressed through Vite
  env files and host-level environment variable sets instead of
  Next.js-specific env conventions.
- **Supabase environment separation**: unchanged — local dev (Supabase
  local or a dev project) → staging Supabase project → production
  Supabase project, with migrations tracked in version control (Supabase
  CLI migrations) once implementation starts.
- **Cache behavior for static assets**: hashed JS/CSS filenames get
  long-lived immutable cache headers; `index.html` and the prerendered
  HTML snapshots get short/no-cache headers, so a redeploy or
  re-prerender is picked up immediately rather than being served stale
  from a CDN edge cache — this split must be set deliberately in host
  config, since getting it backwards (caching `index.html` aggressively)
  would serve a stale app shell referencing deleted hashed asset files
  after a deploy.
- **Sitemap/prerendering deployment implications**: both the sitemap
  generator and the prerender script need read access to the product/
  category catalog at deploy time (a scoped read connection or the
  service role, run only in CI/the deploy pipeline, never shipped to the
  browser) and must complete before the final static artifact is
  published — not as an after-the-fact step.
- **Rollback**: since the output is static files, rollback is "redeploy
  the previous build artifact" — most static hosts keep deployment
  history for exactly this. Simpler than a Next.js server rollback story,
  since there is no running server process to roll back, only files to
  swap back.
