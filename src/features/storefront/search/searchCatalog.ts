import type { CatalogProduct } from '../catalog/catalogData';
import { getAttributes } from '../catalog/attributeStore';
import { publicProducts, type CatalogState } from '../catalog/catalogStore';

// Client-side search over the shared catalog — isolated so it can later map to
// Postgres tsvector search (DATABASE_SCHEMA: separate per-language indexes).
// Searches published products only; unpublished/hidden catalog never leaks.

const ARABIC_NORMALIZE: [RegExp, string][] = [
  [/[\u064B-\u0652\u0670\u0640]/g, ''], // diacritics + tatweel
  [/[أإآٱ]/g, 'ا'],
  [/ة/g, 'ه'],
  [/ى/g, 'ي'],
  [/ؤ/g, 'و'],
  [/ئ/g, 'ي'],
];

export function normalizeQuery(input: string): string {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [re, rep] of ARABIC_NORMALIZE) s = s.replace(re, rep);
  return s;
}

// Option labels resolve from the attribute store — including disabled values,
// so products still match searches for options they were assigned earlier.
function optionLabels(keys: string[], attrKey: string): string[] {
  const attr = getAttributes().find((a) => a.key === attrKey);
  if (!attr) return [];
  return keys.flatMap((key) => {
    const v = attr.values.find((x) => x.key === key);
    return v ? [v.label.ar, v.label.en] : [];
  });
}

// WeakMap keyed by (attributes, catalog state, product) identity — option
// labels come from the attribute store and taxonomy names from the catalog,
// so the cache must invalidate when either snapshot changes.
const fieldsCache = new WeakMap<
  object,
  WeakMap<CatalogState, WeakMap<CatalogProduct, string[]>>
>();

// A field is split into individual WORDS (whitespace- or hyphen-separated,
// so a hyphenated SKU like "TYB-P24" still offers "p24" as its own matchable
// word) rather than kept as one long string. Matching is done per word
// below — this is what keeps a short query from matching an unrelated word
// that merely CONTAINS it: "sa" must START a word ("sand", "p-sa12"), not
// appear anywhere inside one ("reuSAble", "eaSy-care") — otherwise a
// 2–3 letter query matches a large fraction of the catalog through
// incidental substrings buried in free-text descriptions, which is exactly
// the "search feels broken" symptom this fixes.
function fieldWords(field: string): string[] {
  return field.split(/[\s-]+/).filter(Boolean);
}

function words(p: CatalogProduct, catalog: CatalogState): string[] {
  const attrs = getAttributes();
  let perAttrs = fieldsCache.get(attrs);
  if (!perAttrs) {
    perAttrs = new WeakMap();
    fieldsCache.set(attrs, perAttrs);
  }
  let perState = perAttrs.get(catalog);
  if (!perState) {
    perState = new WeakMap();
    perAttrs.set(catalog, perState);
  }
  const cached = perState.get(p);
  if (cached) return cached;
  const cat = catalog.categories.find((c) => c.slug === p.category);
  const coll = catalog.collections.find((c) => c.slug === p.collection);
  const list = [
    p.name.ar,
    p.name.en,
    p.description.ar,
    p.description.en,
    p.sku,
    cat?.name.ar,
    cat?.name.en,
    coll?.name.ar,
    coll?.name.en,
    ...optionLabels(p.colors, 'color'),
    ...optionLabels(p.materials, 'material'),
    ...optionLabels(p.sizes, 'size'),
    // Custom attribute assignments contribute their Arabic/English labels —
    // raw technical keys are never searchable text.
    ...Object.entries(p.attributes ?? {}).flatMap(([attrKey, keys]) =>
      optionLabels(keys, attrKey),
    ),
  ]
    .filter((x): x is string => Boolean(x))
    .flatMap((f) => fieldWords(normalizeQuery(f)));
  perState.set(p, list);
  return list;
}

// AND semantics: every query token must be a PREFIX of at least one word in
// the product's searchable text (see fieldWords/words above for why prefix,
// not "appears anywhere").
export function searchProducts(query: string, catalog: CatalogState): CatalogProduct[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  // Split the query the same way product fields are split (whitespace OR
  // hyphen) so a hyphenated query like "TYB-P1" tokenizes into ["tyb","p1"]
  // exactly like the SKU it's meant to find does — otherwise the two sides
  // disagree and a full, correctly-typed SKU search would never match.
  const tokens = q.split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return publicProducts(catalog).filter((p) => {
    const haystack = words(p, catalog);
    return tokens.every((tok) => haystack.some((w) => w.startsWith(tok)));
  });
}
