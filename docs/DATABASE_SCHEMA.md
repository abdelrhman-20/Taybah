# Taybah — Database Schema Proposal

This is a **proposal for review**, not a migration. No Supabase project has
been touched. Types are illustrative (Postgres), not final DDL.

## 1. Entity Relationship Overview

```
auth.users (incl. anonymous) ──┐
                                 ├─< orders [RESTRICT] >──< order_items >── product_variants
profiles (role: customer/       │                                      │
  staff/admin/owner) ───────────┤                               order_status_history
                                 │                               payment_events (service-role only)
                                 │                               refund_requests (outbox, service-role only)
wishlists ──< wishlist_items >──┤
carts ──< cart_items >──────────┤
comparisons ──< comparison_items >──┤
guest_merge_attempts (concurrency/recovery mutex, service-role only — no ownership ticket, see §3.1) ──┘

pending_image_uploads (service-role writes only)

categories (self-referencing) ──< product_categories >── products ──< product_variants
       │                                                     │                │     │
category_attributes                                  product_images   variant_attribute_values   product_listing_summary
       │                                                                      │              (maintained table, per product)
attributes / attribute_values ───────────────────────────────────────────────┘

coupons ──< coupon_redemptions >── orders

homepage_sections / homepage_section_items  (admin-managed content)
store_settings  (singleton/key-value config)
```

## 2. Core Tables

### `profiles`
Extends `auth.users` (Supabase Auth).

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK, FK → auth.users.id | |
| role | enum('customer','staff','admin','owner') | default `customer` |
| is_anonymous | boolean | mirrors `auth.users.is_anonymous`; distinguishes a guest's real-but-anonymous account from a registered one (§3) |
| preferred_locale | enum('ar','en'), nullable | default `ar` — used for order confirmation emails and any locale-aware admin-facing display of a customer |
| full_name | text | |
| phone | text | |
| created_at | timestamptz | |

