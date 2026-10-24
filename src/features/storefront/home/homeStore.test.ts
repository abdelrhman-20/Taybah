import { describe, expect, it } from 'vitest';
import type { HomeSectionMeta } from './homeStore';
import { freshBackend, reloadWith, type Backend } from '../../../test/harness';

// Homepage content store: defaults, sanitization/migration of data (pure
// migrateHomeContent), row mapping, and — the part that matters for the
// "changes don't stick" reports — persistence behavior against the FAKE
// backend (client.mock.ts): nothing is applied locally until the server
// confirmed it and a read-back matched; failures leave what is shown
// unchanged; saves are built on a fresh read, never a stale copy.

async function loadHome(role: 'anon' | 'user' | 'admin' = 'admin') {
  const b = await freshBackend(role);
  const home = await import('./homeStore');
  await home.refreshHomeContent();
  return { b, home };
}

// Writes the 11 default rows straight into the fake database (as a previous
// successful admin save would have).
function seedRows(b: Backend, home: typeof import('./homeStore'), mutate?: (c: ReturnType<typeof home.defaultContent>) => void) {
  const c = home.defaultContent();
  mutate?.(c);
  for (const r of home.rowsFromHomeContent(c)) b.tables.home_sections.push({ ...r });
}

describe('homeStore — defaults', () => {
  it('seeds all 11 sections in the documented order, with the superseded/unused five hidden', async () => {
    const { home } = await loadHome();
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

  it('seeds three slides, each with its own image, copy and an existing route', async () => {
    const { home } = await loadHome();
    const { slides } = home.getHomeContent().hero;
    expect(slides.map((s) => s.primaryTo)).toEqual(['/category/rugs', '/category/furnishings', '/collections']);
    expect(new Set(slides.map((s) => s.title)).size).toBe(3);
    expect(new Set(slides.map((s) => s.body)).size).toBe(3);
    expect(new Set(slides.map((s) => s.image)).size).toBe(3);
    expect(new Set(slides.map((s) => s.id)).size).toBe(3);
    expect(slides.every((s) => s.visible && s.secondaryLabel === '')).toBe(true);
  });
});

describe('homeStore — persistence (database is the only store)', () => {
  it('a confirmed save is stored in the database, shown, and survives a reload / fresh private window', async () => {
    const { b, home } = await loadHome('admin');
    const hero = home.getHomeContent().hero;
    await home.updateHomeSection('hero', {
      slides: hero.slides.map((s, i) => (i === 0 ? { ...s, title: 'عنوان جديد' } : s)),
    });
    expect(home.getHomeContent().hero.slides[0].title).toBe('عنوان جديد');

    // a visitor in a brand-new private window (no browser storage at all)
    const b2 = await reloadWith(b, 'anon');
    const home2 = await import('./homeStore');
    await home2.refreshHomeContent();
    expect(b2.role).toBe('anon');
    expect(home2.getHomeContent().hero.slides[0].title).toBe('عنوان جديد');
  });

  it('setHomeSections reorders and toggles visibility together', async () => {
    const { b, home } = await loadHome();
    seedRows(b, home);
    const reordered: HomeSectionMeta[] = [
      { key: 'newsletter', visible: false },
      { key: 'hero', visible: true },
    ];
    await home.setHomeSections(reordered);
    const got = home.getHomeContent().sections;
    expect(got.slice(0, 2)).toEqual(reordered);
  });

  it('resetHomeContent restores the seeded defaults after edits', async () => {
    const { home } = await loadHome();
    const hero = home.getHomeContent().hero;
    await home.updateHomeSection('hero', { slides: hero.slides.map((s) => ({ ...s, title: 'مؤقت' })) });
    await home.setHomeSections([{ key: 'hero', visible: false }]);
    await home.resetHomeContent();
    expect(home.getHomeContent().hero.slides[0].title).not.toBe('مؤقت');
    expect(home.getHomeContent().sections).toHaveLength(11);
    expect(home.getHomeContent().sections.filter((s) => s.visible)).toHaveLength(6);
  });

  it('a REJECTED save changes nothing that is shown (no optimistic apply)', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    const before = home.getHomeContent().hero.slides[0].title;
    b.failNext('from:home_sections:upsert', { code: '42501', message: 'new row violates row-level security policy' });
    await expect(
      home.updateHomeSection('hero', {
        slides: home.getHomeContent().hero.slides.map((s, i) => (i === 0 ? { ...s, title: 'لن يُحفظ' } : s)),
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(home.getHomeContent().hero.slides[0].title).toBe(before);
    // and the database was not touched
    const heroRow = b.tables.home_sections.find((r) => r.id === 'hero')!;
    expect((heroRow.data as { slides: Array<{ title: string }> }).slides[0].title).toBe(before);
  });

  it('a non-admin save is rejected BEFORE any write is attempted', async () => {
    const { b, home } = await loadHome('user');
    await expect(
      home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'x' }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(b.calls('from:home_sections:upsert')).toBe(0);
  });

  it('an upsert that silently affected zero rows is an error, not a success', async () => {
    const { b, home } = await loadHome('admin');
    b.respondNext('from:home_sections:upsert', []);
    await expect(
      home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'لا يثبت' }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(home.getHomeContent().story.title).not.toBe('لا يثبت');
  });

  it('a network failure during save is classified and leaves content unchanged', async () => {
    const { b, home } = await loadHome('admin');
    const before = home.getHomeContent().story.title;
    b.failNext('from:home_sections:upsert', new TypeError('Failed to fetch'), { reject: true });
    await expect(
      home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'x' }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(home.getHomeContent().story.title).toBe(before);
  });

  it('refuses to overwrite a section that changed on the server since the editor opened (conflict)', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    const base = structuredClone(home.getHomeContent().story); // editor opens
    // another admin saves the same section meanwhile
    const row = b.tables.home_sections.find((r) => r.id === 'story')!;
    (row.data as { title: string }).title = 'نسخة المسؤول الآخر';
    await expect(
      home.updateHomeSection('story', { ...base, title: 'نسختي' }, { base }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((row.data as { title: string }).title).toBe('نسخة المسؤول الآخر');
  });

  it('saving one section never overwrites OTHER sections with a stale in-memory copy', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent(); // this tab now holds the old newsletter title
    // another admin edits the newsletter after this tab loaded
    const nl = b.tables.home_sections.find((r) => r.id === 'newsletter')!;
    (nl.data as { title: string }).title = 'عنوان جديد من مكان آخر';
    // this tab edits only the story
    await home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'قصة جديدة' });
    expect((nl.data as { title: string }).title).toBe('عنوان جديد من مكان آخر'); // untouched
    expect(home.getHomeContent().newsletter.title).toBe('عنوان جديد من مكان آخر'); // and now shown
  });

  it('never replaces a hidden section\'s saved content with defaults', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home, (c) => {
      c.brand = { ...c.brand, title: 'محتوى مخفي محفوظ' };
      c.sections = c.sections.map((s) => (s.key === 'brand' ? { ...s, visible: false } : s));
    });
    await home.refreshHomeContent();
    await home.updateHomeSection('hero', {
      slides: home.getHomeContent().hero.slides.map((s, i) => (i === 0 ? { ...s, title: 'تعديل' } : s)),
    });
    const brand = b.tables.home_sections.find((r) => r.id === 'brand')!;
    expect((brand.data as { title: string }).title).toBe('محتوى مخفي محفوظ');
    expect(brand.enabled).toBe(false);
  });

  it('an anonymous visitor never receives hidden sections; an admin does', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home, (c) => {
      c.brand = { ...c.brand, title: 'سر مخفي' };
    });
    await home.refreshHomeContent();
    expect(home.getHomeContent().brand.title).toBe('سر مخفي'); // admin sees it
    await reloadWith(b, 'anon');
    const anonHome = await import('./homeStore');
    await anonHome.refreshHomeContent();
    expect(anonHome.getHomeContent().brand.title).not.toBe('سر مخفي');
  });

  it('writes only the rows that changed', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    const snapshot = JSON.stringify(b.tables.home_sections.filter((r) => r.id !== 'story'));
    await home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'فقط هذا' });
    expect(JSON.stringify(b.tables.home_sections.filter((r) => r.id !== 'story'))).toBe(snapshot);
  });

  it('two saves fired together are applied in order, the second on top of the first', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    await Promise.all([
      home.updateHomeSection('story', { ...home.getHomeContent().story, title: 'أولًا' }),
      home.updateHomeSection('newsletter', { ...home.getHomeContent().newsletter, title: 'ثانيًا' }),
    ]);
    expect(home.getHomeContent().story.title).toBe('أولًا');
    expect(home.getHomeContent().newsletter.title).toBe('ثانيًا');
    const rows = Object.fromEntries(b.tables.home_sections.map((r) => [r.id as string, r.data as { title: string }]));
    expect(rows.story.title).toBe('أولًا');
    expect(rows.newsletter.title).toBe('ثانيًا');
  });

  it('saving an unchanged value writes nothing', async () => {
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    await home.updateHomeSection('story', home.getHomeContent().story);
    expect(b.calls('from:home_sections:upsert')).toBe(0);
  });

  it('a failed first load is reported as an error state (not silently as defaults)', async () => {
    const b = await freshBackend('admin');
    b.failNext('from:home_sections:select', { message: 'Failed to fetch' }, { reject: true });
    const home = await import('./homeStore');
    await new Promise((r) => setTimeout(r, 0)); // let the import-time load settle
    expect(home.getHomeSyncState()).toMatchObject({ status: 'error', hadData: false });
  });
});

