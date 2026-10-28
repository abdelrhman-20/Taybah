import { describe, expect, it } from 'vitest';
import { canViewProfit } from './profitAccess';

describe('canViewProfit', () => {
  it('allows only nehro@info.com, ignoring case and spaces', () => {
    expect(canViewProfit('nehro@info.com')).toBe(true);
    expect(canViewProfit('  Nehro@Info.com ')).toBe(true);
  });
  it('refuses every other account and no account', () => {
    expect(canViewProfit('Taybah@info.com')).toBe(false);
    expect(canViewProfit('xnehro@info.com')).toBe(false);
    expect(canViewProfit(null)).toBe(false);
    expect(canViewProfit(undefined)).toBe(false);
  });
});
