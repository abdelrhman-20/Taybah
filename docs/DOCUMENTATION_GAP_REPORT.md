# Documentation Gap Report — Taybah (طيبة)

**Verdict:** the existing `docs/` set is **excellent as a target-architecture
reference but insufficient on its own** for another AI to work on this project
accurately, because it was written before implementation and the build has
since diverged in scope. The handoff document (`CHATGPT_HANDOFF.md`) fills the
gap. A reader trusting `docs/` alone would make systematically wrong
assumptions (bilingual storefront, accounts, normalized orders, payment
pipeline) that the code contradicts.

## Critical doc/code contradictions found

| # | Docs say | Code actually does | Severity |
|---|---|---|---|
| 1 | Arabic default + English **mandatory** for v1 (DESIGN_SYSTEM §2.2, FEATURES §0) | Arabic-only (`SUPPORTED_LOCALES=['ar']`); `en` fields exist but are never rendered | High — any doc-led change could wrongly "restore" English |
| 2 | Admin is LTR/English-only v1 | Admin is Arabic RTL (`AdminLayout` sets `lang=ar dir=rtl`; all admin copy is Arabic) | Medium |
| 3 | Order `status` enum = pending/processing/shipped/delivered/cancelled + separate `payment_status` | Single status incl. extra `confirmed` step; **no `payment_status`** (COD) | High for order work |
| 4 | Orders normalized (`order_items`, `customer_id` FK RESTRICT, anonymous auth) | Orders are jsonb snapshots; **no customer identity at all** | High |
| 5 | Variants via `attribute_value_ids uuid[]` + `create_variant` RPC + numeric `stock_quantity` decrement | Variants via `combo jsonb` + local logic; manual availability enum; `stockQuantity` optional, never decremented | High |
| 6 | Category hierarchy (self-referencing) + localized slugs + M2M product_categories | Flat categories, one slug per locale-pair; **collections** entity added that docs don't mention at all | Medium |
| 7 | Image pipeline: private quarantine bucket + validating Edge Function (Proposed) | IndexedDB local blobs + unused public `storefront-media` bucket | Medium |
| 8 | Guest carts via Supabase anonymous sign-ins | Cart/wishlist are localStorage; no anonymous auth anywhere | High |
| 9 | Roles: customer/staff/admin/owner + `has_role_at_least()` | `admins` allowlist + `is_admin()` for catalog; "any authenticated user" for orders | Medium |
| 10 | "Nothing implemented" (FEATURES.md, ROADMAP, PROJECT_OVERVIEW §2) | Full storefront + partial admin shipped; 315 tests passing | High — most misleading stale claim |
| 11 | Email provider = open question #4 | Resend chosen + working (sandbox sender only) | Low — a real decision now exists |
| 12 | Logo "not yet supplied" | `src/assets/taybah-logo.png` exists | Low |

## Information that cannot be determined from docs or code

- Whether the Arabic-only / COD-only / no-accounts descoping was a **temporary
  sequencing choice** or a **permanent scope change** — this determines whether
  the docs' designs remain the target or need rewriting. (Ask the owner.)
- Deployment/hosting target and any CI pipeline — nothing configured in repo.
- Whether migration 0003's catalog schema was ever actually applied to the
  Supabase project, or only written.
- The referenced "separate data-migration utility" (0003 comment) does not
  exist in the repo — where it lives is unknown.
- Whether `pg` devDependency is intentionally kept for scripts or is leftover.
- Production secrets story beyond `.env.local` (RESEND_API_KEY lives in the
  Supabase project's Edge Function env — not visible in repo).
- Who the business owner is / how to get the OPEN_QUESTIONS items answered.

## Suggested doc maintenance (not performed — per instructions, no edits made)

- `FEATURES.md` and `PROJECT_OVERVIEW.md` §2 need a "current status" banner.
- `DATABASE_SCHEMA.md` should be annotated as *target* schema; migrations are
  the *actual* schema.
- `OPEN_QUESTIONS.md` items #1, #3, #4, #8 should be marked resolved-by-
  implementation (COD/EGP/Resend/guest-only) or re-opened explicitly if the
  descope is temporary.
- Add a note that `collections`, Arabic-only scope, and RTL Arabic admin are
  real product decisions encoded in code.
