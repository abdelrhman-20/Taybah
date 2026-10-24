import { getCatalog } from '../../storefront/catalog/catalogStore';
import { getHomeContent } from '../../storefront/home/homeStore';
import { getOrders } from '../../storefront/checkout/orderStore';
import { LOCAL_IMAGE_PREFIX } from './imageStore';

// IMAGE REFERENCE SCAN — finds every saved entity still pointing at a local
// asset (`local:<id>`) before permanent deletion. Scans products (including
// per-variant images), categories, collections, homepage sections, and order
// line snapshots. Used by the media library delete guard; deletion is blocked
// while any reference remains. Variants store only the same `local:` ref
// string — the shared blob is never duplicated.

export function imageReferences(assetId: string): string[] {
  const ref = `${LOCAL_IMAGE_PREFIX}${assetId}`;
  const uses: string[] = [];
  const catalog = getCatalog();

  for (const p of catalog.products) {
    if (p.image === ref || p.imageHover === ref || (p.images ?? []).includes(ref)) {
      uses.push(`منتج: ${p.name.ar}`);
    }
    for (const v of p.variants ?? []) {
      if (v.image === ref) uses.push(`تنويعة منتج: ${p.name.ar} — ${v.sku}`);
    }
  }
  for (const c of catalog.categories) {
    if (c.image === ref) uses.push(`تصنيف: ${c.name.ar}`);
  }
  for (const c of catalog.collections) {
    if (c.image === ref) uses.push(`مجموعة: ${c.name.ar}`);
  }

  const home = getHomeContent();
  if (home.hero.slides.some((s) => s.image === ref)) uses.push('الصفحة الرئيسية: قسم البطل');
  if (home.brand.image === ref) uses.push('الصفحة الرئيسية: تعريف العلامة');
  if (home.editorial.image === ref) uses.push('الصفحة الرئيسية: البانر التحريري');
  if (home.collection.image1 === ref || home.collection.image2 === ref)
    uses.push('الصفحة الرئيسية: المجموعة المميزة');

  if (home.newsletter.image === ref) uses.push('الصفحة الرئيسية: النشرة البريدية');
  if (home.story.image === ref) uses.push('الصفحة الرئيسية: حكاية طيبة');
  if (home.shopCategories.cards.some((c) => c.image === ref))
    uses.push('الصفحة الرئيسية: تسوّق حسب القسم');
  if (home.collections.cards.some((c) => c.image === ref))
    uses.push('الصفحة الرئيسية: المجموعات');

  for (const o of getOrders()) {
    if (o.lines.some((l) => l.image === ref)) uses.push(`طلب: ${o.ref}`);
  }

  return uses;
}
