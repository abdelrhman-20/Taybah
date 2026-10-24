import { describe, expect, it } from 'vitest';
import { defaultNav, flattenForFooter, isSafeNavUrl, migrateNav } from './navStore';
import type { StorefrontNavItem } from './navStore';
import { freshBackend, type Backend } from '../../../test/harness';

// Navigation store: URL safety, sanitization of malformed data (pure
// migrateNav), hierarchy rules, and persistence through the FAKE backend
// (client.mock.ts) — saves resolve only after the server confirmed, failures
// leave the displayed menu untouched.

async function loadNav(b: Backend, seed?: { main?: unknown[]; footer?: unknown[] }) {
  b.setInitialized(true);
  if (seed?.main) b.putDoc('nav', 'main', { items: seed.main });
  if (seed?.footer) b.putDoc('nav', 'footer', { items: seed.footer });
  const docs = await import('../catalog/catalogDocs');
  const nav = await import('./navStore');
  await docs.whenDocsSettled();
  return { nav, docs };
}

const leaf = (id: string, over: Partial<StorefrontNavItem> = {}): StorefrontNavItem => ({
  id,
  label: id,
  kind: 'internal',
  path: `/${id}`,
  visible: true,
  ...over,
});

describe('isSafeNavUrl', () => {
  it('accepts an internal path starting with a single slash', () => {
    expect(isSafeNavUrl('internal', '/products')).toBe(true);
  });

  it('rejects a protocol-relative internal path (//evil.com)', () => {
    expect(isSafeNavUrl('internal', '//evil.com')).toBe(false);
  });

  it('rejects an internal path with no leading slash', () => {
    expect(isSafeNavUrl('internal', 'products')).toBe(false);
  });

  it('accepts an external https/http URL', () => {
    expect(isSafeNavUrl('external', 'https://example.com')).toBe(true);
    expect(isSafeNavUrl('external', 'http://example.com')).toBe(true);
  });

  it('rejects an external URL with an unsafe protocol', () => {
    expect(isSafeNavUrl('external', 'javascript:alert(1)')).toBe(false);
  });

  it('rejects a malformed external URL', () => {
    expect(isSafeNavUrl('external', 'not a url')).toBe(false);
  });
});

describe('navStore — defaults and persistence', () => {
  it('serves the built-in menus until the catalog is migrated', async () => {
    await freshBackend('admin'); // cutover flag NOT set
    const docs = await import('../catalog/catalogDocs');
    const nav = await import('./navStore');
    await docs.whenDocsSettled();
    expect(nav.getNavigation()).toEqual(defaultNav());
  });

  it('reads the stored menus once initialized', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [leaf('only-this')], footer: [leaf('f1')] });
    expect(nav.getNavigation().main.map((i) => i.id)).toEqual(['only-this']);
    expect(nav.getNavigation().footer.map((i) => i.id)).toEqual(['f1']);
  });

  it('upsertNavItem persists to the database and only then updates the menu', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [leaf('a')], footer: [] });
    await nav.upsertNavItem('main', leaf('new-item', { label: 'جديد' }));
    const stored = b.tables.catalog_docs.find((d) => d.kind === 'nav' && d.id === 'main')!;
    expect((stored.data as { items: StorefrontNavItem[] }).items.map((i) => i.id)).toEqual(['a', 'new-item']);
    expect(nav.getNavigation().main.map((i) => i.id)).toEqual(['a', 'new-item']);
    expect(stored.revision).toBe(2);
  });

  it('upsertNavItem replaces an existing item with the same id instead of duplicating it', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [], footer: [leaf('contact', { label: 'الأصلي' })] });
    await nav.upsertNavItem('footer', leaf('contact', { label: 'محدث' }));
    const contacts = nav.getNavigation().footer.filter((i) => i.id === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].label).toBe('محدث');
  });

  it('removeNavItem drops exactly the targeted item', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [leaf('keep'), leaf('temp')], footer: [] });
    await nav.removeNavItem('main', 'temp');
    expect(nav.getNavigation().main.map((i) => i.id)).toEqual(['keep']);
  });

  it('resetNavigation restores both seeded menus in one atomic write', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [], footer: [] });
    await nav.resetNavigation();
    expect(nav.getNavigation().main.length).toBeGreaterThan(0);
    expect(nav.getNavigation().footer.length).toBeGreaterThan(0);
    expect(b.calls('rpc:catalog_write')).toBe(1);
  });

  it('a failed save rejects and leaves the displayed menu unchanged', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [leaf('a')], footer: [] });
    b.failNext('rpc:catalog_write', { code: '42501', message: 'permission denied' });
    await expect(nav.upsertNavItem('main', leaf('b'))).rejects.toMatchObject({ code: 'unauthorized' });
    expect(nav.getNavigation().main.map((i) => i.id)).toEqual(['a']);
  });

  it('a non-admin cannot change the menu', async () => {
    const b = await freshBackend('user');
    const { nav } = await loadNav(b, { main: [leaf('a')], footer: [] });
    await expect(nav.saveNavGroup('main', [])).rejects.toMatchObject({ code: 'unauthorized' });
    expect(nav.getNavigation().main).toHaveLength(1);
  });

  it('refuses edits before the catalog is migrated', async () => {
    const b = await freshBackend('admin');
    const nav = await import('./navStore');
    const docs = await import('../catalog/catalogDocs');
    await docs.whenDocsSettled();
    await expect(nav.saveNavGroup('main', [])).rejects.toMatchObject({ code: 'not_initialized' });
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });
});

