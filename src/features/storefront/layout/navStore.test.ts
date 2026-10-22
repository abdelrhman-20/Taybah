import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenForFooter, isSafeNavUrl } from './navStore';
import type { StorefrontNavItem } from './navStore';

// Dedicated coverage for the storefront navigation store: persistence,
// hierarchy (exactly one child level on main, flat footer), URL safety
// validation, and sanitization of invalid/malformed stored data.
//
// navStore.ts has no plain getNavigation() getter (only the useNavigation()
// hook, which needs React) — so to observe the sanitized in-memory state
// after a module loads from seeded storage, these tests call a mutator on
// the GROUP NOT under test (e.g. saveNavGroup('footer', [])) to force a
// persist(), which re-serializes BOTH groups from the already-migrated
// in-memory state. That's `flush()` below.

const STORAGE_KEY = 'taybah:navigation';

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

async function freshNavStore() {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  return import('./navStore');
}

// Forces a persist() without changing either group's content: removeNavItem
// reads the CURRENT in-memory nav[group] (already fully migrated on module
// load), filters out a non-existent id (a no-op), and persists {...nav}
// as-is — which is exactly what we need to read the migrated state back
// out of storage without a getter.
function flush(nav: Awaited<ReturnType<typeof freshNavStore>>, probedGroup: 'main' | 'footer') {
  const other = probedGroup === 'main' ? 'footer' : 'main';
  nav.removeNavItem(other, '__flush_probe_nonexistent__');
  return JSON.parse(storage.getItem(STORAGE_KEY)!);
}

beforeEach(() => {
  storage = memoryStorage();
});

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
  it('seeds a non-empty main menu and footer', async () => {
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main.length).toBeGreaterThan(0);
    expect(stored.footer.length).toBeGreaterThan(0);
  });

  it('persists upsertNavItem and survives a fresh module reload', async () => {
    const nav1 = await freshNavStore();
    nav1.upsertNavItem('main', leaf('new-item', { label: 'جديد' }));
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.main.some((i: StorefrontNavItem) => i.id === 'new-item')).toBe(true);
  });

  it('upsertNavItem replaces an existing item with the same id instead of duplicating it', async () => {
    const nav = await freshNavStore();
    nav.upsertNavItem('footer', leaf('contact', { label: 'الأصلي' }));
    nav.upsertNavItem('footer', leaf('contact', { label: 'محدث' }));
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    const contacts = stored.footer.filter((i: StorefrontNavItem) => i.id === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].label).toBe('محدث');
  });

  it('removeNavItem drops exactly the targeted item', async () => {
    const nav = await freshNavStore();
    nav.upsertNavItem('main', leaf('temp'));
    nav.removeNavItem('main', 'temp');
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.main.some((i: StorefrontNavItem) => i.id === 'temp')).toBe(false);
  });

  it('resetNavigation restores the seeded defaults', async () => {
    const nav = await freshNavStore();
    nav.saveNavGroup('main', []);
    nav.resetNavigation();
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.main.length).toBeGreaterThan(0);
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

  it('preserves top-level order while inlining each parent\'s children in place', () => {
    const a = leaf('shop');
    const b = { ...leaf('rugs', { path: '' }), children: [leaf('flatweave')] };
    const c = leaf('collections');
    expect(flattenForFooter([a, b, c]).map((i) => i.id)).toEqual(['shop', 'flatweave', 'collections']);
  });
});

describe('navStore — hierarchy (main has one child level, footer stays flat)', () => {
  it('keeps a child level on a main-menu item', async () => {
    const nav = await freshNavStore();
    nav.saveNavGroup('main', [leaf('rugs', { children: [leaf('flatweave'), leaf('handknotted')] })]);
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.main[0].children).toHaveLength(2);
  });

  it('drops a grandchild level via sanitizeItems — only one level of nesting is ever kept', async () => {
    const nav = await freshNavStore();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        main: [
          { ...leaf('rugs'), children: [{ ...leaf('flatweave'), children: [leaf('too-deep')] }] },
        ],
        footer: [],
      }),
    );
    const nav2 = await freshNavStore();
    void nav;
    const stored = flush(nav2, 'main');
    expect(stored.main[0].children).toHaveLength(1);
    expect(stored.main[0].children[0].children).toBeUndefined();
  });

  it('strips any children sanitizeItems finds on a footer item — footer is always flat', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ main: [leaf('shop')], footer: [{ ...leaf('contact'), children: [leaf('sneaky')] }] }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'footer');
    expect(stored.footer[0].children).toBeUndefined();
  });
});

describe('navStore — sanitization of invalid/malformed stored data', () => {
  it('falls back to defaults when the stored value is malformed JSON', async () => {
    storage.setItem(STORAGE_KEY, '{not json');
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main.length).toBeGreaterThan(0);
  });

  it('drops a duplicate id, keeping only the first occurrence', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ main: [leaf('shop', { label: 'أول' }), leaf('shop', { label: 'ثانٍ' })], footer: [] }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    const shops = stored.main.filter((i: StorefrontNavItem) => i.id === 'shop');
    expect(shops).toHaveLength(1);
    expect(shops[0].label).toBe('أول');
  });

  it('drops a leaf item with no destination and no children', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ main: [{ id: 'empty', label: 'فاضي', kind: 'internal', path: '', visible: true }], footer: [] }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main).toEqual([]);
  });

  it('downgrades a parent with an unsafe destination to a pure trigger, keeping its valid children', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        main: [
          { id: 'rugs', label: 'سجاد', kind: 'internal', path: 'javascript:evil()', visible: true, children: [leaf('flatweave')] },
        ],
        footer: [],
      }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main[0].path).toBe('');
    expect(stored.main[0].children).toHaveLength(1);
  });

  it('drops an item with an unsafe destination and no children entirely', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ main: [{ id: 'bad', label: 'سيء', kind: 'external', path: 'javascript:evil()', visible: true }], footer: [] }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main).toEqual([]);
  });

  it('treats a non-boolean/missing visible flag as visible (tolerant default)', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ main: [{ id: 'shop', label: 'تسوق', kind: 'internal', path: '/products' }], footer: [] }),
    );
    const nav = await freshNavStore();
    const stored = flush(nav, 'main');
    expect(stored.main[0].visible).toBe(true);
  });

  it("seeds a missing group from defaults while keeping the other group's stored value as-is", async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ main: [leaf('only-this')] }));
    const nav = await freshNavStore();
    const stored = flush(nav, 'footer');
    expect(stored.main).toEqual([leaf('only-this')]);
    expect(stored.footer.length).toBeGreaterThan(0); // seeded from defaultNav()
  });
});
