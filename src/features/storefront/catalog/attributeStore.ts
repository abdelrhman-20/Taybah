import { useSyncExternalStore } from 'react';
import {
  colorOptions,
  materialOptions,
  sizeOptions,
  type Localized,
} from './catalogData';
import { getCatalog } from './catalogStore';
import { getOrders } from '../checkout/orderStore';
import { getCartLines } from '../cart/useCart';

// PRODUCT ATTRIBUTE STORE — centralized reactive registry for option
// definitions (colors, materials, sizes, and future custom attributes). Seeded
// from the legacy hardcoded registries in catalogData so every existing key,
// label, and hex survives untouched; Admin edits persist to localStorage and
// sync across tabs. This store owns option DEFINITIONS — product records still
// own their assignments (colors/materials/sizes fields). Variant behavior is a
// later step; `required`/`variationCapable` are stored metadata only.

const STORAGE_KEY = 'taybah:attributes';

export type AttributeDisplay = 'swatch' | 'chips' | 'list';

// Seeded attributes backed by the legacy product fields — these keys are
// reserved and must never appear in CatalogProduct.attributes.
export const RESERVED_ATTRIBUTE_KEYS = ['color', 'material', 'size'] as const;
export type ReservedAttributeKey = (typeof RESERVED_ATTRIBUTE_KEYS)[number];

export interface AttributeValue {
  key: string; // stable Latin key — never rendered as customer-facing text
  label: Localized;
  hex?: string; // only meaningful for display 'swatch'
  // Only meaningful for the 'size' attribute — the real numeric dimensions
  // behind the label (e.g. "280 × 200 سم"), not just a display string, so
  // they can be used for calculations/filtering later. Optional so every
  // other attribute's values are unaffected.
  widthCm?: number;
  lengthCm?: number;
  enabled: boolean;
  order: number;
}

export interface AttributeDef {
  key: string; // immutable relationship key ('color', 'material', 'size', …)
  name: Localized;
  display: AttributeDisplay;
  // Category slugs this attribute applies to; empty = all categories.
  categories: string[];
  required: boolean; // enforced for custom attributes when saving a product
  variationCapable: boolean; // metadata for future variant axes
  filterable: boolean; // expose as a storefront listing facet (attr_<key>)
  enabled: boolean;
  order: number;
  values: AttributeValue[];
}

function seedValues(
  options: { key: string; label: Localized; hex?: string; widthCm?: number; lengthCm?: number }[],
): AttributeValue[] {
  return options.map((o, i) => ({
    key: o.key,
    label: o.label,
    ...(o.hex ? { hex: o.hex } : {}),
    ...(o.widthCm !== undefined ? { widthCm: o.widthCm } : {}),
    ...(o.lengthCm !== undefined ? { lengthCm: o.lengthCm } : {}),
    enabled: true,
    order: i + 1,
  }));
}

function defaultAttributes(): AttributeDef[] {
  return [
    {
      key: 'color',
      name: { ar: 'اللون', en: 'Color' },
      display: 'swatch',
      categories: [],
      required: false,
      variationCapable: true,
      filterable: false, // facet exists already as the legacy 'color' param
      enabled: true,
      order: 1,
      values: seedValues(colorOptions),
    },
    {
      key: 'material',
      name: { ar: 'الخامة', en: 'Material' },
      display: 'list',
      categories: [],
      required: false,
      variationCapable: false,
      filterable: false,
      enabled: true,
      order: 2,
      values: seedValues(materialOptions),
    },
    {
      key: 'size',
      name: { ar: 'المقاس', en: 'Size' },
      display: 'chips',
      categories: [],
      required: false,
      variationCapable: true,
      filterable: false,
      enabled: true,
      order: 3,
      values: seedValues(sizeOptions),
    },
  ];
}

const DISPLAYS: AttributeDisplay[] = ['swatch', 'chips', 'list'];

function sanitizeValue(raw: unknown, fallbackOrder: number): AttributeValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<AttributeValue>;
  if (typeof v.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.key)) return null;
  const label = v.label as Partial<Localized> | undefined;
  if (typeof label?.ar !== 'string' || !label.ar.trim()) return null;
  return {
    key: v.key,
    label: { ar: label.ar, en: typeof label.en === 'string' ? label.en : '' },
    ...(typeof v.hex === 'string' && v.hex ? { hex: v.hex } : {}),
    ...(typeof v.widthCm === 'number' && Number.isFinite(v.widthCm) ? { widthCm: v.widthCm } : {}),
    ...(typeof v.lengthCm === 'number' && Number.isFinite(v.lengthCm) ? { lengthCm: v.lengthCm } : {}),
    enabled: v.enabled !== false,
    order: typeof v.order === 'number' ? v.order : fallbackOrder,
  };
}

