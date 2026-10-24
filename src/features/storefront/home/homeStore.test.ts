import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeSectionMeta } from './homeStore';

// Dedicated coverage for the homepage content store: persistence,
// migration/sanitization of stored data, section ordering/visibility, and
// forward-compat merging (a section the stored data predates must still
// appear, defaulted visible, at the end).

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

let storage: Storage;

async function freshHomeStore() {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  return import('./homeStore');
}

beforeEach(() => {
  storage = memoryStorage();
});

describe('homeStore — defaults and persistence', () => {
  it('seeds all 11 sections in the documented order, with the superseded/unused five hidden', async () => {
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections.map((s) => s.key)).toEqual([
      'hero',
      'shopCategories',
      'collections',
      'bestSellers',
      'story',
      'categories',
      'products',
      'brand',
      'editorial',
      'collection',
      'newsletter',
    ]);
    expect(
      home
        .getHomeContent()
        .sections.filter((s) => !s.visible)
        .map((s) => s.key),
    ).toEqual(['categories', 'products', 'brand', 'editorial', 'collection']);
  });

  it('persists a section update and survives a fresh module reload', async () => {
    const home1 = await freshHomeStore();
    const hero = home1.getHomeContent().hero;
    home1.updateHomeSection('hero', {
      slides: hero.slides.map((s, i) => (i === 0 ? { ...s, title: 'عنوان جديد' } : s)),
    });
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().hero.slides[0].title).toBe('عنوان جديد');
  });

  it('setHomeSections reorders and toggles visibility together', async () => {
    const home = await freshHomeStore();
    const reordered: HomeSectionMeta[] = [
      { key: 'newsletter', visible: false },
      { key: 'hero', visible: true },
    ];
    home.setHomeSections(reordered);
    expect(home.getHomeContent().sections).toEqual(reordered);
  });

  it('resetHomeContent restores the seeded defaults after edits', async () => {
    const home = await freshHomeStore();
    const hero = home.getHomeContent().hero;
    home.updateHomeSection('hero', { slides: hero.slides.map((s) => ({ ...s, title: 'مؤقت' })) });
    home.setHomeSections([{ key: 'hero', visible: false }]);
    home.resetHomeContent();
    expect(home.getHomeContent().hero.slides[0].title).not.toBe('مؤقت');
    expect(home.getHomeContent().sections).toHaveLength(11);
    expect(home.getHomeContent().sections.filter((s) => s.visible)).toHaveLength(6);
  });
});

