import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dedicated coverage for the recently-viewed store: persistence, duplicate
// handling (re-push moves to front instead of duplicating), the 8-item cap,
// invalid stored data, and — the focus of Step 11C Part A — cross-tab
// synchronization, which previously didn't exist here.

const STORAGE_KEY = 'taybah:recently-viewed';

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

async function freshRecentlyViewed() {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', fakeWindow);
  return import('./useRecentlyViewed');
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

describe('useRecentlyViewed — same-tab behavior', () => {
  it('pushing an id persists it at the front', async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    rv.pushRecentlyViewed('p2');
    expect(storage.setItem).toHaveBeenCalled();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p2', 'p1']);
  });

  it('re-pushing an already-viewed id moves it to the front instead of duplicating it', async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    rv.pushRecentlyViewed('p2');
    rv.pushRecentlyViewed('p1');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p1', 'p2']);
  });

  it('caps the list at 8 items, dropping the oldest', async () => {
    const rv = await freshRecentlyViewed();
    for (let i = 1; i <= 10; i++) rv.pushRecentlyViewed(`p${i}`);
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(8);
    expect(stored[0]).toBe('p10'); // most recent first
    expect(stored).not.toContain('p1'); // oldest dropped
    expect(stored).not.toContain('p2');
  });
});

describe('useRecentlyViewed — invalid/stale stored data', () => {
  it('starts empty when the stored value is malformed JSON', async () => {
    storage.setItem(STORAGE_KEY, '{not json');
    const rv = await freshRecentlyViewed();
    expect(rv.useRecentlyViewed).toBeDefined();
    rv.pushRecentlyViewed('p1');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p1']);
  });

  it('drops non-string entries from a corrupt array', async () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(['p1', 42, null, 'p2']));
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p3');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p3', 'p1', 'p2']);
  });
});

describe('useRecentlyViewed — cross-tab synchronization (Step 11C Part A)', () => {
  it("reflects another tab's push after a storage event", async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    storage.setItem(STORAGE_KEY, JSON.stringify(['p2', 'p1']));
    fireStorageEvent(STORAGE_KEY);
    rv.pushRecentlyViewed('p3'); // confirms the in-memory list actually updated
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p3', 'p2', 'p1']);
  });

  it('ignores a storage event for an unrelated key', async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    storage.setItem('some:other:key', '[]');
    fireStorageEvent('some:other:key');
    rv.pushRecentlyViewed('p2');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p2', 'p1']);
  });

  it('does not re-persist on a cross-tab sync — prevents a write-back loop between tabs', async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    storage.setItem(STORAGE_KEY, JSON.stringify(['p2', 'p1']));
    const writesBeforeSync = storage.setItem.mock.calls.length;
    fireStorageEvent(STORAGE_KEY);
    expect(storage.setItem.mock.calls.length).toBe(writesBeforeSync);
  });

  it('recovers safely even if the other tab wrote malformed JSON', async () => {
    const rv = await freshRecentlyViewed();
    rv.pushRecentlyViewed('p1');
    storage.setItem(STORAGE_KEY, '{broken');
    expect(() => fireStorageEvent(STORAGE_KEY)).not.toThrow();
    rv.pushRecentlyViewed('p2');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(['p2']);
  });
});
