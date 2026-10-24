import { describe, expect, it } from 'vitest';
import type { LegacyBundle, LegacySource } from './legacyBundle';
import { freshBackend, product, category } from '../../../test/harness';

// SKU handling in the migration pipeline: detection of duplicates inside the
// legacy data, explicit (never automatic) replacement, and how the database's
// SKU conflicts surface — against the FAKE backend (client.mock.ts), whose
// registry logic mirrors migration 0006 (the SQL itself is tested for real in
// supabase/tests/sku-registry.test.ts).

const catalogJson = (products: unknown[]) =>
  JSON.stringify({ products, categories: [category('rugs')], collections: [category('diwan')] });

function source(products: unknown[]): LegacySource {
  const bundle: LegacyBundle = {
    format: 'taybah-local-backup',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'http://localhost',
    storage: {
      catalog: { present: true, raw: catalogJson(products) },
      attributes: { present: false, raw: null },
      navigation: { present: false, raw: null },
      homepage: { present: false, raw: null },
    },
    images: [],
  };
  return { bundle, blobs: new Map() };
}

async function engine() {
  const legacy = await import('./legacyBundle');
  const eng = await import('./migrationEngine');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  return { legacy, eng, docs };
}

const v = (id: string, sku: string) => ({ id, sku, combo: {}, price: null, compareAtPrice: null, availability: 'in_stock', stockQuantity: null, image: null, active: true });

describe('findSkuProblems', () => {
  it('finds duplicates with the same normalisation as the form and the database (trim + lowercase)', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'DUP-1' }), product('b', { sku: '  dup-1 ' }), product('c', { sku: 'OK-3' })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    expect(plan.skuProblems).toHaveLength(1);
    expect(plan.skuProblems[0].sku).toBe('dup-1');
    expect(plan.skuProblems[0].occurrences.map((o) => o.productId)).toEqual(['a', 'b']);
  });

  it('product SKUs and variant SKUs share one namespace; a variant repeating its own product SKU is a duplicate', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([
      product('a', { sku: 'A-1', variants: [v('v1', 'shared')] }),
      product('b', { sku: 'B-1', variants: [v('v2', 'SHARED'), v('v3', 'b-1')] }),
    ]);
    const problems = eng.buildPlan(legacy.parseLegacy(src.bundle), src).skuProblems.map((p) => p.sku).sort();
    expect(problems).toEqual(['b-1', 'shared']);
  });

  it('blank SKUs are never duplicates', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: '' }), product('b', { sku: '   ' }), product('c', { sku: undefined })]);
    expect(eng.buildPlan(legacy.parseLegacy(src.bundle), src).skuProblems).toEqual([]);
  });

  it('the built-in demo catalog has no duplicate SKUs, so a browser that never saved anything migrates cleanly', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const bundle: LegacyBundle = { ...source([]).bundle, storage: { catalog: { present: false, raw: null }, attributes: { present: false, raw: null }, navigation: { present: false, raw: null }, homepage: { present: false, raw: null } } };
    const plan = eng.buildPlan(legacy.parseLegacy(bundle), { bundle, blobs: new Map() });
    expect(plan.docs.filter((d) => d.kind === 'product').length).toBeGreaterThan(5);
    expect(plan.skuProblems).toEqual([]);
  });
});

