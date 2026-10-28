import { supabase } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';
import { reloadStock, stockKey } from '../../storefront/catalog/stockStore';

// ADMIN stock counts (migration 0009). The numbers (qty / reserved) are
// readable and writable by admins only, through the stock_* functions.

export interface StockRow {
  productId: string;
  variantId: string; // '' for a simple product
  qty: number;
  lowThreshold: number;
  reserved: number;
}

export const DEFAULT_LOW_THRESHOLD = 3;

// Keyed by stockKey(productId, variantId).
export async function fetchStockRows(): Promise<Map<string, StockRow>> {
  const { data, error } = await withTimeout(supabase.rpc('stock_overview'));
  if (error) throw classifyError(error);
  const rows = new Map<string, StockRow>();
  for (const r of (data ?? []) as {
    product_id: string;
    variant_id: string;
    qty: number;
    low_threshold: number;
    reserved: number;
  }[]) {
    rows.set(stockKey(r.product_id, r.variant_id), {
      productId: r.product_id,
      variantId: r.variant_id,
      qty: Number(r.qty),
      lowThreshold: Number(r.low_threshold),
      reserved: Number(r.reserved),
    });
  }
  return rows;
}

export async function saveStock(
  productId: string,
  variantId: string,
  qty: number,
  lowThreshold: number,
): Promise<void> {
  if (!Number.isInteger(qty) || qty < 0 || !Number.isInteger(lowThreshold) || lowThreshold < 0) {
    throw new PersistenceError('invalid', 'quantity and threshold must be whole numbers >= 0');
  }
  const { error } = await withTimeout(
    supabase.rpc('stock_set', {
      p_product: productId,
      p_variant: variantId,
      p_qty: qty,
      p_threshold: lowThreshold,
    }),
  );
  if (error) throw classifyError(error);
  void reloadStock();
}

export async function untrackStock(productId: string, variantId: string): Promise<void> {
  const { error } = await withTimeout(
    supabase.rpc('stock_untrack', { p_product: productId, p_variant: variantId }),
  );
  if (error) throw classifyError(error);
  void reloadStock();
}