describe('migrateHomeContent — migration and sanitization of stored data', () => {
  it('falls back to defaults when the value is not an object', async () => {
    const home = await import('./homeStore');
    expect(home.migrateHomeContent('just a string' as never).sections).toHaveLength(11);
    expect(home.migrateHomeContent(null).sections).toHaveLength(11);
  });

  it('drops an unknown section key and a duplicate of a known one', async () => {
    const home = await import('./homeStore');
    const out = home.migrateHomeContent({
      sections: [
        { key: 'hero', visible: false },
        { key: 'hero', visible: true }, // duplicate — first occurrence wins
        { key: 'not-a-real-section', visible: true },
      ] as never,
    });
    expect(out.sections.filter((s) => s.key === 'hero')).toEqual([{ key: 'hero', visible: false }]);
    const keys: string[] = out.sections.map((s) => s.key);
    expect(keys).not.toContain('not-a-real-section');
  });

  it('appends a section the stored data predates, defaulted visible, at the end', async () => {
    const home = await import('./homeStore');
    const out = home.migrateHomeContent({ sections: [{ key: 'hero', visible: true }] });
    const keys = out.sections.map((s) => s.key);
    expect(keys[0]).toBe('hero');
    expect(keys).toContain('newsletter'); // appended, not lost
    expect(out.sections.find((s) => s.key === 'newsletter')?.visible).toBe(true);
  });

  it('upgrades a pre-existing save: new sections slot under the hero, superseded ones hide', async () => {
    const home = await import('./homeStore');
    const out = home.migrateHomeContent({
      sections: [
        { key: 'hero', visible: true },
        { key: 'categories', visible: true },
        { key: 'products', visible: true },
        { key: 'brand', visible: true },
        { key: 'newsletter', visible: true },
      ],
    });
    const sections = out.sections;
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
    const { b, home } = await loadHome('admin');
    seedRows(b, home);
    await home.refreshHomeContent();
    const sections = home.getHomeContent().sections.map((m) => (m.key === 'brand' ? { ...m, visible: true } : m));
    await home.setHomeSections(sections);
    await reloadWith(b, 'admin');
    const home2 = await import('./homeStore');
    await home2.refreshHomeContent();
    expect(home2.getHomeContent().sections.find((m) => m.key === 'brand')?.visible).toBe(true);
  });

  it('sanitizes stored homepage cards and keeps catalog references only', async () => {
    const home = await import('./homeStore');
    const c = home.migrateHomeContent({
      shopCategories: { cards: [{ slug: 'rugs', title: 5 }, { title: 'no slug' }, null] },
      collections: { cards: 'nope' },
      bestSellers: { productIds: ['a', 3, 'b'] },
    } as never);
    expect(c.shopCategories.cards).toEqual([{ slug: 'rugs', title: '', subtitle: '', image: '' }]);
    expect(c.collections.cards.length).toBe(3); // invalid stored value -> defaults
    expect(c.bestSellers.productIds).toEqual(['a', 'b']);
    expect(c.story.ctaTo).toBe('/about'); // untouched section defaults survive
  });

  it('persists edited card config across a reload', async () => {
    const { b, home } = await loadHome('admin');
    await home.updateHomeSection('collections', {
      ...home.getHomeContent().collections,
      cards: [{ slug: 'atelier', title: 'عنوان', description: '', image: 'local:abc' }],
    });
    await reloadWith(b, 'anon');
    const home2 = await import('./homeStore');
    await home2.refreshHomeContent();
    expect(home2.getHomeContent().collections.cards).toEqual([
      { slug: 'atelier', title: 'عنوان', description: '', image: 'local:abc' },
    ]);
  });

  it('merges a partially-stored section onto the defaults rather than replacing it wholesale', async () => {
    const home = await import('./homeStore');
    const { slides } = home.migrateHomeContent({ hero: { title: 'فقط العنوان تغيّر' } } as never).hero;
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.every((s) => s.title === 'فقط العنوان تغيّر')).toBe(true); // legacy: one shared title
    expect(slides.every((s) => s.image.length > 0)).toBe(true); // images survive from defaults
    expect(slides[0].primaryLabel).toBe('تسوّق المجموعة'); // untouched legacy fields keep their old values
  });

  it('migrates a legacy single hero image into the images list', async () => {
    const home = await import('./homeStore');
    const out = home.migrateHomeContent({ hero: { image: 'local:legacy-hero' } } as never);
    expect(out.hero.slides.map((s) => s.image)).toEqual(['local:legacy-hero']);
    expect((out.hero as unknown as Record<string, unknown>).image).toBeUndefined();
  });

  it('falls back to the default slides when stored hero images are empty or invalid', async () => {
    const home = await import('./homeStore');
    expect(home.migrateHomeContent({ hero: { images: [] } } as never).hero.slides.length).toBeGreaterThan(0);
  });

  it('editing one slide leaves the others untouched and persists across a reload', async () => {
    const { b, home } = await loadHome('admin');
    const before = home.getHomeContent().hero.slides;
    await home.updateHomeSection('hero', {
      slides: before.map((s) => (s.id === 'hero-2' ? { ...s, title: 'عنوان الشريحة الثانية', visible: false } : s)),
    });
    await reloadWith(b, 'anon');
    const home2 = await import('./homeStore');
    await home2.refreshHomeContent();
    const after = home2.getHomeContent().hero.slides;
    expect(after[1].title).toBe('عنوان الشريحة الثانية');
    expect(after[1].visible).toBe(false);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
  });

  it('keeps slide order, additions and removals exactly as saved', async () => {
    const { b, home } = await loadHome('admin');
    const [a, bb, c] = home.getHomeContent().hero.slides;
    const added = { ...a, id: 'extra', title: 'شريحة جديدة', image: 'local:new' };
    await home.updateHomeSection('hero', { slides: [c, added, a] }); // reordered, b deleted, one added
    await reloadWith(b, 'anon');
    const home2 = await import('./homeStore');
    await home2.refreshHomeContent();
    expect(home2.getHomeContent().hero.slides.map((s) => s.id)).toEqual([c.id, 'extra', a.id]);
    expect(home2.getHomeContent().hero.slides.some((s) => s.id === bb.id)).toBe(false);
  });

  it('turns a legacy shared-text save into one slide per image, keeping the saved text', async () => {
    const home = await import('./homeStore');
    const { slides } = home.migrateHomeContent({
      hero: { title: 'عنوان مخصص', body: 'وصف مخصص', images: ['local:one', 'local:two'] },
    } as never).hero;
    expect(slides.map((s) => s.image)).toEqual(['local:one', 'local:two']);
    expect(slides.every((s) => s.title === 'عنوان مخصص' && s.body === 'وصف مخصص')).toBe(true);
    expect(new Set(slides.map((s) => s.id)).size).toBe(2);
  });

  it('gives an untouched legacy save the new distinct per-slide copy, keeping its images', async () => {
    const home = await import('./homeStore');
    const { slides } = home.migrateHomeContent({
      hero: {
        title: 'حيث تلتقي الحِرفة بالفخامة',
        body: 'سجاد وستائر ومفروشات مختارة بعناية — قطع تحمل روح التراث وتُصمَّم لبيوت اليوم.',
        images: ['local:a', 'local:b', 'local:c'],
      },
    } as never).hero;
    expect(slides.map((s) => s.image)).toEqual(['local:a', 'local:b', 'local:c']);
    expect(new Set(slides.map((s) => s.title)).size).toBe(3);
  });

  it('sanitizes a stored slides array (bad entries dropped, duplicate ids fixed, empty -> defaults)', async () => {
    const home = await import('./homeStore');
    const { slides } = home.migrateHomeContent({
      hero: {
        slides: [
          { id: 'x', image: 'local:1', title: 5, visible: false },
          { id: 'x', image: 'local:2', title: 'ب' },
          null,
          'nope',
        ],
      },
    } as never).hero;
    expect(slides).toHaveLength(2);
    expect(new Set(slides.map((s) => s.id)).size).toBe(2);
    expect(slides[0].title).toBe('');
    expect(slides[0].visible).toBe(false);
    expect(slides[1].title).toBe('ب');
    expect(home.migrateHomeContent({ hero: { slides: [] } } as never).hero.slides).toHaveLength(3);
  });

  it('treats visible as true unless explicitly false (tolerates a missing/invalid flag)', async () => {
    const home = await import('./homeStore');
    const out = home.migrateHomeContent({ sections: [{ key: 'hero' }] } as never);
    expect(out.sections.find((s) => s.key === 'hero')?.visible).toBe(true);
  });
});

describe('homeStore — Supabase row mapping', () => {
  it('rowsFromHomeContent serializes order, visibility and per-section data into every row', async () => {
    const { home } = await loadHome();
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
    const { home } = await loadHome();
    const base = home.getHomeContent();
    const rebuilt = home.homeContentFromRows(home.rowsFromHomeContent(base), base);
    expect(rebuilt.sections).toEqual(base.sections);
    expect(rebuilt.hero).toEqual(base.hero);
    expect(rebuilt.newsletter).toEqual(base.newsletter);
    expect(rebuilt.bestSellers.productIds).toEqual(base.bestSellers.productIds);
  });

  it('honors server order/visibility and appends rowless sections hidden, keeping base data', async () => {
    const { home } = await loadHome();
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
    expect(rebuilt.story).toEqual(base.story);
  });

  it('skips unknown/duplicate row ids and sanitizes row data', async () => {
    const { home } = await loadHome();
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
