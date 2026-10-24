import { describe, expect, it } from 'vitest';
import type { LegacyBundle, LegacySource } from './legacyBundle';
import { freshBackend, reloadWith, product, category, type Backend } from '../../../test/harness';

// Migration pipeline against the FAKE backend (client.mock.ts): planning,
// idempotent image upload, conflict-reporting import, verification, homepage
// reference rewrite and cutover. (The import RPC's SQL is verified for real in
// supabase/tests/migrations.test.ts.)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 7, 7, 7]);

const catalogJson = (products: unknown[]) =>
  JSON.stringify({
    products,
    categories: [category('rugs', { order: 1 }), category('curtains', { order: 2 })],
    collections: [category('diwan', { order: 1 })],
  });

function source(opts: { catalog?: string; images?: string[]; missing?: string[] } = {}): LegacySource {
  const images = opts.images ?? [];
  const bundle: LegacyBundle = {
    format: 'taybah-local-backup',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'http://localhost',
    storage: {
      catalog: { present: opts.catalog !== undefined, raw: opts.catalog ?? null },
      attributes: { present: false, raw: null },
      navigation: { present: false, raw: null },
      homepage: { present: false, raw: null },
    },
    images: images.map((id) => ({
      id,
      name: `${id}.png`,
      type: 'image/png',
      size: PNG.length,
      createdAt: '2026-01-01T00:00:00Z',
      file: `images/${id}.png`,
    })),
  };
  return { bundle, blobs: new Map(images.map((id) => [id, new Blob([PNG], { type: 'image/png' })])) };
}

async function engine() {
  const legacy = await import('./legacyBundle');
  const eng = await import('./migrationEngine');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  return { legacy, eng, docs };
}

describe('collectLocalRefs / rewriteLocalRefs', () => {
  it('finds and rewrites whole-string local refs at any depth, leaving everything else alone', async () => {
    await freshBackend('admin');
    const { eng } = await engine();
    const data = {
      image: 'local:a',
      images: ['local:a', '/images/x.webp', 'local:b'],
      variants: [{ image: 'local:c' }, { image: null }],
      note: 'text mentioning local:a inside a sentence',
      n: 3,
    };
    expect([...eng.collectLocalRefs(data)].sort()).toEqual(['local:a', 'local:b', 'local:c']);
    const map = new Map([['local:a', 'media:migrated/a.png'], ['local:c', 'media:migrated/c.png']]);
    const out = eng.rewriteLocalRefs(data, map);
    expect(out.image).toBe('media:migrated/a.png');
    expect(out.images).toEqual(['media:migrated/a.png', '/images/x.webp', 'local:b']); // unmapped kept
    expect(out.variants[0].image).toBe('media:migrated/c.png');
    expect(out.note).toBe(data.note);
    expect(data.image).toBe('local:a'); // input not mutated
  });
});

describe('buildPlan', () => {
  it('preserves ids, slugs, order and relationships, and maps images to deterministic media refs', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const p1 = product('p1', { image: 'local:img1', images: ['local:img1', '/images/y.webp'] });
    const p2 = product('p2', { published: false, variants: [{ id: 'v1', sku: 'V', combo: {}, image: 'local:img2', active: true }] });
    const src = source({ catalog: catalogJson([p1, p2]), images: ['img1', 'img2'] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);

    const prod = plan.docs.filter((d) => d.kind === 'product');
    expect(prod.map((d) => d.id)).toEqual(['p1', 'p2']);
    expect(prod.map((d) => d.sort_order)).toEqual([0, 1]);
    expect(prod[1].visible).toBe(false); // unpublished stays hidden
    expect(prod[0].slug).toBe('slug-p1');
    expect((prod[0].data as { image: string }).image).toBe('media:migrated/img1.png');
    expect((prod[0].data as { images: string[] }).images).toEqual(['media:migrated/img1.png', '/images/y.webp']);
    expect((prod[1].data as { variants: Array<{ image: string }> }).variants[0].image).toBe('media:migrated/img2.png');
    expect(plan.docs.filter((d) => d.kind === 'category').map((d) => d.id)).toEqual(['rugs', 'curtains']);
    expect(plan.docs.filter((d) => d.kind === 'nav').map((d) => d.id)).toEqual(['main', 'footer']);
    expect(plan.images.map((i) => i.path)).toEqual(['migrated/img1.png', 'migrated/img2.png']);
    expect(plan.missingImageRefs).toEqual([]);
    expect(plan.counts).toMatchObject({ product: 2, category: 2, collection: 1, attribute: 3, nav: 2 });
  });

  it('reports references whose image bytes are not in the source (cannot be migrated)', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([product('p1', { image: 'local:lost' })]), images: [] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    expect(plan.missingImageRefs).toEqual(['local:lost']);
    expect((plan.docs[0].data as { image: string }).image).toBe('local:lost'); // untouched
  });
});