describe('homeStore — migration and sanitization of stored data', () => {
  it('falls back to defaults when the stored value is malformed JSON', async () => {
    storage.setItem('taybah:homepage', '{not json');
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections).toHaveLength(11);
  });

  it('falls back to defaults when the stored value is not an object', async () => {
    storage.setItem('taybah:homepage', JSON.stringify('just a string'));
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections).toHaveLength(11);
  });

  it('drops an unknown section key and a duplicate of a known one', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        sections: [
          { key: 'hero', visible: false },
          { key: 'hero', visible: true }, // duplicate — first occurrence wins
          { key: 'not-a-real-section', visible: true },
        ],
      }),
    );
    const home = await freshHomeStore();
    const heroEntries = home.getHomeContent().sections.filter((s) => s.key === 'hero');
    expect(heroEntries).toEqual([{ key: 'hero', visible: false }]);
    const keys: string[] = home.getHomeContent().sections.map((s) => s.key);
    expect(keys).not.toContain('not-a-real-section');
  });

  it('appends a section the stored data predates, defaulted visible, at the end', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        sections: [{ key: 'hero', visible: true }], // an "old" save missing every other section
      }),
    );
    const home = await freshHomeStore();
    const keys = home.getHomeContent().sections.map((s) => s.key);
    expect(keys[0]).toBe('hero');
    expect(keys).toContain('newsletter'); // appended, not lost
    expect(home.getHomeContent().sections.find((s) => s.key === 'newsletter')?.visible).toBe(true);
  });

  it('upgrades a pre-existing save: new sections slot under the hero, superseded ones hide', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        sections: [
          { key: 'hero', visible: true },
          { key: 'categories', visible: true },
          { key: 'products', visible: true },
          { key: 'brand', visible: true },
          { key: 'newsletter', visible: true },
        ],
      }),
    );
    const home = await freshHomeStore();
    const sections = home.getHomeContent().sections;
    expect(sections.slice(0, 5).map((s) => s.key)).toEqual([
      'hero',
      'shopCategories',
      'collections',
      'bestSellers',
      'story',
    ]);
    expect(sections.slice(0, 5).every((s) => s.visible)).toBe(true);
    for (const key of ['categories', 'products', 'brand']) {
      expect(sections.find((s) => s.key === key)?.visible).toBe(false);
    }
    expect(sections.find((s) => s.key === 'newsletter')?.visible).toBe(true);
  });

  it('does not re-hide superseded sections once the new sections are in the saved order', async () => {
    const home1 = await freshHomeStore();
    const sections = home1
      .getHomeContent()
      .sections.map((m) => (m.key === 'brand' ? { ...m, visible: true } : m));
    home1.setHomeSections(sections);
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().sections.find((m) => m.key === 'brand')?.visible).toBe(true);
  });

  it('sanitizes stored homepage cards and keeps catalog references only', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        shopCategories: { cards: [{ slug: 'rugs', title: 5 }, { title: 'no slug' }, null] },
        collections: { cards: 'nope' },
        bestSellers: { productIds: ['a', 3, 'b'] },
      }),
    );
    const home = await freshHomeStore();
    const c = home.getHomeContent();
    expect(c.shopCategories.cards).toEqual([{ slug: 'rugs', title: '', subtitle: '', image: '' }]);
    expect(c.collections.cards.length).toBe(3); // invalid stored value -> defaults
    expect(c.bestSellers.productIds).toEqual(['a', 'b']);
    expect(c.story.ctaTo).toBe('/about'); // untouched section defaults survive
  });

  it('persists edited card config across a reload', async () => {
    const home1 = await freshHomeStore();
    home1.updateHomeSection('collections', {
      ...home1.getHomeContent().collections,
      cards: [{ slug: 'atelier', title: 'عنوان', description: '', image: 'local:abc' }],
    });
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().collections.cards).toEqual([
      { slug: 'atelier', title: 'عنوان', description: '', image: 'local:abc' },
    ]);
  });

  it('merges a partially-stored section onto the defaults rather than replacing it wholesale', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({ hero: { title: 'فقط العنوان تغيّر' } }),
    );
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.every((s) => s.title === 'فقط العنوان تغيّر')).toBe(true); // legacy: one shared title
    expect(slides.every((s) => s.image.length > 0)).toBe(true); // images survive from defaults
    expect(slides[0].primaryLabel).toBe('تسوّق المجموعة'); // untouched legacy fields keep their old values
  });

  it('migrates a legacy single hero image into the images list', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({ hero: { image: 'local:legacy-hero' } }),
    );
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides.map((s) => s.image)).toEqual(['local:legacy-hero']);
    expect((home.getHomeContent().hero as unknown as Record<string, unknown>).image).toBeUndefined();
  });

  it('falls back to the default slides when stored hero images are empty or invalid', async () => {
    storage.setItem('taybah:homepage', JSON.stringify({ hero: { images: [] } }));
    const home = await freshHomeStore();
    expect(home.getHomeContent().hero.slides.length).toBeGreaterThan(0);
  });

  it('seeds three slides, each with its own image, copy and an existing route', async () => {
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides.map((s) => s.primaryTo)).toEqual(['/category/rugs', '/category/furnishings', '/collections']);
    expect(new Set(slides.map((s) => s.title)).size).toBe(3);
    expect(new Set(slides.map((s) => s.body)).size).toBe(3);
    expect(new Set(slides.map((s) => s.image)).size).toBe(3);
    expect(new Set(slides.map((s) => s.id)).size).toBe(3);
    expect(slides.every((s) => s.visible && s.secondaryLabel === '')).toBe(true);
  });

  it('editing one slide leaves the others untouched and persists across a reload', async () => {
    const home1 = await freshHomeStore();
    const before = home1.getHomeContent().hero.slides;
    home1.updateHomeSection('hero', {
      slides: before.map((s) => (s.id === 'hero-2' ? { ...s, title: 'عنوان الشريحة الثانية', visible: false } : s)),
    });
    const home2 = await freshHomeStore();
    const after = home2.getHomeContent().hero.slides;
    expect(after[1].title).toBe('عنوان الشريحة الثانية');
    expect(after[1].visible).toBe(false);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
  });

  it('keeps slide order, additions and removals exactly as saved', async () => {
    const home1 = await freshHomeStore();
    const [a, b, c] = home1.getHomeContent().hero.slides;
    const added = { ...a, id: 'extra', title: 'شريحة جديدة', image: 'local:new' };
    home1.updateHomeSection('hero', { slides: [c, added, a] }); // reordered, b deleted, one added
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().hero.slides.map((s) => s.id)).toEqual([c.id, 'extra', a.id]);
    expect(home2.getHomeContent().hero.slides.some((s) => s.id === b.id)).toBe(false);
  });

  it('turns a legacy shared-text save into one slide per image, keeping the saved text', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        hero: { title: 'عنوان مخصص', body: 'وصف مخصص', images: ['local:one', 'local:two'] },
      }),
    );
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides.map((s) => s.image)).toEqual(['local:one', 'local:two']);
    expect(slides.every((s) => s.title === 'عنوان مخصص' && s.body === 'وصف مخصص')).toBe(true);
    expect(new Set(slides.map((s) => s.id)).size).toBe(2);
  });

  it('gives an untouched legacy save the new distinct per-slide copy, keeping its images', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        hero: {
          title: 'حيث تلتقي الحِرفة بالفخامة',
          body: 'سجاد وستائر ومفروشات مختارة بعناية — قطع تحمل روح التراث وتُصمَّم لبيوت اليوم.',
          images: ['local:a', 'local:b', 'local:c'],
        },
      }),
    );
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides.map((s) => s.image)).toEqual(['local:a', 'local:b', 'local:c']);
    expect(new Set(slides.map((s) => s.title)).size).toBe(3);
  });

  it('sanitizes a stored slides array (bad entries dropped, duplicate ids fixed, empty -> defaults)', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({
        hero: {
          slides: [
            { id: 'x', image: 'local:1', title: 5, visible: false },
            { id: 'x', image: 'local:2', title: 'ب' },
            null,
            'nope',
          ],
        },
      }),
    );
    const home = await freshHomeStore();
    const { slides } = home.getHomeContent().hero;
    expect(slides).toHaveLength(2);
    expect(new Set(slides.map((s) => s.id)).size).toBe(2);
    expect(slides[0].title).toBe('');
    expect(slides[0].visible).toBe(false);
    expect(slides[1].title).toBe('ب');

    storage.setItem('taybah:homepage', JSON.stringify({ hero: { slides: [] } }));
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().hero.slides).toHaveLength(3);
  });

  it('treats visible as true unless explicitly false (tolerates a missing/invalid flag)', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({ sections: [{ key: 'hero' /* no visible flag at all */ }] }),
    );
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections.find((s) => s.key === 'hero')?.visible).toBe(true);
  });
});

