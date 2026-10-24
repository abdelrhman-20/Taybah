import { describe, expect, it } from 'vitest';
import { isLightColor, luminance, swatchColor } from './colorSwatch';

describe('swatchColor', () => {
  it('uses the configured hex when it is valid', () => {
    expect(swatchColor({ key: 'burgundy', label: 'عنابي', hex: '#681D20' })).toBe('#681D20');
    expect(swatchColor({ key: 'x', label: 'x', hex: ' #abc ' })).toBe('#abc');
  });

  it('maps a recognised English key or Arabic name when there is no hex', () => {
    expect(swatchColor({ key: 'beige', label: 'x' })).toBe('#D8C7AD');
    expect(swatchColor({ key: 'custom-1', label: 'بيج' })).toBe('#D8C7AD');
    expect(swatchColor({ key: 'NAVY', label: 'x' })).toBe('#2E3B4E');
  });

  it('ignores an invalid hex and falls back to the name', () => {
    expect(swatchColor({ key: 'red', label: 'x', hex: 'not-a-colour' })).toBe('#B3261E');
  });

  it('returns undefined for an unknown colour — nothing is invented', () => {
    expect(swatchColor({ key: 'zzz', label: 'لون غريب' })).toBeUndefined();
  });
});

describe('isLightColor', () => {
  it('flags very light colours so they get a stronger outline', () => {
    for (const hex of ['#FFFFFF', '#EFEAE2', '#F2E9D8', '#fff']) expect(isLightColor(hex), hex).toBe(true);
  });

  it('does not flag mid or dark colours', () => {
    for (const hex of ['#681D20', '#2E3B4E', '#9DA88F', '#B58A43', '#1F1D1B']) expect(isLightColor(hex), hex).toBe(false);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });
});
