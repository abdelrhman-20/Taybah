import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { withTimeout } from '../../../lib/persistence/errors';
import type { Availability } from './catalogData';

// STOCK AVAILABILITY — public.stock_availability() (migration 0009) returns the
// availability STATE of every tracked unit (a simple product, or one variant),
// never the counts. catalogStore overlays it on the product/variant
// `availability`; a unit with no row is untracked and keeps its manual value.

const map = new Map<string, Availability>();
let version = 0;
let started = false;
const listeners = new Set<() => void>();

export const stockKey = (productId: string, variantId: string | null | undefined) =>
  `${productId}|${variantId ?? ''}`;

// unavailable <= 0, low <= threshold, otherwise in stock (mirrors the SQL).
export function stockState(available: number, lowThreshold: number): Availability {
  if (available <= 0) return 'out_of_stock';
  if (available <= lowThreshold) return 'low_stock';
  return 'in_stock';
}

export function getStockState(productId: string, variantId: string | null | undefined): Availability | undefined {
  return map.get(stockKey(productId, variantId));
}

export function getStockVersion(): number {
  return version;
}

export function subscribeStock(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    void reloadStock();
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function reloadStock(): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const { data, error } = await withTimeout(supabase.rpc('stock_availability'));
    // Not migrated yet / offline: keep what we have, the manual field still applies.
    if (error) return;
    map.clear();
    for (const r of (data ?? []) as { product_id: string; variant_id: string; state: Availability }[]) {
      map.set(stockKey(r.product_id, r.variant_id), r.state);
    }
    version += 1;
    listeners.forEach((l) => l());
  } catch {
    // network failure: same as above
  }
}
