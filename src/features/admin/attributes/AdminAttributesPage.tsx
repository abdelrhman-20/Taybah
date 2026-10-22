import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Search,
  SwatchBook,
  Trash2,
} from 'lucide-react';
import {
  attributeReferences,
  filterAttributes,
  removeAttribute,
  saveAttributes,
  useAttributes,
  type AttributeDisplay,
  type AttributeStatusFilter,
} from '../../storefront/catalog/attributeStore';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';

const DISPLAY_LABELS: Record<AttributeDisplay, string> = {
  swatch: 'عينات لونية',
  chips: 'أزرار مختصرة',
  list: 'قائمة',
};

export function AdminAttributesPage() {
  const attrs = useAttributes();
  const { categories } = useCatalog();
  const [del, setDel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AttributeStatusFilter>('all');

  const ordered = [...attrs].sort((a, b) => a.order - b.order);
  const visible = filterAttributes(ordered, query, status);
  const hasFilters = query.trim() !== '' || status !== 'all';
  const delTarget = del ? attrs.find((a) => a.key === del) : undefined;
  const refs = del ? attributeReferences(del) : [];
  const blocked = refs.length > 0;

  const clear = () => {
    setQuery('');
    setStatus('all');
  };

  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= ordered.length) return;
    const next = ordered.map((a, idx) => {
      const j = idx === i ? t : idx === t ? i : idx;
      return { ...a, order: j + 1 };
    });
    saveAttributes(next);
  };

  const toggleEnabled = (key: string) =>
    saveAttributes(attrs.map((a) => (a.key === key ? { ...a, enabled: !a.enabled } : a)));

  const catLabel = (a: (typeof attrs)[number]) =>
    a.categories.length === 0
      ? 'كل الأقسام'
      : a.categories
          .map((s) => categories.find((c) => c.slug === s)?.name.ar ?? s)
          .join('، ');

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="السمات"
        description="تعريفات خيارات المنتجات — الألوان والخامات والمقاسات وأي سمات مخصصة. المنتجات تحتفظ باختياراتها؛ هذه الصفحة تدير التعريفات والقيم فقط."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم السمة أو المفتاح أو قيمة من قيمها…"
            aria-label="البحث في السمات"
            className="w-full border border-taupe bg-white py-2 pe-3 ps-10 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AttributeStatusFilter)}
          aria-label="التصفية حسب حالة السمة"
          className="border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy"
        >
          <option value="all">الكل</option>
          <option value="enabled">مفعّلة</option>
          <option value="disabled">معطّلة</option>
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
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs tracking-wide text-espresso/55">
          {visible.length} من {ordered.length} سمة
        </p>
        <Link
          to="/admin/attributes/new"
          className="inline-flex items-center gap-2 rounded bg-burgundy px-4 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Plus className="size-4" aria-hidden /> إضافة سمة
        </Link>
      </div>

      {ordered.length === 0 ? (
        <p className="mt-4 rounded border border-dashed border-taupe bg-white py-12 text-center text-sm text-espresso/60">
          لا توجد سمات — أضف أول سمة.
        </p>
      ) : visible.length === 0 ? (
        <div className="mt-4 rounded border border-dashed border-taupe bg-white py-12 text-center">
          <p className="text-sm text-espresso/60">
            لا توجد سمات تطابق البحث أو عوامل التصفية الحالية.
          </p>
          <button
            type="button"
            onClick={clear}
            className="mt-3 text-xs font-medium text-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            مسح البحث والتصفية
          </button>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-taupe/60 rounded border border-taupe/70 bg-white">
          {visible.map((a) => {
            const i = ordered.indexOf(a);
            return (
            <li key={a.key} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`تقديم ${a.name.ar}`}
                  className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <ArrowUp className="size-3" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === ordered.length - 1}
                  aria-label={`تأخير ${a.name.ar}`}
                  className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <ArrowDown className="size-3" aria-hidden />
                </button>
              </div>

              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-taupe text-espresso/55">
                <SwatchBook className="size-4" aria-hidden />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-espresso">{a.name.ar}</span>
                  <span className="font-mono text-[10px] text-espresso/40" dir="ltr">
                    {a.key}
                  </span>
                  <span className="rounded-full border border-espresso/20 px-1.5 py-px text-[10px] text-espresso/55">
                    {DISPLAY_LABELS[a.display]}
                  </span>
                  {a.required && (
                    <span className="rounded-full border border-burgundy/40 bg-burgundy/10 px-1.5 py-px text-[10px] font-semibold text-burgundy">
                      مطلوبة
                    </span>
                  )}
                  {a.variationCapable && (
                    <span className="rounded-full border border-gold/50 bg-gold/10 px-1.5 py-px text-[10px] text-espresso/70">
                      تدعم التنويعات
                    </span>
                  )}
                  {a.filterable && (
                    <span className="rounded-full border border-gold/50 bg-gold/10 px-1.5 py-px text-[10px] text-espresso/70">
                      تظهر في الفلاتر
                    </span>
                  )}
                  {!a.enabled && (
                    <span className="rounded-full border border-espresso/25 bg-espresso/5 px-2 py-0.5 text-[10px] font-semibold text-espresso/70">
                      معطّلة
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-espresso/50">
                  {a.values.length} قيمة · {catLabel(a)}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <label className="me-1 flex cursor-pointer items-center gap-1.5 text-xs text-espresso/70">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={a.enabled}
                    onChange={() => toggleEnabled(a.key)}
                  />
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center border transition ${
                      a.enabled ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
                    }`}
                    aria-hidden
                  >
                    {a.enabled && (
                      <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                        <path d="M2 6.5 5 9l5-6" />
                      </svg>
                    )}
                  </span>
                  تفعيل
                </label>
                <Link
                  to={`/admin/attributes/${a.key}`}
                  aria-label={`تعديل ${a.name.ar}`}
                  className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <Pencil className="size-4" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => setDel(a.key)}
                  aria-label={`حذف ${a.name.ar}`}
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
        open={del !== null}
        title={blocked ? 'لا يمكن حذف السمة' : 'حذف السمة'}
        body={
          delTarget
            ? blocked
              ? `«${delTarget.name.ar}» مستخدمة في: ${refs.join('، ')}. حذفها سيكسر عرض هذه البيانات — عطّلها بدلًا من ذلك لتختفي من الاختيارات الجديدة مع بقاء التسميات في الطلبات والمنتجات.`
              : `حذف «${delTarget.name.ar}» وقيمها نهائيًا؟ لا توجد مراجع إليها — يمكن الحذف بأمان ولا يمكن التراجع.`
            : ''
        }
        confirmLabel={blocked ? undefined : 'حذف نهائي'}
        cancelLabel={blocked ? 'حسنًا' : 'إلغاء'}
        onConfirm={
          blocked
            ? undefined
            : () => {
                if (del) removeAttribute(del);
                setDel(null);
              }
        }
        onCancel={() => setDel(null)}
      />
    </div>
  );
}
