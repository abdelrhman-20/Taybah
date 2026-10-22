import type { AttributeDef } from './attributeStore';
import type { CartAddOptions } from '../cart/useCart';
import type { CatalogProduct } from './catalogData';
import { hasPurchasableVariant, isVariantProduct, singlePurchasableVariant } from './variants';

// Shared "can this card quick-add without a PDP visit?" rule — used by both
// ProductCard's hover toolbar and the quick-view modal, so they never
// disagree about when a one-click add is safe. Variant products quick-add
// only when exactly one combination currently resolves (never guess between
// several); simple products only when there's nothing to choose between.
export function resolveQuickAdd(
  product: CatalogProduct,
  attrs: AttributeDef[],
): { out: boolean; options: CartAddOptions | null } {
  const isVariant = isVariantProduct(product);
  const out = isVariant
    ? !hasPurchasableVariant(product, attrs)
    : product.availability === 'out_of_stock';
  if (out) return { out, options: null };

  if (isVariant) {
    const variant = singlePurchasableVariant(product, attrs);
    return { out, options: variant ? { variant } : null };
  }
  const simpleSingleOptions = product.colors.length <= 1 && product.sizes.length <= 1;
  return {
    out,
    options: simpleSingleOptions
      ? { color: product.colors[0] ?? null, size: product.sizes[0] ?? null }
      : null,
  };
}
