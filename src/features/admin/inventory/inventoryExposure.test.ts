import { describe, expect, it } from 'vitest';
import { freshBackend, product, seedCatalog } from '../../../test/harness';

// Stock quantities and wholesale prices are admin-only. These tests prove — on the
// CLIENT side — that no public code path knows about them, that the inventory UI can
// only write through the approved RPCs, and that nothing leaks into the public
// catalog documents. The database side (RLS / GRANTs / ACLs) is proven against real
// Postgres in supabase/tests/inventory*.test.ts.

// Every non-test source file under src/, as raw text, keyed by its path from src/.
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  )
    .map(([k, v]) => [k.replace('/src/', ''), v as string] as const)
    .filter(([k]) => !/\.test\.tsx?$/.test(k)),
);

const INVENTORY_TOKENS =
  /stock_levels|stock_movements|stock_override|inventory_order_decisions|inventoryStore|inventoryStatus|admin\/inventory|\bon_hand\b|low_threshold|inventory_(set_opening|adjust|receive|record_return|set_threshold)/;

describe('inventory data is never part of public code', () => {
  it('no storefront or shared module references inventory tables, RPCs, stores or fields (static guard)', () => {
    const roots = ['features/storefront/', 'features/shared/'];
    const scanned = Object.keys(sources).filter((f) => roots.some((r) => f.startsWith(r)));
    expect(scanned.length).toBeGreaterThan(50); // the glob really matched the tree
    const offenders = scanned.filter((f) => INVENTORY_TOKENS.test(sources[f]));
    expect(offenders).toEqual([]);
  });

  it('the catalog product type has no stock-quantity field of its own (quantities live in admin-only tables)', () => {
    const type = sources['features/storefront/catalog/catalogData.ts'];
    expect(type).toBeTruthy();
    expect(type).not.toMatch(/\bon_?[hH]and\b|low_?[tT]hreshold|stockLevel/);
  });
});

describe('the inventory UI writes only through the approved RPCs', () => {
  const files = Object.keys(sources).filter((f) => f.startsWith('features/admin/inventory/'));

  it('has no direct insert / update / upsert / delete anywhere in its modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      expect(sources[f], f).not.toMatch(/\.(insert|update|upsert)\s*\(/);
      // (URLSearchParams.delete is unrelated; a table delete would hang off .from(...))
      expect(sources[f], f).not.toMatch(/\.from\([^)]*\)\s*\.delete\s*\(/);
    }
  });

  it('calls exactly the approved RPC names (and is_admin) — no other function', () => {
    const allowedModules = [
      'features/admin/inventory/inventoryStore.ts',
      'features/admin/inventory/inventoryOverrides.ts',
      'features/admin/inventory/inventoryReconciliation.ts',
    ];
    const names = new Set<string>();
    for (const f of allowedModules) {
      expect(sources[f], f).toBeTruthy();
      for (const m of sources[f].matchAll(/(?:callRpc|rows<[A-Za-z]+>|supabase\.rpc)\(\s*'([a-z_]+)'/g)) names.add(m[1]);
    }
    expect(names).toEqual(
      new Set([
        'inventory_set_opening',
        'inventory_adjust',
        'inventory_receive',
        'inventory_record_return',
        'inventory_set_threshold',
        'inventory_deliver_order_override',
        'inventory_create_in_store_order_override',
        'inventory_activation_blockers',
        'inventory_preflight_report',
        'inventory_decide_order',
        'inventory_import_opening',
        'is_admin',
      ]),
    );
    // no other module talks to Supabase at all
    for (const f of files.filter((x) => !allowedModules.includes(x))) {
      expect(sources[f], f).not.toMatch(/supabase\.(from|rpc)\s*\(/);
    }
  });

  it('only SELECTs the inventory tables', () => {
    const store = sources['features/admin/inventory/inventoryStore.ts'];
    for (const m of store.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)\s*\.([a-z]+)/g)) {
      expect(m[2], `${m[1]}.${m[2]}`).toBe('select');
    }
  });

  it('the admin routes and the sidebar entry live under /admin only', () => {
    const router = sources['app/router/index.tsx'];
    const adminAt = router.indexOf("path: '/admin'");
    expect(adminAt).toBeGreaterThan(0);
    expect(router.indexOf("path: 'inventory'")).toBeGreaterThan(adminAt);
    expect(router.indexOf("path: 'inventory/movements'")).toBeGreaterThan(adminAt);
    expect(router.indexOf("path: 'inventory/reconciliation'")).toBeGreaterThan(adminAt);
  });
});

describe('quantities never leak into the public catalog', () => {
  it('anon cannot read the inventory tables; a signed-in non-admin sees nothing', async () => {
    const b = await freshBackend('anon');
    b.tables.stock_levels.push({ product_id: 'p1', on_hand: 4242, low_threshold: 7, product_name: 'x', product_sku: 'y' });
    b.tables.stock_movements.push({ id: 'm', seq: 1, product_id: 'p1', kind: 'opening', quantity: 4242 });
    const { supabase } = await import('../../../lib/supabase/client');
    for (const t of ['stock_levels', 'stock_movements']) {
      const r = await supabase.from(t).select('*');
      expect(r.data).toBeNull();
      expect(r.error).toMatchObject({ code: '42501' });
    }
    b.signIn('user');
    for (const t of ['stock_levels', 'stock_movements']) {
      expect((await supabase.from(t).select('*')).data).toEqual([]);
    }
  });

  it('stock operations never touch the catalog documents, and a public visitor then receives no quantity', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1', { price: 1000 })]);
    const before = JSON.stringify(b.tables.catalog_docs);
    const store = await import('./inventoryStore');
    await store.setOpeningBalance('p1', 4242, 'رصيد افتتاحي');
    await store.adjustStock('p1', 4000, 'جرد فعلي', store.newAttemptKey());
    await store.receiveStock('p1', 3, null, 'استلام', store.newAttemptKey());
    await store.recordStockReturn('p1', 2, false, 'مرتجع تالف', null, store.newAttemptKey());
    await store.setLowThreshold('p1', 9);
    expect(b.tables.stock_levels).toHaveLength(1);
    expect(JSON.stringify(b.tables.catalog_docs)).toBe(before); // byte-identical: availability etc. untouched

    b.signIn('anon');
    const docs = await import('../../storefront/catalog/catalogDocs');
    await docs.refreshDocs();
    const everything = JSON.stringify(docs.getDocsState());
    expect(docs.getDocsState().docs.length).toBeGreaterThan(0);
    for (const secret of ['4242', '4000', 'on_hand', 'low_threshold', 'stock_levels']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('wholesale prices stay out of the public catalog while the admin inventory reads them', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: 654321 });
    const store = await import('./inventoryStore');
    expect((await store.fetchWholesalePrices()).get('p1')).toBe(654321);
    b.signIn('anon');
    const docs = await import('../../storefront/catalog/catalogDocs');
    await docs.refreshDocs();
    expect(JSON.stringify(docs.getDocsState())).not.toContain('654321');
    await expect(store.fetchWholesalePrices()).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
