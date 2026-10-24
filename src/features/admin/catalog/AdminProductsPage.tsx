import { AssetImage } from '../../shared/components/AssetImage';
import { useMemo, useState } from 'react';
import { useSaveAction } from '../hooks/useSaveAction';
import { Link } from 'react-router';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { productReferenceInfo, useCatalog, removeProduct } from '../../storefront/catalog/catalogStore';
import type { Availability } from '../../storefront/catalog/catalogData';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatPrice } from '../../shared/utils/format';

const availabilityLabels: Record<Availability, string> = {
  in_stock: 'متوفر',
  low_stock: 'باقي قطع قليلة',
  out_of_stock: 'نفدت الكمية',
};
const availabilityStyles: Record<Availability, string> = {
  in_stock: 'border-gold/50 bg-gold/10 text-espresso',
  low_stock: 'border-espresso/30 bg-espresso/10 text-espresso',
  out_of_stock: 'border-burgundy/40 bg-burgundy/10 text-burgundy',
};

const selectCls =
  'border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy';

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

type SortKey = 'name' | 'price-asc' | 'price-desc' | 'newest';

export function AdminProductsPage() {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [collection, setCollection] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const del = useSaveAction();

  const catName = (slug: string) =>
    catalog.categories.find((c) => c.slug === slug)?.name.ar ?? slug;
  const collName = (slug: string) =>
    catalog.collections.find((c) => c.slug === slug)?.name.ar ?? (slug || '—');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = catalog.products.filter((p) => {
      if (q && !`${p.name.ar} ${p.sku}`.toLowerCase().includes(q)) return false;
      if (category !== 'all' && p.category !== category) return false;
      if (collection !== 'all' && p.collection !== collection) return false;
      if (availability !== 'all' && p.availability !== availability) return false;
      return true;
    });
    switch (sort) {
      case 'price-asc':
        return [...list].sort((a, b) => a.price - b.price);
      case 'price-desc':
        return [...list].sort((a, b) => b.price - a.price);
      case 'newest':
        return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      default:
        return [...list].sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'));
    }
  }, [catalog.products, query, category, collection, availability, sort]);

  const hasFilters = query || category !== 'all' || collection !== 'all' || availability !== 'all';
  const clear = () => {
    setQuery('');
    setCategory('all');
    setCollection('all');
    setAvailability('all');
  };

  const deleteTarget = catalog.products.find((p) => p.id === deleteId);
  // Products are never structurally blocked from deletion — nothing holds a
  // REQUIRED reference to one the way products hold a required `category`
  // (see productReferenceInfo's doc comment). This is purely informational,
  // shown so Admin knows what currently touches the product before
  // confirming; historical orders are explicitly called out as unaffected.
  const deleteRefs = deleteTarget ? productReferenceInfo(deleteTarget.id) : null;
  const deleteBody = (() => {
    if (!deleteTarget) return '';
    const touches: string[] = [];
    if (deleteRefs!.cartLines > 0) touches.push(`${deleteRefs!.cartLines} في سلة التسوق الحالية`);
    if (deleteRefs!.wishlisted) touches.push('في المفضلة');
    if (deleteRefs!.homepageFeatured) touches.push('ضمن قسم المنتجات المميزة بالصفحة الرئيسية');
    const touchesNote =
      touches.length > 0 ? ` سيُزال أيضًا من: ${touches.join('، ')}.` : '';
    const ordersNote =
      deleteRefs!.historicalOrders > 0
        ? ` الطلبات السابقة (${deleteRefs!.historicalOrders}) تحتفظ بنسخة مستقلة من بيانات المنتج ولن تتأثر.`
        : '';
    return `حذف «${deleteTarget.name.ar}» نهائيًا؟ ستُزال الصورة والأسعار والخيارات من الكتالوج — لا يمكن التراجع.${touchesNote}${ordersNote}`;
  })();

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader
        title="المنتجات"
        description="إدارة كتالوج المتجر — تنعكس الإضافات والتعديلات على واجهة المتجر فورًا."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المنتج أو SKU"
            aria-label="البحث في المنتجات"
            className="w-full border border-taupe bg-white py-2 pe-3 ps-10 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="التصفية حسب التصنيف" className={selectCls}>
          <option value="all">كل التصنيفات</option>
          {catalog.categories.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name.ar}</option>
          ))}
        </select>
        <select value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="التصفية حسب المجموعة" className={selectCls}>
          <option value="all">كل المجموعات</option>
          {catalog.collections.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name.ar}</option>
          ))}
        </select>
        <select value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="التصفية حسب التوفر" className={selectCls}>
          <option value="all">كل حالات المخزون</option>
          {(Object.keys(availabilityLabels) as Availability[]).map((a) => (
            <option key={a} value={a}>{availabilityLabels[a]}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="ترتيب المنتجات" className={selectCls}>
          <option value="name">الاسم</option>
          <option value="price-asc">السعر: من الأقل</option>
          <option value="price-desc">السعر: من الأعلى</option>
          <option value="newest">الأحدث</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            className="text-xs font-medium text-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            مسح
          </button>
        )}
        <Link
          to="/admin/products/new"
          className="inline-flex items-center gap-2 rounded bg-burgundy px-4 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Plus className="size-4" aria-hidden /> إضافة منتج
        </Link>
      </div>

      <p className="mt-4 text-xs tracking-wide text-espresso/55">
        {filtered.length} من {catalog.products.length} منتج
      </p>

      {filtered.length === 0 ? (
        <div className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center">
          <p className="text-sm text-espresso/60">
            {catalog.products.length === 0
              ? 'لا توجد منتجات — أضف أول منتج للكتالوج.'
              : 'لا توجد منتجات تطابق البحث أو عوامل التصفية الحالية.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 hidden overflow-x-auto rounded border border-taupe/70 bg-white md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-taupe/60 text-xs tracking-wide text-espresso/50">
                  <th className="px-3 py-3 text-start font-medium">المنتج</th>
                  <th className="px-3 py-3 text-start font-medium">SKU</th>
                  <th className="px-3 py-3 text-start font-medium">التصنيف</th>
                  <th className="px-3 py-3 text-start font-medium">المجموعة</th>
                  <th className="px-3 py-3 text-end font-medium">السعر</th>
                  <th className="px-3 py-3 text-end font-medium">قبل الخصم</th>
                  <th className="px-3 py-3 text-start font-medium">المخزون</th>
                  <th className="px-3 py-3 text-start font-medium">النشر</th>
                  <th className="px-3 py-3" aria-label="الإجراءات" />
                </tr>
              </thead>
              <tbody className="divide-y divide-taupe/50">
                {filtered.map((p) => (
                  <tr key={p.id} className="transition hover:bg-porcelain/50">
                    <td className="px-3 py-3">
                      <Link
                        to={`/admin/products/${p.id}`}
                        className="flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <AssetImage src={p.image} alt={p.name.ar} className="size-11 shrink-0 object-cover" />
                        <span className="font-medium text-espresso">{p.name.ar}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-espresso/70" dir="ltr">{p.sku}</td>
                    <td className="px-3 py-3 text-espresso/70">{catName(p.category)}</td>
                    <td className="px-3 py-3 text-espresso/70">{collName(p.collection)}</td>
                    <td className="px-3 py-3 text-end font-semibold text-espresso">
                      {formatPrice(p.price, 'ar')}
                    </td>
                    <td className="px-3 py-3 text-end text-espresso/60">
                      {p.compareAtPrice ? formatPrice(p.compareAtPrice, 'ar') : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <Pill label={availabilityLabels[p.availability]} tone={availabilityStyles[p.availability]} />
                    </td>
                    <td className="px-3 py-3">
                      <Pill
                        label={p.published ? 'منشور' : 'مخفي'}
                        tone={p.published ? 'border-gold/50 bg-gold/10 text-espresso' : 'border-espresso/25 bg-espresso/5 text-espresso/70'}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/admin/products/${p.id}/edit`}
                          aria-label={`تعديل ${p.name.ar}`}
                          className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteId(p.id)}
                          aria-label={`حذف ${p.name.ar}`}
                          className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-5 space-y-3 md:hidden">
            {filtered.map((p) => (
              <li key={p.id} className="rounded border border-taupe/70 bg-white p-4">
                <div className="flex items-start gap-3">
                  <AssetImage src={p.image} alt={p.name.ar} className="size-14 shrink-0 object-cover" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/products/${p.id}`} className="text-sm font-medium text-espresso hover:text-burgundy">
                      {p.name.ar}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-espresso/50" dir="ltr">{p.sku}</p>
                    <p className="mt-1 text-xs text-espresso/55">
                      {catName(p.category)} · {collName(p.collection)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Pill label={availabilityLabels[p.availability]} tone={availabilityStyles[p.availability]} />
                      <Pill
                        label={p.published ? 'منشور' : 'مخفي'}
                        tone={p.published ? 'border-gold/50 bg-gold/10 text-espresso' : 'border-espresso/25 bg-espresso/5 text-espresso/70'}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-semibold text-espresso">
                      {formatPrice(p.price, 'ar')}
                    </span>
                    <div className="flex gap-1">
                      <Link
                        to={`/admin/products/${p.id}/edit`}
                        aria-label={`تعديل ${p.name.ar}`}
                        className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 hover:bg-espresso/5 hover:text-burgundy"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteId(p.id)}
                        aria-label={`حذف ${p.name.ar}`}
                        className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 hover:bg-burgundy/10 hover:text-burgundy"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="حذف المنتج"
        body={deleteBody}
        confirmLabel={del.busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
        confirmDisabled={del.busy}
        error={del.error}
        onConfirm={async () => {
          if (!deleteId) return;
          const r = await del.run(() => removeProduct(deleteId));
          if (r.ok) setDeleteId(null);
        }}
        onCancel={() => {
          del.clearError();
          setDeleteId(null);
        }}
      />
    </div>
  );
}
