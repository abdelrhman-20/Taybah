import { describe, expect, it } from 'vitest';
import { freshBackend, product, seedCatalog } from '../../../test/harness';

// Regression: the catalog tables do not exist yet (migration 0006 not applied
// to the Supabase project). This took the live storefront down with a
// "couldn't reach the server" screen. A missing table of OURS must fall back
// to the built-in catalog; every other failure must remain a visible error.
// (Runs against the in-memory FAKE backend, client.mock.ts; it answers a
// missing table with the same PGRST205 shape the real PostgREST returned.)

async function load() {
  const docs = await import('./catalogDocs');
  await docs.whenDocsSettled();
  return docs;
}

const TABLE_MISSING = (t: string) => ({
  code: 'PGRST205',
  message: `Could not find the table 'public.${t}' in the schema cache`,
});

const putOp = (id: string) => ({
  op: 'put' as const,
  kind: 'product' as const,
  id,
  slug: `slug-${id}`,
  visible: true,
  sortOrder: 0,
  data: product(id),
});

describe('migration 0006 not applied (tables missing)', () => {
  it('falls back to the built-in catalog when BOTH tables are missing', async () => {
    const b = await freshBackend('anon');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    const docs = await load();
    const s = docs.getDocsState();
    expect(s.status).toBe('ready');
    expect(s.initialized).toBe(false);
    expect(s.schemaMissing).toBe(true);
    expect(s.everLoaded).toBe(true);
    expect(s.error).toBeNull();
    expect(s.docs).toEqual([]);
  });

  it('the storefront then serves the existing built-in products, categories, navigation and attributes', async () => {
    const b = await freshBackend('anon');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    await load();
    const catalog = await import('./catalogStore');
    const nav = await import('../layout/navStore');
    const attrs = await import('./attributeStore');
    const data = await import('./catalogData');
    expect(catalog.getCatalog().products.length).toBe(data.catalogProducts.length);
    expect(catalog.getCatalog().products.length).toBeGreaterThan(5);
    expect(catalog.getCatalog().categories.map((c) => c.slug)).toEqual(
      data.catalogCategories.map((c) => c.slug),
    );
    expect(nav.getNavigation().main.length).toBeGreaterThan(0);
    expect(attrs.getAttributes().map((a) => a.key)).toEqual(['color', 'material', 'size']);
  });

  it('falls back when only app_settings is missing', async () => {
    const b = await freshBackend('anon');
    delete b.tables.app_settings;
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'ready', schemaMissing: true, initialized: false });
  });

  it('falls back when only catalog_docs is missing', async () => {
    const b = await freshBackend('anon');
    delete b.tables.catalog_docs;
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'ready', schemaMissing: true, initialized: false });
  });

  it('the app is NOT blocked by the gate (readiness is ready)', async () => {
    const b = await freshBackend('anon');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    await load();
    const home = await import('../home/homeStore');
    await home.refreshHomeContent();
    const readiness = await import('../../shared/data/useDataReadiness');
    expect(readiness.currentReadiness()).toBe('ready');
  });

  it('works for a signed-in admin too, and admin writes are still refused with nothing sent', async () => {
    const b = await freshBackend('admin');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    const docs = await load();
    expect(docs.getDocsState().schemaMissing).toBe(true);
    await expect(docs.writeDocs([putOp('p1')])).rejects.toMatchObject({ code: 'not_initialized' });
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });

  it('recovers by itself once the tables exist and the catalog is migrated', async () => {
    const b = await freshBackend('admin');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    const docs = await load();
    expect(docs.getDocsState().schemaMissing).toBe(true);
    // migration 0006 applied + catalog imported + cutover flag set
    b.tables.catalog_docs = [];
    b.tables.app_settings = [];
    seedCatalog(b, [product('p1')]);
    await docs.refreshDocs();
    const s = docs.getDocsState();
    expect(s.schemaMissing).toBe(false);
    expect(s.initialized).toBe(true);
    expect(docs.docsOfKind('product').map((d) => d.id)).toEqual(['p1']);
  });
});

describe('real failures are NOT hidden by the fallback', () => {
  it('a genuine network failure on first load is an error state (no fallback, no seed data)', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:app_settings:select', new TypeError('Failed to fetch'), { reject: true });
    const docs = await load();
    const s = docs.getDocsState();
    expect(s.status).toBe('error');
    expect(s.error).toBe('network');
    expect(s.schemaMissing).toBe(false);
    expect(s.everLoaded).toBe(false);
    const readiness = await import('../../shared/data/useDataReadiness');
    expect(readiness.currentReadiness()).toBe('error');
  });

  it('an authentication failure (expired JWT) stays an error', async () => {
    const b = await freshBackend('admin');
    b.failNext('from:catalog_docs:select', { code: 'PGRST301', message: 'JWT expired' });
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'error', error: 'unauthorized', schemaMissing: false });
  });

  it('a permission denial (RLS) stays an error', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:app_settings:select', {
      code: '42501',
      message: 'permission denied for table app_settings',
    });
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'error', error: 'unauthorized' });
  });

  it('a DIFFERENT missing table is not mistaken for "catalog not migrated"', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:catalog_docs:select', TABLE_MISSING('some_other_table'));
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'error', error: 'schema_missing', schemaMissing: false });
  });

  it('an unrelated database error stays an error', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:catalog_docs:select', { code: 'XX000', message: 'internal error' });
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'error', error: 'unknown', schemaMissing: false });
  });

  it('a request that fails outright is an error, not a fallback', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:catalog_docs:select', new Error('socket hang up'), { reject: true });
    const docs = await load();
    expect(docs.getDocsState().status).toBe('error');
    expect(docs.getDocsState().schemaMissing).toBe(false);
  });

  it('isCatalogTableMissing matches only our two tables via PGRST205 / 42P01', async () => {
    await freshBackend('anon');
    const docs = await import('./catalogDocs');
    expect(docs.isCatalogTableMissing(TABLE_MISSING('catalog_docs'))).toBe(true);
    expect(docs.isCatalogTableMissing(TABLE_MISSING('app_settings'))).toBe(true);
    expect(
      docs.isCatalogTableMissing({ code: '42P01', message: 'relation "public.catalog_docs" does not exist' }),
    ).toBe(true);
    expect(docs.isCatalogTableMissing(TABLE_MISSING('orders'))).toBe(false);
    expect(docs.isCatalogTableMissing({ message: 'Failed to fetch' })).toBe(false);
    expect(docs.isCatalogTableMissing({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
    expect(docs.isCatalogTableMissing(null)).toBe(false);
  });
});

describe('successful reads still work (control)', () => {
  it('reads migrated data normally when the tables exist', async () => {
    const b = await freshBackend('anon');
    seedCatalog(b, [product('p1')]);
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'ready', initialized: true, schemaMissing: false });
    expect(docs.docsOfKind('product')).toHaveLength(1);
  });

  it('tables present but not yet migrated: ready, uninitialized, schemaMissing false', async () => {
    await freshBackend('anon');
    const docs = await load();
    expect(docs.getDocsState()).toMatchObject({ status: 'ready', initialized: false, schemaMissing: false });
  });
});
