import { supabase } from '../../../lib/supabase/client';
import { classifyError, withTimeout } from '../../../lib/persistence/errors';

// ADMIN-ONLY internal pricing (public.product_internal_pricing, migration
// 0007). This module must only ever be imported from the admin dashboard:
// the wholesale price is never part of CatalogProduct / catalog_docs.data and
// must never reach a storefront bundle path. The database enforces it too —
// anon and non-admin sessions cannot read the table.

// null = no wholesale price set. Throws a PersistenceError when the read
// fails (e.g. migration 0007 not applied, expired session) so the form can
// tell "not set" apart from "could not load".
export async function fetchWholesalePrice(productId: string): Promise<number | null> {
  const { data, error } = await withTimeout(
    supabase
      .from('product_internal_pricing')
      .select('product_id, wholesale_price')
      .eq('product_id', productId)
      .maybeSingle(),
  );
  if (error) throw classifyError(error);
  const row = data as { wholesale_price: number | string } | null;
  if (!row) return null;
  const n = Number(row.wholesale_price);
  return Number.isFinite(n) ? n : null;
}

// Every stored wholesale price, keyed by product id (admin profit report).
// Products without a price are simply absent from the map.
export async function fetchAllWholesalePrices(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(
      supabase
        .from('product_internal_pricing')
        .select('product_id, wholesale_price')
        .order('product_id')
        .range(from, from + PAGE - 1),
    );
    if (error) throw classifyError(error);
    const rows = (data ?? []) as { product_id: string; wholesale_price: number | string }[];
    for (const r of rows) {
      const n = Number(r.wholesale_price);
      if (Number.isFinite(n)) out.set(r.product_id, n);
    }
    if (rows.length < PAGE) return out;
  }
}
