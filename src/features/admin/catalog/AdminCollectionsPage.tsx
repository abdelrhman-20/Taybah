import { AssetImage } from '../../shared/components/AssetImage';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { removeCollection, useCatalog } from '../../storefront/catalog/catalogStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function AdminCollectionsPage() {
  const catalog = useCatalog();
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);

  const sorted = [...catalog.collections].sort((a, b) => a.order - b.order);
  const target = catalog.collections.find((c) => c.slug === deleteSlug);
  const refCount = target
    ? catalog.products.filter((p) => p.collection === target.slug).length
    : 0;
  const blocked = refCount > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="المجموعات"
        description="مجموعات تحريرية تجمع المنتجات — المجموعة المخفية تختفي من واجهة المتجر مع منتجاتها."
      />

      <div className="flex justify-end">
        <Link
          to="/admin/collections/new"
          className="inline-flex items-center gap-2 rounded bg-burgundy px-4 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Plus className="size-4" aria-hidden /> إضافة مجموعة
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="mt-5 rounded border border-dashed border-taupe bg-white py-14 text-center">
          <p className="text-sm text-espresso/60">لا توجد مجموعات — أضف أول مجموعة.</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-taupe/60 rounded border border-taupe/70 bg-white">
          {sorted.map((c) => {
            const count = catalog.products.filter((p) => p.collection === c.slug).length;
            return (
              <li key={c.slug} className="flex flex-wrap items-center gap-4 px-5 py-4">
                {c.image && (
                  <AssetImage src={c.image} alt={c.name.ar} className="h-14 w-20 shrink-0 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-espresso">{c.name.ar}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        c.visible
                          ? 'border-gold/50 bg-gold/10 text-espresso'
                          : 'border-espresso/25 bg-espresso/5 text-espresso/70'
                      }`}
                    >
                      {c.visible ? 'ظاهر' : 'مخفي'}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-espresso/50" dir="ltr">
                    {c.slug} · ترتيب {c.order}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-espresso/55">{c.description.ar}</p>
                  <p className="mt-1 text-xs text-espresso/55">{count} منتجًا مرتبطًا</p>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    to={`/admin/collections/${c.slug}/edit`}
                    aria-label={`تعديل ${c.name.ar}`}
                    className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteSlug(c.slug)}
                    aria-label={`حذف ${c.name.ar}`}
                    className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteSlug !== null}
        title={blocked ? 'لا يمكن حذف المجموعة' : 'حذف المجموعة'}
        body={
          target
            ? blocked
              ? `«${target.name.ar}» مرتبطة بـ ${refCount} منتجًا. أعد تعيين تلك المنتجات إلى مجموعة أخرى من صفحة تعديل كل منتج أولًا، ثم أعد المحاولة.`
              : `حذف «${target.name.ar}» نهائيًا؟ لا توجد منتجات مرتبطة بها — يمكن الحذف بأمان.`
            : ''
        }
        confirmLabel={blocked ? undefined : 'حذف نهائي'}
        cancelLabel={blocked ? 'حسنًا' : 'إلغاء'}
        onConfirm={
          blocked
            ? undefined
            : () => {
                if (deleteSlug) removeCollection(deleteSlug);
                setDeleteSlug(null);
              }
        }
        onCancel={() => setDeleteSlug(null)}
      />
    </div>
  );
}