function sanitizeAttr(raw: unknown, fallbackOrder: number): AttributeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<AttributeDef>;
  if (typeof a.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.key)) return null;
  const name = a.name as Partial<Localized> | undefined;
  if (typeof name?.ar !== 'string' || !name.ar.trim()) return null;
  const values: AttributeValue[] = [];
  const seen = new Set<string>();
  if (Array.isArray(a.values)) {
    a.values.forEach((v, i) => {
      const sv = sanitizeValue(v, i + 1);
      if (sv && !seen.has(sv.key)) {
        seen.add(sv.key);
        values.push(sv);
      }
    });
  }
  return {
    key: a.key,
    name: { ar: name.ar, en: typeof name.en === 'string' ? name.en : '' },
    display: DISPLAYS.includes(a.display as AttributeDisplay)
      ? (a.display as AttributeDisplay)
      : 'chips',
    categories: Array.isArray(a.categories)
      ? a.categories.filter((c): c is string => typeof c === 'string')
      : [],
    required: a.required === true,
    variationCapable: a.variationCapable === true,
    // Stored attributes created before `filterable` existed default to false —
    // migration never enables facets on its own.
    filterable: a.filterable === true,
    enabled: a.enabled !== false,
    order: typeof a.order === 'number' ? a.order : fallbackOrder,
    values,
  };
}

// Stored attributes win as-is; any default attribute the stored data predates
// is appended so future versions never destroy admin customizations.
function migrate(raw: unknown): AttributeDef[] {
  const defaults = defaultAttributes();
  if (!Array.isArray(raw)) return defaults;
  const out: AttributeDef[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const a = sanitizeAttr(r, i + 1);
    if (a && !seen.has(a.key)) {
      seen.add(a.key);
      out.push(a);
    }
  });
  for (const d of defaults) {
    if (!seen.has(d.key)) out.push({ ...d, order: out.length + 1 });
  }
  return out;
}

function readAll(): AttributeDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAttributes();
    return migrate(JSON.parse(raw));
  } catch {
    return defaultAttributes();
  }
}

let attributes: AttributeDef[] = readAll();
const listeners = new Set<() => void>();

