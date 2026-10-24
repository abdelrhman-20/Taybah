import { describe, expect, it } from 'vitest';
import { freshBackend, product, seedCatalog } from '../../../test/harness';

// Document-layer behavior against the in-memory FAKE backend (client.mock.ts).
// These prove the client's write/read-back/concurrency/error handling; the
// real SQL semantics are covered by supabase/tests/migrations.test.ts.

async function load() {
  const docs = await import('./catalogDocs');
  await docs.whenDocsSettled();
  return docs;
}

const putOp = (id: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  op: 'put' as const,
  kind: 'product' as const,
  id,
  slug: `slug-${id}`,
  visible: true,
  sortOrder: 0,
  data: product(id, over),
  ...extra,
});

describe('catalogDocs — loading', () => {
  it('loads as ready and reads the cutover flag', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    const s = docs.getDocsState();
    expect(s.status).toBe('ready');
    expect(s.initialized).toBe(true);
    expect(s.everLoaded).toBe(true);
    expect(docs.docsOfKind('product').map((d) => d.id)).toEqual(['p1']);
  });

  it('anonymous visitors only receive visible (published) records', async () => {
    const b = await freshBackend('anon');
    seedCatalog(b, [product('p1'), product('p2', { published: false })]);
    const docs = await load();
    expect(docs.docsOfKind('product').map((d) => d.id)).toEqual(['p1']);
  });

  it('admins also receive drafts', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1'), product('p2', { published: false })]);
    const docs = await load();
    expect(docs.docsOfKind('product').map((d) => d.id)).toEqual(['p1', 'p2']);
  });

  it('reports initialized=false before the migration flag is set', async () => {
    const b = await freshBackend('admin');
    b.putDoc('product', 'p1', product('p1'));
    const docs = await load();
    expect(docs.getDocsState().initialized).toBe(false);
  });

  it('a failed first load is an error state, not an empty catalog', async () => {
    const b = await freshBackend('admin');
    b.failNext('from:catalog_docs:select', { code: 'PGRST301', message: 'JWT expired' });
    const docs = await load();
    const s = docs.getDocsState();
    expect(s.status).toBe('error');
    expect(s.everLoaded).toBe(false);
    expect(s.error).toBe('unauthorized');
  });

  it('a failed refresh after a good load keeps the last good data', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    b.failNext('from:catalog_docs:select', { message: 'Failed to fetch' }, { reject: true });
    await docs.refreshDocs();
    const s = docs.getDocsState();
    expect(s.status).toBe('error');
    expect(s.everLoaded).toBe(true);
    expect(docs.docsOfKind('product')).toHaveLength(1);
  });

  it('pages through more than one page of documents', async () => {
    const b = await freshBackend('admin');
    b.setInitialized(true);
    for (let i = 0; i < 1203; i++) b.putDoc('product', `p${String(i).padStart(4, '0')}`, product(`p${i}`));
    const docs = await load();
    expect(docs.docsOfKind('product')).toHaveLength(1203);
  });
});

