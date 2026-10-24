import { describe, expect, it } from 'vitest';
import { faqContent } from './faqContent';

describe('faqContent', () => {
  it('has the same categories and questions in Arabic and English', () => {
    const shape = (l: 'ar' | 'en') => faqContent[l].categories.map((c) => [c.id, c.items.length, c.items.map((i) => !!i.pending)]);
    expect(shape('ar')).toEqual(shape('en'));
  });

  it('covers the four store topics, each with at least one question and non-empty text', () => {
    for (const locale of ['ar', 'en'] as const) {
      const cats = faqContent[locale].categories;
      expect(cats.map((c) => c.id)).toEqual(['products', 'orders', 'payment', 'shipping']);
      for (const c of cats) {
        expect(c.title.trim()).not.toBe('');
        expect(c.items.length).toBeGreaterThan(0);
        for (const i of c.items) {
          expect(i.q.trim()).not.toBe('');
          expect(i.a.trim()).not.toBe('');
        }
      }
    }
  });

  it('flags every shipping/returns answer as awaiting confirmation (no policy is stated as fact)', () => {
    for (const locale of ['ar', 'en'] as const) {
      const shipping = faqContent[locale].categories.find((c) => c.id === 'shipping')!;
      expect(shipping.items.every((i) => i.pending)).toBe(true);
    }
  });

  it('makes no unconfirmed promises (free shipping, return windows, guarantees, 24/7)', () => {
    const all = faqContent.ar.categories.flatMap((c) => c.items.map((i) => i.a)).join(' ');
    for (const claim of ['شحن مجاني', 'ضمان', 'خلال 14', 'خلال ١٤', 'على مدار الساعة', 'استرداد كامل']) {
      expect(all).not.toContain(claim);
    }
  });
});
