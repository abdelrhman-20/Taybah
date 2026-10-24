import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, USER, as, baseDb, begin, fails, migrationSql, rollback } from './pg';

// DATABASE-ENFORCED SKU UNIQUENESS (migration 0006: catalog_skus registry,
// catalog_write, catalog_import) on a REAL Postgres engine (PGlite).
//
// What is and is not proven here:
//  * Sequential behaviour — including the "stale tab" case, where a second
//    writer's client-side check passes because it never saw the first product —
//    is executed for real.
//  * TRUE concurrency (two simultaneous transactions) is NOT executed: PGlite
//    is single-connection. That guarantee comes from the registry's PRIMARY KEY
//    (Postgres makes the second inserter wait for the first to commit, then
//    fail with a unique violation), which catalog_write maps to CF005.

let db: PGlite;

interface Variant {
  id: string;
  sku: string;
  active?: boolean;
}

const doc = (id: string, sku: string | null, variants: Variant[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  sku,
  name: { ar: id, en: id },
  variants,
  ...extra,
});

const put = (id: string, sku: string | null, variants: Variant[] = [], over: Record<string, unknown> = {}) => ({
  op: 'put',
  kind: 'product',
  id,
  expected_revision: null,
  slug: `slug-${id}`,
  visible: true,
  sort_order: 0,
  data: doc(id, sku, variants),
  ...over,
});

const write = async (ops: unknown[]) =>
  (await db.query<{ r: Array<{ revision: number | null; deleted: boolean }> }>('select public.catalog_write($1::jsonb) r', [JSON.stringify(ops)])).rows[0].r;

const writeFails = (ops: unknown[]) => fails(db, 'select public.catalog_write($1::jsonb)', [JSON.stringify(ops)]);

type Report = {
  inserted: Array<{ id: string }>;
  unchanged: Array<{ id: string }>;
  conflicts: Array<{ id: string; reason: string; sku?: string }>;
};
const imp = async (docs: unknown[], dry = false) =>
  (await db.query<{ r: Report }>('select public.catalog_import($1::jsonb, $2) r', [JSON.stringify(docs), dry])).rows[0].r;

const impDoc = (id: string, sku: string | null, variants: Variant[] = [], over: Record<string, unknown> = {}) => ({
  kind: 'product',
  id,
  slug: `slug-${id}`,
  visible: true,
  sort_order: 0,
  data: doc(id, sku, variants),
  ...over,
});

const registry = async () =>
  (await db.query<{ sku: string; product_id: string; variant_id: string | null }>(
    'select sku, product_id, variant_id from public.catalog_skus order by sku',
  )).rows;
const count = async (sql: string) => (await db.query<{ c: number }>(`select count(*)::int c from (${sql}) t`)).rows[0].c;

beforeAll(async () => {
  db = await baseDb();
  await db.exec(migrationSql('0001_orders.sql'));
  await db.exec(migrationSql('0006_catalog_documents.sql'));
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await begin(db);
  await as(db, 'authenticated', ADMIN);
});
afterEach(async () => {
  await rollback(db);
});

