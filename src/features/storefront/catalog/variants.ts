import { generateId } from '../../shared/utils/id';
import type { AttributeDef } from './attributeStore';
import type { Availability, CatalogProduct, ProductVariant } from './catalogData';
import type { GuestOrder, OrderLine } from '../checkout/orderStore';

// PRODUCT VARIANT CORE — pure business logic for the variant data model.
// No React and no storage access: every helper takes plain data in and
// returns plain results, so the same rules drive catalog migration, admin
// validation, media/order reference scans, and later the storefront
// variant selectors and cart guards.
//
// Invariants enforced here:
//   • 1–3 variation axes per product, each a variation-capable attribute
//     applicable to the product's category.
//   • Every variant combo covers every configured axis exactly once;
//     normalized combos never repeat inside a product.
//   • At most 60 purchasable combinations per product.
//   • price / compareAtPrice = null inherit the product-level values.
//   • Availability is a manual per-variant field — no numeric inventory.
//   • SKU uniqueness is global across product-level and variant-level SKUs.

export const MAX_VARIANT_AXES = 3;
export const MAX_VARIANT_COMBINATIONS = 60;

// ---- identity --------------------------------------------------------------

// New variants get a random UUID assigned once at creation. The id lives on
// the stored record, so editing unrelated product fields never regenerates
// it — that stability is what keeps order references and media scans valid.
export function newVariantId(): string {
  return generateId();
}

export function variantById(
  product: Pick<CatalogProduct, 'variants'>,
  variantId: string,
): ProductVariant | undefined {
  return product.variants?.find((v) => v.id === variantId);
}

// True when the product actually sells combinations — axes configured and at
// least one stored variant. A product with neither is a simple product.
export function isVariantProduct(p: CatalogProduct): boolean {
  return (p.variantAxes?.length ?? 0) > 0 && (p.variants?.length ?? 0) > 0;
}

// ---- combinations ----------------------------------------------------------

// Normalized combination key: axis keys sorted, serialized as JSON pairs so
// the output is deterministic and unambiguous regardless of the characters
// inside keys/values (a plain `k=v&k=v` join could collide if a value ever
// contained a separator).
export function comboKey(combo: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(combo)
      .sort()
      .map((k) => [k, combo[k]]),
  );
}

export function combosEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  return comboKey(a) === comboKey(b);
}

// Structural axis check: 1–3 distinct axis keys. Attribute existence/scope
// is validated separately by validateProductVariants.
export function validVariantAxes(axes: string[]): boolean {
  return (
    axes.length >= 1 &&
    axes.length <= MAX_VARIANT_AXES &&
    new Set(axes).size === axes.length
  );
}

// A combo is complete when it covers every axis exactly once — same key set
// as the axis list, no extras, no empty values.
export function comboComplete(
  combo: Record<string, string>,
  axes: string[],
): boolean {
  return (
    Object.keys(combo).length === axes.length &&
    axes.every((a) => typeof combo[a] === 'string' && combo[a] !== '')
  );
}

// Every combo value key must be defined on its attribute. Disabled values
// still count as defined — a stored variant referencing a since-disabled
// value stays valid, matching how product attribute assignments behave.
export function comboValuesValid(
  combo: Record<string, string>,
  attrs: AttributeDef[],
): boolean {
  return Object.entries(combo).every(([axis, valueKey]) => {
    const attr = attrs.find((a) => a.key === axis);
    return attr !== undefined && attr.values.some((v) => v.key === valueKey);
  });
}

// Whether every combo value is currently selectable — its attribute is
// enabled AND the specific value is enabled. An otherwise-active variant
// whose combo touches a disabled attribute/value can no longer be newly
// selected on the PDP (see sellableVariantAxes/offeredAxisValues below), and
// an existing cart line that already resolved to it must be blocked rather
// than silently staying purchasable — this single check drives both.
export function comboValuesEnabled(
  combo: Record<string, string>,
  attrs: AttributeDef[],
): boolean {
  return Object.entries(combo).every(([axis, valueKey]) => {
    const attr = attrs.find((a) => a.key === axis);
    return (
      attr !== undefined &&
      attr.enabled &&
      attr.values.some((v) => v.key === valueKey && v.enabled)
    );
  });
}