describe('uploadImages', () => {
  it('uploads, then a re-run reports already_present — never duplicating', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([]), images: ['a', 'b'] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const first = await eng.uploadImages(plan.images, src.blobs);
    expect(first.map((r) => r.status)).toEqual(['uploaded', 'uploaded']);
    const second = await eng.uploadImages(plan.images, src.blobs);
    expect(second.map((r) => r.status)).toEqual(['already_present', 'already_present']);
    expect(b.objects.size).toBe(2);
  });

  it('reports a failed image without aborting the others, and a retry completes it', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([]), images: ['a', 'b', 'c'] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    b.failNext('storage:upload', { message: 'Failed to fetch' }); // first upload only
    const first = await eng.uploadImages(plan.images, src.blobs);
    expect(first.map((r) => r.status)).toEqual(['failed', 'uploaded', 'uploaded']);
    expect(first[0].error).toBe('network');
    const retry = await eng.uploadImages(plan.images, src.blobs);
    expect(retry.map((r) => r.status)).toEqual(['uploaded', 'already_present', 'already_present']);
    expect(b.objects.size).toBe(3);
  });

  it('reports progress', async () => {
    await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([]), images: ['a', 'b'] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const seen: Array<[number, number]> = [];
    await eng.uploadImages(plan.images, src.blobs, (d, t) => seen.push([d, t]));
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});

