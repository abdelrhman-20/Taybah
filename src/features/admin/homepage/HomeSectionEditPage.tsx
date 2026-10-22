import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowRight, ArrowUp, Plus } from 'lucide-react';
import {
  updateHomeSection,
  useHomeContent,
  SECTION_LABELS,
  type HomeContent,
  type HomeSectionKey,
} from '../../storefront/home/homeStore';
import { productIsPublic, useCatalog } from '../../storefront/catalog/catalogStore';
import { isSafeNavUrl } from '../../storefront/layout/navStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ImageUploadField } from '../components/ImageUploadField';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';
const SECTION_KEYS: HomeSectionKey[] = [
  'hero', 'categories', 'products', 'brand', 'editorial', 'collection', 'newsletter',
];

const REQ = 'هذا الحقل مطلوب';
const ERR_PATH = 'وجهة داخلية يجب أن تبدأ بـ / — مثل /products';
const ERR_IMG = 'الصورة مطلوبة — اختر ملفًا من جهازك.';
const ERR_IMGS = 'أضف صورة واحدة على الأقل للشرائح.';

interface PickerOption {
  id: string;
  label: string;
  note?: string;
  disabled?: boolean;
}

// Ordered multi-select: checkboxes admit items, arrows order the selection.
function OrderedPicker({
  idPrefix,
  legend,
  options,
  selected,
  onChange,
}: {
  idPrefix: string;
  legend: string;
  options: PickerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter((x) => x !== id));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= selected.length) return;
    const next = [...selected];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };
  const optionFor = (id: string) => options.find((o) => o.id === id);

  return (
    <fieldset>
      <legend className={labelCls}>{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-taupe/70 bg-white p-3">
          {options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <li key={o.id}>
                <label
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                    o.disabled && !checked ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    id={`${idPrefix}-${o.id}`}
                    className="sr-only"
                    checked={checked}
                    disabled={Boolean(o.disabled) && !checked}
                    onChange={(e) => toggle(o.id, e.target.checked)}
                  />
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center border transition ${
                      checked ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
                    }`}
                    aria-hidden
                  >
                    {checked && (
                      <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                        <path d="M2 6.5 5 9l5-6" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-espresso/80">{o.label}</span>
                  {o.note && (
                    <span className="shrink-0 rounded-full border border-espresso/20 px-1.5 py-px text-[10px] text-espresso/55">
                      {o.note}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-espresso">
            الترتيب المختار ({selected.length})
          </p>
          {selected.length === 0 ? (
            <p className="rounded border border-dashed border-taupe px-3 py-4 text-center text-xs text-espresso/50">
              لم يُخَيَّر شيء بعد.
            </p>
          ) : (
            <ul className="space-y-1">
              {selected.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded border border-taupe/70 bg-white px-2 py-1.5"
                >
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="تقديم"
                      className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                    >
                      <ArrowUp className="size-3" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === selected.length - 1}
                      aria-label="تأخير"
                      className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                    >
                      <ArrowDown className="size-3" aria-hidden />
                    </button>
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-espresso/80">
                    {optionFor(id)?.label ?? id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  textarea = false,
  ltr = false,
  hint,
  required = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  textarea?: boolean;
  ltr?: boolean;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label} {required ? '*' : ''}
      </label>
      {textarea ? (
        <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} resize-y`} dir={ltr ? 'ltr' : undefined} aria-invalid={Boolean(error)} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} dir={ltr ? 'ltr' : undefined} aria-invalid={Boolean(error)} />
      )}
      {hint && <p className="mt-1.5 text-xs text-espresso/50">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-burgundy">{error}</p>}
    </div>
  );
}

function ImageField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <ImageUploadField id={id} label={label} required value={value} onChange={onChange} error={error} />
  );
}

// Keyed wrapper: remounts the editor per section so the form draft can never
// carry stale content across a direct section→section navigation.
export function HomeSectionEditRoute() {
  const { sectionKey } = useParams();
  return <HomeSectionEditPage key={sectionKey} />;
}

