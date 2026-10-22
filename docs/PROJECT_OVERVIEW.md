# Taybah — Project Overview

**Project identity:** Taybah (English) / طيبة (Arabic). "Taybah" is the
technical identifier used throughout code, repositories, and documentation.
"طيبة" is the Arabic brand identity used in-product for the Arabic-locale
storefront (logo, Arabic copy, RTL UI). Both refer to the same project —
neither is a translation convenience, both are the official brand name in
their respective language.

## 1. What We're Building

Taybah (طيبة) is a premium e-commerce platform for carpets, rugs, curtains,
and home furnishings. It consists of two applications sharing one data layer:

- **Storefront** — the customer-facing shopping experience.
- **Admin Dashboard** — the internal tool staff use to run the store.

The brand positioning is **"Luxury Editorial with Modern Royal influences"** —
premium oriental heritage expressed through contemporary, editorial-grade design,
not a generic e-commerce template.

## 2. Workspace Discovery (as of 2026-10-18)

- Directory `Tybah` is **completely empty**. No files, no framework, no
  dependencies, no git repository.
- This is a **greenfield project**. There is no existing implementation to
  integrate with, migrate, or conflict with.
- No git repository exists yet. Recommendation: initialize git before any code
  is written, so history exists from commit one. (Not done in this phase — no
  code has been written, and repo initialization was not explicitly requested.)

## 3. Goals

1. Ship a production-ready storefront that feels premium, loads fast, and
   converts — not a visual clone of the reference site
   (carpetlandeg.com/shop), used only to understand functional expectations
   (categories, filters, variants, cart/checkout flow).
2. Ship an admin dashboard that lets non-technical staff manage a 1,000+ SKU
   catalog, inventory, orders, and content without engineering involvement.
3. Build on an architecture that scales in catalog size (1k → 10k+ products)
   and traffic without a rewrite.
4. Keep the gold accent restrained — the UI must read as warm/neutral with
   burgundy and gold as deliberate, sparing accents, not a "gold theme."
5. Deliver a **mobile-first storefront**: every storefront page is designed
   and validated mobile → tablet → desktop, in that order, with desktop as
   an intentional expansion of the mobile experience rather than a scaled-up
   mobile layout. See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2.
6. Support **Arabic (RTL) as the default storefront language, with English
   (LTR) as a fully supported secondary language** — both are first-class,
   not an afterthought bolted onto an LTR-only layout. See
   [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) §2.

## 4. Non-Goals (This Phase)

- No frontend implementation.
- No database migrations or Supabase project changes.
- No authentication implementation.
- No dependency installation.
- No production configuration.

This phase produces **architecture and documentation only**. See
[DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) for what Phase 2+ covers.

## 5. Primary Stakeholders & Users

| Role | Needs |
|---|---|
| Shopper (guest or account holder) | Browse, filter, compare, buy, track orders |
| Store admin / owner | Full control: catalog, orders, customers, content, staff |
| Catalog/ops staff | Product entry, inventory updates, order fulfillment |
| Support staff (future) | Limited order/customer lookup access |

## 6. Success Criteria

- Storefront: sub-2.5s LCP on product listing/detail pages at catalog scale,
  fully responsive, SEO-indexable, accessible (WCAG AA baseline).
- Admin: a staff member can add a new product with variants, images, and
  stock levels in under 3 minutes.
- Architecture supports 1,000+ products, multi-image galleries, and
  variant-level pricing/stock without query performance degradation.
- No customer data or admin action is reachable without proper authorization
  (enforced at the database layer via RLS, not just in application code).
- Every storefront page is validated at mobile, tablet, and desktop
  breakpoints, and in both Arabic (RTL) and English (LTR), before being
  considered done — not validated in one locale/breakpoint and assumed to
  work in the other.

## 7. Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system & technical architecture
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — entities & relationships
- [FEATURES.md](./FEATURES.md) — full feature breakdown
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — brand, color, typography, components
- [SECURITY_PLAN.md](./SECURITY_PLAN.md) — auth, RLS, authorization strategy
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) — phased delivery plan
- [IMPLEMENTATION_RULES.md](./IMPLEMENTATION_RULES.md) — engineering conventions
- [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) — assumptions & unresolved decisions
- [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) — Phase 1 Step 2 audit
  findings and resolutions
