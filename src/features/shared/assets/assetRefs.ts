import { getCatalog } from '../../storefront/catalog/catalogStore';
import { getHomeContent } from '../../storefront/home/homeStore';
import { getOrders } from '../../storefront/checkout/orderStore';
import { getDocsState } from '../../storefront/catalog/catalogDocs';
import { isLocalImageRef } from './imageStore';
import { LEGACY_KEYS } from '../../admin/migration/legacyBundle';

// IMAGE REFERENCE SCAN — finds every saved entity still pointing at an image
// ref (`media:<path>` in Storage, or a legacy `local:<id>`) before permanent
// deletion. Scans products (including
// per-variant images), categories, collections, homepage sections, and order
// line snapshots. Used by the media library delete guard; deletion is blocked
// while any reference remains. Variants store only the same ref string —
// the shared file is never duplicated.

// Raw legacy browser data (the pre-migration catalog/attributes/menus/homepage
// the migration tool reads). A plain substring search on purpose: it must not
// depend on parsing succeeding or on the shape of old data.
function legacyBrowserReferences(ref: string): string[] {
  const uses: string[] = [];
  for (const key of Object.values(LEGACY_KEYS)) {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw && raw.includes(ref)) uses.push(`بيانات هذا المتصفح غير المرحَّلة (${key})`);
  }
  return uses;
}

// Why a deletion cannot be proven safe even when no reference was found.
// Before the catalog migration is activated the app serves the BUILT-IN demo
// catalog, which says nothing about whether a locally stored image is used by
// the data that still lives only in this browser — so a local image is never
// "unused" until the migration has moved that data to the database.
export function imageDeletionUnverifiedReason(ref: string): string | null {
  if (isLocalImageRef(ref) && !getDocsState().initialized) {
    return 'لم يُرحَّل الكتالوج بعد، لذلك لا يمكن التأكد من أن هذه الصورة المحلية غير مستخدمة في بياناتك المحلية. أكمل «النسخ الاحتياطي والترحيل» أولًا.';
  }
  return null;
}

export function imageReferences(ref: string): string[] {
  const uses: string[] = legacyBrowserReferences(ref);
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