export function HomeSectionEditPage() {
  const { sectionKey } = useParams();
  const navigate = useNavigate();
  const home = useHomeContent();
  const catalog = useCatalog();
  const key = SECTION_KEYS.includes(sectionKey as HomeSectionKey)
    ? (sectionKey as HomeSectionKey)
    : null;

  const [draft, setDraft] = useState<HomeContent[HomeSectionKey] | null>(() =>
    key ? structuredClone(home[key]) : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!key || !draft) {
    return (
      <div className="mx-auto max-w-4xl">
        <AdminPageHeader title="القسم غير موجود" />
        <Link
          to="/admin/homepage"
          className="inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى الصفحة الرئيسية
        </Link>
      </div>
    );
  }

  const setField = (f: string, v: string | string[]) =>
    setDraft((d) => (d ? { ...d, [f]: v } : d));
  const str = (f: string) => String((draft as Record<string, unknown>)[f] ?? '');
  const err = (f: string) => errors[f];

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const need = (f: string) => {
      if (!str(f).trim()) e[f] = REQ;
    };
    const needPath = (f: string) => {
      if (!str(f).trim()) e[f] = REQ;
      else if (!isSafeNavUrl('internal', str(f))) e[f] = ERR_PATH;
    };
    const needImg = (f: string) => {
      if (!str(f).trim()) e[f] = ERR_IMG;
    };
    switch (key) {
      case 'hero': {
        ['eyebrow', 'title', 'body', 'primaryLabel', 'secondaryLabel'].forEach(need);
        needPath('primaryTo');
        needPath('secondaryTo');
        const imgs = (draft as { images?: unknown }).images;
        if (!Array.isArray(imgs) || !imgs.some((s) => typeof s === 'string' && s.trim()))
          e.images = ERR_IMGS;
        break;
      }
      case 'categories':
        ['eyebrow', 'title', 'actionLabel'].forEach(need);
        break;
      case 'products':
        break;
      case 'brand':
        ['eyebrow', 'title', 'body1', 'body2'].forEach(need);
        needImg('image');
        break;
      case 'editorial':
        ['eyebrow', 'title', 'body', 'ctaLabel'].forEach(need);
        needPath('ctaTo');
        needImg('image');
        break;
      case 'collection':
        ['eyebrow', 'actionLabel'].forEach(need);
        if (!str('slug')) e.slug = REQ;
        needImg('image1');
        needImg('image2');
        break;
      case 'newsletter':
        ['eyebrow', 'title', 'body', 'placeholder', 'submitLabel', 'privacy'].forEach(need);
        break;
    }
    return e;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // Drop unfilled image rows before persisting so no empty slide ships.
    const clean =
      key === 'hero'
        ? {
            ...draft,
            images: ((draft as { images?: string[] }).images ?? []).filter((s) => s.trim()),
          }
        : draft;
    updateHomeSection(key, clean as never);
    navigate('/admin/homepage');
  };

  const fields = () => {
    switch (key) {
      case 'hero': {
        const images = Array.isArray((draft as { images?: string[] }).images)
          ? (draft as { images: string[] }).images
          : [];
        const setImages = (next: string[]) => setField('images', next);
        const moveImage = (i: number, dir: -1 | 1) => {
          const t = i + dir;
          if (t < 0 || t >= images.length) return;
          const next = [...images];
          [next[i], next[t]] = [next[t], next[i]];
          setImages(next);
        };
        return (
          <>
            <fieldset className="rounded border border-taupe/70 bg-white p-4">
              <legend className="px-1 text-xs font-semibold tracking-wide text-espresso">
                صور الشرائح *
              </legend>
              <p className="mb-3 text-xs text-espresso/50">
                صورة واحدة على الأقل — تُعرض بالترتيب كشرائح متحركة خلف نص القسم.
              </p>
              <ul className="space-y-2">
                {images.map((img, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded border border-taupe/60 px-2.5 py-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveImage(i, -1)}
                        disabled={i === 0}
                        aria-label={`تقديم الشريحة ${i + 1}`}
                        className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <ArrowUp className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(i, 1)}
                        disabled={i === images.length - 1}
                        aria-label={`تأخير الشريحة ${i + 1}`}
                        className="inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <ArrowDown className="size-3" aria-hidden />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <ImageUploadField
                        id={`hs-img-${i}`}
                        label={`الشريحة ${i + 1}`}
                        compact
                        value={img}
                        onChange={(v) =>
                          v
                            ? setImages(images.map((x, xi) => (xi === i ? v : x)))
                            : setImages(images.filter((_, xi) => xi !== i))
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setImages([...images, ''])}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <Plus className="size-3.5" aria-hidden /> إضافة صورة
              </button>
              {err('images') && <p className="mt-1.5 text-xs text-burgundy">{err('images')}</p>}
            </fieldset>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
              <div className="sm:col-span-2"><Field id="hs-title" label="العنوان الرئيسي" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} /></div>
              <div className="sm:col-span-2"><Field id="hs-body" label="الوصف" textarea value={str('body')} onChange={(v) => setField('body', v)} error={err('body')} /></div>
              <Field id="hs-plabel" label="نص الزر الرئيسي" value={str('primaryLabel')} onChange={(v) => setField('primaryLabel', v)} error={err('primaryLabel')} />
              <Field id="hs-pto" label="رابط الزر الرئيسي" ltr value={str('primaryTo')} onChange={(v) => setField('primaryTo', v)} error={err('primaryTo')} hint="وجهة داخلية — مثل /products" />
              <Field id="hs-slabel" label="نص الزر الثانوي" value={str('secondaryLabel')} onChange={(v) => setField('secondaryLabel', v)} error={err('secondaryLabel')} />
              <Field id="hs-sto" label="رابط الزر الثانوي" ltr value={str('secondaryTo')} onChange={(v) => setField('secondaryTo', v)} error={err('secondaryTo')} hint="وجهة داخلية — مثل /about" />
            </div>
          </>
        );
      }
      case 'categories':
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
              <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
              <Field id="hs-action" label="نص رابط «كل الأقسام»" value={str('actionLabel')} onChange={(v) => setField('actionLabel', v)} error={err('actionLabel')} />
            </div>
            <div className="mt-5">
              <OrderedPicker
                idPrefix="hp-cat"
                legend="الأقسام المعروضة وترتيبها — الأقسام المخفية لا تظهر في المتجر حتى لو اختيرت"
                options={catalog.categories.map((c) => ({
                  id: c.slug,
                  label: c.name.ar,
                  note: c.visible ? undefined : 'مخفي',
                  disabled: !c.visible,
                }))}
                selected={Array.isArray((draft as { slugs?: string[] }).slugs) ? (draft as { slugs: string[] }).slugs : []}
                onChange={(v) => setField('slugs', v)}
              />
            </div>
          </>
        );
      case 'products':
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} required={false} />
              <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} required={false} />
              <Field id="hs-action" label="نص رابط «كل المنتجات»" value={str('actionLabel')} onChange={(v) => setField('actionLabel', v)} error={err('actionLabel')} required={false} />
            </div>
            <div className="mt-5">
              <OrderedPicker
                idPrefix="hp-prod"
                legend="المنتجات المعروضة وترتيبها — المنتجات غير المنشورة أو المحظورة لا تظهر في المتجر"
                options={catalog.products.map((p) => {
                  const pub = productIsPublic(p, catalog);
                  return {
                    id: p.id,
                    label: `${p.name.ar} — ${p.sku}`,
                    note: pub ? undefined : 'غير متاح للعرض',
                    disabled: !pub,
                  };
                })}
                selected={Array.isArray((draft as { productIds?: string[] }).productIds) ? (draft as { productIds: string[] }).productIds : []}
                onChange={(v) => setField('productIds', v)}
              />
            </div>
          </>
        );
      case 'brand':
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
            <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
            <div className="sm:col-span-2"><Field id="hs-body1" label="الفقرة الأولى" textarea value={str('body1')} onChange={(v) => setField('body1', v)} error={err('body1')} /></div>
            <div className="sm:col-span-2"><Field id="hs-body2" label="الفقرة الثانية" textarea value={str('body2')} onChange={(v) => setField('body2', v)} error={err('body2')} /></div>
            <div className="sm:col-span-2"><ImageField id="hs-image" label="الصورة" value={str('image')} onChange={(v) => setField('image', v)} error={err('image')} /></div>
          </div>
        );
      case 'editorial':
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
            <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
            <div className="sm:col-span-2"><Field id="hs-body" label="الوصف" textarea value={str('body')} onChange={(v) => setField('body', v)} error={err('body')} /></div>
            <Field id="hs-ctalabel" label="نص الزر" value={str('ctaLabel')} onChange={(v) => setField('ctaLabel', v)} error={err('ctaLabel')} />
            <Field id="hs-ctato" label="رابط الزر" ltr value={str('ctaTo')} onChange={(v) => setField('ctaTo', v)} error={err('ctaTo')} hint="وجهة داخلية — مثل /collections" />
            <div className="sm:col-span-2"><ImageField id="hs-image" label="الصورة" value={str('image')} onChange={(v) => setField('image', v)} error={err('image')} /></div>
          </div>
        );
      case 'collection': {
        const d = draft as { slug?: string };
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
            <Field id="hs-action" label="نص رابط «تصفح المجموعة»" value={str('actionLabel')} onChange={(v) => setField('actionLabel', v)} error={err('actionLabel')} />
            <div className="sm:col-span-2">
              <label htmlFor="hs-slug" className={labelCls}>المجموعة المعروضة *</label>
              <select
                id="hs-slug"
                value={d.slug ?? ''}
                onChange={(e) => setField('slug', e.target.value)}
                className={inputCls}
                aria-invalid={Boolean(err('slug'))}
              >
                <option value="">—</option>
                {catalog.collections.map((c) => (
                  <option key={c.slug} value={c.slug} disabled={!c.visible}>
                    {c.name.ar}{!c.visible ? ' (مخفية)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-espresso/50">
                عنوان القسم ووصفه ورابطه تُؤخذ من سجل المجموعة — المجموعة المخفية تُخفي القسم في المتجر.
              </p>
              {err('slug') && <p className="mt-1.5 text-xs text-burgundy">{err('slug')}</p>}
            </div>
            <ImageField id="hs-img1" label="الصورة الأولى" value={str('image1')} onChange={(v) => setField('image1', v)} error={err('image1')} />
            <ImageField id="hs-img2" label="الصورة الثانية" value={str('image2')} onChange={(v) => setField('image2', v)} error={err('image2')} />
          </div>
        );
      }
      case 'newsletter':
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} error={err('eyebrow')} />
            <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
            <div className="sm:col-span-2"><Field id="hs-body" label="الوصف" textarea value={str('body')} onChange={(v) => setField('body', v)} error={err('body')} /></div>
            <Field id="hs-placeholder" label="نص حقل البريد" value={str('placeholder')} onChange={(v) => setField('placeholder', v)} error={err('placeholder')} />
            <Field id="hs-submit" label="نص زر الاشتراك" value={str('submitLabel')} onChange={(v) => setField('submitLabel', v)} error={err('submitLabel')} />
            <div className="sm:col-span-2"><Field id="hs-privacy" label="ملاحظة الخصوصية" value={str('privacy')} onChange={(v) => setField('privacy', v)} error={err('privacy')} /></div>
          </div>
        );
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/admin/homepage"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> الصفحة الرئيسية
      </Link>
      <div className="mt-4">
        <AdminPageHeader title={`تعديل: ${SECTION_LABELS[key]}`} />
      </div>

      <form onSubmit={submit} noValidate className="space-y-6">
        <section className="rounded border border-taupe/70 bg-white p-5">{fields()}</section>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-burgundy px-8 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            حفظ التعديلات
          </button>
          <Link to="/admin/homepage" className="text-sm font-medium text-espresso/60 transition hover:text-espresso">
            إلغاء
          </Link>
        </div>
      </form>
    </div>
  );
}