describe('homeStore — Supabase row mapping', () => {
  it('rowsFromHomeContent serializes order, visibility and per-section data into every row', async () => {
    const home = await freshHomeStore();
    const c = home.getHomeContent();
    const rows = home.rowsFromHomeContent(c);
    expect(rows).toHaveLength(c.sections.length);
    for (const [i, row] of rows.entries()) {
      expect(row.display_order).toBe(i);
      expect(row.id).toBe(c.sections[i].key);
      expect(row.enabled).toBe(c.sections[i].visible);
      expect(row.data).toEqual(c[c.sections[i].key]);
    }
  });

  it('homeContentFromRows round-trips a saved snapshot exactly', async () => {
    const home = await freshHomeStore();
    const base = home.getHomeContent();
    const rebuilt = home.homeContentFromRows(home.rowsFromHomeContent(base), base);
    expect(rebuilt.sections).toEqual(base.sections);
    expect(rebuilt.hero).toEqual(base.hero);
    expect(rebuilt.newsletter).toEqual(base.newsletter);
    expect(rebuilt.bestSellers.productIds).toEqual(base.bestSellers.productIds);
  });

  it('honors server order/visibility and appends rowless sections hidden, keeping their local data', async () => {
    const home = await freshHomeStore();
    const base = home.getHomeContent();
    const rows = [
      { id: 'newsletter', enabled: true, display_order: 0, data: base.newsletter },
      { id: 'hero', enabled: false, display_order: 1, data: base.hero },
    ];
    const rebuilt = home.homeContentFromRows(rows, base);
    expect(rebuilt.sections.slice(0, 2)).toEqual([
      { key: 'newsletter', visible: true },
      { key: 'hero', visible: false },
    ]);
    // Every section the server didn't return is present but hidden.
    expect(rebuilt.sections).toHaveLength(11);
    expect(rebuilt.sections.slice(2).every((s) => !s.visible)).toBe(true);
    // Its data comes from the local base, not the defaults — so a
    // public-scope fetch can't clobber an admin's saved-but-hidden content.
    const storyBase = base.story;
    expect(rebuilt.story).toEqual(storyBase);
  });

  it('skips unknown/duplicate row ids and sanitizes row data', async () => {
    const home = await freshHomeStore();
    const base = home.getHomeContent();
    const rebuilt = home.homeContentFromRows(
      [
        { id: 'not-real', enabled: true, display_order: 0, data: {} },
        { id: 'hero', enabled: true, display_order: 1, data: { nope: true } },
        { id: 'hero', enabled: false, display_order: 2, data: base.hero },
      ],
      base,
    );
    expect(rebuilt.sections.map((s) => s.key)).not.toContain('not-real');
    expect(rebuilt.sections.filter((s) => s.key === 'hero')).toEqual([{ key: 'hero', visible: true }]);
    // Malformed row data falls back to sanitized defaults, not a crash.
    expect(rebuilt.hero.slides.length).toBeGreaterThan(0);
  });
});