export function axisAppliesToCategory(
  attr: AttributeDef,
  categorySlug: string,
): boolean {
  return attr.categories.length === 0 || attr.categories.includes(categorySlug);
}

export function hasDuplicateCombos(variants: ProductVariant[]): boolean {
  const seen = new Set<string>();
  for (const v of variants) {
    const k = comboKey(v.combo);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

export function hasDuplicateVariantIds(variants: ProductVariant[]): boolean {
  const seen = new Set<string>();
  for (const v of variants) {
    if (seen.has(v.id)) return true;
    seen.add(v.id);
  }
  return false;
}

// Theoretical number of purchasable combinations for the selected axis
// values — zero when any axis has nothing selected.
export function combinationCount(
  axes: string[],
  selections: Record<string, string[]>,
): number {
  return axes.reduce((n, a) => n * (selections[a]?.length ?? 0), 1);
}

// Cartesian product of the selected values per axis, in stable axis/selection
// order. Returns null when the axes are structurally invalid, any axis has
// no selected values, or the result would exceed the 60-combination cap —
// callers must reduce selections rather than ship a partial matrix.
export function generateVariantCombos(
  axes: string[],
  selections: Record<string, string[]>,
): Record<string, string>[] | null {
  if (!validVariantAxes(axes)) return null;
  if (axes.some((a) => (selections[a]?.length ?? 0) === 0)) return null;
  if (combinationCount(axes, selections) > MAX_VARIANT_COMBINATIONS) return null;
  const combos: Record<string, string>[] = [];
  const walk = (depth: number, acc: Record<string, string>) => {
    if (depth === axes.length) {
      combos.push({ ...acc });
      return;
    }
    const axis = axes[depth];
    for (const value of selections[axis]) {
      acc[axis] = value;
      walk(depth + 1, acc);
    }
  };
  walk(0, {});
  return combos;
}

export function variantByCombo(
  product: CatalogProduct,
  combo: Record<string, string>,
): ProductVariant | undefined {
  const key = comboKey(combo);
  return product.variants?.find((v) => comboKey(v.combo) === key);
}

// Rebuilds each axis's selected-value list from the stored variants — kept
// for diagnostics/backfill (e.g. surfacing combos whose values fell out of
// the product's own fields on reopen).
export function deriveAxisSelections(
  axes: string[],
  variants: ProductVariant[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const axis of axes) {
    const seen = new Set<string>();
    for (const v of variants) {
      const val = v.combo[axis];
      if (typeof val === 'string' && val !== '') seen.add(val);
    }
    out[axis] = [...seen];
  }
  return out;
}

// ---- axis values sourced from product fields --------------------------------

// Reserved attribute keys map to dedicated legacy product fields; every
// other axis sources its selected values from the product's custom
// `attributes` assignments. This makes the form's existing selections
// (الخيارات والحالة + السمات المخصصة) the single source of truth for
// variation values — the matrix never re-asks for them.
const RESERVED_AXIS_FIELDS: Record<string, 'colors' | 'materials' | 'sizes'> = {
  color: 'colors',
  material: 'materials',
  size: 'sizes',
};

export interface AxisValueSource {
  colors: readonly string[];
  materials: readonly string[];
  sizes: readonly string[];
  attributes?: Record<string, readonly string[]>;
}

// Selected values for one axis, straight from the product's own fields.
// Only enabled attribute values participate in NEW combination generation;
// a disabled-but-still-selected value stops generating (its stored variants
// are retained inactive by syncVariantMatrix). Output is deduped.
export function axisProductValues(
  axis: string,
  product: AxisValueSource,
  attr?: Pick<AttributeDef, 'values'>,
): string[] {
  const field = RESERVED_AXIS_FIELDS[axis];
  const raw = field !== undefined ? product[field] : (product.attributes?.[axis] ?? []);
  const enabled = attr
    ? new Set(attr.values.filter((v) => v.enabled).map((v) => v.key))
    : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    if (seen.has(k) || (enabled !== null && !enabled.has(k))) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// Resolved per-axis selections for every configured axis — the direct input
// to generateVariantCombos / syncVariantMatrix in the admin form.
export function axisValuesForAxes(
  axes: string[],
  product: AxisValueSource,
  attrs: AttributeDef[],
): Record<string, string[]> {
  return Object.fromEntries(
    axes.map((a) => [
      a,
      axisProductValues(a, product, attrs.find((x) => x.key === a)),
    ]),
  );
}

// Deterministic SKU suggestion for a NEW combo — `<productSku>-<v1>-<v2>` in
// sorted axis order, with a numeric suffix when the stem collides. Existing
// SKUs are never rewritten by this helper.
export function suggestVariantSku(
  baseSku: string,
  combo: Record<string, string>,
  isTaken: (sku: string) => boolean,
): string {
  const values = Object.keys(combo)
    .sort()
    .map((k) => combo[k])
    .join('-');
  const stem = `${baseSku.trim() || 'V'}-${values}`;
  let candidate = stem;
  let i = 2;
  while (isTaken(candidate)) candidate = `${stem}-${i++}`;
  return candidate;
}

export interface VariantSyncResult {
  // Generated combos first (in deterministic generation order), then
  // retained-inactive orphans.
  variants: ProductVariant[];
  added: ProductVariant[];
  // Stored variants whose combo is no longer generated — kept, deactivated,
  // never physically deleted (order references may point at them).
  retainedInactive: ProductVariant[];
}

// Merges a freshly generated combination matrix into stored variants.
// Matched by normalized combo key: matches keep every stored field verbatim
// (id, SKU, price overrides, availability, image, active state);
// genuinely new combos get records from `create`; dropped combos stay stored
// but inactive. Returns null when generation itself is invalid (>60 combos,
// empty selections, bad axes) — the caller shows the limit/validation
// message and keeps the current matrix untouched.
export function syncVariantMatrix(
  axes: string[],
  selections: Record<string, string[]>,
  existing: ProductVariant[],
  create: (combo: Record<string, string>) => ProductVariant,
): VariantSyncResult | null {
  const generated = generateVariantCombos(axes, selections);
  if (generated === null) return null;
  // First stored record wins per normalized combo — any later duplicates of
  // the same combo become retained-inactive orphans, never resurrected.
  const byCombo = new Map<string, ProductVariant>();
  for (const v of existing) {
    const k = comboKey(v.combo);
    if (!byCombo.has(k)) byCombo.set(k, v);
  }
  const kept = new Set<string>();
  const variants: ProductVariant[] = [];
  const added: ProductVariant[] = [];
  for (const combo of generated) {
    const found = byCombo.get(comboKey(combo));
    if (found && !kept.has(found.id)) {
      variants.push(found);
      kept.add(found.id);
    } else {
      const nv = create(combo);
      variants.push(nv);
      added.push(nv);
    }
  }
  const retainedInactive = existing
    .filter((v) => !kept.has(v.id))
    .map((v) => (v.active ? { ...v, active: false } : v));
  return { variants: [...variants, ...retainedInactive], added, retainedInactive };
}

// ---- pricing ---------------------------------------------------------------

export function variantPrice(
  variant: Pick<ProductVariant, 'price'>,
  product: Pick<CatalogProduct, 'price'>,
): number {
  return variant.price ?? product.price;
}

export function variantCompareAtPrice(
  variant: Pick<ProductVariant, 'compareAtPrice'>,
  product: Pick<CatalogProduct, 'compareAtPrice'>,
): number | null {
  return variant.compareAtPrice ?? product.compareAtPrice;
}

// Effective prices must be finite and non-negative; an effective compare-at
// price must exceed the effective selling price.
export function variantPricingValid(
  variant: Pick<ProductVariant, 'price' | 'compareAtPrice'>,
  product: Pick<CatalogProduct, 'price' | 'compareAtPrice'>,
): boolean {
  const price = variantPrice(variant, product);
  if (!Number.isFinite(price) || price < 0) return false;
  const compareAt = variantCompareAtPrice(variant, product);
  return compareAt === null || (Number.isFinite(compareAt) && compareAt > price);
}

// ---- inventory & purchasability --------------------------------------------
// No numeric inventory exists in Taybah — availability is a manual field set
// per variant (and per product), identical in behavior to product-level
// availability.

// The availability a customer sees is the variant's own manual field.
export function variantAvailability(
  variant: Pick<ProductVariant, 'availability'>,
): Availability {
  return variant.availability;
}

// Purchase gate for the variant record alone — product-level visibility
// (published / category / collection) composes on top at the call site.
// Inactive variants and manually out-of-stock variants never sell.
export function variantPurchasable(
  variant: Pick<ProductVariant, 'active' | 'availability'>,
): boolean {
  return variant.active && variant.availability !== 'out_of_stock';
}

// Whether at least one of the product's variants can be bought right now —
// active, manually in stock/low-stock, AND every attribute/value its combo
// touches is still enabled (see comboValuesEnabled). This is the single
// source of truth for "is this variant product purchasable at all" and
// drives both the PDP's neutral-vs-"out of stock" messaging (ProductInfo)
// and every listing surface's availability badge (ProductCard) — they must
// never disagree about whether a variant product can currently be bought.
export function hasPurchasableVariant(
  product: Pick<CatalogProduct, 'variants'>,
  attrs: AttributeDef[],
): boolean {
  return (product.variants ?? []).some(
    (v) => variantPurchasable(v) && comboValuesEnabled(v.combo, attrs),
  );
}

// The one variant a "quick add" action may use without asking the customer
// to choose — exists only when EXACTLY one stored combo is both structurally
// complete (covers every configured axis) and currently purchasable (active,
// in-stock/low-stock, no disabled attribute/value in its combo). Zero
// matches means nothing is purchasable right now; more than one means a
// real choice exists for the customer — both return undefined so callers
// never guess, the same rule the PDP's own selection resolution follows.
export function singlePurchasableVariant(
  product: Pick<CatalogProduct, 'variantAxes' | 'variants'>,
  attrs: AttributeDef[],
): ProductVariant | undefined {
  const axes = product.variantAxes ?? [];
  if (axes.length === 0) return undefined;
  const candidates = (product.variants ?? []).filter(
    (v) =>
      comboComplete(v.combo, axes) &&
      variantPurchasable(v) &&
      comboValuesEnabled(v.combo, attrs),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

// ---- SKU uniqueness --------------------------------------------------------

export function normalizeSku(sku: string): string {
  return sku.trim().toLowerCase();
}

export function skuEmpty(sku: string): boolean {
  return normalizeSku(sku) === '';
}

// Fields to leave out of a uniqueness scan while editing: `productId` skips
// the product record itself (its variant SKUs still count), `variantId`
// skips the one variant being edited.
export interface SkuExclusion {
  productId?: string;
  variantId?: string;
}

// Global SKU scan across every product-level and variant-level SKU in the
// catalog — normalized with trim + case-folding so 'TYB-P01 ' and 'tyb-p01'
// collide. Empty input never matches anything (emptiness is a separate
// issue), and nothing is ever rewritten by this check.
export function skuTaken(
  sku: string,
  products: CatalogProduct[],
  exclude?: SkuExclusion,
): boolean {
  const needle = normalizeSku(sku);
  if (!needle) return false;
  for (const p of products) {
    if (p.id !== exclude?.productId && normalizeSku(p.sku) === needle) return true;
    for (const v of p.variants ?? []) {
      if (v.id !== exclude?.variantId && normalizeSku(v.sku) === needle) {
        return true;
      }
    }
  }
  return false;
}

// ---- order-reference safety -------------------------------------------------
// Order lines snapshot productId + the reserved color/size value keys — no
// variantId column exists yet, so a line "references" a variant when its
// recorded axis values agree with the variant's combo. Axes the snapshot
// never records can't disambiguate: a line that omits them may reference
// any variant of that product, so it counts as a reference to each. That
// over-approximation is deliberate — deletion protection must never miss a
// real reference. When order snapshots gain an explicit variant id, this
// matching becomes exact and this heuristic goes away.

const ORDER_LINE_AXES = ['color', 'size'] as const;

export function orderLineMayReferenceVariant(
  line: Pick<OrderLine, 'productId' | 'color' | 'size'> & { variantId?: string | null },
  product: Pick<CatalogProduct, 'id' | 'variantAxes'>,
  variant: ProductVariant,
): boolean {
  if (line.productId !== product.id) return false;
  // Exact snapshot id match beats the color/size heuristic — survives
  // later combo edits; absent variantId falls through to legacy matching.
  if (line.variantId) return line.variantId === variant.id;
  for (const axis of ORDER_LINE_AXES) {
    const recorded = axis === 'color' ? line.color : line.size;
    if (recorded === null || !product.variantAxes?.includes(axis)) continue;
    if (variant.combo[axis] !== recorded) return false;
  }
  return true;
}

// Orders whose lines reference this product — covers legacy orders too,
// since productId has been snapshotted since the first order.
export function productOrderReferences(
  productId: string,
  orders: GuestOrder[],
): GuestOrder[] {
  return orders.filter((o) => o.lines.some((l) => l.productId === productId));
}

export function isProductReferencedByOrders(
  productId: string,
  orders: GuestOrder[],
): boolean {
  return orders.some((o) => o.lines.some((l) => l.productId === productId));
}

export function variantOrderReferences(
  product: Pick<CatalogProduct, 'id' | 'variantAxes' | 'variants'>,
  variantId: string,
  orders: GuestOrder[],
): GuestOrder[] {
  const variant = variantById(product, variantId);
  if (!variant) return [];
  return orders.filter((o) =>
    o.lines.some((l) => orderLineMayReferenceVariant(l, product, variant)),
  );
}

export function isVariantReferencedByOrders(
  product: Pick<CatalogProduct, 'id' | 'variantAxes' | 'variants'>,
  variantId: string,
  orders: GuestOrder[],
): boolean {
  return variantOrderReferences(product, variantId, orders).length > 0;
}

// The physical-deletion guard: an order-referenced variant may be
// deactivated (active = false) but its record must never be removed.
export function canDeleteVariant(
  product: Pick<CatalogProduct, 'id' | 'variantAxes' | 'variants'>,
  variantId: string,
  orders: GuestOrder[],
): boolean {
  return !isVariantReferencedByOrders(product, variantId, orders);
}

// ---- validation -------------------------------------------------------------

export type VariantIssueCode =
  | 'axes_empty' // variants stored but no axes configured
  | 'axes_too_many' // more than MAX_VARIANT_AXES
  | 'axes_duplicate' // repeated axis key
  | 'variants_missing' // axes configured but zero variants stored
  | 'axis_unknown' // axis key isn't a defined attribute
  | 'axis_disabled' // attribute is disabled
  | 'axis_not_variation_capable' // attribute flagged variationCapable = false
  | 'axis_out_of_scope' // attribute doesn't apply to this product's category
  | 'combo_incomplete' // doesn't cover every axis exactly once
  | 'combo_value_unknown' // value key not defined on the attribute
  | 'combo_duplicate' // normalized combo repeated inside the product
  | 'combo_limit' // more than MAX_VARIANT_COMBINATIONS stored
  | 'variant_id_duplicate'
  | 'sku_empty'
  | 'sku_duplicate' // variant SKU collides with another product or variant
  | 'product_sku_duplicate' // the product-level SKU itself collides
  | 'price_invalid' // effective price missing/negative/non-finite
  | 'compare_at_invalid'; // effective compare-at <= effective price

export interface VariantIssue {
  code: VariantIssueCode;
  variantId?: string;
  axis?: string;
}

// Full audit of a product's variant configuration against the live attribute
// registry and catalog — the single gate the admin form (and later import
// tooling) calls before persisting. Returns [] for healthy simple products.
export function validateProductVariants(
  product: CatalogProduct,
  attrs: AttributeDef[],
  allProducts: CatalogProduct[],
): VariantIssue[] {
  const issues: VariantIssue[] = [];
  const axes = product.variantAxes ?? [];
  const variants = product.variants ?? [];

  // The product's own SKU participates in the global scan even for simple
  // products — a product SKU may never reuse a variant SKU anywhere.
  if (skuTaken(product.sku, allProducts, { productId: product.id })) {
    issues.push({ code: 'product_sku_duplicate' });
  }

  if (axes.length === 0 && variants.length === 0) return issues;

  if (axes.length === 0) {
    issues.push({ code: 'axes_empty' });
  } else if (axes.length > MAX_VARIANT_AXES) {
    issues.push({ code: 'axes_too_many' });
  } else if (new Set(axes).size !== axes.length) {
    issues.push({ code: 'axes_duplicate' });
  }

  const axesUsable = validVariantAxes(axes);
  if (axesUsable) {
    for (const axis of axes) {
      const attr = attrs.find((a) => a.key === axis);
      if (!attr) {
        issues.push({ code: 'axis_unknown', axis });
      } else {
        if (!attr.enabled) issues.push({ code: 'axis_disabled', axis });
        if (!attr.variationCapable)
          issues.push({ code: 'axis_not_variation_capable', axis });
        if (!axisAppliesToCategory(attr, product.category))
          issues.push({ code: 'axis_out_of_scope', axis });
      }
    }
    if (variants.length === 0) issues.push({ code: 'variants_missing' });
  }

  if (variants.length > MAX_VARIANT_COMBINATIONS) {
    issues.push({ code: 'combo_limit' });
  }

  const seenIds = new Set<string>();
  const seenCombos = new Set<string>();
  for (const v of variants) {
    const at = (code: VariantIssueCode, axis?: string) =>
      issues.push({ code, variantId: v.id, axis });

    // Identity invariants apply to every stored record — even an inactive
    // variant's SKU stays reserved in the global pool.
    if (seenIds.has(v.id)) at('variant_id_duplicate');
    seenIds.add(v.id);

    if (skuEmpty(v.sku)) at('sku_empty');
    else if (skuTaken(v.sku, allProducts, { variantId: v.id }))
      at('sku_duplicate');

    // Purchasability checks only gate ACTIVE variants. Inactive records are
    // deliberately retained (e.g. combinations retired from the matrix or
    // order-referenced history) and can't sell, so their combo shape,
    // values, and price don't block saving — the admin resolves them
    // by reactivating (only possible while generated) or deleting when safe.
    if (!v.active) continue;

    if (axesUsable) {
      if (!comboComplete(v.combo, axes)) {
        at('combo_incomplete');
      } else {
        if (!comboValuesValid(v.combo, attrs)) {
          at('combo_value_unknown');
        }
        const key = comboKey(v.combo);
        if (seenCombos.has(key)) at('combo_duplicate');
        seenCombos.add(key);
      }
    }

    const price = variantPrice(v, product);
    if (!Number.isFinite(price) || price < 0) at('price_invalid');
    else {
      const compareAt = variantCompareAtPrice(v, product);
      if (
        compareAt !== null &&
        (!Number.isFinite(compareAt) || compareAt <= price)
      )
        at('compare_at_invalid');
    }

  }

  return issues;
}

// ---- storefront selection (PDP) ----------------------------------------------
// Pure helpers driving the PDP's progressive option selectors. A "selection"
// maps every configured axis to a chosen value key or null (not yet chosen).
// Every rule here consults ACTIVE stored variants — purchasability gates
// (manual availability) apply afterwards via variantPurchasable, never at
// option-filtering time.

export type VariantSelection = Record<string, string | null>;

export function emptySelection(axes: string[]): VariantSelection {
  return Object.fromEntries(axes.map((a) => [a, null]));
}

// Distinct values offered for one axis — sourced from the product's stored
// variant combos (the canonical purchasable options), in first-appearance
// order. Values that only occur on inactive variants are never offered.
export function activeAxisValues(
  product: Pick<CatalogProduct, 'variants'>,
  axis: string,
): string[] {
  const seen = new Set<string>();
  for (const v of product.variants ?? []) {
    if (!v.active) continue;
    const val = v.combo[axis];
    if (typeof val === 'string' && val !== '') seen.add(val);
  }
  return [...seen];
}

// Progressive filtering: can `axis = value` still form an ACTIVE variant
// under the other currently-selected axes? Values with no remaining path are
// disabled in the UI rather than silently dropping selections.
export function axisValueEnabled(
  product: Pick<CatalogProduct, 'variantAxes' | 'variants'>,
  selection: VariantSelection,
  axis: string,
  value: string,
): boolean {
  return (product.variants ?? []).some(
    (v) =>
      v.active &&
      v.combo[axis] === value &&
      (product.variantAxes ?? []).every(
        (a) => a === axis || selection[a] == null || v.combo[a] === selection[a],
      ),
  );
}

// Reconciles a selection against current data — clears (null) every chosen
// value that can no longer form an active variant under the OTHER chosen
// axes, iterating to a fixpoint (≤3 axes, trivial). `preferAxis` marks the
// axis the customer just changed: it's evaluated LAST so dependents yield
// to the new choice rather than the choice reverting. Runs when the product
// record or a selection changes so stale combos never linger.
export function reconcileSelection(
  product: Pick<CatalogProduct, 'variantAxes' | 'variants'>,
  selection: VariantSelection,
  preferAxis?: string,
): VariantSelection {
  const axes = product.variantAxes ?? [];
  const out = emptySelection(axes);
  for (const a of axes) out[a] = selection[a] ?? null;
  const order = preferAxis
    ? [...axes.filter((a) => a !== preferAxis), preferAxis]
    : axes;
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of order) {
      const val = out[a];
      if (val === null) continue;
      const others = { ...out, [a]: null };
      if (!axisValueEnabled(product, others, a, val)) {
        out[a] = null;
        changed = true;
      }
    }
  }
  return out;
}

export function selectionComplete(
  axes: string[],
  selection: VariantSelection,
): boolean {
  return axes.length > 0 && axes.every((a) => selection[a] != null);
}

// Exact-match resolution: all axes selected → the single ACTIVE variant
// whose normalized combo equals the selection. Partial or impossible
// selections return undefined — never a partial match, never the "first"
// variant.
export function resolveSelectedVariant(
  product: Pick<CatalogProduct, 'variantAxes' | 'variants'>,
  selection: VariantSelection,
): ProductVariant | undefined {
  const axes = product.variantAxes ?? [];
  if (!selectionComplete(axes, selection)) return undefined;
  return (product.variants ?? []).find(
    (v) => v.active && combosEqual(v.combo, selection as Record<string, string>),
  );
}

// Axes still open to customer choice — a configured axis whose attribute
// has since been disabled entirely can never be completed again (no UI
// offers it), so callers drop it from selectors/"choose this" prompts and
// fall through to the "no valid combination" message instead.
export function sellableVariantAxes(axes: string[], attrs: AttributeDef[]): string[] {
  return axes.filter((a) => attrs.find((x) => x.key === a)?.enabled === true);
}

// Values offered as a NEW selection for one axis — active-variant combo
// values (activeAxisValues) further restricted to values the admin still
// has enabled. A disabled attribute offers nothing (its whole selector is
// hidden by sellableVariantAxes); a disabled value inside an otherwise
// enabled attribute just drops out of the list, even when an ACTIVE variant
// still carries it in its stored combo.
export function offeredAxisValues(
  product: Pick<CatalogProduct, 'variants'>,
  axis: string,
  attrs: AttributeDef[],
): string[] {
  const attr = attrs.find((a) => a.key === axis);
  if (!attr || !attr.enabled) return [];
  const enabled = new Set(attr.values.filter((v) => v.enabled).map((v) => v.key));
  return activeAxisValues(product, axis).filter((v) => enabled.has(v));
}

// Drops any already-made selection whose axis attribute or exact value has
// since become disabled — run alongside reconcileSelection so a disabled
// option never lingers as "selected" merely because its stored variant combo
// still matches structurally. Mirrors comboValuesEnabled, one axis at a time.
export function withoutDisabledSelections(
  selection: VariantSelection,
  attrs: AttributeDef[],
): VariantSelection {
  const out = { ...selection };
  for (const axis of Object.keys(out)) {
    const val = out[axis];
    if (val !== null && !comboValuesEnabled({ [axis]: val }, attrs)) {
      out[axis] = null;
    }
  }
  return out;
}

// Initial PDP selection: axes carrying exactly one offered value prefill —
// matching the legacy single-option auto-select — everything else starts
// null so the customer chooses deliberately.
export function initialVariantSelection(
  product: Pick<CatalogProduct, 'variantAxes' | 'variants'>,
): VariantSelection {
  const out = emptySelection(product.variantAxes ?? []);
  for (const a of product.variantAxes ?? []) {
    const values = activeAxisValues(product, a);
    if (values.length === 1) out[a] = values[0];
  }
  return out;
}

// ---- migration sanitization -------------------------------------------------

// Structural cleanup for records persisted before the variant fields existed
// or written by an older/partial version. Only malformed records are repaired
// or dropped — valid data rides through untouched:
//   • variants missing a usable id get a fresh UUID (preserving the record
//     rather than discarding it),
//   • non-numeric price/compareAtPrice normalize to null (inherit) instead
//     of crashing or corrupting, and legacy `stock` fields are dropped —
//   • non-string combo entries are filtered out,
//   • invalid availability falls back to 'in_stock', missing `active`
//     defaults to true — consistent with the rest of the codebase's
//     "preserve, don't strip" migration style.
// Validation (SKU/combo correctness) is validateProductVariants' job — this
// layer only guarantees records are structurally loadable.
function sanitizeVariant(raw: unknown): ProductVariant | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<ProductVariant>;
  const combo: Record<string, string> = {};
  if (v.combo && typeof v.combo === 'object' && !Array.isArray(v.combo)) {
    for (const [k, val] of Object.entries(v.combo)) {
      if (typeof val === 'string') combo[k] = val;
    }
  }
  const num = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  return {
    id: typeof v.id === 'string' && v.id.trim() ? v.id : newVariantId(),
    sku: typeof v.sku === 'string' ? v.sku : '',
    combo,
    price: num(v.price),
    compareAtPrice: num(v.compareAtPrice),
    stockQuantity: num(v.stockQuantity),
    availability:
      v.availability === 'low_stock' || v.availability === 'out_of_stock'
        ? v.availability
        : 'in_stock',
    image: typeof v.image === 'string' && v.image ? v.image : null,
    active: v.active !== false,
  };
}

// Sanitizes just the variant fields of a stored product record. Both keys
// are always returned (explicit undefined when absent) so callers can
// overwrite or delete whatever raw value was persisted.
export function sanitizeVariantFields(raw: {
  variantAxes?: unknown;
  variants?: unknown;
}): { variantAxes: string[] | undefined; variants: ProductVariant[] | undefined } {
  const variantAxes = Array.isArray(raw.variantAxes)
    ? [...new Set(raw.variantAxes.filter((a): a is string => typeof a === 'string'))]
    : undefined;
  const variants = Array.isArray(raw.variants)
    ? raw.variants
        .map(sanitizeVariant)
        .filter((v): v is ProductVariant => v !== null)
        .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
    : undefined;
  return { variantAxes, variants };
}
