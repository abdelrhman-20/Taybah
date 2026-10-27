import type { Availability, CatalogProduct } from '../../storefront/catalog/catalogData';
import type { AttributeDef } from '../../storefront/catalog/attributeStore';
import { hasPurchasableVariant, isVariantProduct } from '../../storefront/catalog/variants';

// Pure inventory rules for the admin UI — no React, no storage. Admin-only: this
// module must never be imported by a storefront code path.

// A product without a stock row has NO initialized balance (zero is an explicit,
// initialized balance — it is "out", not "uninitialized").
export type StockStatus = 'uninitialized' | 'negative' | 'out' | 'low' | 'ok';

export interface StockLike {
  onHand: number;
  lowThreshold: number;
}

export function stockStatus(level: StockLike | null | undefined): StockStatus {
  if (!level) return 'uninitialized';
  if (level.onHand < 0) return 'negative';
  if (level.onHand === 0) return 'out';
  // threshold 0 disables the LOW alert; the out-of-stock alert always applies
  if (level.lowThreshold > 0 && level.onHand <= level.lowThreshold) return 'low';
  return 'ok';
}

export const STOCK_STATUS_LABELS_AR: Record<StockStatus, string> = {
  uninitialized: 'غير مُهيَّأ',
  negative: 'سالب',
  out: 'نفد',
  low: 'منخفض',
  ok: 'متوفر',
};

// Most urgent first — used by the "severity" sort.
export const STOCK_STATUS_RANK: Record<StockStatus, number> = {
  negative: 0,
  out: 1,
  low: 2,
  uninitialized: 3,
  ok: 4,
};

// What the storefront currently shows for this product. Variant products are
// judged by their variants exactly like ProductCard does; simple products by
// the manual availability field.
export function effectiveAvailability(
  product: Pick<CatalogProduct, 'availability' | 'variants' | 'variantAxes'>,
  attrs: AttributeDef[],
): Availability {
  if (isVariantProduct(product as CatalogProduct) && !hasPurchasableVariant(product, attrs)) {
    return 'out_of_stock';
  }
  return product.availability;
}

// The storefront availability stays MANUAL; these only warn the admin when it
// contradicts the real stock. They never change anything.
export type AvailabilityConflict = 'listed_but_empty' | 'marked_out_but_stocked' | 'low_but_in_stock';

export function availabilityConflict(
  status: StockStatus,
  storefront: Availability,
): AvailabilityConflict | null {
  if ((status === 'out' || status === 'negative') && storefront !== 'out_of_stock') return 'listed_but_empty';
  if ((status === 'ok' || status === 'low') && storefront === 'out_of_stock') return 'marked_out_but_stocked';
  if (status === 'low' && storefront === 'in_stock') return 'low_but_in_stock';
  return null;
}

export const AVAILABILITY_CONFLICT_LABELS_AR: Record<AvailabilityConflict, string> = {
  listed_but_empty: 'المخزون صفر أو سالب لكن المتجر يعرض المنتج «متوفر»',
  marked_out_but_stocked: 'يوجد مخزون لكن المتجر يعرض المنتج «نفدت الكمية»',
  low_but_in_stock: 'المخزون منخفض والمتجر يعرض المنتج «متوفر» دون تنبيه',
};

export const STORE_AVAILABILITY_LABELS_AR: Record<Availability, string> = {
  in_stock: 'متوفر',
  low_stock: 'باقي قطع قليلة',
  out_of_stock: 'نفدت الكمية',
};