describe('explicit replacement (never automatic)', () => {
  it('nothing is renamed unless the admin supplies a value; the first occurrence always keeps its SKU', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'DUP' }), product('b', { sku: 'dup' })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const skus = plan.docs.filter((d) => d.kind === 'product').map((d) => (d.data as { sku: string }).sku);
    expect(skus).toEqual(['DUP', 'dup']); // exactly as the admin had them
    const rows = eng.skuRowsNeedingNewValue(plan, []);
    expect(rows.map((r) => [r.productId, r.reason])).toEqual([['b', 'duplicate_in_data']]); // only the LATER one
  });

  it('an override is applied to the imported copy of the product SKU and of a variant SKU, and resolves the duplicate', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const parsed = legacy.parseLegacy(source([product('a', { sku: 'DUP' }), product('b', { sku: 'x', variants: [v('v1', 'dup'), v('v2', 'keep')] })]).bundle);
    const src = source([]);
    const base = eng.buildPlan(parsed, src);
    expect(eng.skuRowsNeedingNewValue(base, []).map((r) => r.key)).toEqual(['b:v1']);
    const fixed = eng.buildPlan(parsed, src, { 'b:v1': 'DUP-B1' });
    expect(fixed.skuProblems).toEqual([]);
    const b = fixed.docs.find((d) => d.id === 'b')!.data as { sku: string; variants: Array<{ id: string; sku: string }> };
    expect(b.sku).toBe('x');
    expect(b.variants.map((x) => x.sku)).toEqual(['DUP-B1', 'keep']);
    // the base plan (and therefore the parsed source) is not mutated
    const baseB = base.docs.find((d) => d.id === 'b')!.data as { variants: Array<{ sku: string }> };
    expect(baseB.variants[0].sku).toBe('dup');
  });

  it('a blank replacement means "not resolved": it can never blank a SKU out', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'DUP' }), product('b', { sku: 'dup' })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src, { b: '   ' });
    expect((plan.docs.find((d) => d.id === 'b')!.data as { sku: string }).sku).toBe('dup');
    expect(plan.skuProblems).toHaveLength(1);
  });

  it('a replacement that is itself a duplicate is still reported', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'DUP' }), product('b', { sku: 'dup' }), product('c', { sku: 'TAKEN' })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src, { b: ' taken ' });
    expect(plan.skuProblems.map((p) => p.sku)).toEqual(['taken']);
  });
});

describe('database SKU conflicts through the import', () => {
  it('duplicates inside the data: the first product imports, the later one is reported as sku_taken and NOT overwritten', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'DUP' }), product('b', { sku: ' dup ' })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const rep = await eng.importDocs(plan.docs, false);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'b', reason: 'sku_taken', sku: 'dup' }]);
    expect(b.tables.catalog_docs.some((d) => d.id === 'a')).toBe(true);
    expect(b.tables.catalog_docs.some((d) => d.id === 'b')).toBe(false);
  });

  it('a SKU already owned by a stored product conflicts; the stored product is untouched; resolving it by an override imports cleanly', async () => {
    const b = await freshBackend('admin');
    b.putDoc('product', 'stored', product('stored', { sku: 'ACME-1' }), { slug: 'slug-stored' });
    const { legacy, eng } = await engine();
    const src = source([product('incoming', { sku: 'acme-1' })]);
    const parsed = legacy.parseLegacy(src.bundle);

    const first = eng.buildPlan(parsed, src);
    const dry = await eng.importDocs(first.docs, true);
    const skuConflicts = dry.conflicts.filter((c) => eng.isSkuConflict(c.reason));
    expect(skuConflicts).toEqual([{ kind: 'product', id: 'incoming', reason: 'sku_taken', sku: 'acme-1' }]);
    expect((b.tables.catalog_docs.find((d) => d.id === 'stored')!.data as { sku: string }).sku).toBe('ACME-1');

    // the page would now show a row for this product; the admin supplies a new SKU
    const rows = eng.skuRowsNeedingNewValue(first, skuConflicts);
    expect(rows.map((r) => [r.productId, r.reason])).toEqual([['incoming', 'taken_in_database']]);
    const fixed = eng.buildPlan(parsed, src, { [rows[0].key]: 'ACME-1-NEW' });
    const dry2 = await eng.importDocs(fixed.docs, true);
    expect(dry2.conflicts.filter((c) => eng.isSkuConflict(c.reason))).toEqual([]);
    const real = await eng.importDocs(fixed.docs, false);
    expect(real.inserted.map((x) => x.id)).toContain('incoming');
    expect((b.tables.catalog_docs.find((d) => d.id === 'incoming')!.data as { sku: string }).sku).toBe('ACME-1-NEW');
  });

  it('re-running an import never conflicts with itself (idempotent)', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source([product('a', { sku: 'A-1', variants: [v('v1', 'A-1-X')] })]);
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    await eng.importDocs(plan.docs, false);
    const again = await eng.importDocs(plan.docs, false);
    expect(again.conflicts).toEqual([]);
    expect(again.unchanged.some((x) => x.id === 'a')).toBe(true);
    void b;
  });
});
