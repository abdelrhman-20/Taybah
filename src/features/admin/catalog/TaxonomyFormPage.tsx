import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import {
  upsertCategory,
  upsertCollection,
  useCatalog,
} from '../../storefront/catalog/catalogStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ImageUploadField } from '../components/ImageUploadField';

// Shared form for categories + collections — identical field set (name,
// description, slug, image, visibility, order). `kind` picks the store section
// and labels.
const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const copy = {
  category: {
    listPath: '/admin/categories',
    listLabel: 'التصنيفات',
    addTitle: 'إضافة تصنيف',
    editTitle: (n: string) => `تعديل التصنيف: ${n}`,
    notFound: 'التصنيف غير موجود',
    save: 'حفظ التصنيف',
    slugUsed: 'الـ slug مستخدم لتصنيف آخر.',
  },
  collection: {
    listPath: '/admin/collections',
    listLabel: 'المجموعات',
    addTitle: 'إضافة مجموعة',
    editTitle: (n: string) => `تعديل المجموعة: ${n}`,
    notFound: 'المجموعة غير موجودة',
    save: 'حفظ المجموعة',
    slugUsed: 'الـ slug مستخدم لمجموعة أخرى.',
  },
} as const;

export function TaxonomyFormPage({ kind }: { kind: 'category' | 'collection' }) {
  const { [`${kind}Id`]: id } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const t = copy[kind];
  const list = kind === 'category' ? catalog.categories : catalog.collections;
  // Route param is the slug (the relationship key for products).
  const existing = id ? list.find((x) => x.slug === id) : undefined;

  const [fields, setFields] = useState(() =>
    existing
      ? {
          nameAr: existing.name.ar,
          nameEn: existing.name.en,
          descAr: existing.description.ar,
          descEn: existing.description.en,
          slug: existing.slug,
          image: existing.image,
          visible: existing.visible,
          order: String(existing.order),
        }
      : {
          nameAr: '',
          nameEn: '',
          descAr: '',
          descEn: '',
          slug: '',
          image: '',
          visible: true,
          order: String(list.length + 1),
        },
  );
  const [errors, setErrors] = useState<Partial<Record<keyof typeof fields, string>>>({});

  if (id && !existing) {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title={t.notFound} />
        <Link
          to={t.listPath}
          className="inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى {t.listLabel}
        </Link>
      </div>
    );
  }

  const set = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) =>
    setFields((f) => ({ ...f, [key]: value }));
  const err = (key: keyof typeof fields) =>
    errors[key] ? <p className="mt-1.5 text-xs text-burgundy">{errors[key]}</p> : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<keyof typeof fields, string>> = {};
    if (fields.nameAr.trim().length < 2) errs.nameAr = 'الاسم بالعربي مطلوب (حرفان على الأقل).';
    if (!SLUG_RE.test(fields.slug.trim()))
      errs.slug = 'الـ slug مطلوب — أحرف إنجليزية صغيرة وأرقام وشرطات.';
    else if (!existing && list.some((x) => x.slug === fields.slug.trim()))
      errs.slug = t.slugUsed;

    const order = Number(fields.order);
    if (!fields.order.trim() || !Number.isInteger(order) || order < 0)
      errs.order = 'ترتيب العرض يجب أن يكون رقمًا صحيحًا صفرًا أو أكبر.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const record = {
      slug: fields.slug.trim(),
      name: { ar: fields.nameAr.trim(), en: fields.nameEn.trim() },
      description: { ar: fields.descAr.trim(), en: fields.descEn.trim() },
      image: fields.image.trim(),
      visible: fields.visible,
      order,
    };
    if (kind === 'category') upsertCategory(record);
    else upsertCollection(record);
    navigate(t.listPath);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={t.listPath}
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> {t.listLabel}
      </Link>
      <div className="mt-4">
        <AdminPageHeader title={existing ? t.editTitle(existing.name.ar) : t.addTitle} />
      </div>

      <form onSubmit={submit} noValidate className="space-y-6">
        <section className="rounded border border-taupe/70 bg-white p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="tx-name-ar" className={labelCls}>الاسم بالعربي *</label>
              <input id="tx-name-ar" value={fields.nameAr} onChange={(e) => set('nameAr', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.nameAr)} />
              {err('nameAr')}
            </div>
            <div>
              <label htmlFor="tx-name-en" className={labelCls}>الاسم بالإنجليزي (داخلي)</label>
              <input id="tx-name-en" value={fields.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tx-desc-ar" className={labelCls}>الوصف بالعربي</label>
              <textarea id="tx-desc-ar" value={fields.descAr} onChange={(e) => set('descAr', e.target.value)} rows={2} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tx-desc-en" className={labelCls}>الوصف بالإنجليزي (داخلي)</label>
              <textarea id="tx-desc-en" value={fields.descEn} onChange={(e) => set('descEn', e.target.value)} rows={2} dir="ltr" className={inputCls} />
            </div>
            <div>
              <label htmlFor="tx-slug" className={labelCls}>الـ slug التقني *</label>
              <input
                id="tx-slug"
                value={fields.slug}
                onChange={(e) => set('slug', e.target.value)}
                dir="ltr"
                disabled={Boolean(existing)}
                className={`${inputCls} disabled:bg-espresso/5 disabled:text-espresso/50`}
                placeholder="winter-edit"
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={existing ? 'tx-slug-lock' : undefined}
              />
              {existing ? (
                <p id="tx-slug-lock" className="mt-1.5 text-xs text-espresso/50">
                  لا يمكن تغيير الـ slug بعد الإنشاء — المنتجات مرتبطة به.
                </p>
              ) : null}
              {err('slug')}
            </div>
            <div>
              <label htmlFor="tx-order" className={labelCls}>ترتيب العرض *</label>
              <input id="tx-order" inputMode="numeric" dir="ltr" value={fields.order} onChange={(e) => set('order', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.order)} />
              {err('order')}
            </div>
            <div className="sm:col-span-2">
              <ImageUploadField
                id="tx-img"
                label="الصورة"
                value={fields.image}
                onChange={(v) => set('image', v)}
                error={errors.image}
              />
            </div>
          </div>
          <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-espresso/75">
            <input
              type="checkbox"
              className="sr-only"
              checked={fields.visible}
              onChange={(e) => set('visible', e.target.checked)}
            />
            <span
              className={`flex size-4 shrink-0 items-center justify-center border transition ${
                fields.visible ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
              }`}
              aria-hidden
            >
              {fields.visible && (
                <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                  <path d="M2 6.5 5 9l5-6" />
                </svg>
              )}
            </span>
            ظاهر في المتجر
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-burgundy px-8 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {t.save}
          </button>
          <Link to={t.listPath} className="text-sm font-medium text-espresso/60 transition hover:text-espresso">
            إلغاء
          </Link>
        </div>
      </form>
    </div>
  );
}
