import { AssetImage } from '../../shared/components/AssetImage';
import { useEffect, useState } from 'react';
import { useSaveAction } from '../hooks/useSaveAction';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowRight, Check, Pencil, Trash2, X } from 'lucide-react';
import { productReferenceInfo, removeProduct, useCatalog } from '../../storefront/catalog/catalogStore';
import {
  attributeByKey,
  attributeValueLabel,
  useAttributes,
} from '../../storefront/catalog/attributeStore';
import type { Availability } from '../../storefront/catalog/catalogData';
import {
  isVariantProduct,
  variantAvailability,
  variantCompareAtPrice,
  variantPrice,
} from '../../storefront/catalog/variants';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatPrice } from '../../shared/utils/format';

const availabilityLabels: Record<Availability, string> = {
  in_stock: 'متوفر',
  low_stock: 'باقي قطع قليلة',
  out_of_stock: 'نفدت الكمية',
};

const dtCls = 'w-32 shrink-0 text-xs tracking-wide text-espresso/50';

export function AdminProductDetailsPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  useAttributes(); // option labels resolve from the attribute store
  const product = catalog.products.find((p) => p.id === productId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useSaveAction();

  // Flash success banner after the product form's save — the form navigates
  // here with a `saved` flag in router state; consumed once (state cleared
  // via replace) and auto-dismissed after a few seconds.
  const location = useLocation();
  const [savedNote, setSavedNote] = useState<'created' | 'updated' | null>(
    () => {
      const s = (location.state as { saved?: unknown } | null)?.saved;
      return s === 'created' || s === 'updated' ? s : null;
    },
  );

  useEffect(() => {
    if (!savedNote) return;
    navigate(location.pathname, { replace: true, state: null });
    const t = setTimeout(() => setSavedNote(null), 4000);
    return () => clearTimeout(t);
  }, [savedNote, location.pathname, navigate]);

  if (!product) {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title="المنتج غير موجود" />
        <p className="text-sm text-espresso/60">هذا المنتج غير موجود في الكتالوج.</p>
        <Link
          to="/admin/products"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى المنتجات
        </Link>
      </div>
    );
  }

  const cat = catalog.categories.find((c) => c.slug === product.category);
  const coll = catalog.collections.find((c) => c.slug === product.collection);
  const opt = (attrKey: string, key: string) =>
    attributeValueLabel(attrKey, key, 'ar') ?? key;
  const join = (keys: string[], attrKey: string) =>
    keys.map((k) => opt(attrKey, k)).join('، ') || '—';

  const hasVariants = isVariantProduct(product);
  const axes = product.variantAxes ?? [];
  const variants = product.variants ?? [];
  const activeCount = variants.filter((v) => v.active).length;
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/admin/products"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> المنتجات
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <AssetImage src={product.image} alt={product.name.ar} className="h-28 w-22 shrink-0 object-cover" />
          <div>
            <h2 className="font-display text-2xl text-espresso">{product.name.ar}</h2>
            <p className="mt-1 font-mono text-xs text-espresso/55" dir="ltr">
              {product.sku} · {product.slug}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  product.published
                    ? 'border-gold/50 bg-gold/10 text-espresso'
                    : 'border-espresso/25 bg-espresso/5 text-espresso/70'
                }`}
              >
                {product.published ? 'منشور' : 'مخفي'}
              </span>
              <span className="rounded-full border border-espresso/25 bg-espresso/5 px-2.5 py-0.5 text-[11px] font-semibold text-espresso">
                {availabilityLabels[product.availability]}
              </span>
              {product.featured && (
                <span className="rounded-full border border-burgundy/40 bg-burgundy/10 px-2.5 py-0.5 text-[11px] font-semibold text-burgundy">
                  مميز
                </span>
              )}
              {product.isNew && (
                <span className="rounded-full border border-gold/50 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-espresso">
                  جديد
                </span>
              )}
              <span className="rounded-full border border-espresso/25 bg-espresso/5 px-2.5 py-0.5 text-[11px] font-semibold text-espresso">
                {hasVariants ? `بتنويعات · ${variants.length}` : 'منتج بسيط'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/admin/products/${product.id}/edit`}
            className="inline-flex items-center gap-2 rounded border border-espresso/25 px-4 py-2 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            <Pencil className="size-4" aria-hidden /> تعديل
          </Link>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-2 rounded border border-burgundy/40 px-4 py-2 text-sm font-medium text-burgundy transition hover:bg-burgundy/10 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            <Trash2 className="size-4" aria-hidden /> حذف
          </button>
        </div>
      </div>

      {savedNote && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded border border-espresso/20 bg-espresso px-4 py-2.5"
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium text-porcelain">
            <Check className="size-4 text-gold" aria-hidden />
            {savedNote === 'created'
              ? 'تم إضافة المنتج بنجاح.'
              : 'تم حفظ التعديلات بنجاح.'}
          </span>
          <button
            type="button"
            onClick={() => setSavedNote(null)}
            aria-label="إغلاق"
            className="inline-flex size-6 items-center justify-center rounded-full text-porcelain/60 transition hover:bg-white/10 hover:text-porcelain focus-visible:outline-2 focus-visible:outline-gold"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="pd-pricing" className="rounded border border-taupe/70 bg-white p-5">
          <h3 id="pd-pricing" className="font-display text-lg text-espresso">التسعير والتصنيف</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-3"><dt className={dtCls}>السعر</dt><dd className="font-semibold text-espresso">{formatPrice(product.price, 'ar')}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>قبل الخصم</dt><dd className="text-espresso/70">{product.compareAtPrice ? formatPrice(product.compareAtPrice, 'ar') : '—'}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>التصنيف</dt><dd className="text-espresso">{cat?.name.ar ?? product.category}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>المجموعة</dt><dd className="text-espresso">{coll?.name.ar ?? (product.collection || '—')}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>أُضيف</dt><dd className="text-espresso/70" dir="ltr">{product.createdAt}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="pd-options" className="rounded border border-taupe/70 bg-white p-5">
          <h3 id="pd-options" className="font-display text-lg text-espresso">الخيارات</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-3"><dt className={dtCls}>الألوان</dt><dd className="text-espresso">{join(product.colors, 'color')}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>الخامات</dt><dd className="text-espresso">{join(product.materials, 'material')}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>المقاسات</dt><dd className="text-espresso">{join(product.sizes, 'size')}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>المقاس الافتراضي</dt><dd className="text-espresso">{opt('size', product.size)}</dd></div>
          </dl>
        </section>
      </div>

      {hasVariants && (
        <section aria-labelledby="pd-variants" className="mt-6 rounded border border-taupe/70 bg-white p-5">
          <h3 id="pd-variants" className="font-display text-lg text-espresso">التنويعات</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-3">
              <dt className={dtCls}>محاور التنويع</dt>
              <dd className="text-espresso">
                {axes.map((a) => attributeByKey(a)?.name.ar ?? a).join('، ') || '—'}
              </dd>
            </div>
            <div className="flex gap-3"><dt className={dtCls}>الإجمالي</dt><dd className="text-espresso">{variants.length}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>مفعّلة</dt><dd className="text-espresso">{activeCount}</dd></div>
            <div className="flex gap-3"><dt className={dtCls}>غير مفعّلة</dt><dd className="text-espresso">{variants.length - activeCount}</dd></div>
          </dl>
          <div className="mt-4 overflow-x-auto rounded border border-taupe/60">
            <table className="w-full min-w-[760px] text-start text-xs">
              <thead>
                <tr className="border-b border-taupe/60 bg-taupe/20 text-espresso/60">
                  <th className="px-2.5 py-2 text-start font-medium">الصورة</th>
                  <th className="px-2.5 py-2 text-start font-medium">التركيبة</th>
                  <th className="px-2.5 py-2 text-start font-medium">SKU</th>
                  <th className="px-2.5 py-2 text-start font-medium">السعر</th>
                  <th className="px-2.5 py-2 text-start font-medium">قبل الخصم</th>

                  <th className="px-2.5 py-2 text-start font-medium">التوفر</th>
                  <th className="px-2.5 py-2 text-start font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className="border-b border-taupe/40 last:border-0">
                    <td className="px-2.5 py-2">
                      <AssetImage
                        src={v.image ?? product.image}
                        alt={v.sku}
                        className="size-9 rounded border border-taupe/70 object-cover"
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      {axes.map((a) => `${attributeByKey(a)?.name.ar ?? a}: ${opt(a, v.combo[a])}`).join(' · ')}
                    </td>
                    <td className="px-2.5 py-2 font-mono" dir="ltr">{v.sku}</td>
                    <td className="px-2.5 py-2">
                      {formatPrice(variantPrice(v, product), 'ar')}
                      {v.price === null && <span className="text-espresso/45"> (يُرث)</span>}
                    </td>
                    <td className="px-2.5 py-2">
                      {variantCompareAtPrice(v, product) !== null
                        ? `${formatPrice(variantCompareAtPrice(v, product)!, 'ar')}${v.compareAtPrice === null ? ' (يُرث)' : ''}`
                        : '—'}
                    </td>

                    <td className="px-2.5 py-2">{availabilityLabels[variantAvailability(v)]}</td>
                    <td className="px-2.5 py-2">{v.active ? 'مفعّلة' : 'غير مفعّلة'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="pd-desc" className="mt-6 rounded border border-taupe/70 bg-white p-5">
        <h3 id="pd-desc" className="font-display text-lg text-espresso">الوصف</h3>
        <p className="mt-3 text-sm leading-7 text-espresso/75">{product.description.ar || '—'}</p>
      </section>

      <section aria-labelledby="pd-images" className="mt-6 rounded border border-taupe/70 bg-white p-5">
        <h3 id="pd-images" className="font-display text-lg text-espresso">الصور</h3>
        <ul className="mt-4 flex flex-wrap gap-3">
          {product.images.map((src, i) => (
            <li key={i}>
              <AssetImage src={src} alt={`${product.name.ar} — صورة ${i + 1}`} className="h-32 w-24 object-cover" />
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="حذف المنتج"
        body={(() => {
          const refs = productReferenceInfo(product.id);
          const touches: string[] = [];
          if (refs.cartLines > 0) touches.push(`${refs.cartLines} في سلة التسوق الحالية`);
          if (refs.wishlisted) touches.push('في المفضلة');
          if (refs.homepageFeatured) touches.push('ضمن قسم المنتجات المميزة بالصفحة الرئيسية');
          const touchesNote = touches.length > 0 ? ` سيُزال أيضًا من: ${touches.join('، ')}.` : '';
          const ordersNote =
            refs.historicalOrders > 0
              ? ` الطلبات السابقة (${refs.historicalOrders}) تحتفظ بنسخة مستقلة من بيانات المنتج ولن تتأثر.`
              : '';
          return `حذف «${product.name.ar}» نهائيًا؟ سيختفي من المتجر ومن قوائم الإدارة — لا يمكن التراجع.${touchesNote}${ordersNote}`;
        })()}
        confirmLabel={del.busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
        confirmDisabled={del.busy}
        error={del.error}
        onConfirm={async () => {
          const r = await del.run(() => removeProduct(product.id));
          if (r.ok) navigate('/admin/products');
        }}
        onCancel={() => {
          del.clearError();
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}
