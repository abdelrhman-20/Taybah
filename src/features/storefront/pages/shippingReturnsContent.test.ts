import { describe, expect, it } from 'vitest';
import { shippingReturnsContent } from './shippingReturnsContent';

describe('shippingReturnsContent', () => {
  it('keeps the same sections, items and cards in Arabic and English', () => {
    const shape = (l: 'ar' | 'en') => ({
      sections: shippingReturnsContent[l].sections.map((s) => [s.id, s.items.map((i) => [i.id, i.pending])]),
      cards: shippingReturnsContent[l].summary.map((c) => [c.id, c.target]),
    });
    expect(shape('ar')).toEqual(shape('en'));
  });

  it('every summary card points at a real policy row', () => {
    const t = shippingReturnsContent.ar;
    const ids = new Set(t.sections.flatMap((s) => s.items.map((i) => i.id)));
    for (const c of t.summary) expect(ids.has(c.target), c.id).toBe(true);
  });

  it('keeps all the previously reserved topics', () => {
    const ids = shippingReturnsContent.ar.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['zones', 'timelines', 'fees', 'tracking', 'eligibility', 'exchange', 'refunds', 'damaged']);
  });

  it('states no unconfirmed facts: every item is flagged pending and contains no numbers, fees or guarantees', () => {
    for (const locale of ['ar', 'en'] as const) {
      const items = shippingReturnsContent[locale].sections.flatMap((s) => s.items);
      for (const i of items) {
        expect(i.pending, i.id).toBe(true);
        expect(i.text, i.id).not.toMatch(/[0-9٠-٩]/); // no days, prices or percentages
        expect(i.text.toLowerCase(), i.id).not.toMatch(/مجاني|free|ضمان|guarantee|خلال|within/);
      }
    }
  });
});
