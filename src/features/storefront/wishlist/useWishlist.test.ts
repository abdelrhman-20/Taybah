import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dedicated coverage for the wishlist store: persistence, duplicate
// toggling, removal, invalid stored data, and — the focus of Step 11C
// Part A — cross-tab synchronization, which previously didn't exist here.

const STORAGE_KEY = 'taybah:wishlist';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => (m.has(k) ? m.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void m.set(k, String(v))),
    removeItem: vi.fn((k: string) => void m.delete(k)),
    clear: vi.fn(() => m.clear()),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;
let fakeWindow: EventTarget;

async function freshWishlist() {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', fakeWindow);
  return import('./useWishlist');
}

function fireStorageEvent(key: string) {
  const evt = new Event('storage') as Event & { key: string };
  evt.key = key;
  fakeWindow.dispatchEvent(evt);
}

beforeEach(() => {
  storage = memoryStorage();
  fakeWindow = new EventTarget();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWishlist — same-tab behavior', () => {
  it('toggling an id on adds it and persists it', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    expect(w.getWishlistIds().has('p1')).toBe(true);
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('toggling the same id again removes it (duplicate-toggle handling)', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    w.toggleWishlist('p1');
    expect(w.getWishlistIds().has('p1')).toBe(false);
  });

  it('holds multiple distinct ids independently', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    w.toggleWishlist('p2');
    expect([...w.getWishlistIds()].sort()).toEqual(['p1', 'p2']);
    w.toggleWishlist('p1');
    expect([...w.getWishlistIds()]).toEqual(['p2']);
  });

  it('round-trips through storage across a fresh module load', async () => {
    const w1 = await freshWishlist();
    w1.toggleWishlist('p1');
    const w2 = await freshWishlist();
    expect(w2.getWishlistIds().has('p1')).toBe(true);
  });
});

describe('useWishlist — invalid/stale stored data', () => {
  it('starts empty when the stored value is malformed JSON', async () => {
    storage.setItem(STORAGE_KEY, '{not json');
    const w = await freshWishlist();
    expect(w.getWishlistIds().size).toBe(0);
  });

  it('drops non-string entries from a corrupt array', async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(['p1', 42, null, { id: 'p2' }, 'p3']));
    const w = await freshWishlist();
    expect([...w.getWishlistIds()].sort()).toEqual(['p1', 'p3']);
  });

  it('starts empty when the stored value is not an array at all', async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    const w = await freshWishlist();
    expect(w.getWishlistIds().size).toBe(0);
  });
});

describe('useWishlist — cross-tab synchronization (Step 11C Part A)', () => {
  it("reflects another tab's toggle after a storage event", async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');

    storage.setItem(STORAGE_KEY, JSON.stringify(['p1', 'p2']));
    fireStorageEvent(STORAGE_KEY);

    expect([...w.getWishlistIds()].sort()).toEqual(['p1', 'p2']);
  });

  it('ignores a storage event for an unrelated key', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    storage.setItem('some:other:key', '[]');
    fireStorageEvent('some:other:key');
    expect(w.getWishlistIds().has('p1')).toBe(true);
  });

  it('does not re-persist on a cross-tab sync — prevents a write-back loop between tabs', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    storage.setItem(STORAGE_KEY, JSON.stringify(['p1', 'p2']));
    const writesBeforeSync = storage.setItem.mock.calls.length;
    fireStorageEvent(STORAGE_KEY);
    expect(storage.setItem.mock.calls.length).toBe(writesBeforeSync);
  });

  it('recovers safely even if the other tab wrote malformed JSON', async () => {
    const w = await freshWishlist();
    w.toggleWishlist('p1');
    storage.setItem(STORAGE_KEY, '{broken');
    expect(() => fireStorageEvent(STORAGE_KEY)).not.toThrow();
    expect(w.getWishlistIds().size).toBe(0);
  });
});
