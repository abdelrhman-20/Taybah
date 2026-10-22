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
  it('seeds all 7 sections visible, in the documented default order', async () => {
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections.map((s) => s.key)).toEqual([
      'hero',
      'categories',
      'products',
      'brand',
      'editorial',
      'collection',
      'newsletter',
    ]);
    expect(home.getHomeContent().sections.every((s) => s.visible)).toBe(true);
  });

  it('persists a section update and survives a fresh module reload', async () => {
    const home1 = await freshHomeStore();
    home1.updateHomeSection('hero', { ...home1.getHomeContent().hero, title: 'عنوان جديد' });
    const home2 = await freshHomeStore();
    expect(home2.getHomeContent().hero.title).toBe('عنوان جديد');
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
    home.updateHomeSection('hero', { ...home.getHomeContent().hero, title: 'مؤقت' });
    home.setHomeSections([{ key: 'hero', visible: false }]);
    home.resetHomeContent();
    expect(home.getHomeContent().hero.title).not.toBe('مؤقت');
    expect(home.getHomeContent().sections).toHaveLength(7);
    expect(home.getHomeContent().sections.every((s) => s.visible)).toBe(true);
  });
});

describe('homeStore — migration and sanitization of stored data', () => {
  it('falls back to defaults when the stored value is malformed JSON', async () => {
    storage.setItem('taybah:homepage', '{not json');
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections).toHaveLength(7);
  });

  it('falls back to defaults when the stored value is not an object', async () => {
    storage.setItem('taybah:homepage', JSON.stringify('just a string'));
    const home = await freshHomeStore();
    expect(home.getHomeContent().sections).toHaveLength(7);
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

  it('merges a partially-stored section onto the defaults rather than replacing it wholesale', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({ hero: { title: 'فقط العنوان تغيّر' } }),
    );
    const home = await freshHomeStore();
    expect(home.getHomeContent().hero.title).toBe('فقط العنوان تغيّر');
    expect(home.getHomeContent().hero.images.length).toBeGreaterThan(0); // untouched fields survive from defaults
  });

  it('migrates a legacy single hero image into the images list', async () => {
    storage.setItem(
      'taybah:homepage',
      JSON.stringify({ hero: { image: 'local:legacy-hero' } }),
    );
    const home = await freshHomeStore();
    expect(home.getHomeContent().hero.images).toEqual(['local:legacy-hero']);
    expect((home.getHomeContent().hero as Record<string, unknown>).image).toBeUndefined();
  });

  it('falls back to the default slides when stored hero images are empty or invalid', async () => {
    storage.setItem('taybah:homepage', JSON.stringify({ hero: { images: [] } }));
    const home = await freshHomeStore();
    expect(home.getHomeContent().hero.images.length).toBeGreaterThan(0);
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
