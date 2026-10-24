import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  attributeValueReferences,
  attributeByKey,
  upsertAttribute,
  useAttributes,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeDef,
  type AttributeDisplay,
} from '../../storefront/catalog/attributeStore';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { docRevision } from '../../storefront/catalog/catalogDocs';
import { useSaveAction } from '../hooks/useSaveAction';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';
const checkRow =
  'flex cursor-pointer items-center gap-2 py-0.5 text-sm text-espresso/75 hover:text-espresso';
const checkBox = (on: boolean) =>
  `flex size-4 shrink-0 items-center justify-center border transition ${
    on ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
  }`;

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DISPLAYS: { key: AttributeDisplay; label: string; hint: string }[] = [
  { key: 'swatch', label: 'عينات لونية', hint: 'دوائر ملونة — لكل قيمة كود لون hex' },
  { key: 'chips', label: 'أزرار مختصرة', hint: 'أزرار نصية صغيرة — كالمقاسات' },
  { key: 'list', label: 'قائمة', hint: 'تُعرض كنصوص في تفاصيل المنتج والفلاتر' },
];

interface ValueDraft {
  key: string;
  labelAr: string;
  labelEn: string;
  hex: string;
  enabled: boolean;
  // Stored values keep immutable keys — products, variants, and orders
  // reference them by key. Only newly added rows accept a key.
  locked: boolean;
}

interface Fields {
  key: string;
  nameAr: string;
  nameEn: string;
  display: AttributeDisplay;
  categories: string[];
  required: boolean;
  variationCapable: boolean;
  filterable: boolean;
  enabled: boolean;
  order: string;
  values: ValueDraft[];
}

function fromAttr(a: AttributeDef): Fields {
  return {
    key: a.key,
    nameAr: a.name.ar,
    nameEn: a.name.en,
    display: a.display,
    categories: a.categories,
    required: a.required,
    variationCapable: a.variationCapable,
    filterable: a.filterable,
    enabled: a.enabled,
    order: String(a.order),
    values: a.values.map((v) => ({
      key: v.key,
      labelAr: v.label.ar,
      labelEn: v.label.en,
      hex: v.hex ?? '',
      enabled: v.enabled,
      locked: true,
    })),
  };
}

const empty: Fields = {
  key: '',
  nameAr: '',
  nameEn: '',
  display: 'chips',
  categories: [],
  required: false,
  variationCapable: false,
  filterable: false,
  enabled: true,
  order: '',
  values: [],
};

