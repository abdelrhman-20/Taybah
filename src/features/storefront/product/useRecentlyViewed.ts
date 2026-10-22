import { useSyncExternalStore } from 'react';

// TEMPORARY FRONTEND-ONLY recently-viewed list — localStorage-backed, isolated
// like the wishlist/cart stores; replaced or dropped when real sessions exist.

const STORAGE_KEY = 'taybah:recently-viewed';
const MAX_ITEMS = 8;

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

let ids: string[] = loadIds();
const listeners = new Set<() => void>();

export function pushRecentlyViewed(productId: string) {
  ids = [productId, ...ids.filter((x) => x !== productId)].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable
  }
  listeners.forEach((l) => l());
}

// Cross-tab sync — mirrors catalogStore/attributeStore/useWishlist: another
// tab's push reloads this tab's in-memory list and notifies, with no
// re-persist (loadIds() already tolerates invalid/corrupt JSON by returning
// []). Registered once at module scope.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      ids = loadIds();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecentlyViewed(): string[] {
  return useSyncExternalStore(subscribe, () => ids);
}