describe('flattenForFooter (Phase 2 fix: dropdown-trigger parents were dead footer links)', () => {
  it('keeps a plain leaf item unchanged', () => {
    expect(flattenForFooter([leaf('shop')])).toEqual([leaf('shop')]);
  });

  it('drops an invisible item entirely', () => {
    expect(flattenForFooter([leaf('shop', { visible: false })])).toEqual([]);
  });

  it('flattens a dropdown-trigger parent (empty path) into just its children', () => {
    const parent = { ...leaf('rugs', { path: '' }), children: [leaf('flatweave'), leaf('handknotted')] };
    expect(flattenForFooter([parent])).toEqual([leaf('flatweave'), leaf('handknotted')]);
  });

  it('keeps a parent that has BOTH its own destination and children, plus the children', () => {
    const parent = { ...leaf('rugs'), children: [leaf('flatweave')] }; // path stays '/rugs'
    // The included parent keeps carrying its own `children` — FooterNavLink
    // never reads that field, so it's harmless; only its PRESENCE in the
    // output list (not a stripped copy) is what matters here.
    expect(flattenForFooter([parent])).toEqual([parent, leaf('flatweave')]);
  });

  it('drops an invisible child while keeping its visible siblings', () => {
    const parent = {
      ...leaf('rugs', { path: '' }),
      children: [leaf('flatweave', { visible: false }), leaf('handknotted')],
    };
    expect(flattenForFooter([parent])).toEqual([leaf('handknotted')]);
  });

  it("preserves top-level order while inlining each parent's children in place", () => {
    const a = leaf('shop');
    const b = { ...leaf('rugs', { path: '' }), children: [leaf('flatweave')] };
    const c = leaf('collections');
    expect(flattenForFooter([a, b, c]).map((i) => i.id)).toEqual(['shop', 'flatweave', 'collections']);
  });
});

describe('navStore — hierarchy (main has one child level, footer stays flat)', () => {
  it('keeps a child level on a main-menu item', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, { main: [], footer: [] });
    await nav.saveNavGroup('main', [leaf('rugs', { children: [leaf('flatweave'), leaf('handknotted')] })]);
    expect(nav.getNavigation().main[0].children).toHaveLength(2);
  });

  it('drops a grandchild level — only one level of nesting is ever kept', () => {
    const out = migrateNav({
      main: [{ ...leaf('rugs'), children: [{ ...leaf('flatweave'), children: [leaf('too-deep')] }] }],
      footer: [],
    });
    expect(out.main[0].children).toHaveLength(1);
    expect(out.main[0].children![0].children).toBeUndefined();
  });

  it('strips any children found on a footer item — footer is always flat', () => {
    const out = migrateNav({
      main: [leaf('shop')],
      footer: [{ ...leaf('contact'), children: [leaf('sneaky')] }],
    });
    expect(out.footer[0].children).toBeUndefined();
  });
});

describe('migrateNav — sanitization of invalid/malformed data', () => {
  it('falls back to defaults when the value is not an object', () => {
    expect(migrateNav(null)).toEqual(defaultNav());
    expect(migrateNav('x' as never)).toEqual(defaultNav());
  });

  it('drops a duplicate id, keeping only the first occurrence', () => {
    const out = migrateNav({
      main: [leaf('shop', { label: 'أول' }), leaf('shop', { label: 'ثانٍ' })],
      footer: [],
    });
    const shops = out.main.filter((i) => i.id === 'shop');
    expect(shops).toHaveLength(1);
    expect(shops[0].label).toBe('أول');
  });

  it('drops a leaf item with no destination and no children', () => {
    const out = migrateNav({
      main: [{ id: 'empty', label: 'فاضي', kind: 'internal', path: '', visible: true }],
      footer: [],
    });
    expect(out.main).toEqual([]);
  });

  it('downgrades a parent with an unsafe destination to a pure trigger, keeping its valid children', () => {
    const out = migrateNav({
      main: [
        {
          id: 'rugs',
          label: 'سجاد',
          kind: 'internal',
          path: 'javascript:evil()',
          visible: true,
          children: [leaf('flatweave')],
        },
      ],
      footer: [],
    });
    expect(out.main[0].path).toBe('');
    expect(out.main[0].children).toHaveLength(1);
  });

  it('drops an item with an unsafe destination and no children entirely', () => {
    const out = migrateNav({
      main: [{ id: 'bad', label: 'سيء', kind: 'external', path: 'javascript:evil()', visible: true }],
      footer: [],
    });
    expect(out.main).toEqual([]);
  });

  it('treats a missing visible flag as visible (tolerant default)', () => {
    const out = migrateNav({
      main: [{ id: 'shop', label: 'تسوق', kind: 'internal', path: '/products' } as StorefrontNavItem],
      footer: [],
    });
    expect(out.main[0].visible).toBe(true);
  });

  it("seeds a missing group from defaults while keeping the other group's value as-is", () => {
    const out = migrateNav({ main: [leaf('only-this')] });
    expect(out.main).toEqual([leaf('only-this')]);
    expect(out.footer.length).toBeGreaterThan(0);
  });

  it('a stored menu with unsafe items is sanitized when read from the database', async () => {
    const b = await freshBackend('admin');
    const { nav } = await loadNav(b, {
      main: [leaf('ok'), { id: 'bad', label: 'x', kind: 'external', path: 'javascript:evil()', visible: true }],
      footer: [],
    });
    expect(nav.getNavigation().main.map((i) => i.id)).toEqual(['ok']);
  });
});
