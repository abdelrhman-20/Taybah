import { useSyncExternalStore } from 'react';
import {
  catalogCategories as seedCategories,
  catalogCollections as seedCollections,
  catalogProducts as seedProducts,
  type CatalogCategory,
  type CatalogCollection,
  type CatalogProduct,
  type Localized,
  type ProductVariant,
} from './catalogData';
import {
  comboValuesEnabled,
  sanitizeVariantFields,
  variantById,
  variantPrice,
  variantPurchasable,
} from './variants';
import { getAttributes } from './attributeStore';
import {
  docsOfKind,
  getDoc,
  getDocsState,
  subscribeDocs,
  writeDocs,
  type DocPut,
} from './catalogDocs';
import { getStockState, getStockVersion, subscribeStock } from './stockStore';
import { getCartLines, type CartLine } from '../cart/useCart';
import { getWishlistIds } from '../wishlist/useWishlist';
import { getHomeContent } from '../home/homeStore';
import { getOrders } from '../checkout/orderStore';

// SHARED CATALOG STORE — typed view over the persistent catalog documents
// (public.catalog_docs, see catalogDocs.ts / migration 0006). The database is
// the source of truth for products, categories and collections; there is no
// browser-side persistence. Until an admin has migrated and verified the
// catalog (`initialized`), the storefront keeps serving the built-in demo
// catalog from catalogData and admin writes are refused.
//
// Every mutation returns a Promise that resolves only after the server
// confirmed the write and a read-back matched; local state never runs ahead
// of the database.

export interface CatalogState {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  collections: CatalogCollection[];
}

export function seedState(): CatalogState {
  return JSON.parse(
    JSON.stringify({
      products: seedProducts,
      categories: seedCategories,
      collections: seedCollections,
    }),
  ) as CatalogState;
}

// Forward-compat for records persisted before a field existed. Existing
// simple products are never given variants — variant fields only appear on
// records that already stored them, sanitized so malformed entries can't
// crash the store (see sanitizeVariantFields).
export function migrateCatalogState(raw: Partial<CatalogState> | null): CatalogState {
  return {
    products: (raw?.products ?? seedProducts).map((p) => {
      const { variantAxes, variants } = sanitizeVariantFields(p);
      if (variantAxes === undefined) delete p.variantAxes;
      else p.variantAxes = variantAxes;
      if (variants === undefined) delete p.variants;
      else p.variants = variants;
      return {
        ...p,
        published: p.published ?? true,
        isNew: p.isNew ?? false,
        attributes: p.attributes ?? {},
      };
    }),
    categories: (raw?.categories ?? seedCategories).map((c, i) => ({
      ...c,
      visible: c.visible ?? true,
      order: c.order ?? i + 1,
    })),
    collections: (raw?.collections ?? seedCollections).map((c, i) => ({
      ...c,
      visible: c.visible ?? true,
      order: c.order ?? i + 1,
    })),
  };
}

function docData<T>(kind: 'product' | 'category' | 'collection'): T[] {
  // structuredClone: migrateCatalogState normalizes in place, and the raw
  // documents must stay exactly as the database returned them.
  return docsOfKind(kind).map((d) => structuredClone(d.data) as T);
}

// Tracked stock (migration 0009) overrides the manual availability of the units
// it covers; untracked units keep their stored value.
function applyStock(state: CatalogState): CatalogState {
  for (const p of state.products) {
    const own = getStockState(p.id, null);
    if (own) p.availability = own;
    for (const v of p.variants ?? []) {
      const s = getStockState(p.id, v.id);
      if (s) v.availability = s;
    }
  }
  return state;
}

function derive(): CatalogState {
  const s = getDocsState();
  if (!s.initialized) return seedState();
  return applyStock(
    migrateCatalogState({
      products: docData<CatalogProduct>('product'),
      categories: docData<CatalogCategory>('category'),
      collections: docData<CatalogCollection>('collection'),
    }),
  );
}

let cache: { version: number; stockVersion: number; value: CatalogState } | null = null;

export function getCatalog(): CatalogState {
  const version = getDocsState().version;
  const stockVersion = getStockVersion();
  if (!cache || cache.version !== version || cache.stockVersion !== stockVersion) {
    cache = { version, stockVersion, value: derive() };
  }
  return cache.value;
}

function subscribeCatalog(listener: () => void): () => void {
  const a = subscribeDocs(listener);
  const b = subscribeStock(listener);
  return () => {
    a();
    b();
  };
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(subscribeCatalog, getCatalog);
}

