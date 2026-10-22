import { useSyncExternalStore } from 'react';

// TEMPORARY FRONTEND-ONLY wishlist — persists to localStorage until Supabase
// wishlists replace it (DATABASE_SCHEMA §2 wishlists table, customer_id = auth.uid()).

const STORAGE_KEY = 'taybah:wishlist';

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

let ids = new Set<string>(loadIds());
let snapshot: ReadonlySet<string> = ids;
const listeners = new Set<() => void>();

// Notifies subscribers with a fresh Set reference (useSyncExternalStore
// needs referential change to detect an update) WITHOUT touching
// localStorage — shared by same-tab mutations (after they persist) and the
// cross-tab storage listener (which must never write back what it just
// read, or every tab would re-trigger the others' listeners in a loop).
function notify() {
  snapshot = new Set(ids);
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // storage unavailable (private mode) — wishlist remains session-scoped
  }
}

export function toggleWishlist(productId: string) {
  if (ids.has(productId)) ids.delete(productId);
  else ids.add(productId);
  persist();
  notify();
}

// Cross-tab sync — mirrors the catalogStore/attributeStore pattern: another
// tab's wishlist write reloads this tab's in-memory ids and notifies, with
// no re-persist (loadIds() already tolerates invalid/corrupt JSON by
// returning []). Registered once at module scope, so every component using
// useWishlist shares this single listener rather than adding its own.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      ids = new Set(loadIds());
      notify();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
  return snapshot;
}

// Non-reactive read for callers outside React (e.g. the Admin product
// deletion reference check) — mirrors getCartLines()/getAttributes()'s
// plain-getter pattern used elsewhere in the storefront stores.
export function getWishlistIds(): ReadonlySet<string> {
  return snapshot;
}

export function useWishlist() {
  const set = useSyncExternalStore(subscribe, getSnapshot);
  return {
    ids: set,
    count: set.size,
    has: (id: string) => set.has(id),
    toggle: toggleWishlist,
  };
}