describe('catalog_write — registry maintenance', () => {
  it('registers the product SKU and every variant SKU, normalised (trim + lowercase)', async () => {
    await write([put('p1', '  TYB-P1 ', [{ id: 'v1', sku: 'Tyb-P1-Red' }, { id: 'v2', sku: 'TYB-P1-BLUE\t' }])]);
    await as(db, 'postgres');
    expect(await registry()).toEqual([
      { sku: 'tyb-p1', product_id: 'p1', variant_id: null },
      { sku: 'tyb-p1-blue', product_id: 'p1', variant_id: 'v2' },
      { sku: 'tyb-p1-red', product_id: 'p1', variant_id: 'v1' },
    ]);
  });

  it('a DUPLICATE across two products is refused with CF005 and nothing is saved', async () => {
    await write([put('p1', 'SKU-1')]);
    const err = await writeFails([put('p2', 'SKU-1')]);
    expect(err.code).toBe('CF005');
    expect(err.message).toBe('duplicate_sku');
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'p2'`)).toBe(0);
    expect((await registry()).map((r) => r.product_id)).toEqual(['p1']);
  });

  it('the error names the offending SKU', async () => {
    await write([put('p1', 'SKU-1')]);
    await as(db, 'authenticated', ADMIN);
    await db.exec('savepoint s');
    try {
      await db.query('select public.catalog_write($1::jsonb)', [JSON.stringify([put('p2', 'sku-1')])]);
      throw new Error('should have failed');
    } catch (e) {
      await db.exec('rollback to savepoint s');
      const err = e as { detail?: string };
      expect(err.detail ?? '').toContain('sku-1');
    }
  });

  it.each([
    ['different case', 'sku-1'],
    ['leading/trailing spaces', '   SKU-1   '],
    ['tabs and newlines', '\tSKU-1\n'],
    ['mixed', ' Sku-1 '],
  ])('normalisation: %s collides with an existing SKU', async (_label, other) => {
    await write([put('p1', 'SKU-1')]);
    expect((await writeFails([put('p2', other)])).code).toBe('CF005');
  });

  it('a different SKU that merely looks similar is allowed', async () => {
    await write([put('p1', 'SKU-1')]);
    await write([put('p2', 'SKU-10'), put('p3', 'SKU-1A'), put('p4', 'SKU 1')]);
    await as(db, 'postgres');
    expect(await registry()).toHaveLength(4);
  });

  it('a variant SKU may not equal another product\'s SKU, nor another product\'s variant SKU', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
    expect((await writeFails([put('p2', 'X', [{ id: 'v', sku: 'sku-1' }])])).code).toBe('CF005');
    expect((await writeFails([put('p3', 'Y', [{ id: 'v', sku: ' sku-1-a ' }])])).code).toBe('CF005');
  });

  it('inside one product: a variant may not reuse the product SKU, and variants may not share a SKU', async () => {
    expect((await writeFails([put('p1', 'SKU-1', [{ id: 'v1', sku: 'sku-1' }])])).code).toBe('CF005');
    expect((await writeFails([put('p1', 'SKU-1', [{ id: 'v1', sku: 'A' }, { id: 'v2', sku: 'a ' }])])).code).toBe('CF005');
  });

  it('inactive variants still reserve their SKU (same rule as the product form)', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'OLD-1', active: false }])]);
    expect((await writeFails([put('p2', 'OLD-1')])).code).toBe('CF005');
  });

  it('draft (unpublished) products reserve their SKU too', async () => {
    await write([put('p1', 'SKU-1', [], { visible: false })]);
    expect((await writeFails([put('p2', 'SKU-1')])).code).toBe('CF005');
  });

  it('missing or blank SKUs are never registered and never conflict', async () => {
    await write([put('p1', null), put('p2', '   '), put('p3', '', [{ id: 'v', sku: '' }])]);
    await as(db, 'postgres');
    expect(await registry()).toEqual([]);
  });

  it('UPDATE that keeps its own SKU succeeds (no self-conflict) and bumps the revision', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
    const r = await write([
      put('p1', ' sku-1 ', [{ id: 'v1', sku: 'SKU-1-A' }], { expected_revision: 1, data: doc('p1', ' sku-1 ', [{ id: 'v1', sku: 'SKU-1-A' }], { price: 2 }) }),
    ]);
    expect(r[0].revision).toBe(2);
    await as(db, 'postgres');
    expect((await registry()).map((x) => x.sku)).toEqual(['sku-1', 'sku-1-a']);
  });

  it('changing a SKU releases the old one (another product can take it) and reserves the new one', async () => {
    await write([put('p1', 'OLD')]);
    await write([put('p1', 'NEW', [], { expected_revision: 1 })]);
    await write([put('p2', 'OLD')]); // old SKU is free now
    expect((await writeFails([put('p3', 'NEW')])).code).toBe('CF005'); // new SKU is held
  });

  it('removing a variant releases that variant SKU', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
    await write([put('p1', 'SKU-1', [], { expected_revision: 1 })]);
    await write([put('p2', 'SKU-1-A')]);
  });

  it('deleting a product frees all of its SKUs for reuse', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
    await write([{ op: 'delete', kind: 'product', id: 'p1', expected_revision: 1 }]);
    await as(db, 'postgres');
    expect(await registry()).toEqual([]);
    await as(db, 'authenticated', ADMIN);
    await write([put('p2', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
  });

  it('two products can SWAP SKUs inside one batch', async () => {
    await write([put('a', 'X'), put('b', 'Y')]);
    await write([
      put('a', 'Y', [], { expected_revision: 1 }),
      put('b', 'X', [], { expected_revision: 1 }),
    ]);
    await as(db, 'postgres');
    expect(await registry()).toEqual([
      { sku: 'x', product_id: 'b', variant_id: null },
      { sku: 'y', product_id: 'a', variant_id: null },
    ]);
  });

  it('deleting one product and reusing its SKU for another in the SAME batch works', async () => {
    await write([put('a', 'X')]);
    await write([{ op: 'delete', kind: 'product', id: 'a', expected_revision: 1 }, put('b', 'X')]);
    await as(db, 'postgres');
    expect(await registry()).toEqual([{ sku: 'x', product_id: 'b', variant_id: null }]);
  });

  it('two operations in one batch claiming the same SKU: the whole batch is rolled back (atomic)', async () => {
    const err = await writeFails([put('a', 'DUP'), put('b', ' dup ')]);
    expect(err.code).toBe('CF005');
    await as(db, 'postgres');
    expect(await count('select 1 from public.catalog_docs')).toBe(0);
    expect(await registry()).toEqual([]);
  });

  it('a duplicate in a LATER operation rolls back earlier valid operations of the batch', async () => {
    await write([put('p1', 'TAKEN')]);
    const err = await writeFails([put('ok', 'FREE'), put('bad', 'taken')]);
    expect(err.code).toBe('CF005');
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'ok'`)).toBe(0);
    expect((await registry()).map((r) => r.sku)).toEqual(['taken']);
  });

  it('STALE TAB: a second writer that never saw the first product is still stopped by the database', async () => {
    // Tab A creates the product. Tab B's loaded catalog does not contain it, so
    // B's client-side skuTaken() check passes; id and slug are different, so
    // none of the document-level constraints fire. Only the registry catches it.
    await write([put('from-tab-a', 'SHARED-SKU')]);
    const err = await writeFails([put('from-tab-b', 'shared-sku', [], { slug: 'a-different-slug' })]);
    expect(err.code).toBe('CF005');
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'from-tab-b'`)).toBe(0);
  });

  it('a stale-revision write still fails with the revision error, not a SKU error', async () => {
    await write([put('p1', 'SKU-1')]);
    await write([put('p1', 'SKU-1', [], { expected_revision: 1 })]);
    expect((await writeFails([put('p1', 'SKU-1', [], { expected_revision: 1 })])).code).toBe('CF001');
  });

  it('non-product documents are unaffected by the registry', async () => {
    await write([
      { op: 'put', kind: 'category', id: 'c', expected_revision: null, slug: 'c', visible: true, sort_order: 0, data: { sku: 'SKU-1' } },
      put('p1', 'SKU-1'),
    ]);
    await as(db, 'postgres');
    expect((await registry()).map((r) => r.product_id)).toEqual(['p1']);
  });
});

describe('registry integrity and access', () => {
  it('API roles cannot read or write the registry directly', async () => {
    await write([put('p1', 'SKU-1')]);
    for (const [role, sub] of [['authenticated', ADMIN], ['authenticated', USER], ['anon', undefined]] as const) {
      await as(db, role, sub);
      expect((await fails(db, 'select * from public.catalog_skus')).message).toMatch(/permission denied/);
      expect((await fails(db, `insert into public.catalog_skus(sku, product_id) values ('x', 'p1')`)).message).toMatch(/permission denied/);
      expect((await fails(db, `delete from public.catalog_skus`)).message).toMatch(/permission denied/);
    }
  });

  it('the helper functions are not callable through the API', async () => {
    expect((await fails(db, `select public.catalog_normalize_sku(' A ')`)).message).toMatch(/permission denied/);
    expect((await fails(db, `select * from public.catalog_product_skus('{}')`)).message).toMatch(/permission denied/);
  });

  it('removing a product document by ANY path (foreign key) releases its SKUs', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v1', sku: 'A' }])]);
    await as(db, 'postgres');
    await db.query(`delete from public.catalog_docs where kind = 'product' and id = 'p1'`);
    expect(await registry()).toEqual([]);
  });

  it('INVARIANT: after a long mixed sequence the registry equals the SKUs derived from the documents', async () => {
    await write([put('a', 'A1', [{ id: 'v', sku: 'A1-X' }]), put('b', 'B1'), put('c', 'C1')]);
    await write([put('a', 'A2', [{ id: 'v', sku: 'A1-X' }, { id: 'w', sku: 'A2-Y' }], { expected_revision: 1 })]);
    await write([{ op: 'delete', kind: 'product', id: 'b', expected_revision: 1 }, put('d', 'B1')]);
    await writeFails([put('e', 'c1')]); // rejected: must leave no trace
    await write([put('c', 'C2', [], { expected_revision: 1 }), put('e', 'C1')]);
    await as(db, 'postgres');
    const derived = (await db.query<{ sku: string; product_id: string; variant_id: string | null }>(
      `select s.sku, d.id as product_id, s.variant_id
         from public.catalog_docs d cross join lateral public.catalog_product_skus(d.data) s
        where d.kind = 'product' order by s.sku`,
    )).rows;
    expect(await registry()).toEqual(derived);
    expect(derived.length).toBeGreaterThan(5);
  });
});

describe('catalog_import — SKU conflicts', () => {
  it('duplicate SKUs INSIDE one import: the first product is imported, the later one is reported (never overwriting)', async () => {
    const rep = await imp([impDoc('p1', 'SKU-1'), impDoc('p2', ' sku-1 '), impDoc('p3', 'SKU-3')]);
    expect(rep.inserted.map((x) => x.id)).toEqual(['p1', 'p3']);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'p2', reason: 'sku_taken', sku: 'sku-1' }]);
    await as(db, 'postgres');
    expect(await count(`select 1 from public.catalog_docs where id = 'p2'`)).toBe(0);
    expect((await registry()).map((r) => r.product_id)).toEqual(['p1', 'p3']);
  });

  it('a DRY RUN reports exactly the same duplicates and writes nothing', async () => {
    const dry = await imp([impDoc('p1', 'SKU-1'), impDoc('p2', 'sku-1')], true);
    expect(dry.inserted.map((x) => x.id)).toEqual(['p1']);
    expect(dry.conflicts.map((c) => [c.id, c.reason])).toEqual([['p2', 'sku_taken']]);
    await as(db, 'postgres');
    expect(await count('select 1 from public.catalog_docs')).toBe(0);
    expect(await registry()).toEqual([]);
  });

  it('a SKU already owned by an EXISTING product is a conflict; the existing product is untouched', async () => {
    await write([put('existing', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }])]);
    const rep = await imp([impDoc('incoming', 'sku-1-a'), impDoc('fine', 'FREE')]);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'incoming', reason: 'sku_taken', sku: 'sku-1-a' }]);
    expect(rep.inserted.map((x) => x.id)).toEqual(['fine']);
    await as(db, 'postgres');
    const row = (await db.query<{ revision: number; data: { sku: string } }>(`select revision, data from public.catalog_docs where id = 'existing'`)).rows[0];
    expect(row.revision).toBe(1);
    expect(row.data.sku).toBe('SKU-1');
    expect((await registry()).filter((r) => r.product_id === 'existing')).toHaveLength(2);
  });

  it('re-importing a product that is already stored is "unchanged", not a SKU conflict with itself', async () => {
    const d = impDoc('p1', 'SKU-1', [{ id: 'v1', sku: 'SKU-1-A' }]);
    await imp([d]);
    const again = await imp([d]);
    expect(again.inserted).toEqual([]);
    expect(again.unchanged.map((x) => x.id)).toEqual(['p1']);
    expect(again.conflicts).toEqual([]);
  });

  it('an existing product whose data differs stays untouched; its registry rows are not disturbed', async () => {
    await imp([impDoc('p1', 'SKU-1')]);
    const rep = await imp([impDoc('p1', 'CHANGED-SKU')]);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'p1', reason: 'different_data' }]);
    await as(db, 'postgres');
    expect((await registry()).map((r) => r.sku)).toEqual(['sku-1']);
  });

  it('a product that repeats a SKU inside itself is reported as sku_duplicate_in_product', async () => {
    const rep = await imp([impDoc('p1', 'SKU-1', [{ id: 'v1', sku: 'sku-1' }]), impDoc('p2', 'B', [{ id: 'a', sku: 'x' }, { id: 'b', sku: ' X' }])]);
    expect(rep.conflicts.map((c) => [c.id, c.reason])).toEqual([['p1', 'sku_duplicate_in_product'], ['p2', 'sku_duplicate_in_product']]);
    expect(rep.inserted).toEqual([]);
  });

  it('imported SKUs are registered, so a later admin write cannot duplicate them', async () => {
    await imp([impDoc('p1', 'SKU-1')]);
    expect((await writeFails([put('p2', 'sku-1')])).code).toBe('CF005');
  });

  it('products without SKUs and non-product documents import normally', async () => {
    const rep = await imp([
      impDoc('p1', null),
      impDoc('p2', ''),
      { kind: 'category', id: 'c', slug: 'c', visible: true, sort_order: 0, data: { sku: 'SKU-1' } },
    ]);
    expect(rep.inserted).toHaveLength(3);
    expect(rep.conflicts).toEqual([]);
  });

  it('a slug conflict is still reported as slug_taken (unchanged behaviour)', async () => {
    await imp([impDoc('p1', 'A', [], { slug: 'same' })]);
    const rep = await imp([impDoc('p2', 'B', [], { slug: 'same' })]);
    expect(rep.conflicts.map((c) => c.reason)).toEqual(['slug_taken']);
  });
});

describe('backfill and re-application', () => {
  const backfill = () => {
    const sql = migrationSql('0006_catalog_documents.sql');
    const start = sql.indexOf('do $$\ndeclare\n  v_dups text;');
    const end = sql.indexOf('end;\n$$;', start) + 'end;\n$$;'.length;
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, end);
  };

  it('registers product documents that exist without registry rows (idempotent)', async () => {
    await as(db, 'postgres');
    await db.query(
      `insert into public.catalog_docs(kind, id, slug, data) values
        ('product', 'legacy1', 's1', '{"sku":"L-1","variants":[{"id":"v","sku":"L-1-A"}]}'),
        ('product', 'legacy2', 's2', '{"sku":" l-2 "}')`,
    );
    expect(await registry()).toEqual([]);
    await db.exec(backfill());
    await db.exec(backfill()); // second run changes nothing
    expect((await registry()).map((r) => r.sku)).toEqual(['l-1', 'l-1-a', 'l-2']);
  });

  it('DUPLICATES already present in the data are never silently registered or rewritten', async () => {
    await as(db, 'postgres');
    await db.query(
      `insert into public.catalog_docs(kind, id, slug, data) values
        ('product', 'x1', 's1', '{"sku":"DUP"}'),
        ('product', 'x2', 's2', '{"sku":"dup"}'),
        ('product', 'x3', 's3', '{"sku":"UNIQUE"}')`,
    );
    await db.exec(backfill());
    expect((await registry()).map((r) => r.sku)).toEqual(['unique']); // dup skipped, not guessed
    const data = (await db.query<{ id: string; data: { sku: string } }>(`select id, data from public.catalog_docs order by id`)).rows;
    expect(data.map((r) => r.data.sku)).toEqual(['DUP', 'dup', 'UNIQUE']); // documents untouched
  });

  it('the whole migration can be applied again on a populated database without error', async () => {
    await write([put('p1', 'SKU-1', [{ id: 'v', sku: 'SKU-1-A' }])]);
    await as(db, 'postgres'); // migrations run as the owner, not as an API role
    await db.exec('commit'); // leave the per-test transaction: re-apply for real
    try {
      await db.exec(migrationSql('0006_catalog_documents.sql'));
      await as(db, 'postgres');
      expect((await registry()).map((r) => r.sku)).toEqual(['sku-1', 'sku-1-a']);
    } finally {
      await db.exec('delete from public.catalog_docs'); // cascades to the registry
      await db.exec('begin'); // afterEach expects an open transaction
    }
  });
});