### `categories`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| parent_id | uuid, FK → categories.id, nullable | self-referencing hierarchy |
| name_ar / name_en | text | **bilingual, not a single `name` column** — see §2.1 |
| slug_ar / slug_en | text, unique each | separate localized SEO URLs (e.g. `/ar/category/سجاد-فاخر` vs `/en/category/luxury-rugs`), not one slug reused across locales |
| description_ar / description_en | text, nullable | editorial copy, independently written per locale, not machine-translated at render time |
| image_path | text, nullable | category hero image — shared across locales unless art direction requires a per-locale override (open question if that's needed) |
| display_order | int | admin-controlled ordering |
| is_active | boolean | |

### `products`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name_ar / name_en | text | bilingual — see §2.1 |
| slug_ar / slug_en | text, unique each | |
| description_ar / description_en | text | rich/long-form editorial copy, per locale |
| short_description_ar / short_description_en | text, nullable | for listing cards |
| base_sku | text | product-level SKU prefix — SKUs are not localized |
| status | enum('draft','active','archived') | |
| meta_title_ar / meta_title_en, meta_description_ar / meta_description_en | text, nullable | SEO override, per locale |
| avg_rating | numeric, nullable | denormalized, maintained by trigger — not locale-dependent |
| created_at / updated_at | timestamptz | |

#### 2.1 Why Paired Columns, Not a Translations Table

Two locales (Arabic default, English secondary) with no near-term plan for
a third language favors simple paired columns (`name_ar`/`name_en`) over a
generic `product_translations(product_id, locale, name, ...)` side table:
it keeps every catalog query a single-table read (no extra join on every
listing/detail query, which matters at 1,000+ products), and it makes "this
field has no Arabic copy yet" a visible `NULL` in the main row instead of a
missing-row problem in a side table. If a third language is ever added,
this is a schema migration (add two columns, backfill) rather than a
rewrite — an acceptable tradeoff documented here as a deliberate choice,
not an oversight. Attribute values (§2.2) use the same paired-column
pattern for the same reason.

### `product_categories` (many-to-many)
| Column | Type |
|---|---|
| product_id | uuid, FK |
| category_id | uuid, FK |

PK: (product_id, category_id)

### `product_images`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| product_id | uuid, FK | |
| storage_path | text | path in the **public** `product-images` bucket — this row is only ever created *after* content validation succeeds, see `pending_image_uploads` below and [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 |
| alt_text_ar / alt_text_en | text, nullable | SEO/accessibility, bilingual — same paired-column pattern as §2.1, not a single-language field |
| display_order | int | |
| is_primary | boolean | one per product enforced via partial unique index |

### `pending_image_uploads` (Quarantine/Validation Tracking)

**Resolves a boundary error in the original design**, which described a
Postgres function as validating uploaded file *content* — not possible,
since Postgres never receives the file's bytes (the browser uploads
directly to Supabase Storage). This table exists so the admin UI has
something to track upload progress against while the real validation
(an Edge Function inspecting actual bytes, outside Postgres) runs. Full
flow: [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1.

**Row created *before* any file exists — this is what prevents a Storage
event from ever legitimately arriving before its DB record does** (see
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 for the full initiation
sequence this table's `id` column makes possible).

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | generated at row creation, **before** upload — embedded in `quarantine_path` so the object path is bound to this exact row, not chosen freely by the uploader |
| product_id | uuid, FK | |
| uploaded_by | uuid, FK → profiles | |
| quarantine_path | text, nullable until upload completes | deterministically derived from `id` (e.g. `{uploaded_by}/{id}.{ext}`) and returned to the client at row-creation time — the client uploads to *this* path, not one it picks |
| public_path | text, nullable until promoted | set once the file has been copied to the `product-images` bucket. **Correction**: an earlier revision implied the object isn't "publicly visible" until this column (or the `product_images` row) is set — that's not how Storage access works; a bucket's public-readability is a bucket/policy-level property, independent of whether any particular row references an object yet. See [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2 for the corrected access boundary (`product-images` is **not** an unconditionally-public bucket; it's a private bucket whose read policy requires a matching `product_images` row to already exist) — this column records *when we did the copy*, it does not itself control *who can read the object*. |
| status | enum('initiated','uploaded','validating','approved','promotion_pending','published','rejected','failed') | see state machine below |
| storage_event_id | text, nullable, **unique** | the triggering Storage event's own id — the unique constraint is what makes a duplicate event delivery a safe no-op (same pattern as `payment_events`) |
| rejection_reason | text, nullable | set on `rejected` |
| quarantine_deleted | boolean, default `false` | tracked separately from `status` — a `published` row can briefly have `quarantine_deleted = false` (promotion succeeded, quarantine cleanup still pending) without needing its own status value for that |
| attempt_count | int, default 0 | |
| created_at / updated_at | timestamptz | |
| resolved_at | timestamptz, nullable | set on `published`/`rejected`/`failed` |

**State machine** (who triggers each transition, what must pass,
retryability, and failure handling — per
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 for the full narrative):

| Transition | Trigger | Required to pass | Retryable? | On failure |
|---|---|---|---|---|
| → `initiated` | Client requests an upload slot (RLS-permitted `INSERT`, `uploaded_by = auth.uid()`, role ≥ staff) | role check | — | row simply isn't created |
| `initiated` → `uploaded` | Client's direct browser→Storage upload to `quarantine_path` completes; client updates its own row | Storage policy (path-scoped write) | yes — re-upload to the same path | row stays `initiated`; harmless either way, since the Storage event (next row) does not depend on this client-side update having happened |
| `initiated`/`uploaded` → `validating` | **Corrected — see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1 item 3A for the full narrative, including why the client-side `uploaded` update is not load-bearing for this step.** The Storage event fires the instant the object write completes in Storage — independent of, and not waiting for, the client's own `uploaded` update, which can legitimately still be `initiated` when the event arrives. The validating Edge Function: (1) looks up `pending_image_uploads` by `quarantine_path`; (2) if **no row at all** matches that path, treats the object as unauthorized/orphaned and deletes it — this is the only case where deletion on event-arrival is correct; (3) if a row matches with `status IN ('initiated','uploaded')` and `storage_event_id IS NULL`, **independently confirms the object actually exists and is fully written** (a direct Storage metadata/HEAD check — not inferred from the event payload alone) before claiming anything; (4) only then claims atomically: `UPDATE pending_image_uploads SET status='validating', storage_event_id=$1 WHERE id=$2 AND status IN ('initiated','uploaded') AND storage_event_id IS NULL RETURNING id` | a matching row (any status in `('initiated','uploaded')`) **and** independently-confirmed object existence/completeness | the claim query itself is the duplicate-event idempotency check (zero rows returned = safe no-op); a genuine completeness check failing (object not actually finished writing yet) is also a safe no-op, not an error | **no row matches at all** → delete (true orphan/unauthorized case). **A row matches but the object isn't actually complete yet** → do nothing and exit — the row is left exactly as it was (still `initiated`/`uploaded`), **never deleted**, because a matching row is evidence of a legitimate, still-in-progress upload, not an orphan. A later, genuine completion event (or the next poll, if polling is used instead of/alongside webhooks) retries the claim normally. |
| `validating` → `approved` | Edge Function finishes inspecting actual bytes | real format/size/dimension checks pass | — | → `rejected` |
| `validating` → `rejected` | Edge Function finishes inspecting actual bytes | (validation failed) | not retried automatically | quarantine object deleted immediately; `rejection_reason` set; no `product_images` row ever created |
| `approved` → `promotion_pending` → `published` | Edge Function copies the object to the `product-images` bucket, then — in a **separate** Postgres transaction (not atomic with the Storage copy; see [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.2) — sets `public_path`, `status='published'`, and creates/activates the `product_images` row | the copy must land at the expected destination path | **yes, safely**: copying to the same deterministic destination is an idempotent overwrite, so a retried promotion after a crash is harmless | if the copy succeeds but the DB transaction fails, the object physically exists in the bucket but **remains unreadable** — the bucket's read policy requires a matching `product_images` row, which doesn't exist yet, so this is not a public-exposure gap, only an incomplete-publish state. The reconciliation sweep checks whether the destination object already exists before retrying the copy (never double-copies) and completes the DB write if it's missing. |
| `published` → (quarantine deleted) | Cleanup job, any time after `published` | none beyond status check | yes, idempotent (delete-if-exists) | leftover quarantine object remains until the next sweep — harmless, never publicly reachable |
| any non-terminal state stuck past a bounded age | Reconciliation sweep | checks actual Storage/DB state before acting (see below) | — | resolved to `failed` only if genuinely abandoned (no object, no progress possible) |

**Never deletes a row/object that is `published` or mid-retry**: the
cleanup/reconciliation sweep's rule is to check real state (does the
public object exist? does a `product_images` row reference it?) before
deleting anything — it does not delete based on `status` alone when that
status could be stale due to a crash rather than true abandonment.

### `attributes`, `attribute_values`, and `category_attributes`
Generic attribute system — new attribute types (size, color, material, pile
height, drop length, origin, weave) don't require schema changes, **and
different categories are not forced to share one attribute set**: a rug
takes "pile height" and "origin," a curtain takes "drop length" and
"fabric," a furnishing piece might take neither — see §2.2 for the
category-flexibility resolution.

`attributes`: id, name_ar / name_en, slug, display_type (enum: swatch,
dropdown, text), input_type (enum: `select`, `free_text`, `numeric_range`) —
`input_type` matters because not every attribute is a fixed set of swatches
(e.g. dimensions might be a numeric range filter rather than a closed list
of values).

`attribute_values`: id, attribute_id (FK), value_ar / value_en (e.g.
"200×300cm" is locale-neutral but a color name like "Burgundy"/"عنابي" is
not), display_order, swatch_hex (nullable, for color-type attributes
rendered as a swatch).

#### 2.2 `category_attributes` — Catalog Flexibility (Advisory, Not Enforced)

`category_attributes` (many-to-many, **new table resolving catalog
flexibility**): category_id (FK), attribute_id (FK), is_required (boolean).
This is what the admin product form reads to decide *which* attribute
pickers to show when a staff member is creating a product under "Curtains"
vs. "Rugs" vs. "Furnishings" — the product form is data-driven from this
table, not a hardcoded per-category form. A product's actual variants are
still free to use any attribute (the join is advisory for the admin UI and
for filter-sidebar composition per category), not a hard constraint
enforced by a DB trigger — enforcing it as a hard constraint was considered
and rejected as premature rigidity for a catalog still being onboarded; see
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) if the business wants it enforced
strictly later.

### `product_variants`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| product_id | uuid, FK | |
| sku | text, unique | |
| price | numeric(10,2) | variant-specific price |
| compare_at_price | numeric(10,2), nullable | for showing discounts |
| stock_quantity | int | default 0, CHECK >= 0 |
| low_stock_threshold | int, nullable | admin alerting |
| weight_kg | numeric, nullable | for shipping calc (future) |
| is_active | boolean | |
| attribute_value_ids | uuid[], **not nullable, default `'{}'`** | the canonical, sorted, deduplicated set of this variant's attribute values — see §2.3. **Replaces an earlier `attribute_combination_hash text` design**, per the explicit comparison in §2.3. |

**Products without variations** are not special-cased in a separate table:
every product has **at least one** `product_variants` row. A "simple"
product (no customer-visible size/color choice) has exactly one variant
with no rows in `variant_attribute_values` — it still carries the real
SKU/price/stock, so every downstream query (cart, order_items, stock
decrement) is written once against `product_variants` and works
identically for simple and variant-bearing products. The storefront UI
simply doesn't render a variant picker when a product has only one variant
with no attributes attached.

### `variant_attribute_values` (many-to-many)
| Column | Type |
|---|---|
| variant_id | uuid, FK |
| attribute_value_id | uuid, FK |

PK: (variant_id, attribute_value_id).

#### 2.3 Duplicate Combination Prevention, Canonicalization & Validation (Resolved)

The original proposal noted Postgres "can't trivially unique-constrain a
set across a join table" and left this as an application-layer check —
unsafe under concurrent creation. A follow-up pass specified a
`attribute_combination_hash text` column, maintained by the creating RPC.
**This pass replaces the hash with storing the canonical combination
directly**, per the explicit evaluation below, and adds the input
validation the hash-only design never specified.

**Why a canonical array column instead of an MD5 hash:**

| | `attribute_combination_hash text` (MD5) | `attribute_value_ids uuid[]` (canonical array, chosen) |
|---|---|---|
| Collision risk | Non-zero, if astronomically small — a hash is a lossy summary | None — the actual values are stored and compared, not a digest of them |
| Debuggability | Opaque — reading a hash tells a developer nothing; reproducing it requires re-running the same hash function correctly | Self-describing — `SELECT attribute_value_ids FROM product_variants WHERE id = ...` directly shows the combination |
| Extra moving parts | Requires picking and fixing a hash function/encoding (`md5`, separator character, array-to-string ordering) that must be reproduced identically everywhere it's computed | Postgres array equality is built in; no custom serialization to get right or keep consistent |
| Index support | `btree` unique index on the hash column | `btree` unique index on the array column works the same way — Postgres supports equality/ordering comparison on arrays natively, so uniqueness enforcement is identical in mechanism |

Postgres array equality requires the *elements* to be in the same order to
compare equal — `ARRAY[a,b] <> ARRAY[b,a]` as raw values even though they
represent "the same set." **Canonicalization (sorting before storage) is
therefore still required** with this approach, exactly as it was for the
hash's sorted-then-joined string — the array column doesn't remove the
need to canonicalize, it just removes the need to additionally hash the
canonical form.

**`create_variant(product_id, sku, price, stock_quantity, attribute_value_ids[])` — one `SECURITY DEFINER` function, one transaction:**

1. **Deduplicate and sort the input array first, in function logic,
   before anything is validated or written**: `SELECT array_agg(DISTINCT v
   ORDER BY v) FROM unnest(input_attribute_value_ids) v` — this is the
   canonical form. Deduplication means a staff member accidentally
   selecting the same value twice (double-click, a form bug) does not
   produce a different combination than selecting it once; it also means
   the validation steps below only ever reason about a clean, unique list.
   **Simple products** (no customer-facing attributes) pass an *empty*
   input array, whose canonical form is the empty array `'{}'` — a
   well-defined, distinct value that Postgres can compare and index
   exactly like any other array value, with **no separate sentinel
   constant needed** (unlike the hash design, which needed to invent one
   for the empty case). The unique index (step 5) still means a product
   can have at most one variant with `attribute_value_ids = '{}'` — i.e.
   at most one "simple" variant — for the same reason as before.
2. **Validate every id exists**: `SELECT count(*) FROM attribute_values
   WHERE id = ANY(canonical_ids)` must equal `cardinality(canonical_ids)`.
   If fewer rows are found than distinct ids supplied, the function raises
   an exception and **nothing is written** — this catches a stale or
   invalid `attribute_value_id` (e.g. one deleted between the admin form
   loading and submitting) before any row exists that references it.
3. **Validate no two ids belong to the same attribute** (prevents
   selecting two values of the same attribute — e.g. both "Size: Small"
   and "Size: Large" — on one variant): join the canonical ids to
   `attribute_values` to get each one's `attribute_id`, and check that the
   resulting list of `attribute_id`s has no duplicates
   (`count(DISTINCT attribute_id) = count(attribute_id)` over the joined
   rows). This is a hard rule for every attribute as currently modeled
   (§2, `attributes`), since no attribute's `input_type` is multi-select
   in v1 — if a genuinely multi-valued attribute type is ever introduced,
   this rule would need to become attribute-type-conditional, which is
   flagged here as a forward note, not implemented speculatively now.
   This same join is what "validates selected values belong to the
   intended attributes" in practice: there is no separate "expected
   attribute per slot" input to check against — attribute membership for
   each value is read directly from `attribute_values.attribute_id`, and
   the one-value-per-attribute rule above is the actual constraint that
   matters.
4. **`category_attributes` is deliberately *not* checked here.** The
   function does not reject an attribute value whose attribute isn't
   mapped to the product's category — `category_attributes` remains an
   **advisory** mapping that only drives which pickers the admin UI shows
   (§2, `category_attributes`), not a constraint enforced by
   `create_variant`. This audit was explicitly asked not to silently
   resolve that business decision, and it has not been — see
   [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) item #13, unchanged. If the
   business later decides this should be strict, the enforcement point
   would be exactly here: an additional check in `create_variant` (and
   `update_variant_attributes` below) rejecting any `attribute_id` not
   present in `category_attributes` for the product's category/categories.
5. **Single `INSERT` into `product_variants`** with `sku`, `price`,
   `stock_quantity`, and the canonical `attribute_value_ids` array all
   provided in the same statement — validation (steps 2–3) already
   happened, so this insert either succeeds as a fully valid row or is
   never reached. The **unique index on `(product_id, attribute_value_ids)`**
   on `product_variants` is what rejects a *duplicate* combination (as
   opposed to an *invalid* one, caught in steps 2–3): if another variant
   with the same product and the same canonical array already exists,
   this `INSERT` raises a unique-violation and the whole transaction rolls
   back — no partial variant, no orphaned `variant_attribute_values` rows.
6. **Insert the corresponding `variant_attribute_values` rows** (one per
   canonical id, skipped entirely if the array is empty) referencing the
   new `variant_id`, in the same transaction. `variant_attribute_values`
   remains the queryable join table other reads use (e.g. "show me all
   variants with color = Burgundy"); `product_variants.attribute_value_ids`
   is the canonical, uniqueness-enforcing copy of the same information —
   kept in sync because both are written in the same transaction as a
   single unit of work, never independently.
7. **Concurrent creation** is safe by construction: two simultaneous calls
   to `create_variant` with the same input (in any order, since step 1
   canonicalizes before either compares) compute the same canonical array,
   both attempt the same `INSERT`, and Postgres's index-level uniqueness
   check resolves the race — exactly one commits, the other's transaction
   aborts cleanly with a unique-violation that the admin UI surfaces as
   "this combination already exists."

**Updates (`update_variant_attributes(variant_id, new_attribute_value_ids[])`)**
run the same canonicalization and validation (steps 1–4) on the new input,
then in one transaction: delete the variant's existing
`variant_attribute_values` rows, insert the new ones, and `UPDATE
product_variants SET attribute_value_ids = <new canonical array>` for that
variant — all statements together, or none of them (rollback on any
failure, including a unique-violation if the new combination collides
with a different existing variant of the same product). Because the array
update and the join-table changes happen in the same transaction,
`product_variants.attribute_value_ids` can never observably drift out of
sync with `variant_attribute_values` for that variant.

No table-level trigger is used for any of this: the RPC already has the
complete, validated input before it writes anything, which a trigger
reacting to join-table rows one at a time would have to reconstruct or
infer instead.

## 3. Shopping & Customer Tables

### `wishlists` / `wishlist_items`
One wishlist per `customer_id` (`auth.uid()`), using the same anonymous-auth
identification as carts (§3, `carts`) — a guest's wishlist is a real row
keyed by their anonymous uid, merged on login the same way a guest cart is.
`wishlist_items`: wishlist_id, product_id or variant_id, added_at.

### `comparisons` / `comparison_items`
Same `customer_id = auth.uid()` scoping as wishlist, capped at N items
(e.g. 4) enforced in app logic, not schema.

### `carts` / `cart_items`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| customer_id | uuid, FK → auth.users.id, **not nullable** | see guest identification below |
| created_at | timestamptz | |
| updated_at | timestamptz | used to expire/garbage-collect stale guest carts |

`cart_items`: cart_id, variant_id, quantity, unit_price_snapshot (price at
time of add, reconciled at checkout).

**Revised guest identification (replaces the original httpOnly
session-token design — see
[ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §B for the reasoning):**
guests are identified using **Supabase Auth anonymous sign-ins**, not a
custom session token. An anonymous sign-in creates a real `auth.users` row
and a real, signed JWT with a genuine `auth.uid()` — so `carts.customer_id`
is *always* `auth.uid()`, for both guests and authenticated customers, and
every RLS policy on cart/wishlist/comparison tables is a single uniform
rule (`customer_id = auth.uid()`) rather than a guest-vs-customer branch.
`profiles.role` for an anonymous user defaults to `customer` with an
`is_anonymous` flag (mirroring `auth.users.is_anonymous`) so admin-facing
queries can distinguish real accounts from anonymous carts/orders.

Cart merge on login has two paths:
1. **Guest converts to a new account** (sign-up from checkout): call
   Supabase's anonymous-to-permanent identity linking, which **keeps the
   same `auth.uid()`** — the existing cart/wishlist/order rows need no
   merge at all, since `customer_id` never changes. This is also why this
   path has no order-retention question: there is only ever one identity.
2. **Guest signs into an existing account**: the anonymous `auth.uid()` and
   the existing account's `auth.uid()` are different. **Status: Proposed
   — awaiting architecture approval, not Resolved. This no longer goes
   through a plain Postgres RPC with a client-presented ticket — see
   §3.1 below for why that design was retired, and
   [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4 for the full
   corrected mechanism, including transaction boundaries, concurrency
   control, and partial-failure recovery (§2.1 items 4A–4E), which this
   outline summarizes but does not repeat in full.** In outline: a
   Supabase Edge Function independently verifies both the live anonymous
   session (as the request's own auth context) and a freshly obtained
   target-account session token (passed as data, verified via Supabase
   Auth's admin API). **Two separate operations follow — not one
   transaction, and this document no longer claims otherwise**: (a) one
   real Postgres transaction re-parents `cart_items`/`wishlist_items`
   onto the target account's cart/wishlist (quantity-summed on
   conflicting variants) and reassigns `orders.customer_id` from the
   anonymous id to the target account's id for every order the anonymous
   identity placed; (b) only after that transaction commits, a separate
   call to the Supabase Auth Admin API deletes the anonymous
   `auth.users` row — a different trust/transaction domain that cannot
   be wrapped in the same `BEGIN`/`COMMIT` as (a). A durable
   `guest_merge_attempts` row (below) is what makes this two-step
   sequence safe under concurrency and partial failure, not an assumed
   atomicity between a database transaction and an HTTP call to a
   separate service.

### 3.1 Anonymous User & Order Retention Lifecycle

Guest checkout means an order can be placed by an identity (`auth.uid()`)
that is anonymous and may never convert to a registered account, may be
abandoned by the browser clearing site data, or may later be merged into
an existing account per path 2 above. This section defines what's
guaranteed to happen — and, as explicitly requested, what is **not**
assumed safe — across that identity's lifecycle.

### `guest_merge_tickets` — Retired, Not Just Patched

**A prior revision of this schema introduced a `guest_merge_tickets`
table** (a random `token` bound to an `anonymous_user_id`, short-expiry,
single-use) **as the proof mechanism for identity merge. On review, that
design does not hold up and has been removed from the schema, not
retained alongside a fix.** The flaw: the ticket was never bound to a
specific *target* account — only to the anonymous identity it came
from — so whoever first possessed the token (not necessarily the
legitimate guest) could redeem it into *any* account they could
authenticate into. Short expiry and single-use only constrain *when* and
*how many times* a token works, not *who* is allowed to use it; they
don't address this at all.

**No ticket-shaped replacement exists for this** — the corrected
mechanism verifies both identities' *own* session tokens directly,
inside a Supabase Edge Function, rather than bridging them with a stored
bearer secret. **A different table is still needed, for a different
reason**: not to prove ownership (that's the two-token verification's
job), but to durably coordinate concurrency and recovery across a
sequence that spans two separate transactional domains — a Postgres
transaction and a separate Auth Admin API call (§3 above). An earlier
version of this document said no table was needed for the merge at all;
that was correct for the *ownership-proof* problem (there's no ticket)
but incomplete for the *concurrency/recovery* problem, which this table
addresses.

### `guest_merge_attempts` (Concurrency and Recovery State)

| Column | Type | Notes |
|---|---|---|
| anonymous_user_id | uuid, PK, FK → auth.users.id | the mutex key — a `PRIMARY KEY`/unique constraint on this column is what prevents two concurrent attempts for the *same* anonymous identity from both proceeding |
| target_user_id | uuid, FK → auth.users.id, nullable until known | set once the target token is verified |
| status | enum('in_progress','data_merged','completed','failed') | see state machine below |
| started_at | timestamptz | used to detect a stuck `in_progress` row (Edge Function crashed) |
| data_merged_at | timestamptz, nullable | set when the Postgres reassignment transaction commits |
| completed_at | timestamptz, nullable | set when the Auth Admin API deletion also succeeds |
| last_error | text, nullable | |

**This row is the first thing the Edge Function writes, before any other
work** — an `INSERT ... ON CONFLICT (anonymous_user_id) DO NOTHING
RETURNING *` (or an equivalent claim query). If the insert is skipped
(conflict), **a second concurrent request for the same anonymous
identity does not proceed independently** — it reads the existing row
instead and responds according to its status, never re-running the
merge logic: `in_progress` (and not stale past a bounded timeout) →
"a merge is already running, try again shortly"; `data_merged` or
`completed` → return success referencing `target_user_id` from the
existing row, without touching any data again (the merge already
happened; this is the idempotent-retry path); `failed` → allow a fresh
attempt by claiming the row again (`UPDATE ... SET status =
'in_progress', target_user_id = NULL, started_at = now() WHERE
anonymous_user_id = $1 AND status = 'failed'` — **`target_user_id` is
explicitly cleared on this reset**, so a stale target from a dead
attempt can never leak into or constrain a fresh one).

**State machine:**
- `in_progress` → `data_merged`: set in the **same Postgres transaction**
  as the cart/wishlist/order reassignment, immediately after it commits
  (so this transition and the reassignment either both happen or neither
  does — this is the one piece that *is* genuinely atomic, because it's
  entirely within one Postgres transaction).
- `data_merged` → `completed`: set after the **separate** Auth Admin API
  call to delete the anonymous user succeeds. If that call fails, the row
  **stays at `data_merged`** — this is not a failure state, because the
  user-visible goal (data under the target account) already succeeded;
  it's a "cleanup still owed" state, picked up by the reconciliation sweep
  described in [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4C.
- `in_progress` → `failed`: set if the Postgres reassignment transaction
  itself fails/rolls back (e.g. an unexpected constraint violation) or
  target-token verification fails — nothing was changed, safe to retry.

**Corrected recovery for a stuck `in_progress` row (an earlier revision
of this design was unsafe here and has been fixed):** past a bounded
timeout, a reconciliation sweep must decide whether the reassignment
transaction committed. **The earlier version inferred this by checking
whether any cart/wishlist/order rows still reference
`anonymous_user_id` — this is unsafe and is not the design anymore**: a
guest with an empty cart, no wishlist items, and no orders would show
*zero matching rows regardless of whether the transaction ever ran*,
making that check unable to distinguish "committed, nothing to move" from
"never ran." **The authoritative evidence is the `status` column
itself, not row-counting**, for a precise reason: the transition to
`data_merged` is written *inside* the same transaction as the
reassignment (above), so Postgres's own atomicity guarantee means these
two outcomes are indistinguishable from each other in practice — if the
transaction committed, `status` is `data_merged` (not `in_progress`); if
the transaction didn't commit, `status` is still `in_progress`, full
stop, regardless of how many or how few rows the reassignment would have
touched. **Therefore**: if a sweep observes a row still at `in_progress`
past the timeout, the reassignment transaction for that attempt
definitely did not commit — there is nothing to check for, and it is
always safe to reset it to `failed` (clearing `target_user_id`, per
above) and allow a clean retry. This holds identically for a guest with
substantial data and a guest with none.

**Target-account binding — explicit rules:**
- **Before the reassignment transaction commits**, `target_user_id` is
  provisional, not binding. If the attempt is reset to `failed` (crash,
  verification failure, timeout), `target_user_id` is cleared, and a
  retry is free to present a *different* target account — nothing was
  committed, so there is nothing to protect against changing.
- **Once the reassignment transaction commits** (`status` reaches
  `data_merged`), `target_user_id` becomes **permanently bound** for
  that anonymous identity. Any later request for the same
  `anonymous_user_id` — whether presenting the same or a *different*
  verified target token — is answered from the existing row's
  `target_user_id`, never re-executed: a matching target gets the
  idempotent "already merged" success response (§ above); a
  *different* target gets an explicit rejection ("this guest identity
  was already merged into a different account"), **not** a silent
  re-merge or a second reassignment. This is what prevents reassigned
  data from ever being redirected to a second account after the fact.
- **A request arriving while a previous attempt is `in_progress` (not
  yet stale)**: rejected with "merge in progress, try again shortly" —
  it does not matter whether this new request's target matches the
  in-progress attempt's provisional target or not; the mutex (the `PK`
  conflict) blocks it regardless, so there is no window where two
  different targets could both be racing toward a commit for the same
  anonymous identity.
- **A request arriving when the previous attempt is `failed`**: free to
  proceed with whatever target the new request presents, per the first
  bullet — no binding exists yet.

No client role has any access to this table — written and read only by
the merge Edge Function and its reconciliation sweep, both service-role.

**Foreign key deletion behavior, stated explicitly (nothing here is left
to the default):**

| FK | On delete of the referenced row | Why |
|---|---|---|
| `carts.customer_id` → `auth.users.id` | `CASCADE` | Carts are ephemeral pre-purchase state with no retention requirement; losing a guest's cart when their identity is cleaned up is acceptable. |
| `wishlists.customer_id`, `comparisons.customer_id` → `auth.users.id` | `CASCADE` | Same reasoning as carts. |
| `profiles.id` → `auth.users.id` | `CASCADE` | `profiles` is pure extension data for an `auth.users` row; it has no independent reason to outlive the account. |
| **`orders.customer_id` → `auth.users.id`** | **`RESTRICT`** | **This is the one that matters.** An order is a business/financial record, not ephemeral state. `RESTRICT` means Postgres itself refuses to delete any `auth.users` row — anonymous or not — while an order still references it, rather than silently cascading the order away or leaving `customer_id` dangling. This is a database-enforced guarantee, not a policy that application code has to remember to honor. |
| `order_items.order_id`, `order_status_history.order_id`, `coupon_redemptions.order_id` → `orders.id` | `RESTRICT` | Orders are never hard-deleted by any application code path in this design (cancellation is a `status` value, not a row deletion) — `RESTRICT` here is defensive, documenting that intent explicitly rather than leaving it implicit. |
| `payment_events.order_id` → `orders.id` | `SET NULL` (nullable FK) | `payment_events` is an audit/idempotency trail that should survive even in a hypothetical future where an order record is purged under a data-retention policy not yet defined (see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)) — it is not itself a reason to block that purge. |
| `refund_requests.order_id` → `orders.id` | `RESTRICT` | Mirrors `order_items` — orders aren't deleted in this design, so this is defensive, not load-bearing today. |

**Why `orders.customer_id` is `RESTRICT` and not `CASCADE`:** `CASCADE`
would mean deleting an abandoned anonymous identity — exactly the kind of
row a cleanup job targets — **silently deletes that customer's order
history along with it**. That is precisely the failure mode this review
was asked to rule out. `RESTRICT` makes it structurally impossible: any
cleanup process, however it decides which anonymous identities to delete,
cannot delete one that owns an order — the database rejects the delete
statement outright. This also means a cleanup job's *own* candidate query
matters (below), since discovering the restriction via a failed `DELETE`
is not the same as having designed the job to never attempt it.

**Anonymous-user cleanup is a custom scheduled job, not Supabase's
built-in anonymous-user cleanup used as-is.** Supabase offers automatic
cleanup of anonymous users past an inactivity window, but this review does
not assume that feature's default selection logic is aware of — or
excludes — identities that own retained business records in *this*
schema's `orders` table; that exclusion is specific to this application's
data model, not something a generic platform feature can be assumed to
know. Rather than assume it's safe, the retention restriction is made
explicit: the cleanup job this project runs (a scheduled Edge
Function/SQL job, not the platform default) is defined as:

```sql
-- candidates: inactive anonymous users with no owned orders
SELECT u.id FROM auth.users u
WHERE u.is_anonymous
  AND u.last_sign_in_at < now() - interval '30 days' -- threshold TBD, not a business decision made here
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id)
```

Only rows returned by this query are deleted. An anonymous identity that
has ever placed an order is **retained indefinitely by this exclusion
rule** — not on a timer this project controls — until a separate,
explicit data-retention policy (e.g. a legal/tax-driven minimum retention
period, or a decision that old guest orders can eventually be archived)
is defined by the business. **No such policy is assumed or invented
here**; this is the retention restriction the audit asked for in place of
assuming automatic cleanup is safe. The 30-day inactivity threshold shown
above is illustrative, not a committed value — see
[OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md).

**The merge operation cannot transfer another user's orders — corrected
to match the current (Edge Function, two-token) design, not the earlier
ticket-based or "replaced session" wording this paragraph previously
used.** The anonymous identity reassigned is whichever one the merge
Edge Function's own request is authenticated as — verified by Supabase
Auth from the request's actual JWT, never read from a client-supplied
parameter of any kind (not an id, not a ticket). A client cannot cause
an arbitrary stranger's orders to be pulled into a different account,
because there is no "which anonymous identity" input anywhere in this
flow for a client to supply in the first place. Full mechanism,
including the `guest_merge_attempts` concurrency/recovery layer:
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4.

**Guest orders that are never merged or converted** (the guest completes
checkout, never creates an account, and never returns) remain fully
accessible and historically preserved indefinitely under the `RESTRICT`
guarantee above — they are simply attached to an anonymous identity that
is never cleaned up, precisely because it owns an order. **What is not
solved here, and is flagged rather than invented:** such a guest, without
an account and without their original browser session (cleared cookies,
different device), has no way to look up that order themselves through
the storefront as currently scoped in
[FEATURES.md](./FEATURES.md) — a "look up my order by order number + email"
feature would be needed for that, and is not currently in the v1 feature
set. This is noted as a product gap for the business to decide on, not
resolved by assuming it's out of scope.

### `orders`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| order_number | text, unique | human-readable, e.g. `TY-100042` |
| customer_id | uuid, FK → auth.users.id, **not nullable** | guest checkout uses the anonymous-auth uid (§3) — there is no "null customer," only an anonymous one, which keeps this FK and every RLS policy on `orders` uniform |
| status | enum('pending','processing','shipped','delivered','cancelled') | **fulfillment lifecycle only** — payment state is tracked separately, see `payment_status` below and [ARCHITECTURE.md](./ARCHITECTURE.md) §7.1 |
| subtotal / discount_total / shipping_total / tax_total / grand_total | numeric(10,2) | |
| shipping_address | jsonb | snapshot, not FK — addresses change, orders shouldn't |
| billing_address | jsonb | |
| payment_status | enum('unpaid','paid','failed','refunded') | updated **only** by the payment-webhook Edge Function, never by a client request or by the order-status RPC |
| cancelled_at / cancellation_reason | timestamptz, nullable / text, nullable | set by the `cancel_order` RPC (§7.1); a cancelled order with `payment_status = 'paid'` enqueues a `refund_requests` row (§3, `refund_requests`) in the same transaction — it does not silently leave the payment captured, and it does not call the payment provider directly from this RPC |
| placed_at | timestamptz | |

### `order_items`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| order_id | uuid, FK | |
| variant_id | uuid, FK | |
| product_name_snapshot | text | historical accuracy if product renamed/deleted |
| sku_snapshot | text | |
| unit_price | numeric(10,2) | price at purchase time |
| quantity | int | |

### `order_status_history`
order_id, status, changed_at, changed_by (FK → profiles, nullable for
system-triggered changes) — audit trail for admin order management.

### `payment_events`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| provider | text | e.g. `stripe`, `paymob` — provider TBD, see [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) |
| provider_event_id | text | the provider's event/notification id |
| order_id | uuid, FK, nullable | |
| event_type | text | e.g. `payment_succeeded`, `refund_succeeded` — used to check the transition is valid for the order's current state (see out-of-order handling below) |
| requires_review | boolean, default `false` | set `true` when the event was recorded but did not match a valid state transition (e.g. a refund event for an order not currently `paid`) — reviewed manually, never auto-resolved by a guess |
| effect_applied_at | timestamptz, nullable | set the instant the event's business effect (e.g. the `orders.payment_status` update) is actually applied — **distinct from `processed_at`** (which just means "recorded"). `requires_review = true` rows have `effect_applied_at = NULL` until resolved; this is the field that makes resolution idempotent, see §3.2. |
| reviewed_by | uuid, FK → profiles, nullable | who resolved a flagged event |
| reviewed_at | timestamptz, nullable | |
| resolution_notes | text, nullable | required free-text justification when resolving a flagged event, for audit purposes |
| processed_at | timestamptz | when the event was first recorded (not necessarily when its effect was applied) |

Unique index on `(provider, provider_event_id)`. **The insert into
`payment_events` and the business-effect update (e.g.
`orders.payment_status`) happen as statements inside the same database
transaction**, not as two independent steps — this is what makes the
idempotency guarantee actually hold:
- If the `INSERT` violates the unique constraint, the event was already
  fully processed in an earlier, committed transaction (never partially —
  see below), so the handler catches that specific error and returns
  success to the provider without reapplying anything.
- If the `INSERT` succeeds but a later statement in the same transaction
  fails, the **entire transaction rolls back, including the
  `payment_events` insert** — the event is never left "recorded but not
  acted on." The handler returns a failure response to the provider, which
  triggers the provider's normal webhook retry, and that retry is
  processed from a clean slate because nothing committed the first time.
See [ARCHITECTURE.md](./ARCHITECTURE.md) §7.2 and
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.2 for the full failure-recovery
and out-of-order-event design.

### `refund_requests` (Transactional Outbox for Provider Refund Calls)

**Resolves a boundary error in the original design**, which described
`cancel_order` as "initiating a refund request to the payment provider"
directly from a Postgres RPC. Postgres functions do not make outbound
HTTP calls as part of a transaction — and even where an extension makes it
technically possible, a slow or failing external HTTP call inside a
database transaction risks holding row locks (on the order/variant rows)
for the duration of that call, which is unacceptable. The actual provider
API call must happen in a trusted server/Edge Function context, outside
the database transaction — `refund_requests` is the durable hand-off
between the two.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | **the provider idempotency key — used literally, unchanged, on every attempt for this row, including every retry.** Never regenerated per attempt; this is what makes a retried call safe (see Lifecycle, step 4). |
| order_id | uuid, FK | |
| amount | numeric(10,2) | |
| status | enum('pending','in_flight','provider_accepted','succeeded','failed') | see state machine below — `provider_accepted` is new and deliberately distinct from `succeeded` |
| claimed_by | text, nullable | worker/process instance identifier that currently holds this row's lease; `NULL` when not claimed |
| claimed_at | timestamptz, nullable | |
| lease_expires_at | timestamptz, nullable | a claim is only valid until this time; an expired lease means the claiming worker is presumed dead/stuck and the row becomes reclaimable |
| attempt_count | int, default 0 | |
| next_retry_at | timestamptz, nullable | earliest time a failed/retryable attempt may be picked up again (backoff) |
| provider_accepted_at | timestamptz, nullable | set when the provider's **synchronous** API response accepted the request — distinct from confirmed completion, see below |
| provider_refund_id | text, nullable | set once the provider confirms |
| last_attempted_at | timestamptz, nullable | |
| last_error | text, nullable | |
| created_at | timestamptz | |

**Two partial unique indexes, not one — because "no duplicates" has two
different meanings here that a single index can't express:**
- `UNIQUE (order_id) WHERE status IN ('pending','in_flight','provider_accepted')`
  — prevents a *second concurrently outstanding* refund request for the
  same order (the original "duplicate refund requests" case).
- `UNIQUE (order_id) WHERE status = 'succeeded'` — prevents a *lifetime*
  second successful refund for the same order. **This is the index the
  original design was missing**: the first index alone only blocks
  *overlapping* requests — it does nothing to stop a *new* request being
  created after an earlier one already reached `succeeded`, because
  `succeeded` isn't one of the statuses it covers. With this second index,
  any attempt to insert a new `refund_requests` row for an order that
  already has a `succeeded` one fails outright, regardless of how much
  time has passed. **A new request after a `failed` one, however, is
  allowed** — `failed` is covered by neither index, which is intentional:
  an order whose refund attempt failed should be retryable (by an
  explicit, audited "retry refund" admin action creating a new row, not
  an automatic unbounded loop), and a `failed` status must not block that.

**Claiming a row — safe under multiple workers, via `SELECT ... FOR UPDATE
SKIP LOCKED`:**

```sql
UPDATE refund_requests SET
  status = 'in_flight', claimed_by = $worker_id,
  claimed_at = now(), lease_expires_at = now() + interval '5 minutes',
  attempt_count = attempt_count + 1, last_attempted_at = now()
WHERE id = (
  SELECT id FROM refund_requests
  WHERE (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now()))
     OR (status = 'in_flight' AND lease_expires_at < now()) -- reclaim a dead worker's row
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`SKIP LOCKED` is what prevents two workers from claiming the same row:
each worker's `SELECT ... FOR UPDATE` locks the row it's examining, and a
second worker running the same query concurrently skips any row still
locked by the first rather than blocking on it or double-claiming it —
this directly answers "multiple workers claiming the same pending
request." The `lease_expires_at < now()` branch of the `WHERE` is what
answers "a worker crashing after setting `in_flight`" and "a request
remaining `in_flight` indefinitely": a lease that isn't renewed (because
its worker died) simply expires, and the *same* claim query above picks
it back up — there is no separate recovery procedure to build, the normal
claim path already covers it.

**State machine:**

```
pending ──(claim)──► in_flight ──(provider API call accepts)──► provider_accepted ──(webhook confirms)──► succeeded
   ▲                     │                                             │
   │                 (retryable failure,                      (webhook reports failure —
   │                  attempts remain:                          rare, but possible)
   │                  next_retry_at set,                               │
   └──────────────────claim fields cleared)                            ▼
                             │                                      failed
                             ▼
                          failed  (non-retryable, or attempts exhausted)
```

1. `cancel_order` (and any other refund-triggering RPC) writes the order
   status change, the stock restoration, **and** a `refund_requests` row
   (`status = 'pending'`) in **one Postgres transaction** — the outbox
   write.
2. A worker claims a due row per the query above (`pending` →
   `in_flight`), then calls the provider's refund API, **passing
   `refund_requests.id` as the idempotency key** — the same value on
   every attempt for this row, never a freshly generated one per retry.
3. **Distinguishing provider acceptance from confirmed completion**: if
   the provider's synchronous API response says the refund was accepted
   for processing, the worker sets `status = 'provider_accepted'` and
   `provider_accepted_at = now()`. This is **not** `succeeded`, and
   `orders.payment_status` is **not** touched at this point — only the
   provider's later asynchronous webhook confirmation (same
   signature-verified, `payment_events`-idempotent path as a payment
   confirmation) moves the row to `succeeded`, sets `provider_refund_id`,
   and is what the webhook handler uses to set
   `orders.payment_status = 'refunded'`, all in that webhook handler's own
   transaction. Two independent signals — our own API-call success and
   the provider's separate confirmation — must both occur before anything
   customer-facing says "refunded."
4. **Safe recovery when the provider's response is lost** (e.g. a network
   timeout after the provider actually processed the refund, so our
   worker never saw the success response): because the idempotency key
   (`refund_requests.id`) is always reused, retrying the identical call is
   safe — the provider either returns the original result for that key
   (a true idempotent replay, causing no second refund) or, if it hadn't
   actually processed it, processes it now. This is the specific mechanism
   that makes "the provider may have processed the refund but the response
   was lost" **not** a double-refund risk: the retry is not a *new*
   refund attempt from the provider's point of view, it's a replay of the
   same one.
5. **Retryable failure** (timeout, 5xx, or a lost-response timeout as in
   step 4): `last_error` is recorded, `status` returns to `pending`,
   `claimed_by`/`claimed_at`/`lease_expires_at` are cleared, and
   `next_retry_at` is set with exponential backoff — eligible for
   re-claim once that time passes (or earlier if the lease approach above
   never got that far, e.g. a timeout before any lease was even set).
6. **Non-retryable failure or attempts exhausted**: `status = 'failed'`,
   surfaced in the admin UI as "refund needs manual attention" — never
   silently dropped, and never reported to the customer as completed. A
   new refund attempt for the same order is then allowed (not blocked by
   either unique index, since neither covers `failed`), but only via an
   explicit admin "retry refund" action that creates a fresh
   `refund_requests` row — not an automatic unbounded retry loop.
7. **Out-of-order payment events** (webhook confirmations arriving out of
   the sequence the local state machine expects) are handled by
   `payment_events.requires_review`, detailed above (§3, `payment_events`)
   and expanded further in §3.2 below — not duplicated here.

### 3.2 Webhook Manual Review & Lifetime Duplicate-Refund Protection

**Who can review and resolve a `requires_review` event:** only
`admin`/`owner` (not plain `staff`) — this is a financially-sensitive
decision (it can cause `orders.payment_status` to change), gated the same
way other admin-tier financial actions are (coupons, store settings; see
[SECURITY_PLAN.md](./SECURITY_PLAN.md) §3).

**Resolution requires an audited `SECURITY DEFINER` RPC —
`resolve_payment_event(event_id, action, resolution_notes)` — never a
direct `UPDATE` on `payment_events` from the admin UI.** It:
1. Checks `has_role_at_least('admin')`.
2. Reads the existing `payment_events` row by `event_id`. **It does not
   `INSERT`** — the row already exists from when the event was first
   received (that's what triggered `requires_review = true` in the first
   place); the unique constraint on `(provider, provider_event_id)` is
   therefore never re-tested during resolution, because resolution never
   attempts a second insert for the same event. This directly answers
   "how does the unique provider event constraint interact with manual
   resolution": it doesn't need to — insertion and resolution are
   different operations on the same row, not two inserts.
3. **Checks `effect_applied_at IS NULL` before doing anything else.** If
   it's already set, the RPC returns success without reapplying the
   effect — this is what makes resolution itself idempotent (safe to call
   twice, whether by a genuine retry or an admin double-clicking a
   button), and is the direct answer to "how the system prevents the same
   event from being applied twice" even through the manual path.
4. If `action = 'apply'`: applies the event's business effect (e.g. the
   `orders.payment_status` update the event implies) and, **in the same
   transaction**, sets `effect_applied_at = now()`, `requires_review =
   false`, `reviewed_by = auth.uid()`, `reviewed_at = now()`, and the
   required `resolution_notes`. Effect and bookkeeping commit together or
   not at all — the same atomicity principle used for automatic
   processing (§3, `payment_events`) applies here too.
5. If `action = 'reject'`: no business effect is applied; the row is
   still updated with `requires_review = false`, `reviewed_by`,
   `reviewed_at`, `resolution_notes` (recording *why* it was rejected —
   e.g. "duplicate of event X, already applied manually") — `
   effect_applied_at` stays `NULL` permanently for a rejected event, which
   is intentional and distinguishes "resolved, no action needed" from
   "resolved, action taken."

**Lifetime duplicate-refund protection does not come from the partial
unique index alone** — the audit brief specifically asked this not be
assumed, and on inspection it's correct to flag: the index
`UNIQUE (order_id) WHERE status IN ('pending','in_flight','provider_accepted')`
on `refund_requests` only ever prevents *overlapping* requests; it has
nothing to say about a *new* request created after an earlier one already
finished. The actual lifetime guarantee is the **second** partial unique
index introduced in §3 above — `UNIQUE (order_id) WHERE status =
'succeeded'` — which makes a second successful refund for the same order
a constraint violation regardless of how much time has passed or how many
`failed` attempts came before it. Put together: an order can accumulate
any number of `failed` refund-request rows (each one a legitimate,
explicit retry), but can never have more than one `succeeded` row, ever.
**A new refund request after a previous attempt is allowed if and only
if every prior `refund_requests` row for that order has `status =
'failed'`** (checked naturally by the two indexes together — a `pending`/
`in_flight`/`provider_accepted` row blocks it via the first index, a
`succeeded` row blocks it via the second, and `failed` rows block
nothing) — never after a `succeeded` one, and creating that new row is
itself gated behind the explicit admin "retry refund" action referenced
above, not an automatic process.

## 4. Discounts

### `coupons`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| code | text, unique | |
| type | enum('percentage','fixed_amount','free_shipping') | |
| value | numeric(10,2) | |
| min_order_amount | numeric, nullable | |
| usage_limit | int, nullable | total redemptions allowed |
| usage_limit_per_customer | int, nullable | |
| starts_at / expires_at | timestamptz, nullable | |
| is_active | boolean | |

### `coupon_redemptions`
coupon_id, order_id, customer_id, redeemed_at — used to enforce per-customer
limits and provide admin visibility into coupon performance.

## 5. Admin & Content Tables

### `homepage_sections`
id, type (enum: hero, featured_categories, featured_products, editorial_banner),
title, display_order, is_active — lets admin compose the homepage without
a deploy.

### `homepage_section_items`
section_id, ref_type (product/category/custom), ref_id nullable, custom_payload
jsonb (for banners with custom copy/image/link), display_order.

### `store_settings`
Singleton row (or key-value table) for store-wide config: currency,
tax rate, shipping rules, low-stock default threshold, contact info, social
links. Key-value (`key text PK, value jsonb`) is preferred over a wide
singleton row — easier to extend without migrations.

## 6. Indexing Strategy (for 1,000+ products)

- `products(slug_ar)`, `products(slug_en)` unique indexes — product detail
  lookups per locale.
- `categories(slug_ar)`, `categories(slug_en)` unique indexes.
- `product_categories(category_id)` — category listing queries.
- `product_variants(product_id)`, `product_variants(sku)` unique.
- Unique index on `product_variants(product_id, attribute_value_ids)` —
  duplicate-combination prevention (§2.3); Postgres indexes array columns
  for equality/ordering the same way as scalar columns, so this works
  exactly like any other unique index.
- Composite index on `product_variants(product_id, is_active, stock_quantity)`
  for in-stock/price-range aggregation.
- `orders(customer_id, placed_at desc)` — order history pages.
- `orders(status)`, `orders(payment_status)` — admin order queue filtering
  on either dimension independently.
- Unique index on `payment_events(provider, provider_event_id)` — duplicate
  webhook protection (§3, `payment_events`).
- Partial unique index on `refund_requests(order_id)` where
  `status IN ('pending','in_flight','provider_accepted')` — prevents a
  second *concurrent* refund request per order.
- Partial unique index on `refund_requests(order_id)` where
  `status = 'succeeded'` — prevents a second *lifetime* successful refund
  per order (§3.2) — distinct from the index above, not a duplicate of it.
- `refund_requests(status, next_retry_at)` — supports the outbox worker's
  claim query (§3, `refund_requests`), which filters on `status` plus
  retry/lease timing.
- `pending_image_uploads(status)` — supports the admin UI's poll/
  subscribe query for upload progress, and the cleanup job's search for
  stuck/orphaned rows (§2, `pending_image_uploads`).
- Unique index on `pending_image_uploads(storage_event_id)` (nullable,
  so only non-null values are constrained) — duplicate Storage-event
  delivery protection (§2, `pending_image_uploads`).
- `guest_merge_attempts` needs no additional index beyond its
  `anonymous_user_id` primary key — that one column is both the lookup
  key and the concurrency mutex (§3.1).
- Full-text search index (`tsvector` generated column) on
  `products(name_ar, description_ar)` and a separate one on
  `products(name_en, description_en)` — **two indexes, not one**, since
  Postgres full-text search configs are language-specific (Arabic
  stemming/stopwords differ from English) and a single combined `tsvector`
  would degrade relevance in both languages.

## 7. Aggregation Strategy — Maintained Table, Not a Materialized View

**Revised from the original proposal.** The original design proposed a
materialized view refreshed via `REFRESH MATERIALIZED VIEW CONCURRENTLY`
after writes, including "refreshed via trigger" — doing a concurrent
materialized-view refresh *inside* the same trigger/transaction that wrote
the underlying row is not supported by Postgres (a `REFRESH ... CONCURRENTLY`
cannot run inside the transaction that's also modifying the view's source
tables, and a plain `REFRESH` takes a lock that blocks reads of the view
for its duration — unacceptable for a live storefront).

**Resolved approach: `product_listing_summary` is a real table**, not a
view, maintained by an `AFTER INSERT/UPDATE/DELETE` trigger on
`product_variants` (and `products`, for name/status changes) that performs
an `UPSERT` of just the affected product's summary row — min/max variant
price, aggregate in-stock boolean, primary image path, average rating —
computed from a scoped subquery over that one product's variants, not a
full-table recomputation.

**Why this over the alternatives:**

| Option | Consistency | Write cost | Read cost | Verdict |
|---|---|---|---|---|
| Plain (non-materialized) view | Always consistent (computed live) | None | Pays the aggregation cost on every listing-page read, across 1,000+ products | Too slow at catalog scale — this is exactly the N+1-shaped cost the view was meant to avoid |
| Materialized view, periodically refreshed | Eventually consistent (stale between refreshes) | Cheap (batched) | Fast | Acceptable for analytics, **not** for "admin just changed the price/stock and expects the listing page to reflect it," and `CONCURRENTLY` refresh can't safely run inside the write's own transaction |
| **Maintained table, trigger-upserted per affected row (chosen)** | Consistent as of the triggering transaction's commit — no refresh lag | Small, scoped to the one product that changed, paid on write (which is rare relative to reads) | Fast — same shape as a materialized view | Correct consistency guarantee (no stale window) at a write cost that's negligible given reads vastly outnumber writes in a storefront |

Listing, search, and category pages query `product_listing_summary`
instead of joining variants live — avoiding the N+1 pattern across
1,000+ products on every listing-page render — with the same read
performance as a materialized view but without its staleness window or its
unsafe-refresh-timing problem.

## 8. Row Level Security (Summary — full detail in SECURITY_PLAN.md)

- `products`, `categories`, `category_attributes`, `attributes`,
  `attribute_values`, `product_variants`, `product_images`,
  `product_listing_summary`: public `SELECT` where `status = 'active'`
  (products) or unconditionally (reference/lookup tables);
  `INSERT/UPDATE/DELETE` restricted to `staff`/`admin`/`owner` roles.
  `product_listing_summary` is additionally **never writable by any client
  role** — it is written only by its maintaining trigger (`SECURITY
  DEFINER`), never by direct `INSERT/UPDATE` from app code.
- `carts`, `cart_items`, `wishlists`, `wishlist_items`, `comparisons`,
  `comparison_items`: **one uniform policy** —
  `customer_id = auth.uid()` — with no guest/customer branch, since guests
  are real (anonymous) `auth.uid()` holders (§3). This is the main
  simplification from the guest-cart redesign in
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §B.
- **No `guest_merge_tickets`-equivalent (ownership-proof) table exists** —
  guest-identity merge is verified via two independently-checked session
  tokens inside a service-role Edge Function. **`guest_merge_attempts`
  does exist**, for a different purpose (concurrency/recovery
  coordination, not ownership proof): no client role has any access to
  it at all — written and read only by the merge Edge Function and its
  reconciliation sweep, both service-role. See §3.1 and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §2.1 item 4.
- `pending_image_uploads`: `staff`/`admin`/`owner` may `INSERT` a row for
  their own upload intent (`uploaded_by = auth.uid()`, status
  `initiated`) and `SELECT` their own rows (for upload-progress
  polling); `UPDATE` of `status`/`rejection_reason`/`public_path`/
  `storage_event_id` only by the service-role validating Edge Function
  and its reconciliation sweep — no role can mark their own upload
  `published`/`approved` directly. See §2, `pending_image_uploads`, and
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §6.1.
- `orders`, `order_items`, `order_status_history`: customers can `SELECT`
  only their own (`customer_id = auth.uid()` on `orders`, joined for the
  other two); staff/admin/owner can see all. No role may directly `INSERT`
  into `orders`/`order_items` — creation only through the order-placement
  RPC (`SECURITY DEFINER`, runs the stock-check/decrement/total-calculation
  transaction). `payment_status` is additionally unwritable by
  staff/admin/owner through normal `UPDATE` — only the webhook Edge
  Function (service role) can change it.
- `payment_events`: no `SELECT`/`INSERT`/`UPDATE`/`DELETE` for `customer`
  or `staff`. `admin`/`owner` may `SELECT` (needed to review flagged
  events) and may call `resolve_payment_event(...)` (§3.2) — but have
  **no direct `UPDATE` grant** on the table itself; resolution only
  happens through that `SECURITY DEFINER` RPC, which is what actually
  performs the write (with `has_role_at_least('admin')` checked inside
  it, per [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3.1–3.2). The automatic
  (non-flagged) insert-and-apply path remains service-role only.
- `refund_requests`: staff/admin/owner may `SELECT` (to show "refund
  pending/failed" status in the admin order view); `INSERT` only via the
  `cancel_order`/refund-retry RPC (`SECURITY DEFINER`); `UPDATE` of
  `status`/`claimed_by`/`claimed_at`/`lease_expires_at`/`attempt_count`/
  `next_retry_at`/`provider_accepted_at`/`provider_refund_id`/`last_error`
  only by the service-role outbox worker — staff/admin cannot directly
  mark a refund `succeeded`/`provider_accepted` from the UI, only request
  one or request a retry after `failed` (consistent with
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §5.1).
- `profiles`: a user can read/update their own row, **except** `role` and
  `is_anonymous`, which are excluded from the self-update policy's allowed
  columns (column-level security via a restrictive policy or a trigger
  that rejects a role change from a non-privileged caller — not merely "the
  UI doesn't expose a role field"); only `admin`/`owner` can change `role`.
- `coupons`: public can validate a code via a restricted RPC (not direct
  table `SELECT`, to avoid leaking all active codes); full management is
  staff/admin/owner only. `coupon_redemptions` follows the same
  `customer_id = auth.uid()`-for-own-rows pattern as orders.
- `store_settings`, `homepage_sections`, `homepage_section_items`: public
  `SELECT`, write restricted to `admin`/`owner` (not `staff` — homepage
  content and store settings are an admin-tier action per
  [SECURITY_PLAN.md](./SECURITY_PLAN.md) §3).
- **Owner access is verified to compose correctly**: every policy above
  written as `role IN ('staff','admin','owner')` or a tighter subset is
  checked to confirm `owner` is included in every permission `admin` has,
  plus staff-account management — a role hierarchy helper
  (`has_role_at_least(role)`) is used in policies instead of repeating
  `IN (...)` lists, so adding a new tier later can't accidentally omit
  `owner` from an existing policy the way a copy-pasted list might. See
  [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) §C.

## Internal (admin-only) pricing — migration 0007

`public.product_internal_pricing (product_id, wholesale_price)` holds the
admin-only **wholesale price**. It is deliberately NOT a field of
`catalog_docs.data`: `catalog_docs` rows are world-readable when visible and RLS
is per row, so any field inside a product document is served to every visitor.

- Read: admins only (RLS `is_admin()`); `anon` has no privileges on the table.
- Write: only via `catalog_write_product(p_ops, p_wholesale)` (SECURITY
  DEFINER, `is_admin()` checked). It wraps the unchanged `catalog_write` and the
  wholesale upsert in one transaction, so the product (with its revision check)
  and its price are saved together or not at all. The form uses it only when the
  wholesale value actually changed; all other writes still call `catalog_write`.
- Deleting a product cascades to its wholesale price.
- Rule: never put wholesale/internal pricing in `catalog_docs.data`, orders,
  or any storefront code path (guarded by `wholesaleExposure.test.ts`).

## In-store orders — migration 0008

Staff can record walk-in sales on the **existing** `public.orders` table (no
separate order system). `supabase/migrations/0008_in_store_orders.sql` adds:

| Change | Detail |
|---|---|
| `orders.source` | `text not null default 'online'`, `check in ('online','in_store')`. Persisted — never inferred from customer data or status. Existing rows become `online` through the default. |
| `orders.note` | nullable `text`, max 1000 characters. |
| status `sold` («تم البيع») | Added to `orders_status_check`. `orders_source_status_check` ties it together: `online` ⇒ any status except `sold`; `in_store` ⇒ only `sold` or `cancelled`. In-store orders can therefore never enter a shipping status. |
| Insert policy | `"public can insert pending orders"` narrowed to `status='pending' AND source='online'`. New `"admins can insert in-store orders"`: `is_admin() AND source='in_store' AND status='sold'`. Direct client insert, no RPC. |
| `validate_in_store_order()` (BEFORE INSERT) | Re-checks admin; delivery must be `in_store`; 1–100 lines; integer qty 1–999; every line a real product (and variant) at its **current retail price** (`catalog_docs.data.price`, variant price falling back to the product price); `subtotal = total = Σ price×qty`; no `wholesale` key anywhere in lines/contact. A forged price/total raises `22023 invalid_in_store_order` (detail `price_mismatch` / `total_mismatch`). |
| `guard_order_update()` (BEFORE UPDATE) | `source` is immutable; an in-store order's lines, subtotal, total and contact are frozen. Status and note stay editable. |
| `enqueue_order_email()` | Same as 0005 plus: an `in_store` order is always queued as `skipped` (`last_error = 'in_store_order'`), so no customer e-mail is ever sent for it, even if an address were stored. |

Wholesale pricing (`product_internal_pricing`, 0007) is neither read nor written
by this migration, and its values never appear in an order.

Deploy order: apply `0008` **before** deploying the app version that records
in-store sales. The order list falls back to the legacy columns if `source`/`note`
do not exist yet (every order then shows as online), but «إضافة طلب» needs the
migration. Online checkout works before and after it (it never sends `source`).
Requires 0001, 0003, 0005 and 0006 — a pre-flight check at the top of the file aborts, changing nothing, if any is missing; safe to re-run. **Never re-apply 0005 after 0008**: it redefines `enqueue_order_email()` without the in-store suppression (re-run 0008 right after if you must). Rollback is in the file's
trailing comment (delete in-store orders first).

## Inventory — migration 0009 (phase 1, local only, not applied anywhere)

One warehouse, product-level quantity (all variants of a product share one
balance), admin-only. `supabase/migrations/0009_inventory.sql` adds tables and
admin operations ONLY. **It does not touch `public.orders`** (no trigger, policy,
column, or function redefinition — asserted by a catalog-snapshot test) and
deducts nothing: deduction on delivery / in-store sale is the later, separate
`0010_inventory_orders.sql`. Order creation, delivery and every status behave
exactly as before 0009.

| Object | Purpose |
|---|---|
| `stock_levels` | One row per product with an **explicitly initialized** balance (zero counts). `product_id` is text with **no foreign key** to the catalog, so a deleted product keeps its balance and ledger (name/SKU snapshot stored). `low_threshold` per product. |
| `stock_movements` | Append-only ledger: `opening`, `receipt`, `sale`, `sale_accounted`, `return_restock`, `return_damaged`, `adjustment`. Each row: `quantity`, `qty_delta`, `qty_before`, `qty_after`, reason, optional reference/order, actor (`auth.uid()` + e-mail snapshot), timestamp, `idempotency_key`. UPDATE/DELETE/TRUNCATE are rejected by trigger (even for the owner). Constraints encode the rules (e.g. `return_damaged` => `qty_delta = 0`, `qty_before = qty_after`). |
| `inventory_order_decisions` | Append-only, order-level reconciliation decisions (`deduct_on_delivery`, `already_accounted`, and `settled_legacy` = a historical classification, **not** a switch) bound to a `lines_hash`. |
| `stock_override_grants` | Audit rows for explicit shortage overrides; one row per product **per attempt** (`unique (attempt_key, product_id)`), consumable exactly once. Created/consumed by 0010's RPCs. |

Privacy: no quantity is stored in `catalog_docs`. All four tables are readable
by admins only (RLS `is_admin()`); `anon`/`authenticated` have no INSERT/UPDATE/
DELETE/TRUNCATE (the explicit `revoke` matters because Supabase grants new
tables by default). Every change goes through SECURITY DEFINER functions that
check `is_admin()` first. Wholesale pricing (0007) is untouched; purchase cost is
not modelled.

Admin operations: `inventory_set_opening`, `inventory_import_opening` (dry run by
default, never overwrites, never zero-fills products missing from the batch),
`inventory_adjust` (to a counted quantity >= 0), `inventory_receive` (stock in —
no supplier, no cost), `inventory_record_return` (the admin **must** choose
resaleable or damaged; a damaged return is recorded with delta 0 and never
increases `on_hand`; a linked return cannot exceed the quantity sold),
`inventory_set_threshold`, `inventory_init_removed_product`,
`inventory_decide_order`, `inventory_preflight_report`, `inventory_reconcile`,
`inventory_reconcile_summary`. Errors: `42501` forbidden, `22023`
`inventory_invalid` (reason in DETAIL), `IS001` `stock_not_initialized`, `IS005`
`idempotency_key_reuse` (`IS002`-`IS004` are reserved for 0010).

**Order-history audit.** `order_status_history` is not assumed complete.
`inventory_preflight_report()` (read-only, one row per order and product)
classifies each order `clean_settled`, `in_flight` or `ambiguous` and lists the
issue codes (`NO_HISTORY`, `FIRST_STATUS_UNEXPECTED`, `LAST_STATUS_MISMATCH`,
`DELIVERED_WITHOUT_ROW`, `DUPLICATE_CONSECUTIVE`, `TIMESTAMP_TIE`,
`TIMESTAMP_RANGE`, `REENTERED_DELIVERED`, `UNKNOWN_STATUS`, `LINES_UNPARSEABLE`).
An ambiguous order is never deducted or ignored automatically: it needs an
explicit decision.

**What a clean reconciliation is.** `inventory_reconcile()` returns one row per
problem (`code`, `severity`, `category`). It is **clean when there is no `error`
row in any category** (`inventory_reconcile_summary().clean`). It checks:
balance = sum of ledger deltas and the last row ends at `on_hand`; an unbroken
`qty_before`/`qty_after` chain starting at exactly one opening; arithmetic;
no orphan movements or opening-less balances; movements point at existing
orders; sales match order lines and appear once; linked returns do not exceed
the quantity sold; override grants are consumed exactly once and match their
movement; decisions are not stale; and **coverage** — every catalog product has
an initialized balance and so does every product of an unsettled order,
including products deleted from the catalog. Warnings/info (e.g. a balance for
a removed product) are listed but do not make it unclean. The checks that every
delivered/sold order was actually deducted are added by 0010 together with the
deduction triggers.

**Pre-flight guard** (the first statement; aborts before any change, naming each
failing item): `orders` and `order_status_history` (0001), `touch_updated_at()`
(0001), `is_admin()` (0003), `catalog_docs` and `app_settings` (0006), `orders.source`
(0008); the catalog is **migrated** — `app_settings.catalog_initialized` must be the
object `catalog_mark_initialized()` writes (`{"at": ..., "by": ...}`; `null`, `{}`,
arrays, strings or a blank/absent `"at"` do not qualify) **and** at least one valid
product exists (`kind = 'product'` with a `sku` and an Arabic `name`); and
`PUBLIC`, `anon` and `authenticated` must have no `CREATE` on schema `public` or
`auth` (the SECURITY DEFINER functions pin `search_path = public` and call
`auth.uid()`/`auth.jwt()`). The migration **never changes privileges itself**; the
diagnostic names the offending grant and the owner decides. Before applying, the
owner can check: `select r, s, has_schema_privilege(r, s, 'CREATE') from
unnest(array['public','anon','authenticated']) r, unnest(array['public','auth']) s;`
(all `false`). Re-runnable. Rollback (only before 0010): the comment at the end of
the file — export the ledger first.

**Hardening.**
- *Idempotency keys* (adjust / receive / return) are optional and must match
  `^[A-Za-z0-9._-]{1,128}$` (ASCII; no spaces, no `:`). `:` is reserved for system
  keys (`opening:<id>`, and in 0010 `sale:`/`accounted:`/`grant:`), so user and
  system keys can never collide; system keys do not pass through that validator.
  Reusing a key returns the original result **only** if the whole request matches
  (product, operation, quantity/count, return classification, linked order, reference,
  reason); otherwise `IS005 idempotency_key_reuse` naming the differing fields.
- *Snapshots*: `product_name`/`product_sku` are refreshed from the catalog on every
  ledger write while the product exists; a deleted product keeps its last snapshot, and
  a blank catalog value never erases a stored one.
- *Privileges*: `service_role` keeps `SELECT` only on the four tables (all changes run
  through the SECURITY DEFINER functions, which need nothing from it; nothing in the
  application writes these tables). No API role has any privilege on the ledger's
  identity sequence. No inventory function is executable by `PUBLIC`, `anon` or
  `service_role`; `authenticated` can execute only the eleven admin operations (each
  checks `is_admin()` first). Every SECURITY DEFINER function pins `search_path = public`
  and schema-qualifies every application object, so look-alike temp objects cannot
  redirect it.
- *`inventory_actor_email`* tolerates only a missing `auth.jwt()` or malformed claims;
  any other error propagates.

### Inventory — concurrency verification status

**UNVERIFIED.** (Hardening did not change this.) The migration's tests run on PGlite, which has a single
connection, so races between simultaneous transactions are **not** exercised:
row-lock serialization of two operations on the same product, parallel retries
with the same idempotency key, and concurrent returns against the same order's
cap. The design relies on `SELECT ... FOR UPDATE` of the `stock_levels` row and
on unique constraints, but those guarantees have **not been demonstrated**.
Docker and the Supabase CLI were not available in the development environment
(`docker`, a local PostgreSQL and the Supabase CLI were all missing), so no
multi-connection test could be run. Before 0010 (which adds delivery
deductions) a multi-connection suite against a disposable local PostgreSQL must
be written and run; production must never be used for it.

## Inventory — migration 0010 (phase 2: stock deduction from orders; local only, not applied anywhere)

`supabase/migrations/0010_inventory_orders.sql`. **Applying it is the activation** —
there is no flag and no go-live timestamp. Requires 0001, 0003, 0005, 0006, 0008 (with its
e-mail suppression intact; the file refuses otherwise) and 0009. Re-runnable.

**Activation guard (first statement, fails closed).** Aborts before any change, naming
each item, unless the reconciliation is complete: no `inventory_activation_blockers()`
row (every catalog product — and every product of an unsettled order, including deleted
ones — has an explicit opening balance; every in-flight/ambiguous order has a current,
unstale explicit decision; no integrity error). On the first install every pre-existing
clean finished order gets a `settled_legacy` decision (a historical classification, not a
switch; `decided_by` null).

**Triggers on `public.orders`** (all `SECURITY DEFINER`, `search_path = public`):

| Trigger | Fires | Effect |
|---|---|---|
| `orders_inventory_insert` | after insert | `source = 'in_store'` and `status = 'sold'`: deducts in the same transaction as the insert. Cancelled in-store inserts and all online inserts deduct nothing. |
| `orders_inventory_status` | after update of status, `when (new.status = 'delivered' and old.status is distinct from new.status)` | Online order entering `delivered`: deducts. Any other transition, including leaving `delivered`/cancelling afterwards, deducts or reverses nothing (returns are separate). |
| `orders_inventory_lines_guard` | before update of lines | `IS004` once any `sale`/`sale_accounted`/return movement exists for the order. |

Deduction (`inventory_apply_order`): quantities are **summed per product across variants**;
locks are taken `orders` row first, then `stock_levels` rows in sorted `product_id` order
(deadlock avoidance — unverified under real concurrency); every movement uses the system
key `sale:<order>:<product>` (unique), so retries / repeated transitions / re-delivery never
deduct twice. Legacy orders follow their decision: `deduct_on_delivery` deducts,
`already_accounted` writes a `sale_accounted` audit movement (delta 0), `settled_legacy`
re-entering `delivered` raises `IS003`. The whole statement rolls back on any refusal (no
order change, no partial deduction).

Refusals: `IS001` product has no opening balance · `IS002` insufficient stock (DETAIL =
JSON `[{product_id, requested, available, shortfall}]`) · `IS003` legacy decision required ·
`IS004` lines locked · `IS006` lines are not valid product/quantity lines · `IS007`
override shortfall changed · `IS009` override grant unused · `IS005` attempt key reused for
a different request · `CF001` status changed under the caller.

**Shortage override** — only `inventory_deliver_order_override(order, expected_status,
attempt_key, confirmed_shortfall, reason)` and `inventory_create_in_store_order_override(
order_json, attempt_key, confirmed_shortfall, reason)`; admin only (`authenticated`
execute; `PUBLIC`/`anon`/`service_role` revoked), reason >= 5 characters, bound to the
exact shortfall the admin saw, one `stock_override_grants` row per product **per attempt**,
consumed once in the same transaction (`stock_movements.override_grant_id`, `override`,
`shortfall`). It does **not** bypass unknown products, uninitialized balances, prices,
totals or status validation. A replay of the same attempt returns `replayed`.

`inventory_reconcile_rows()` is extended with `MISSING_SALE`, `LEGACY_DELIVERED_WITHOUT_MOVEMENT`
and `DECISION_VIOLATED` (delivered/sold orders really were deducted, exactly once, matching
their lines). `0009`'s `inventory_decide_order` additionally refuses a decision for an
order created after the integration exists (otherwise an admin could switch deduction off).
Re-running 0009 after 0010 restores the base reconcile: re-run 0010 straight after.

Unchanged by 0010: checkout, status transitions, `order_status_history`, the e-mail outbox
and the 0008 in-store suppression, RLS on `orders`.

Rollback (comment at the end of the file; **not automatic**): drops the three triggers and
the 0010 functions; ledger, balances, decisions and grants are kept; stock already deducted
is not restored (reconcile by hand with adjustments).

**Verification status.** Real-Postgres (PGlite) tests: `supabase/tests/inventory.orders.test.ts`.
Concurrency: **UNVERIFIED** (see above); the multi-connection suite exists but has never
been run.

**Attempt-key serialization (0010 hardening).** Both override RPCs take
`pg_advisory_xact_lock(hashtextextended('inventory_override:' || attempt_key, 0))` before any
check that depends on attempt-key uniqueness. Without it, `unique (attempt_key, product_id)` only
collides when two attempts share a product, so two concurrent requests with one key on different
orders could both pass the replay check and leave one key bound to two orders. Lock order:
advisory lock -> `orders` row -> `stock_levels` rows in `product_id` order; non-override paths
never take the advisory lock, so no cycle exists by construction. A hash collision between two
different keys only makes them wait for each other. PGlite tests prove the lock is taken and a
key cannot be re-bound; that it serializes real racing connections is **UNVERIFIED** until
scenario 4 of `supabase/tests/concurrency/inventory.concurrency.ts` runs.
