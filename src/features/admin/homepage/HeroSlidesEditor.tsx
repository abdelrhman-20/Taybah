import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { HeroSlideContent } from '../../storefront/home/homeStore';
import { AssetImage } from '../../shared/components/AssetImage';
import { generateId } from '../../shared/utils/id';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImageUploadField } from '../components/ImageUploadField';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';
const iconBtn =
  'inline-flex size-7 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy';

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required = false,
  textarea = false,
  ltr = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  textarea?: boolean;
  ltr?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label} {required ? '*' : ''}
      </label>
      {textarea ? (
        <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} resize-y`} aria-invalid={Boolean(error)} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} dir={ltr ? 'ltr' : undefined} aria-invalid={Boolean(error)} />
      )}
      {hint && <p className="mt-1.5 text-xs text-espresso/50">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-burgundy">{error}</p>}
    </div>
  );
}

function newHeroSlide(): HeroSlideContent {
  return {
    id: generateId(),
    visible: true,
    image: '',
    eyebrow: '',
    title: '',
    body: '',
    primaryLabel: '',
    primaryTo: '',
    secondaryLabel: '',
    secondaryTo: '',
  };
}

// Hero slides: a list to pick / order / hide / delete / add, and one editor for
// the picked slide. All edits go through `onChange` with the full array, and
// every update touches only its own slide (matched by id), so editing one
// slide can never change another.
export function HeroSlidesEditor({
  slides,
  onChange,
  errors,
  selectedId,
  onSelect,
}: {
  slides: HeroSlideContent[];
  onChange: (next: HeroSlideContent[]) => void;
  // Keyed `<slideId>.<field>`, plus `slides` for list-level problems.
  errors: Record<string, string>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0];
  const patch = (id: string, change: Partial<HeroSlideContent>) =>
    onChange(slides.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= slides.length) return;
    const next = [...slides];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };
  const hasError = (id: string) => Object.keys(errors).some((k) => k.startsWith(`${id}.`));
  const err = (f: string) => (selected ? errors[`${selected.id}.${f}`] : undefined);
  const toDelete = slides.find((s) => s.id === pendingDelete);

  return (
    <div className="space-y-5">
      <fieldset className="rounded border border-taupe/70 bg-white p-4">
        <legend className="px-1 text-xs font-semibold tracking-wide text-espresso">
          شرائح الواجهة الرئيسية ({slides.length})
        </legend>
        <p className="mb-3 text-xs text-espresso/50">
          لكل شريحة صورتها ونصوصها وأزرارها المستقلة — اختر شريحة لتعديلها. الشرائح المخفية لا تظهر في المتجر.
        </p>
        <ul className="space-y-2">
          {slides.map((slide, i) => {
            const active = slide.id === selected?.id;
            return (
              <li
                key={slide.id}
                className={`flex items-center gap-2 rounded border px-2.5 py-2 ${
                  active ? 'border-burgundy bg-burgundy/[0.04]' : 'border-taupe/60'
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`تقديم الشريحة ${i + 1}`} className={iconBtn}>
                    <ArrowUp className="size-3" aria-hidden />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label={`تأخير الشريحة ${i + 1}`} className={iconBtn}>
                    <ArrowDown className="size-3" aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(slide.id)}
                  aria-pressed={active}
                  className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <AssetImage src={slide.image} alt="" className="h-12 w-20 shrink-0 rounded-sm object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-espresso">
                      {i + 1}. {slide.title.trim() || '(بدون عنوان)'}
                    </span>
                    <span className="block truncate text-xs text-espresso/55">{slide.eyebrow || slide.primaryLabel}</span>
                  </span>
                  {!slide.visible && (
                    <span className="shrink-0 rounded-full border border-espresso/25 bg-espresso/5 px-2 py-0.5 text-[10px] font-semibold text-espresso/70">
                      مخفية
                    </span>
                  )}
                  {hasError(slide.id) && (
                    <span className="shrink-0 rounded-full bg-burgundy px-2 py-0.5 text-[10px] font-semibold text-white">
                      يحتاج مراجعة
                    </span>
                  )}
                </button>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-espresso/70">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#681d20]"
                    checked={slide.visible}
                    onChange={(e) => patch(slide.id, { visible: e.target.checked })}
                    aria-label={`إظهار الشريحة ${i + 1}`}
                  />
                  إظهار
                </label>
                <button
                  type="button"
                  onClick={() => setPendingDelete(slide.id)}
                  disabled={slides.length <= 1}
                  aria-label={`حذف الشريحة ${i + 1}`}
                  title={slides.length <= 1 ? 'يجب أن تبقى شريحة واحدة على الأقل' : 'حذف الشريحة'}
                  className={iconBtn}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            const slide = newHeroSlide();
            onChange([...slides, slide]);
            onSelect(slide.id);
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Plus className="size-3.5" aria-hidden /> إضافة شريحة
        </button>
        {errors.slides && <p className="mt-2 text-xs text-burgundy">{errors.slides}</p>}
      </fieldset>

      {selected && (
        <fieldset key={selected.id} className="rounded border border-taupe/70 bg-white p-4">
          <legend className="px-1 text-xs font-semibold tracking-wide text-espresso">
            تعديل الشريحة {slides.indexOf(selected) + 1}
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ImageUploadField
                id={`hero-img-${selected.id}`}
                label="صورة الشريحة"
                required
                value={selected.image}
                onChange={(v) => patch(selected.id, { image: v })}
                error={err('image')}
              />
            </div>
            <TextField id={`hero-eyebrow-${selected.id}`} label="العبارة التمهيدية" value={selected.eyebrow} onChange={(v) => patch(selected.id, { eyebrow: v })} />
            <TextField id={`hero-title-${selected.id}`} label="العنوان الرئيسي" required value={selected.title} onChange={(v) => patch(selected.id, { title: v })} error={err('title')} hint="الكلمة الأخيرة تظهر بلون مميز تلقائيًا." />
            <div className="sm:col-span-2">
              <TextField id={`hero-body-${selected.id}`} label="الوصف" textarea value={selected.body} onChange={(v) => patch(selected.id, { body: v })} />
            </div>
            <TextField id={`hero-plabel-${selected.id}`} label="نص الزر الرئيسي" value={selected.primaryLabel} onChange={(v) => patch(selected.id, { primaryLabel: v })} error={err('primaryLabel')} />
            <TextField id={`hero-pto-${selected.id}`} label="رابط الزر الرئيسي" ltr value={selected.primaryTo} onChange={(v) => patch(selected.id, { primaryTo: v })} error={err('primaryTo')} hint="وجهة داخلية — مثل /category/rugs" />
            <TextField id={`hero-slabel-${selected.id}`} label="نص الزر الثانوي (اختياري)" value={selected.secondaryLabel} onChange={(v) => patch(selected.id, { secondaryLabel: v })} error={err('secondaryLabel')} />
            <TextField id={`hero-sto-${selected.id}`} label="رابط الزر الثانوي (اختياري)" ltr value={selected.secondaryTo} onChange={(v) => patch(selected.id, { secondaryTo: v })} error={err('secondaryTo')} hint="يظهر الزر فقط عند تعبئة النص والرابط معًا." />
          </div>
        </fieldset>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="حذف الشريحة"
        body={`سيتم حذف الشريحة «${toDelete?.title.trim() || 'بدون عنوان'}» ونصوصها من الواجهة الرئيسية بعد الحفظ. الصورة المرفوعة تبقى في مكتبة الوسائط.`}
        confirmLabel="نعم، احذف الشريحة"
        onConfirm={() => {
          if (!toDelete) return;
          const i = slides.findIndex((s) => s.id === toDelete.id);
          const next = slides.filter((s) => s.id !== toDelete.id);
          onChange(next);
          if (selected?.id === toDelete.id) onSelect((next[Math.min(i, next.length - 1)] ?? next[0])?.id ?? '');
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
