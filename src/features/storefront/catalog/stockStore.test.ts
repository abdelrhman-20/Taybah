import { describe, expect, it } from 'vitest';
import { stockKey, stockState } from './stockStore';

describe('stockState', () => {
  it('is out of stock at zero or below', () => {
    expect(stockState(0, 3)).toBe('out_of_stock');
    expect(stockState(-2, 3)).toBe('out_of_stock');
  });
  it('is low up to and including the threshold', () => {
    expect(stockState(1, 3)).toBe('low_stock');
    expect(stockState(3, 3)).toBe('low_stock');
  });
  it('is in stock above the threshold', () => {
    expect(stockState(4, 3)).toBe('in_stock');
  });
});

describe('stockKey', () => {
  it('treats a missing variant as the empty variant', () => {
    expect(stockKey('p1', null)).toBe(stockKey('p1', ''));
    expect(stockKey('p1', 'v1')).not.toBe(stockKey('p1', null));
  });
});
