// REAL sales counts per product id, for the "الأكثر مبيعًا" sort.
//
// None are available to the storefront today: orders are stored in a table that
// only signed-in staff can read (see supabase/migrations/0001_orders.sql), so a
// shopper's browser has no site-wide sales numbers — and a per-device order
// history would be a misleading popularity signal. Returning `undefined` makes
// the listing hide the "best-selling" option instead of ranking by invented
// data. When a trustworthy source exists (for example a public aggregate view
// of delivered/confirmed order quantities), return `{ [productId]: units }`
// here and the sort turns on with no other change.
export function getSalesCounts(): Record<string, number> | undefined {
  return undefined;
}