describe('catalogDocs — writing', () => {
  it('inserts, reads back, and only then exposes the record', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    const docs = await load();
    const selectsBefore = b.calls('from:catalog_docs:select');
    await docs.writeDocs([putOp('p9')]);
    expect(docs.getDoc('product', 'p9')?.revision).toBe(1);
    // a read-back query ran after the RPC
    expect(b.calls('from:catalog_docs:select')).toBeGreaterThan(selectsBefore);
    expect(b.tables.catalog_docs.some((d) => d.id === 'p9')).toBe(true);
  });

  it('local state equals what the DATABASE holds (jsonb key order normalised)', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    const docs = await load();
    await docs.writeDocs([putOp('p9')]);
    const stored = b.tables.catalog_docs.find((d) => d.id === 'p9')!;
    expect(docs.getDoc('product', 'p9')?.data).toEqual(stored.data);
  });

  it('uses the held revision on update and increments it', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await docs.writeDocs([putOp('p1', { price: 2000 })]);
    expect(docs.getDoc('product', 'p1')?.revision).toBe(2);
    await docs.writeDocs([putOp('p1', { price: 3000 })]);
    expect(docs.getDoc('product', 'p1')?.revision).toBe(3);
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(3000);
  });

  it('serializes concurrent writes so neither sees a stale revision', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await Promise.all([
      docs.writeDocs([putOp('p1', { price: 11 })]),
      docs.writeDocs([putOp('p1', { price: 22 })]),
    ]);
    expect(docs.getDoc('product', 'p1')?.revision).toBe(3);
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(22);
  });

  it('rejects a stale draft (conflict) instead of overwriting newer data', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    const opened = docs.docRevision('product', 'p1'); // form opens on rev 1
    // someone else saves meanwhile
    const row = b.tables.catalog_docs.find((d) => d.id === 'p1')!;
    row.revision = 2;
    (row.data as { price: number }).price = 4242;

    await expect(
      docs.writeDocs([putOp('p1', { price: 1 }, { expectedRevision: opened })]),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((row.data as { price: number }).price).toBe(4242); // untouched
    // the store caught up with the newer copy
    await docs.refreshDocs();
    expect(docs.getDoc('product', 'p1')?.revision).toBe(2);
  });

  it('refuses to write before the catalog is initialized (and sends nothing)', async () => {
    const b = await freshBackend('admin');
    const docs = await load();
    await expect(docs.writeDocs([putOp('p1')])).rejects.toMatchObject({ code: 'not_initialized' });
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });

  it('a non-admin write is unauthorized and changes nothing', async () => {
    const b = await freshBackend('user');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await expect(docs.writeDocs([putOp('p1', { price: 9 })])).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(1000);
  });

  it('classifies duplicate slug and existing id', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await expect(docs.writeDocs([putOp('p2', {}, { slug: 'slug-p1' })])).rejects.toMatchObject({
      code: 'duplicate_slug',
    });
    await expect(docs.writeDocs([putOp('p1', {}, { expectedRevision: null })])).rejects.toMatchObject({
      code: 'exists',
    });
  });

  it('a batch is all-or-nothing', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await expect(
      docs.writeDocs([putOp('new1'), putOp('p1', {}, { expectedRevision: 99 })]),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(docs.getDoc('product', 'new1')).toBeUndefined();
    expect(b.tables.catalog_docs.some((d) => d.id === 'new1')).toBe(false);
  });

  it('a network failure leaves local state untouched and is classified', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    b.failNext('rpc:catalog_write', new TypeError('Failed to fetch'), { reject: true });
    await expect(docs.writeDocs([putOp('p1', { price: 7 })])).rejects.toMatchObject({ code: 'network' });
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(1000);
  });

  it('a failed read-back is reported as verify_failed, then self-heals on refresh', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    // the NEXT catalog_docs select is the write's read-back
    b.failNext('from:catalog_docs:select', { code: 'XX000', message: 'boom' });
    await expect(docs.writeDocs([putOp('p1', { price: 55 })])).rejects.toMatchObject({
      code: 'verify_failed',
    });
    await docs.refreshDocs();
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(55);
  });

  it('delete requires the revision and reports an already-removed record honestly', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    await docs.writeDocs([{ op: 'delete', kind: 'product', id: 'p1' }]);
    expect(docs.getDoc('product', 'p1')).toBeUndefined();
    expect(b.tables.catalog_docs.some((d) => d.id === 'p1')).toBe(false);
    // second delete: end state already holds — no error, nothing resurrected
    await docs.writeDocs([{ op: 'delete', kind: 'product', id: 'p1' }]);
    expect(docs.getDoc('product', 'p1')).toBeUndefined();
  });

  it('a refresh that raced with a write cannot roll local state back', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    // freeze the next catalog read (the refresh) so it returns a pre-write snapshot
    const held = b.hold('from:catalog_docs:select');
    const refresh = docs.refreshDocs();
    await Promise.resolve();
    await docs.writeDocs([putOp('p1', { price: 777 })]);
    held.release();
    await refresh;
    expect((docs.getDoc('product', 'p1')?.data as { price: number }).price).toBe(777);
    expect(docs.getDoc('product', 'p1')?.revision).toBe(2);
  });

  it('re-reads on sign-in so an admin gets drafts', async () => {
    const b = await freshBackend('anon');
    seedCatalog(b, [product('p1'), product('p2', { published: false })]);
    const docs = await load();
    expect(docs.docsOfKind('product')).toHaveLength(1);
    b.signIn('admin'); // fires SIGNED_IN
    await docs.refreshDocs();
    expect(docs.docsOfKind('product')).toHaveLength(2);
  });
});
