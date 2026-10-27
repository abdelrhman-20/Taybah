import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../../storefront/catalog/catalogData';
import {
  STOCK_STATUS_RANK,
  availabilityConflict,
  effectiveAvailability,
  stockStatus,
} from './inventoryStatus';

describe('stockStatus', () => {
  it('no balance row is NOT initialized — and zero is an explicit, initialized "out"', () => {
    expect(stockStatus(null)).toBe('uninitialized');
    expect(stockStatus(undefined)).toBe('uninitialized');
    expect(stockStatus({ onHand: 0, lowThreshold: 0 })).toBe('out');
    expect(stockStatus({ onHand: 0, lowThreshold: 5 })).toBe('out');
  });

  it('negative balances (left by an audited override) are their own status', () => {
    expect(stockStatus({ onHand: -1, lowThreshold: 5 })).toBe('negative');
  });

  it('low applies at or below a positive threshold; threshold 0 disables only the LOW alert', () => {
    expect(stockStatus({ onHand: 5, lowThreshold: 5 })).toBe('low');
    expect(stockStatus({ onHand: 3, lowThreshold: 5 })).toBe('low');
    expect(stockStatus({ onHand: 6, lowThreshold: 5 })).toBe('ok');
    expect(stockStatus({ onHand: 1, lowThreshold: 0 })).toBe('ok');
  });

  it('orders the most urgent status first', () => {
    const order = (Object.keys(STOCK_STATUS_RANK) as Array<keyof typeof STOCK_STATUS_RANK>).sort(
      (a, b) => STOCK_STATUS_RANK[a] - STOCK_STATUS_RANK[b],
    );
    expect(order).toEqual(['negative', 'out', 'low', 'uninitialized', 'ok']);
  });
});

describe('availabilityConflict (a warning only — the storefront availability stays manual)', () => {
  it('flags an empty or negative product that the storefront still lists as available or low', () => {
    expect(availabilityConflict('out', 'in_stock')).toBe('listed_but_empty');
    expect(availabilityConflict('out', 'low_stock')).toBe('listed_but_empty');
    expect(availabilityConflict('negative', 'in_stock')).toBe('listed_but_empty');
    expect(availabilityConflict('out', 'out_of_stock')).toBeNull();
  });

  it('flags a stocked product the storefront marks out of stock', () => {
    expect(availabilityConflict('ok', 'out_of_stock')).toBe('marked_out_but_stocked');
    expect(availabilityConflict('low', 'out_of_stock')).toBe('marked_out_but_stocked');
  });

  it('flags low stock shown as plainly available, but not when the storefront already says "few left"', () => {
    expect(availabilityConflict('low', 'in_stock')).toBe('low_but_in_stock');
    expect(availabilityConflict('low', 'low_stock')).toBeNull();
  });

  it('never flags healthy or uninitialized products', () => {
    expect(availabilityConflict('ok', 'in_stock')).toBeNull();
    expect(availabilityConflict('ok', 'low_stock')).toBeNull();
    for (const a of ['in_stock', 'low_stock', 'out_of_stock'] as const) {
      expect(availabilityConflict('uninitialized', a)).toBeNull();
    }
  });
});

describe('effectiveAvailability', () => {
  const base = { availability: 'in_stock' as const };

  it('a simple product shows its manual availability', () => {
    expect(effectiveAvailability({ ...base, availability: 'low_stock' }, [])).toBe('low_stock');
  });

  it('a variant product with no purchasable variant shows as out of stock, whatever its manual field says', () => {
    const p = {
      availability: 'in_stock',
      variantAxes: ['size'],
      variants: [
        { id: 'v1', sku: 'A', combo: { size: 'big' }, price: null, compareAtPrice: null, availability: 'out_of_stock', stockQuantity: null, image: null, active: true },
      ],
    } as unknown as CatalogProduct;
    expect(effectiveAvailability(p, [])).toBe('out_of_stock');
  });
});