// ---- public-discovery rule ---------------------------------------------
// A product is storefront-discoverable only when it is published AND its
// category AND collection are visible. Hidden products stay reachable for
// internal needs (existing cart lines) but never appear in listings, search,
// or featured sections.
export function productIsPublic(p: CatalogProduct, state: CatalogState): boolean {
  if (!p.published) return false;
  const cat = state.categories.find((c) => c.slug === p.category);
  const coll = state.collections.find((c) => c.slug === p.collection);
  return (cat?.visible ?? false) && (coll?.visible ?? false);
}

export function publicProducts(state: CatalogState): CatalogProduct[] {
  return state.products.filter((p) => productIsPublic(p, state));
}

// ---- cart validation -----------------------------------------------------
// A product already sitting in a cart can become unpurchasable after admin
// edits: unpublished / hidden-taxonomy products report 'hidden', out-of-stock
// products report 'unavailable'. Blocked lines stay visible in the cart so
// the customer understands what changed, but must never reach an order.
export type CartItemBlock = 'hidden' | 'unavailable';

export function cartItemBlock(
  p: CatalogProduct,
  state: CatalogState,
): CartItemBlock | null {
  if (!productIsPublic(p, state)) return 'hidden';
  if (p.availability === 'out_of_stock') return 'unavailable';
  return null;
}

// One resolution path shared by CartDrawer, CartPage, and CheckoutPage so all
// surfaces agree on pricing, images, and blocked status.
//
// Pricing policy: always live — unitPrice resolves the CURRENT catalog value
// (variant.price ?? product.price). The line's stored price/image/name are
// snapshot fallbacks rendered only when the product or variant no longer
// resolves, keeping removed items displayable and removable. A variant price
// change therefore updates the cart immediately; checkout re-validates later.
export interface ResolvedCartLine {
  line: CartLine;
  product: CatalogProduct | undefined;
  variant: ProductVariant | undefined;
  // null only when the product is gone AND the line has no snapshot.
  name: Localized | null;
  image: string;
  sku: string;
  unitPrice: number;
  // [axisKey, valueKey] pairs in axis order (variant lines) or legacy
  // color/size pairs — raw keys, labeled at render via attributeValueLabel.
  options: [string, string][];
  block: CartItemBlock | null;
}

export function resolveCartLines(lines: CartLine[], state: CatalogState): ResolvedCartLine[] {
  const attrs = getAttributes();
  return lines.map((line) => {
    const product = state.products.find((p) => p.id === line.productId);
    const variant = product && line.variantId ? variantById(product, line.variantId) : undefined;

    const combo = variant?.combo ?? line.combo;
    let options: [string, string][];
    if (combo) {
      const axes = product?.variantAxes?.filter((a) => typeof combo[a] === 'string') ?? [];
      const ordered: [string, string][] = axes.map((a) => [a, combo[a]]);
      // Combo keys not covered by current axes (stale axis config) still show.
      for (const [k, v] of Object.entries(combo)) {
        if (v && !axes.includes(k)) ordered.push([k, v]);
      }
      options = ordered;
    } else {
      options = (
        [
          ['color', line.color],
          ['size', line.size],
        ] as [string, string | null][]
      ).filter((x): x is [string, string] => x[1] !== null);
    }

    let block: CartItemBlock | null = null;
    if (!product || !productIsPublic(product, state)) {
      // Product gone entirely → 'unavailable' (snapshot line, removable);
      // present but unpublished/hidden → 'hidden'.
      block = product ? 'hidden' : 'unavailable';
    } else if (line.variantId !== null) {
      // A disabled attribute/value the variant's combo still touches blocks
      // it exactly like an inactive/out-of-stock variant — the record and
      // the cart line both stay, just unpurchasable until re-enabled.
      if (
        !variant ||
        !variantPurchasable(variant) ||
        !comboValuesEnabled(variant.combo, attrs)
      ) {
        block = 'unavailable';
      }
    } else if (
      product.availability === 'out_of_stock' ||
      !comboValuesEnabled(
        Object.fromEntries(
          (
            [
              ['color', line.color],
              ['size', line.size],
            ] as [string, string | null][]
          ).filter((x): x is [string, string] => x[1] !== null),
        ),
        attrs,
      )
    ) {
      block = 'unavailable';
    }

    return {
      line,
      product,
      variant,
      name: product?.name ?? line.name,
      // Image: resolved variant → its image or the product's. Variant line
      // whose variant is gone → the snapshot of what was added, then the
      // product's. Legacy line → live product image, snapshot as last resort.
      image:
        variant?.image ??
        (line.variantId !== null
          ? (line.image ?? product?.image ?? '')
          : (product?.image ?? line.image ?? '')),
      sku: variant?.sku ?? product?.sku ?? '',
      unitPrice: variant
        ? variantPrice(variant, product!)
        : product
          ? product.price
          : (line.price ?? 0),
      options,
      block,
    };
  });
}