function persist(next: AttributeDef[]) {
  attributes = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attributes));
  } catch {
    // storage unavailable — state lives in memory for this session
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      attributes = readAll();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAttributes(): AttributeDef[] {
  return useSyncExternalStore(subscribe, () => attributes);
}

export function getAttributes(): AttributeDef[] {
  return attributes;
}

export function attributeByKey(key: string): AttributeDef | undefined {
  return attributes.find((a) => a.key === key);
}

// Enabled attributes applicable to a category (empty scope = all).
export function attributesForCategory(categorySlug: string): AttributeDef[] {
  return attributes
    .filter((a) => a.enabled && (a.categories.length === 0 || a.categories.includes(categorySlug)))
    .sort((a, b) => a.order - b.order);
}

// Value keys allowed in URL filter params — all known keys, so existing
// filtered URLs keep working even for disabled values (they just are not
// offered as new selections).
export function valueKeySet(attrKey: string): Set<string> {
  const a = attributeByKey(attrKey);
  return new Set((a?.values ?? []).map((v) => v.key));
}

// Enabled values in display order — what storefront selectors/filters offer.
export function enabledValues(attrKey: string): AttributeValue[] {
  const a = attributeByKey(attrKey);
  if (!a || !a.enabled) return [];
  return a.values.filter((v) => v.enabled).sort((x, y) => x.order - y.order);
}

// Label lookup resolves DISABLED values too — historical orders, cart lines,
// and product assignments must keep rendering their Arabic label even after
// an admin disables the option.
export function attributeValueLabel(
  attrKey: string,
  valueKey: string | null,
  locale: 'ar' | 'en',
): string | null {
  if (!valueKey) return null;
  const v = attributeByKey(attrKey)?.values.find((x) => x.key === valueKey);
  return v ? v.label[locale] : valueKey;
}

export function attributeValueHex(attrKey: string, valueKey: string): string | undefined {
  return attributeByKey(attrKey)?.values.find((x) => x.key === valueKey)?.hex;
}

// Enabled-only subset of a product's assigned value keys for one attribute,
// in the product's own order — drives LIVE customer-facing specs (PDP specs
// table, material/color/size rows) so a disabled attribute or disabled value
// never surfaces as current information, without touching the product's
// stored assignment. Historical surfaces (orders, cart lines) intentionally
// keep using attributeValueLabel directly instead, so a since-disabled value
// still renders its saved label there.
export function visibleAssignedValues(attrKey: string, keys: string[]): string[] {
  const a = attributeByKey(attrKey);
  if (!a || !a.enabled) return [];
  const enabled = new Set(a.values.filter((v) => v.enabled).map((v) => v.key));
  return keys.filter((k) => enabled.has(k));
}

// ---- mutations -------------------------------------------------------------

export function saveAttributes(next: AttributeDef[]) {
  persist(next);
}

export function upsertAttribute(attr: AttributeDef) {
  const exists = attributes.some((a) => a.key === attr.key);
  persist(
    exists ? attributes.map((a) => (a.key === attr.key ? attr : a)) : [...attributes, attr],
  );
}

export function removeAttribute(key: string) {
  persist(attributes.filter((a) => a.key !== key));
}

// ---- reference scanning (deletion safety) ----------------------------------
// Product assignments live in the legacy fields for the three seeded keys
// (color/material/size) plus the optional generic `attributes` map reserved
// for future custom attributes. Variant records hold resolved value keys in
// `combo`; order lines snapshot raw value keys in legacy `color`/`size` and
// (for variant lines) in `options[]`; cart lines carry `combo`/`color`/`size`
// while they exist. Deleting a referenced key would degrade every one of
// these to raw technical keys — the scans below cover all of them.

type ProductWithAttrs = {
  colors: string[];
  materials: string[];
  size: string;
  sizes: string[];
  name: Localized;
  attributes?: Record<string, string[]>;
};

// Shared resolver — returns the assigned value keys for any attribute on a
// product, whether the assignment lives in a legacy field (reserved seeds) or
// the generic attributes map. Used by reference scanning, storefront filters,
// and (later) variant-axis resolution; variant logic itself lives elsewhere.
export function productAxisValues(p: ProductWithAttrs, attrKey: string): string[] {
  switch (attrKey) {
    case 'color':
      return p.colors;
    case 'material':
      return p.materials;
    case 'size':
      // Union of default + selectable sizes (deduped, falsy-safe) so reference
      // scanning catches a value used only as the product's default size.
      return [...new Set([p.size, ...p.sizes].filter(Boolean))];
    default:
      return p.attributes?.[attrKey] ?? [];
  }
}

export function attributeReferences(attrKey: string): string[] {
  const uses: string[] = [];
  for (const p of getCatalog().products) {
    if (productAxisValues(p as ProductWithAttrs, attrKey).length > 0) {
      uses.push(`منتج: ${p.name.ar}`);
    }
    const comboRefs = (p.variants ?? [])
      .filter((v) => v.combo[attrKey] !== undefined)
      .map((v) => v.sku || v.id);
    if (comboRefs.length > 0) {
      uses.push(`تنويعات في «${p.name.ar}»: ${comboRefs.join('، ')}`);
    }
  }
  for (const o of getOrders()) {
    const hit = o.lines.some(
      (l) =>
        (attrKey === 'color' && l.color !== null) ||
        (attrKey === 'size' && l.size !== null) ||
        (l.options?.some((x) => x.axis === attrKey) ?? false),
    );
    if (hit) uses.push(`طلب: ${o.ref}`);
  }
  if (
    getCartLines().some(
      (l) =>
        l.combo?.[attrKey] !== undefined ||
        (attrKey === 'color' && l.color !== null) ||
        (attrKey === 'size' && l.size !== null),
    )
  ) {
    uses.push('سلة التسوق');
  }
  return uses;
}

export function attributeValueReferences(attrKey: string, valueKey: string): string[] {
  const uses: string[] = [];
  for (const p of getCatalog().products) {
    if (productAxisValues(p as ProductWithAttrs, attrKey).includes(valueKey)) {
      uses.push(`منتج: ${p.name.ar}`);
    }
    const comboRefs = (p.variants ?? [])
      .filter((v) => v.combo[attrKey] === valueKey)
      .map((v) => v.sku || v.id);
    if (comboRefs.length > 0) {
      uses.push(`تنويعات في «${p.name.ar}»: ${comboRefs.join('، ')}`);
    }
  }
  for (const o of getOrders()) {
    const hit = o.lines.some(
      (l) =>
        (attrKey === 'color' && l.color === valueKey) ||
        (attrKey === 'size' && l.size === valueKey) ||
        (l.options?.some((x) => x.axis === attrKey && x.value === valueKey) ?? false),
    );
    if (hit) uses.push(`طلب: ${o.ref}`);
  }
  if (
    getCartLines().some(
      (l) =>
        l.combo?.[attrKey] === valueKey ||
        (attrKey === 'color' && l.color === valueKey) ||
        (attrKey === 'size' && l.size === valueKey),
    )
  ) {
    uses.push('سلة التسوق');
  }
  return uses;
}

// ---- admin list filtering ----------------------------------------------------

export type AttributeStatusFilter = 'all' | 'enabled' | 'disabled';

// Pure selection for the Admin attributes page — case-insensitive substring
// match across the attribute's name (both locales), technical key, and every
// value's label and key. Arabic is unaffected by case folding, so the same
// lowercased comparison covers both languages. The input list's order is
// preserved as-is; sorting stays the caller's job.
export function filterAttributes(
  list: AttributeDef[],
  query: string,
  status: AttributeStatusFilter = 'all',
): AttributeDef[] {
  const q = query.trim().toLowerCase();
  return list.filter((a) => {
    if (status === 'enabled' && !a.enabled) return false;
    if (status === 'disabled' && a.enabled) return false;
    if (!q) return true;
    if (
      a.name.ar.toLowerCase().includes(q) ||
      a.name.en.toLowerCase().includes(q) ||
      a.key.toLowerCase().includes(q)
    ) {
      return true;
    }
    return a.values.some(
      (v) =>
        v.label.ar.toLowerCase().includes(q) ||
        v.label.en.toLowerCase().includes(q) ||
        v.key.toLowerCase().includes(q),
    );
  });
}