export function AttributeFormPage() {
  const { attrKey } = useParams();
  const navigate = useNavigate();
  const attrs = useAttributes();
  const { categories } = useCatalog();
  const existing = attrKey ? attributeByKey(attrKey) : undefined;

  const [fields, setFields] = useState<Fields>(() =>
    existing ? fromAttr(existing) : { ...empty, order: String(attrs.length + 1) },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [delValue, setDelValue] = useState<string | null>(null);
  const save = useSaveAction();
  // Revision the form opened on — a save over a newer copy is rejected.
  const [baseRevision] = useState(() => (existing ? docRevision('attribute', existing.key) : null));

  if (attrKey && !existing) {
    return (
      <div className="mx-auto max-w-3xl">
        <AdminPageHeader title="السمة غير موجودة" />
        <Link
          to="/admin/attributes"
          className="inline-flex items-center gap-2 text-sm font-medium text-burgundy underline-offset-4 hover:underline"
        >
          <ArrowRight className="size-4" /> العودة إلى السمات
        </Link>
      </div>
    );
  }

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const setValue = (i: number, patch: Partial<ValueDraft>) =>
    set(
      'values',
      fields.values.map((v, vi) => (vi === i ? { ...v, ...patch } : v)),
    );

  const moveValue = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= fields.values.length) return;
    const next = [...fields.values];
    [next[i], next[t]] = [next[t], next[i]];
    set('values', next);
  };

  const toggleCat = (slug: string) =>
    set(
      'categories',
      fields.categories.includes(slug)
        ? fields.categories.filter((c) => c !== slug)
        : [...fields.categories, slug],
    );

  // Reserved seeds (color/material/size): filterable/required don't apply —
  // they own fixed legacy facets and product fields, so the controls are
  // locked rather than silently inert.
  const isReserved =
    existing !== undefined &&
    (RESERVED_ATTRIBUTE_KEYS as readonly string[]).includes(existing.key);

  const delTarget = delValue !== null ? fields.values.find((v) => v.key === delValue) : undefined;
  const valueRefs =
    delValue !== null && existing ? attributeValueReferences(existing.key, delValue) : [];
  const valueBlocked = valueRefs.length > 0;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (fields.nameAr.trim().length < 2) e.nameAr = 'اسم السمة بالعربي مطلوب (حرفان على الأقل).';
    if (!KEY_RE.test(fields.key.trim()) || fields.key.trim() === 'new')
      e.key = 'المفتاح التقني مطلوب — أحرف إنجليزية صغيرة وأرقام وشرطات.';
    else if (!existing && attrs.some((a) => a.key === fields.key.trim()))
      e.key = 'المفتاح مستخدم لسمة أخرى.';
    const order = Number(fields.order);
    if (!fields.order.trim() || !Number.isInteger(order) || order < 0)
      e.order = 'ترتيب العرض يجب أن يكون رقمًا صحيحًا صفرًا أو أكبر.';
    const seen = new Set<string>();
    const seenLabels = new Set<string>();
    for (const [i, v] of fields.values.entries()) {
      const pfx = `v${i}`;
      if (!KEY_RE.test(v.key.trim())) e[`${pfx}-key`] = 'مفتاح القيمة: أحرف إنجليزية صغيرة وأرقام وشرطات.';
      else if (seen.has(v.key.trim())) e[`${pfx}-key`] = 'مفتاح مكرر داخل السمة.';
      if (v.labelAr.trim().length < 1) e[`${pfx}-label`] = 'التسمية بالعربي مطلوبة.';
      else if (seenLabels.has(v.labelAr.trim())) e[`${pfx}-label`] = 'تسمية مكررة داخل السمة.';
      if (v.hex.trim() && !HEX_RE.test(v.hex.trim()))
        e[`${pfx}-hex`] = 'كود اللون يجب أن يكون hex صحيحًا — مثل #681D20.';
      seen.add(v.key.trim());
      seenLabels.add(v.labelAr.trim());
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (save.busy || !validate()) return;
    const attr: AttributeDef = {
      key: fields.key.trim(),
      name: { ar: fields.nameAr.trim(), en: fields.nameEn.trim() },
      display: fields.display,
      categories: fields.categories,
      required: fields.required,
      variationCapable: fields.variationCapable,
      filterable: fields.filterable,
      enabled: fields.enabled,
      order: Number(fields.order),
      values: fields.values.map((v, i) => ({
        key: v.key.trim(),
        label: { ar: v.labelAr.trim(), en: v.labelEn.trim() },
        ...(v.hex.trim() ? { hex: v.hex.trim() } : {}),
        enabled: v.enabled,
        order: i + 1,
      })),
    };
    const result = await save.run(() =>
      upsertAttribute(attr, { expectedRevision: baseRevision }),
    );
    if (result.ok) navigate('/admin/attributes');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/admin/attributes"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> السمات
      </Link>
      <div className="mt-4">
        <AdminPageHeader
          title={existing ? `تعديل السمة: ${existing.name.ar}` : 'إضافة سمة'}
        />
      </div>

      <form onSubmit={submit} noValidate className="space-y-8">
        <section className="rounded border border-taupe/70 bg-white p-5">
          <h3 className="font-display text-lg text-espresso">التعريف</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="af-name-ar" className={labelCls}>الاسم بالعربي *</label>
              <input id="af-name-ar" value={fields.nameAr} onChange={(e) => set('nameAr', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.nameAr)} />
              {errors.nameAr && <p className="mt-1.5 text-xs text-burgundy">{errors.nameAr}</p>}
            </div>
            <div>
              <label htmlFor="af-name-en" className={labelCls}>الاسم بالإنجليزي (داخلي)</label>
              <input id="af-name-en" value={fields.nameEn} onChange={(e) => set('nameEn', e.target.value)} dir="ltr" className={inputCls} />
            </div>
            <div>
              <label htmlFor="af-key" className={labelCls}>المفتاح التقني *</label>
              <input
                id="af-key"
                value={fields.key}
                onChange={(e) => set('key', e.target.value)}
                dir="ltr"
                disabled={Boolean(existing)}
                className={`${inputCls} disabled:bg-espresso/5 disabled:text-espresso/50`}
                placeholder="weave-type"
                aria-invalid={Boolean(errors.key)}
                aria-describedby={existing ? 'af-key-lock' : undefined}
              />
              {existing ? (
                <p id="af-key-lock" className="mt-1.5 text-xs text-espresso/50">
                  لا يمكن تغيير المفتاح بعد الإنشاء — المنتجات والطلبات تشير إليه.
                </p>
              ) : null}
              {errors.key && <p className="mt-1.5 text-xs text-burgundy">{errors.key}</p>}
            </div>
            <div>
              <label htmlFor="af-order" className={labelCls}>ترتيب العرض *</label>
              <input id="af-order" inputMode="numeric" dir="ltr" value={fields.order} onChange={(e) => set('order', e.target.value)} className={inputCls} aria-invalid={Boolean(errors.order)} />
              {errors.order && <p className="mt-1.5 text-xs text-burgundy">{errors.order}</p>}
            </div>
          </div>

          <div className="mt-5">
            <span className={labelCls}>نوع العرض *</span>
            <div className="grid gap-3 sm:grid-cols-3">
              {DISPLAYS.map((d) => {
                const on = fields.display === d.key;
                return (
                  <label
                    key={d.key}
                    className={`cursor-pointer rounded border px-4 py-3 transition ${
                      on ? 'border-burgundy bg-burgundy/5' : 'border-espresso/15 hover:border-espresso/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="af-display"
                      className="sr-only"
                      checked={on}
                      onChange={() => set('display', d.key)}
                    />
                    <span className="block text-sm font-medium text-espresso">{d.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-espresso/50">{d.hint}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <span className={labelCls}>الأقسام المطبَّقة عليها</span>
            <p className="mb-2 text-[11px] text-espresso/50">
              اترك الاختيار فارغًا لتنطبق السمة على كل الأقسام.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {categories.map((c) => {
                const on = fields.categories.includes(c.slug);
                return (
                  <label key={c.slug} className={checkRow}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleCat(c.slug)} />
                    <span className={checkBox(on)} aria-hidden>
                      {on && (
                        <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                          <path d="M2 6.5 5 9l5-6" />
                        </svg>
                      )}
                    </span>
                    {c.name.ar}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ['enabled', 'مفعّلة — تظهر في المتجر والنماذج'],
                ['required', 'مطلوبة — يجب ملؤها على المنتجات في الأقسام المطبَّقة'],
                ['variationCapable', 'تدعم التنويعات — يمكن اختيارها كمحور تنويع في نموذج المنتج'],
                ['filterable', 'تظهر في الفلاتر — تُضاف كمجموعة فلترة في قوائم الأقسام المطبَّقة'],
              ] as const
            ).map(([key, label]) => {
              const locked = isReserved && (key === 'required' || key === 'filterable');
              return (
                <label
                  key={key}
                  className={`${checkRow} ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={fields[key]}
                    disabled={locked}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  <span className={checkBox(fields[key])} aria-hidden>
                    {fields[key] && (
                      <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                        <path d="M2 6.5 5 9l5-6" />
                      </svg>
                    )}
                  </span>
                  {label}
                </label>
              );
            })}
          </div>
          {isReserved && (
            <p className="mt-3 text-[11px] leading-5 text-espresso/50">
              سمة أساسية — «مطلوبة» و«تظهر في الفلاتر» لا تنطبقان على اللون والخامة والمقاس: لها
              فلاترها المخصصة الثابتة وتُدار قيمها من حقول المنتج مباشرةً.
            </p>
          )}
        </section>

        <section className="rounded border border-taupe/70 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-espresso">القيم</h3>
              <p className="mt-0.5 text-[11px] text-espresso/50">
                مفاتيح القيم تقنية (إنجليزية صغيرة) — العملاء يرون التسمية العربية فقط.
                {fields.display === 'swatch' ? ' كل قيمة تحتاج كود لون hex.' : ''}
                {existing &&
                  ' مفاتيح القيم المحفوظة مقفلة — لا يمكن تغييرها بعد الإنشاء لأن المنتجات والتنويعات والطلبات تشير إليها بالمفتاح.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                set('values', [
                  ...fields.values,
                  { key: '', labelAr: '', labelEn: '', hex: '', enabled: true, locked: false },
                ])
              }
              className="inline-flex items-center gap-1.5 rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Plus className="size-3.5" aria-hidden /> إضافة قيمة
            </button>
          </div>

          {fields.values.length === 0 ? (
            <p className="mt-3 rounded border border-dashed border-taupe py-8 text-center text-sm text-espresso/50">
              لا قيم بعد — أضف أول قيمة.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {fields.values.map((v, i) => (
                <li
                  key={i}
                  className="rounded border border-taupe/60 bg-porcelain/40 px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveValue(i, -1)}
                        disabled={i === 0}
                        aria-label="تقديم القيمة"
                        className="inline-flex size-5 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <ArrowUp className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveValue(i, 1)}
                        disabled={i === fields.values.length - 1}
                        aria-label="تأخير القيمة"
                        className="inline-flex size-5 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <ArrowDown className="size-3" aria-hidden />
                      </button>
                    </div>
                    <div className="grid flex-1 gap-3 sm:grid-cols-4">
                      <div>
                        <label htmlFor={`afv-label-${i}`} className={labelCls}>التسمية بالعربي *</label>
                        <input
                          id={`afv-label-${i}`}
                          value={v.labelAr}
                          onChange={(e) => setValue(i, { labelAr: e.target.value })}
                          className={inputCls}
                        />
                        {errors[`v${i}-label`] && (
                          <p className="mt-1 text-xs text-burgundy">{errors[`v${i}-label`]}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`afv-key-${i}`} className={labelCls}>المفتاح *</label>
                        <input
                          id={`afv-key-${i}`}
                          value={v.key}
                          onChange={(e) => setValue(i, { key: e.target.value })}
                          dir="ltr"
                          disabled={v.locked}
                          className={`${inputCls} disabled:bg-espresso/5 disabled:text-espresso/50`}
                          placeholder="beige"
                        />
                        {errors[`v${i}-key`] && (
                          <p className="mt-1 text-xs text-burgundy">{errors[`v${i}-key`]}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`afv-hex-${i}`} className={labelCls}>
                          كود اللون{fields.display === 'swatch' ? ' *' : ' (اختياري)'}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`afv-hex-${i}`}
                            value={v.hex}
                            onChange={(e) => setValue(i, { hex: e.target.value })}
                            dir="ltr"
                            className={inputCls}
                            placeholder="#681D20"
                          />
                          {HEX_RE.test(v.hex.trim()) && (
                            <span
                              className="size-8 shrink-0 rounded-full border border-espresso/15"
                              style={{ backgroundColor: v.hex.trim() }}
                              aria-hidden
                            />
                          )}
                        </div>
                        {errors[`v${i}-hex`] && (
                          <p className="mt-1 text-xs text-burgundy">{errors[`v${i}-hex`]}</p>
                        )}
                      </div>
                      <div className="flex items-end justify-between gap-2 pb-0.5">
                        <label className={checkRow}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={v.enabled}
                            onChange={(e) => setValue(i, { enabled: e.target.checked })}
                          />
                          <span className={checkBox(v.enabled)} aria-hidden>
                            {v.enabled && (
                              <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                                <path d="M2 6.5 5 9l5-6" />
                              </svg>
                            )}
                          </span>
                          مفعّلة
                        </label>
                        <button
                          type="button"
                          onClick={() => setDelValue(v.key)}
                          aria-label={`حذف القيمة ${v.labelAr}`}
                          className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {save.error && (
          <p role="alert" className="text-sm font-medium text-burgundy">
            {save.error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.busy}
            className="rounded bg-burgundy px-8 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {save.busy ? 'جارٍ الحفظ…' : existing ? 'حفظ السمة' : 'إضافة السمة'}
          </button>
          <Link to="/admin/attributes" className="text-sm font-medium text-espresso/60 transition hover:text-espresso">
            إلغاء
          </Link>
        </div>
      </form>

      <ConfirmDialog
        open={delValue !== null}
        title={valueBlocked ? 'لا يمكن حذف القيمة' : 'حذف القيمة'}
        body={
          delTarget
            ? valueBlocked
              ? `«${delTarget.labelAr}» مستخدمة في: ${valueRefs.join('، ')}. عطّلها بدلًا من ذلك — ستختفي من الاختيارات الجديدة وتبقى تسميتها في المنتجات والطلبات السابقة.`
              : `حذف «${delTarget.labelAr}» من قيم السمة؟ لا توجد مراجع إليها. يُحفظ التغيير عند حفظ السمة.`
            : ''
        }
        confirmLabel={valueBlocked ? undefined : 'حذف القيمة'}
        cancelLabel={valueBlocked ? 'حسنًا' : 'إلغاء'}
        onConfirm={
          valueBlocked
            ? undefined
            : () => {
                set('values', fields.values.filter((v) => v.key !== delValue));
                setDelValue(null);
              }
        }
        onCancel={() => setDelValue(null)}
      />
    </div>
  );
}
