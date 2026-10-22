import { useSyncExternalStore } from 'react';
import type { CatalogProduct, Localized, ProductVariant } from '../catalog/catalogData';
import { variantPrice } from '../catalog/variants';

export interface CartLine {
  key: string;
  productId: string;
  // Exact purchasable unit. null → legacy/simple line keyed by color|size.
  variantId: string | null;
  // Reserved-axis copies kept for legacy display and order snapshots.
  color: string | null;
  size: string | null;
  // Full option snapshot for variant lines — survives catalog-side deletion
  // so the line stays displayable/removable.
  combo: Record<string, string> | null;
  // Display fallbacks used only when the product/variant no longer resolves
  // to live catalog data. Live data always wins (see resolveCartLines).
  name: Localized | null;
  price: number | null;
  image: string | null;
  qty: number;
}

export interface CartAddOptions {
  variant?: ProductVariant | null;
  color?: string | null;
  size?: string | null;
}

export interface CartState {
  lines: CartLine[];
  drawerOpen: boolean;
}

const STORAGE_KEY = 'taybah:cart';
const listeners = new Set<() => void>();

// Identity: variant lines are keyed by productId + variantId so two variants
// of one product stay distinct; legacy/simple lines keep the color|size key.
function lineKey(
  productId: string,
  variantId: string | null,
  color: string | null,
  size: string | null,
): string {
  return variantId
    ? `${productId}|v:${variantId}`
    : `${productId}|${color ?? ''}|${size ?? ''}`;
}

function sanitizeLine(raw: unknown): CartLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const l = raw as Partial<CartLine>;
  if (typeof l.productId !== 'string' || l.productId === '') return null;
  const qty =
    typeof l.qty === 'number' && Number.isFinite(l.qty) ? Math.max(1, Math.floor(l.qty)) : 1;
  const variantId = typeof l.variantId === 'string' && l.variantId !== '' ? l.variantId : null;
  const color = typeof l.color === 'string' && l.color !== '' ? l.color : null;
  const size = typeof l.size === 'string' && l.size !== '' ? l.size : null;
  const combo =
    typeof l.combo === 'object' && l.combo !== null && !Array.isArray(l.combo)
      ? (Object.fromEntries(
          Object.entries(l.combo).filter(
            ([k, v]) => typeof k === 'string' && typeof v === 'string' && v !== '',
          ),
        ) as Record<string, string>)
      : null;
  const name =
    typeof l.name === 'object' && l.name !== null && typeof (l.name as Localized).ar === 'string'
      ? {
          ar: (l.name as Localized).ar,
          en: typeof (l.name as Localized).en === 'string' ? (l.name as Localized).en : '',
        }
      : null;
  const price = typeof l.price === 'number' && Number.isFinite(l.price) ? l.price : null;
  const image = typeof l.image === 'string' && l.image !== '' ? l.image : null;
  return {
    key: lineKey(l.productId, variantId, color, size),
    productId: l.productId,
    variantId,
    color,
    size,
    combo,
    name,
    price,
    image,
    qty,
  };
}

function loadLines(): CartLine[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Legacy format was a bare array; tolerate both shapes on read.
    const rawLines = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { lines?: unknown[] }).lines)
        ? (parsed as { lines: unknown[] }).lines
        : null;
    if (!rawLines) return [];
    const seen = new Map<string, CartLine>();
    for (const rawLine of rawLines) {
      const line = sanitizeLine(rawLine);
      if (!line) continue;
      const existing = seen.get(line.key);
      if (existing) existing.qty += line.qty;
      else seen.set(line.key, line);
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}

function persist(state: CartState) {
  try {
    // Legacy storage shape: a bare array of lines.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.lines));
  } catch {
    // storage unavailable — keep in-memory state
  }
}

function emit(next: CartState) {
  state = next;
  persist(state);
  listeners.forEach((l) => l());
}

let state: CartState = { lines: loadLines(), drawerOpen: false };

// Cross-tab sync — mirrors catalogStore/attributeStore: another tab's cart
// write reloads this tab's lines from localStorage and notifies, WITHOUT
// re-persisting (that would re-trigger every other tab's listener right
// back). `drawerOpen` is left untouched — whether the drawer is open is a
// per-tab UI concern, not shared cart state. loadLines() already tolerates
// malformed/invalid stored JSON by falling back to an empty cart.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state = { ...state, lines: loadLines() };
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): CartState {
  return state;
}

export function getCartLines(): CartLine[] {
  return state.lines;
}

export function addToCart(product: CatalogProduct, opts: CartAddOptions, qty: number) {
  const variant = opts.variant ?? null;
  // Reserved-axis values mirrored for legacy display/order compatibility.
  const color = variant ? (variant.combo['color'] ?? null) : (opts.color ?? null);
  const size = variant ? (variant.combo['size'] ?? null) : (opts.size ?? null);
  const key = lineKey(product.id, variant?.id ?? null, color, size);
  const existing = state.lines.find((l) => l.key === key);
  if (existing) {
    emit({
      ...state,
      drawerOpen: true,
      lines: state.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l)),
    });
    return;
  }
  emit({
    ...state,
    drawerOpen: true,
    lines: [
      ...state.lines,
      {
        key,
        productId: product.id,
        variantId: variant?.id ?? null,
        color,
        size,
        combo: variant ? { ...variant.combo } : null,
        name: { ...product.name },
        price: variant ? variantPrice(variant, product) : product.price,
        image: variant?.image ?? product.image,
        qty,
      },
    ],
  });
}

export function setLineQty(key: string, qty: number) {
  if (qty < 1) return;
  emit({
    ...state,
    lines: state.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
  });
}

export function removeLine(key: string) {
  emit({ ...state, lines: state.lines.filter((l) => l.key !== key) });
}

export function clearCart() {
  emit({ lines: [], drawerOpen: false });
}

export function setDrawerOpen(open: boolean) {
  emit({ ...state, drawerOpen: open });
}

export function useCart() {
  const s = useSyncExternalStore(subscribe, snapshot);
  return {
    lines: s.lines,
    drawerOpen: s.drawerOpen,
    count: s.lines.reduce((n, l) => n + l.qty, 0),
    add: addToCart,
    setQty: setLineQty,
    remove: removeLine,
    clear: clearCart,
    setDrawer: setDrawerOpen,
  };
}
