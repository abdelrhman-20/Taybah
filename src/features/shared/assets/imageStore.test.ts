import { afterEach, describe, expect, it, vi } from 'vitest';

// Dedicated coverage for the IndexedDB-backed image store — save/read/delete
// round trips, and (Step 11C Part B) write-failure handling: a failed save
// or delete must never report success, and a transient open failure must
// not permanently brick every later operation for the rest of the session.
//
// IndexedDB doesn't exist in this project's Node test environment, so this
// file provides a minimal fake implementing only the handful of IDB APIs
// imageStore.ts actually calls (open/transaction/objectStore put-get-delete-
// getAll), with injectable failure points for the error-path tests.

interface FakeIDBOpts {
  failOpen: boolean;
  failTxWith: (DOMException | Error) | null;
}

function createFakeIndexedDB(opts: FakeIDBOpts) {
  const records = new Map<string, unknown>();
  let storeCreated = false;

  function makeDb() {
    return {
      objectStoreNames: { contains: () => storeCreated },
      createObjectStore: () => {
        storeCreated = true;
      },
      transaction: () => {
        const tx: {
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          onabort: (() => void) | null;
          error: unknown;
          objectStore: (n: string) => unknown;
        } = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => undefined };

        const finish = (req: { result?: unknown }, apply: () => void) => {
          queueMicrotask(() => {
            if (opts.failTxWith) {
              tx.error = opts.failTxWith;
              tx.onabort?.();
              return;
            }
            apply();
            tx.oncomplete?.();
          });
          return req;
        };

        const store = {
          put: (record: { id: string }) => {
            const req: { result?: unknown } = {};
            return finish(req, () => {
              records.set(record.id, record);
              req.result = record.id;
            });
          },
          get: (id: string) => {
            const req: { result?: unknown } = {};
            return finish(req, () => {
              req.result = records.get(id);
            });
          },
          delete: (id: string) => {
            const req: { result?: unknown } = {};
            return finish(req, () => {
              records.delete(id);
            });
          },
          getAll: () => {
            const req: { result?: unknown } = {};
            return finish(req, () => {
              req.result = [...records.values()];
            });
          },
        };
        tx.objectStore = () => store;
        return tx;
      },
    };
  }

  return {
    open: () => {
      const req: {
        result?: unknown;
        error?: unknown;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (opts.failOpen) {
          req.error = new Error('failed to open database');
          req.onerror?.();
          return;
        }
        req.result = makeDb();
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    _records: records,
  };
}

let opts: FakeIDBOpts;

async function freshImageStore() {
  vi.resetModules();
  opts = { failOpen: false, failTxWith: null };
  vi.stubGlobal('indexedDB', createFakeIndexedDB(opts));
  // Node's URL class lacks the browser object-URL statics at runtime (even
  // though the DOM lib types declare them) — polyfill once, defensively.
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:fake';
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
  return import('./imageStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const blob = () => new Blob(['fake-image-bytes'], { type: 'image/png' });

describe('imageStore — save/read/delete round trip', () => {
  it('saves a blob and reads it back by the returned id', async () => {
    const store = await freshImageStore();
    const id = await store.saveImageBlob(blob(), { name: 'rug.png' });
    const read = await store.getImageBlob(id);
    expect(read).toBeInstanceOf(Blob);
  });

  it('lists saved assets with their metadata', async () => {
    const store = await freshImageStore();
    const id = await store.saveImageBlob(blob(), { name: 'rug.png' });
    const list = await store.listImageAssets();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: 'rug.png', type: 'image/png' });
  });

  it('deleting an asset removes it — a subsequent read resolves to undefined', async () => {
    const store = await freshImageStore();
    const id = await store.saveImageBlob(blob(), { name: 'rug.png' });
    await store.deleteImageAsset(id);
    expect(await store.getImageBlob(id)).toBeUndefined();
    expect(await store.listImageAssets()).toHaveLength(0);
  });

  it('isLocalImageRef / localImageRef round-trip the id prefix correctly', async () => {
    const store = await freshImageStore();
    expect(store.isLocalImageRef('local:abc')).toBe(true);
    expect(store.isLocalImageRef('https://example.com/x.png')).toBe(false);
    expect(store.isLocalImageRef(null)).toBe(false);
    expect(store.localImageRef('abc')).toBe('local:abc');
  });
});

describe('imageStore — write-failure handling (Step 11C Part B)', () => {
  it('a failed save rejects and never reports a false success', async () => {
    const store = await freshImageStore();
    opts.failTxWith = new Error('transaction aborted');
    await expect(store.saveImageBlob(blob(), { name: 'rug.png' })).rejects.toThrow();
    // No phantom entry was ever added to the asset list.
    opts.failTxWith = null; // allow the follow-up read to succeed
    expect(await store.listImageAssets()).toHaveLength(0);
  });

  it('a failed delete rejects and never falsely reports the asset as removed', async () => {
    const store = await freshImageStore();
    const id = await store.saveImageBlob(blob(), { name: 'rug.png' });
    opts.failTxWith = new Error('transaction aborted');
    await expect(store.deleteImageAsset(id)).rejects.toThrow();
    opts.failTxWith = null;
    // The asset is still there — the caller never saw a false "removed" state.
    expect(await store.getImageBlob(id)).toBeInstanceOf(Blob);
  });

  it('propagates a QuotaExceededError by name so callers can show a specific message', async () => {
    const store = await freshImageStore();
    opts.failTxWith = new DOMException('quota exceeded', 'QuotaExceededError');
    await expect(store.saveImageBlob(blob(), { name: 'rug.png' })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('a failed database OPEN rejects every pending operation', async () => {
    const store = await freshImageStore();
    opts.failOpen = true;
    await expect(store.saveImageBlob(blob(), { name: 'rug.png' })).rejects.toThrow();
  });

  it('recovers on the next call after a transient open failure — never permanently bricked', async () => {
    const store = await freshImageStore();
    opts.failOpen = true;
    await expect(store.saveImageBlob(blob(), { name: 'rug.png' })).rejects.toThrow();

    // The underlying issue clears (e.g. browser unblocks the upgrade) —
    // the NEXT call must get a fresh attempt, not the same cached rejection.
    opts.failOpen = false;
    const id = await store.saveImageBlob(blob(), { name: 'rug-2.png' });
    expect(await store.getImageBlob(id)).toBeInstanceOf(Blob);
  });
});