// ---- mutations -----------------------------------------------------------
// All return Promise<void> and reject with a PersistenceError (see
// lib/persistence/errors.ts). Pass `expectedRevision` (from docRevision() at
// the moment a form opened the record) to make a save fail with a conflict
// instead of overwriting newer changes made elsewhere.

export interface WriteOpts {
  expectedRevision?: number | null;
}

function nextProductSort(): number {
  const docs = docsOfKind('product');
  return docs.length ? Math.min(...docs.map((d) => d.sortOrder)) - 1 : 0;
}

// Op builders are exported so a form can combine several records (e.g. an
// attribute plus every product that references one of its values) into ONE
// atomic writeDocs() call.
export function productDocOp(product: CatalogProduct, opts: WriteOpts = {}): DocPut {
  const cur = getDoc('product', product.id);
  return {
    op: 'put',
    kind: 'product',
    id: product.id,
    slug: product.slug,
    visible: product.published,
    sortOrder: cur ? cur.sortOrder : nextProductSort(),
    data: product,
    expectedRevision: opts.expectedRevision,
  };
}

export function categoryDocOp(category: CatalogCategory, opts: WriteOpts = {}): DocPut {
  return {
    op: 'put',
    kind: 'category',
    id: category.slug,
    slug: category.slug,
    visible: category.visible,
    sortOrder: category.order,
    data: category,
    expectedRevision: opts.expectedRevision,
  };
}

export function collectionDocOp(collection: CatalogCollection, opts: WriteOpts = {}): DocPut {
  return {
    op: 'put',
    kind: 'collection',
    id: collection.slug,
    slug: collection.slug,
    visible: collection.visible,
    sortOrder: collection.order,
    data: collection,
    expectedRevision: opts.expectedRevision,
  };
}

export function upsertProduct(product: CatalogProduct, opts?: WriteOpts): Promise<void> {
  return writeDocs([productDocOp(product, opts)]);
}

// ---- product reference info (deletion dialog) ------------------------------
// Unlike categories/collections — which products point to via a REQUIRED
// field, so deleting one would strand products with a dangling slug —
// nothing holds a required reference to a product. Cart lines, wishlist
// saves, and homepage featured-product picks are all optional/soft
// references that already degrade gracefully once a product disappears:
// resolveCartLines keeps the line's own snapshot and blocks it ('unavailable'),
// FeaturedProducts/WishlistPage/useRecentlyViewed simply filter a missing id
// out of what they render. Historical orders snapshot product data
// independently (buildOrderLines) and must NEVER block deletion — they are
// reported here purely as information. Product deletion is therefore never
// blocked structurally; this only surfaces counts so Admin understands what
// currently touches the product before confirming, matching the "display
// useful reference information" rule without inventing a block that would
// contradict how every one of these consumers already behaves.
export interface ProductReferenceInfo {
  cartLines: number;
  wishlisted: boolean;
  homepageFeatured: boolean;
  historicalOrders: number;
}

export function productReferenceInfo(productId: string): ProductReferenceInfo {
  return {
    cartLines: getCartLines().filter((l) => l.productId === productId).length,
    wishlisted: getWishlistIds().has(productId),
    homepageFeatured: getHomeContent().products.productIds.includes(productId),
    historicalOrders: getOrders().filter((o) => o.lines.some((l) => l.productId === productId))
      .length,
  };
}

export function removeProduct(id: string): Promise<void> {
  return writeDocs([{ op: 'delete', kind: 'product', id }]);
}

export function upsertCategory(category: CatalogCategory, opts?: WriteOpts): Promise<void> {
  return writeDocs([categoryDocOp(category, opts)]);
}

export function removeCategory(slug: string): Promise<void> {
  return writeDocs([{ op: 'delete', kind: 'category', id: slug }]);
}

export function upsertCollection(collection: CatalogCollection, opts?: WriteOpts): Promise<void> {
  return writeDocs([collectionDocOp(collection, opts)]);
}

// Deletion is blocked in the UI while products still reference the
// collection — this never touches product records as a side effect.
export function removeCollection(slug: string): Promise<void> {
  return writeDocs([{ op: 'delete', kind: 'collection', id: slug }]);
}
