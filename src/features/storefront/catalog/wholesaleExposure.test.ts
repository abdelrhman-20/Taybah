import { describe, expect, it } from 'vitest';
import { freshBackend, product, seedCatalog } from '../../../test/harness';

// The wholesale price is admin-only internal data (migration 0007). These
// tests prove — on the client side — that public sessions never receive it and
// that no storefront code path knows about it. The database side (RLS/GRANTs)
// is proven against real Postgres in supabase/tests/internal-pricing.test.ts.

// Every non-test source file under src/, as raw text, keyed by its path from src/.
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  )
    .map(([k, v]) => [k.replace('/src/', ''), v as string] as const)
    .filter(([k]) => !/\.test\.tsx?$/.test(k)),
);

describe('wholesale price is never part of public data', () => {
  it('no storefront, shared, app or order code references wholesale pricing (static guard)', () => {
    const roots = ['features/storefront/', 'features/shared/', 'app/', 'lib/'];
    // catalogDocs.ts is the single shared write gateway; its ONLY mention is the
    // write-side `WriteExtras` option that carries an admin's price to the RPC.
    // client.mock.ts is the test-only fake Supabase (swapped in by vitest.setup.ts,
    // never part of the production bundle).
    const allowed = ['features/storefront/catalog/catalogDocs.ts', 'lib/supabase/client.mock.ts'];
    const offenders = Object.entries(sources)
      .filter(([f]) => roots.some((r) => f.startsWith(r)) && !allowed.includes(f))
      .filter(([, text]) => /wholesale|internal_?pricing|internalPricing/i.test(text))
      .map(([f]) => f);
    expect(Object.keys(sources).filter((f) => roots.some((r) => f.startsWith(r))).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('the catalog type and the product document builders have no wholesale field', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100); // the glob really matched the tree
    expect(sources['features/storefront/catalog/catalogData.ts']).toBeTruthy();
    expect(sources['features/storefront/catalog/catalogData.ts']).not.toMatch(/wholesale/i);
  });

  it('an anonymous visitor loading the catalog receives no wholesale price anywhere', async () => {
    const b = await freshBackend('anon');
    seedCatalog(b, [product('p1', { price: 1000 })]);
    b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 123456 });
    const docs = await import('./catalogDocs');
    await docs.whenDocsSettled();
    expect(docs.getDocsState().docs.length).toBeGreaterThan(0);
    const everything = JSON.stringify(docs.getDocsState());
    expect(everything).not.toMatch(/wholesale/i);
    expect(everything).not.toContain('123456');
    const { getCatalog } = await import('./catalogStore');
    expect(JSON.stringify(getCatalog())).not.toContain('123456');
  });

  it('anon and non-admin sessions cannot read the internal pricing table', async () => {
    const b = await freshBackend('anon');
    b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 720 });
    const { supabase } = await import('../../../lib/supabase/client');

    const anon = await supabase.from('product_internal_pricing').select('product_id, wholesale_price');
    expect(anon.data).toBeNull();
    expect((anon.error as { code: string }).code).toBe('42501');

    b.role = 'user';
    const user = await supabase.from('product_internal_pricing').select('product_id, wholesale_price');
    expect(user.error).toBeNull();
    expect(user.data).toEqual([]);

    b.role = 'admin';
    const admin = await supabase.from('product_internal_pricing').select('product_id, wholesale_price');
    expect(admin.data).toEqual([{ product_id: 'p1', wholesale_price: 720 }]);
  });

  it('direct client writes to the pricing table are refused for every role; the RPC is admin-only', async () => {
    const b = await freshBackend('admin');
    const { supabase } = await import('../../../lib/supabase/client');
    const row = { product_id: 'p1', wholesale_price: 1 };
    for (const role of ['anon', 'user', 'admin'] as const) {
      b.role = role;
      const res = await supabase.from('product_internal_pricing').insert(row);
      expect((res.error as { code: string }).code).toBe('42501');
    }
    expect(b.tables.product_internal_pricing).toEqual([]);
    for (const role of ['anon', 'user'] as const) {
      b.role = role;
      const res = await supabase.rpc('catalog_write_product', { p_ops: [], p_wholesale: null });
      expect((res.error as { code: string }).code).toBe('42501');
    }
  });
});