describe('importDocs', () => {
  it('a dry run reports what would happen and writes nothing', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([product('p1')]) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const dry = await eng.importDocs(plan.docs, true);
    expect(dry.dryRun).toBe(true);
    expect(dry.inserted.length).toBe(plan.docs.length);
    expect(b.tables.catalog_docs).toHaveLength(0);
  });

  it('imports everything once, and re-importing is idempotent (all unchanged)', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([product('p1'), product('p2')]) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const r1 = await eng.importDocs(plan.docs, false);
    expect(r1.inserted).toHaveLength(plan.docs.length);
    expect(r1.conflicts).toEqual([]);
    const r2 = await eng.importDocs(plan.docs, false);
    expect(r2.inserted).toEqual([]);
    expect(r2.unchanged).toHaveLength(plan.docs.length);
    expect(b.tables.catalog_docs).toHaveLength(plan.docs.length);
  });

  it('NEVER overwrites an existing record that differs — it is reported as a conflict', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    b.putDoc('product', 'p1', product('p1', { price: 99999 }), { slug: 'slug-p1' });
    const src = source({ catalog: catalogJson([product('p1', { price: 1 }), product('p2')]) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const rep = await eng.importDocs(plan.docs, false);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'p1', reason: 'different_data' }]);
    expect((b.tables.catalog_docs.find((d) => d.id === 'p1')!.data as { price: number }).price).toBe(99999);
    expect(b.tables.catalog_docs.some((d) => d.id === 'p2')).toBe(true); // non-conflicting still imported
  });

  it('reports a slug already used by a different record', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    b.putDoc('product', 'other', product('other', { slug: 'slug-p1' }), { slug: 'slug-p1' });
    const src = source({ catalog: catalogJson([product('p1')]) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const rep = await eng.importDocs(plan.docs, false);
    expect(rep.conflicts).toEqual([{ kind: 'product', id: 'p1', reason: 'slug_taken' }]);
  });

  it('splits large imports into chunks and merges the report', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng } = await engine();
    const many = Array.from({ length: 450 }, (_, i) => product(`p${i}`));
    const src = source({ catalog: catalogJson(many) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const rep = await eng.importDocs(plan.docs, false);
    expect(b.calls('rpc:catalog_import')).toBeGreaterThanOrEqual(3);
    expect(rep.inserted).toHaveLength(plan.docs.length);
  });

  it('is refused for a non-admin', async () => {
    await freshBackend('user');
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([product('p1')]) });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    await expect(eng.importDocs(plan.docs, false)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('verifyMigration', () => {
  async function imported(b: Backend) {
    const { legacy, eng } = await engine();
    const src = source({ catalog: catalogJson([product('p1', { image: 'local:i1' })]), images: ['i1'] });
    const plan = eng.buildPlan(legacy.parseLegacy(src.bundle), src);
    const up = await eng.uploadImages(plan.images, src.blobs);
    await eng.importDocs(plan.docs, false);
    void b;
    return { eng, plan, up };
  }

  it('passes when documents match the plan and images exist', async () => {
    const b = await freshBackend('admin');
    const { eng, plan, up } = await imported(b);
    const v = await eng.verifyMigration(plan, up);
    expect(v).toMatchObject({ ok: true, mismatches: [], missingObjects: [] });
    expect(v.checked).toBe(plan.docs.length);
  });

  it('detects a missing document', async () => {
    const b = await freshBackend('admin');
    const { eng, plan, up } = await imported(b);
    b.tables.catalog_docs = b.tables.catalog_docs.filter((d) => d.id !== 'p1');
    const v = await eng.verifyMigration(plan, up);
    expect(v.ok).toBe(false);
    expect(v.mismatches).toContainEqual({ kind: 'product', id: 'p1', reason: 'missing' });
  });

  it('detects a document whose content differs from the plan', async () => {
    const b = await freshBackend('admin');
    const { eng, plan, up } = await imported(b);
    (b.tables.catalog_docs.find((d) => d.id === 'p1')!.data as { price: number }).price = 1;
    const v = await eng.verifyMigration(plan, up);
    expect(v.mismatches).toContainEqual({ kind: 'product', id: 'p1', reason: 'different' });
  });

  it('detects an uploaded image that is no longer in storage', async () => {
    const b = await freshBackend('admin');
    const { eng, plan, up } = await imported(b);
    b.objects.clear();
    const v = await eng.verifyMigration(plan, up);
    expect(v.ok).toBe(false);
    expect(v.missingObjects).toEqual(['migrated/i1.png']);
  });
});

describe('homepage image references', () => {
  it('points saved homepage sections at the migrated images, persisted and verified', async () => {
    const b = await freshBackend('admin');
    const { eng } = await engine();
    const home = await import('../../storefront/home/homeStore');
    await home.refreshHomeContent();
    await home.updateHomeSection('brand', { ...home.getHomeContent().brand, image: 'local:hb' });
    await home.updateHomeSection('story', { ...home.getHomeContent().story, image: '/images/home/story.webp' });
    expect(eng.homeLocalRefs()).toEqual(['local:hb']);

    const res = await eng.rewriteHomepageRefs(new Map([['local:hb', 'media:migrated/hb.png']]));
    expect(res.find((r) => r.section === 'brand')?.status).toBe('rewritten');
    expect(res.filter((r) => r.status === 'failed')).toEqual([]);
    expect(eng.homeLocalRefs()).toEqual([]);
    const row = b.tables.home_sections.find((r) => r.id === 'brand')!;
    expect((row.data as { image: string }).image).toBe('media:migrated/hb.png');
    expect(home.getHomeContent().story.image).toBe('/images/home/story.webp'); // untouched
  });

  it('writes nothing when no homepage section holds a mapped reference', async () => {
    const b = await freshBackend('admin');
    const { eng } = await engine();
    const home = await import('../../storefront/home/homeStore');
    await home.refreshHomeContent();
    const res = await eng.rewriteHomepageRefs(new Map([['local:zzz', 'media:migrated/zzz.png']]));
    expect(res.every((r) => r.status === 'unchanged')).toBe(true);
    expect(b.calls('from:home_sections:upsert')).toBe(0);
  });

  it('reports a section whose rewrite failed instead of claiming success', async () => {
    const b = await freshBackend('admin');
    const { eng } = await engine();
    const home = await import('../../storefront/home/homeStore');
    await home.refreshHomeContent();
    await home.updateHomeSection('brand', { ...home.getHomeContent().brand, image: 'local:hb' });
    b.failNext('from:home_sections:upsert', { code: '42501', message: 'denied' });
    const res = await eng.rewriteHomepageRefs(new Map([['local:hb', 'media:migrated/hb.png']]));
    expect(res.find((r) => r.section === 'brand')).toMatchObject({ status: 'failed', error: 'unauthorized' });
    expect(eng.homeLocalRefs()).toEqual(['local:hb']); // still local: nothing was claimed
  });
});

describe('cutover', () => {
  it('finalize flips the flag so the storefront switches to the database; rollback flips it back without deleting data', async () => {
    const b = await freshBackend('admin');
    const { eng, docs } = await engine();
    expect(docs.getDocsState().initialized).toBe(false);
    await eng.finalizeMigration();
    expect(docs.getDocsState().initialized).toBe(true);
    b.putDoc('product', 'keep', product('keep'));
    await eng.rollbackMigrationFlag();
    expect(docs.getDocsState().initialized).toBe(false);
    expect(b.tables.catalog_docs.some((d) => d.id === 'keep')).toBe(true);
  });

  it('a non-admin cannot flip the flag', async () => {
    await freshBackend('user');
    const { eng } = await engine();
    await expect(eng.finalizeMigration()).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('full pipeline: legacy browser -> database -> a fresh private window', () => {
  it('migrates catalog + attributes + navigation + images and a visitor in a new browser sees them', async () => {
    const b = await freshBackend('admin');
    const { legacy, eng, docs } = await engine();

    // 1. the old browser: two edited products, one with an uploaded image
    const src = source({
      catalog: catalogJson([
        product('p1', { image: 'local:photo', images: ['local:photo'], price: 4200 }),
        product('p2', { published: false }),
      ]),
      images: ['photo'],
    });
    const parsed = legacy.parseLegacy(src.bundle);
    const plan = eng.buildPlan(parsed, src);

    // 2. backup (recoverable) — then the run
    const backup = await legacy.createBackupZip(src);
    expect(legacy.parseBackupZip(backup).bundle.images).toHaveLength(1);
    const dry = await eng.importDocs(plan.docs, true);
    expect(dry.conflicts).toEqual([]);
    const uploads = await eng.uploadImages(plan.images, src.blobs);
    expect(uploads.every((u) => u.status === 'uploaded')).toBe(true);
    const report = await eng.importDocs(plan.docs, false);
    expect(report.conflicts).toEqual([]);
    const verify = await eng.verifyMigration(plan, uploads);
    expect(verify.ok).toBe(true);
    await eng.finalizeMigration();
    expect(docs.getDocsState().initialized).toBe(true);

    // 3. a visitor, brand-new browser, nothing in local storage
    await reloadWith(b, 'anon');
    const catalog = await import('../../storefront/catalog/catalogStore');
    const media = await import('../../shared/assets/mediaStorage');
    const docs2 = await import('../../storefront/catalog/catalogDocs');
    await docs2.whenDocsSettled();
    const products = catalog.getCatalog().products;
    expect(products.map((p) => p.id)).toEqual(['p1']); // draft p2 is not delivered
    expect(products[0].price).toBe(4200);
    expect(products[0].image).toBe('media:migrated/photo.png');
    expect(media.mediaPublicUrl(media.mediaPath(products[0].image))).toContain('/migrated/photo.png');
    expect(b.objects.has('migrated/photo.png')).toBe(true);
  });
});
