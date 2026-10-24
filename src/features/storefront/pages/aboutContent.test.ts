import { describe, expect, it } from 'vitest';
import { aboutContent } from './aboutContent';

describe('aboutContent', () => {
  it('has matching structure in Arabic and English', () => {
    const shape = (l: 'ar' | 'en') => ({
      values: aboutContent[l].values.map((v) => v.id),
      diffs: aboutContent[l].diffs.map((d) => d.id),
      story: aboutContent[l].story.length,
    });
    expect(shape('ar')).toEqual(shape('en'));
  });

  it('keeps the existing story, four values and three differentiators', () => {
    const t = aboutContent.ar;
    expect(t.story).toHaveLength(2);
    expect(t.story[0]).toContain('بدأت طيبة من فكرة بسيطة');
    expect(t.values.map((v) => v.h)).toEqual(['الأصالة', 'الجودة أولًا', 'الهدوء البصري', 'الشفافية']);
    expect(t.diffs).toHaveLength(3);
  });

  it('contains no invented statistics, dates or counts', () => {
    for (const locale of ['ar', 'en'] as const) {
      const t = aboutContent[locale];
      const text = [t.intro, ...t.story, ...t.values.flatMap((v) => [v.h, v.p]), ...t.diffs.map((d) => d.text), t.cta.heading, t.cta.body].join(' ');
      expect(text, locale).not.toMatch(/[0-9٠-٩]/);
    }
  });
});
