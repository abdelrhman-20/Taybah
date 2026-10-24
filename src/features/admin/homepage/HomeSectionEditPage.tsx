import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowRight, ArrowUp, Plus } from 'lucide-react';
import {
  updateHomeSection,
  useHomeContent,
  HOME_SECTION_KEYS,
  SECTION_LABELS,
  type HomeContent,
  type HomeSectionKey,
} from '../../storefront/home/homeStore';
import { productIsPublic, useCatalog } from '../../storefront/catalog/catalogStore';
import { isSafeNavUrl } from '../../storefront/layout/navStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ImageUploadField } from '../components/ImageUploadField';
import { HeroSlidesEditor } from './HeroSlidesEditor';

const inputCls =
  'w-full border border-taupe bg-white px-3.5 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-xs font-semibold tracking-wide text-espresso';
const SECTION_KEYS = HOME_SECTION_KEYS;

const REQ = 'هذا الحقل مطلوب';
const ERR_PATH = 'وجهة داخلية يجب أن تبدأ بـ / — مثل /products';
const ERR_IMG = 'الصورة مطلوبة — اختر ملفًا من جهازك.';

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

interface CardRow {
  slug: string;
  title: string;
  image: string;
  subtitle?: string;
  description?: string;
}

// Ordered card list: each card points at a real catalog record (category or
// collection) and may override its title/text/image. Empty overrides fall
// back to the catalog record on the storefront.
function CardsEditor({
  idPrefix,
  legend,
  textKey,
  textLabel,
  options,
  cards,
  onChange,
  error,
}: {
  idPrefix: string;
  legend: string;
  textKey: 'subtitle' | 'description';
  textLabel: string;
  options: PickerOption[];
  cards: CardRow[];
  onChange: (next: CardRow[]) => void;
  error?: string;
}) {
  const update = (i: number, patch: Partial<CardRow>) =>
    onChange(cards.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= cards.length) return;
    const next = [...cards];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };
  const arrowCls =
    'inline-flex size-6 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy';
  return (
    <fieldset className="rounded border border-taupe/70 bg-white p-4">
      <legend className="px-1 text-xs font-semibold tracking-wide text-espresso">{legend}</legend>
      <ul className="space-y-3">
        {cards.map((card, i) => (
          <li key={i} className="rounded border border-taupe/60 p-3">
            <div className="mb-3 flex items-center gap-2">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`تقديم البطاقة ${i + 1}`} className={arrowCls}>
                <ArrowUp className="size-3" aria-hidden />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === cards.length - 1} aria-label={`تأخير البطاقة ${i + 1}`} className={arrowCls}>
                <ArrowDown className="size-3" aria-hidden />
              </button>
              <span className="flex-1 text-xs font-semibold text-espresso/70">البطاقة {i + 1}</span>
              <button
                type="button"
                onClick={() => onChange(cards.filter((_, ci) => ci !== i))}
                className="text-xs font-medium text-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                حذف
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${idPrefix}-slug-${i}`} className={labelCls}>السجل المرتبط *</label>
                <select
                  id={`${idPrefix}-slug-${i}`}
                  value={card.slug}
                  onChange={(e) => update(i, { slug: e.target.value })}
                  className={inputCls}
                >
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.disabled && o.id !== card.slug}>
                      {o.label}{o.note ? ` (${o.note})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                id={`${idPrefix}-title-${i}`}
                label="العنوان (اختياري)"
                value={card.title}
                onChange={(v) => update(i, { title: v })}
                required={false}
                hint="اتركه فارغًا لاستخدام اسم السجل."
              />
              <div className="sm:col-span-2">
                <Field
                  id={`${idPrefix}-text-${i}`}
                  label={textLabel}
                  textarea
                  value={card[textKey] ?? ''}
                  onChange={(v) => update(i, { [textKey]: v })}
                  required={false}
                />
              </div>
              <div className="sm:col-span-2">
                <ImageUploadField
                  id={`${idPrefix}-img-${i}`}
                  label="الصورة (اختياري)"
                  compact
                  value={card.image}
                  onChange={(v) => update(i, { image: v })}
                  hint="اتركها فارغة لاستخدام صورة السجل."
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...cards, { slug: '', title: '', image: '', [textKey]: '' }])}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <Plus className="size-3.5" aria-hidden /> إضافة بطاقة
      </button>
      {error && <p className="mt-1.5 text-xs text-burgundy">{error}</p>}
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
  // Which hero slide the editor is showing (empty = first).
  const [heroSel, setHeroSel] = useState('');

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

  const setField = (f: string, v: unknown) =>
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
    const cardsOk = (f: string) => {
      const cards = (draft as unknown as Record<string, { slug: string }[]>)[f] ?? [];
      const slugs = cards.map((c) => c.slug);
      if (slugs.some((x) => !x)) e[f] = 'اختر سجلًا لكل بطاقة أو احذف البطاقة الفارغة.';
      else if (new Set(slugs).size !== slugs.length) e[f] = 'لا يمكن تكرار السجل نفسه في بطاقتين.';
    };
    switch (key) {
      case 'shopCategories':
        need('title');
        cardsOk('cards');
        break;
      case 'collections':
        ['title', 'ctaLabel', 'actionLabel'].forEach(need);
        needPath('actionTo');
        cardsOk('cards');
        break;
      case 'bestSellers':
        need('title');
        if (str('actionLabel').trim() || str('actionTo').trim()) {
          need('actionLabel');
          needPath('actionTo');
        }
        break;
      case 'story':
        ['title', 'body'].forEach(need);
        if (str('ctaLabel').trim()) needPath('ctaTo');
        needImg('image');
        break;
      case 'hero': {
        const slides = (draft as HomeContent['hero']).slides;
        if (!slides.length) e.slides = 'أضف شريحة واحدة على الأقل.';
        else if (!slides.some((sl) => sl.visible)) e.slides = 'أظهر شريحة واحدة على الأقل.';
        for (const sl of slides) {
          if (!sl.image.trim()) e[`${sl.id}.image`] = ERR_IMG;
          if (!sl.title.trim()) e[`${sl.id}.title`] = REQ;
          // A button needs its label and destination together (or neither).
          const cta = (label: string, to: string, lk: string, tk: string) => {
            if (label.trim() && !to.trim()) e[`${sl.id}.${tk}`] = REQ;
            else if (to.trim() && !isSafeNavUrl('internal', to)) e[`${sl.id}.${tk}`] = ERR_PATH;
            if (to.trim() && !label.trim()) e[`${sl.id}.${lk}`] = REQ;
          };
          cta(sl.primaryLabel, sl.primaryTo, 'primaryLabel', 'primaryTo');
          cta(sl.secondaryLabel, sl.secondaryTo, 'secondaryLabel', 'secondaryTo');
        }
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
    if (Object.keys(errs).length) {
      // Jump to the first hero slide that needs attention.
      const bad = key === 'hero' ? Object.keys(errs).find((k) => k.includes('.')) : undefined;
      if (bad) setHeroSel(bad.split('.')[0]);
      return;
    }
    updateHomeSection(key, draft as never);
    navigate('/admin/homepage');
  };

  const fields = () => {
    switch (key) {
      case 'shopCategories':
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} required={false} />
              <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
              <div className="sm:col-span-2"><Field id="hs-subtitle" label="العنوان الفرعي" value={str('subtitle')} onChange={(v) => setField('subtitle', v)} required={false} /></div>
            </div>
            <div className="mt-5">
              <CardsEditor
                idPrefix="sc"
                legend="بطاقات الأقسام — الرابط يُؤخذ من القسم المختار، والأقسام المخفية لا تظهر في المتجر"
                textKey="subtitle"
                textLabel="النص الفرعي (اختياري)"
                options={catalog.categories.map((c) => ({ id: c.slug, label: c.name.ar, note: c.visible ? undefined : 'مخفي', disabled: !c.visible }))}
                cards={(draft as HomeContent['shopCategories']).cards}
                onChange={(v) => setField('cards', v)}
                error={err('cards')}
              />
            </div>
          </>
        );
      case 'collections':
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} required={false} />
              <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
              <div className="sm:col-span-2"><Field id="hs-subtitle" label="العنوان الفرعي" value={str('subtitle')} onChange={(v) => setField('subtitle', v)} required={false} /></div>
              <Field id="hs-action" label="نص رابط «عرض جميع المجموعات»" value={str('actionLabel')} onChange={(v) => setField('actionLabel', v)} error={err('actionLabel')} />
              <Field id="hs-actionto" label="رابط «عرض الكل»" ltr value={str('actionTo')} onChange={(v) => setField('actionTo', v)} error={err('actionTo')} hint="وجهة داخلية — مثل /collections" />
              <Field id="hs-cta" label="نص زر البطاقات" value={str('ctaLabel')} onChange={(v) => setField('ctaLabel', v)} error={err('ctaLabel')} />
            </div>
            <div className="mt-5">
              <CardsEditor
                idPrefix="cc"
                legend="بطاقات المجموعات — الرابط يُؤخذ من المجموعة المختارة، والمجموعات المخفية لا تظهر في المتجر"
                textKey="description"
                textLabel="الوصف (اختياري)"
                options={catalog.collections.map((c) => ({ id: c.slug, label: c.name.ar, note: c.visible ? undefined : 'مخفية', disabled: !c.visible }))}
                cards={(draft as HomeContent['collections']).cards}
                onChange={(v) => setField('cards', v)}
                error={err('cards')}
              />
            </div>
          </>
        );
      case 'bestSellers':
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} required={false} />
              <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
              <div className="sm:col-span-2"><Field id="hs-subtitle" label="العنوان الفرعي" value={str('subtitle')} onChange={(v) => setField('subtitle', v)} required={false} /></div>
              <Field id="hs-action" label="نص رابط «عرض الكل»" value={str('actionLabel')} onChange={(v) => setField('actionLabel', v)} error={err('actionLabel')} required={false} hint="اتركه فارغًا لإخفاء الرابط." />
              <Field id="hs-actionto" label="رابط «عرض الكل»" ltr value={str('actionTo')} onChange={(v) => setField('actionTo', v)} error={err('actionTo')} required={false} hint="وجهة داخلية — مثل /products" />
            </div>
            <div className="mt-5">
              <OrderedPicker
                idPrefix="hp-best"
                legend="المنتجات المعروضة وترتيبها — اختيار يدوي (لا توجد بيانات مبيعات فعلية)"
                options={catalog.products.map((p) => {
                  const pub = productIsPublic(p, catalog);
                  return { id: p.id, label: `${p.name.ar} — ${p.sku}`, note: pub ? undefined : 'غير متاح للعرض', disabled: !pub };
                })}
                selected={(draft as HomeContent['bestSellers']).productIds}
                onChange={(v) => setField('productIds', v)}
              />
            </div>
          </>
        );
      case 'story':
        return (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="hs-eyebrow" label="العبارة التمهيدية" value={str('eyebrow')} onChange={(v) => setField('eyebrow', v)} required={false} />
            <Field id="hs-title" label="العنوان" value={str('title')} onChange={(v) => setField('title', v)} error={err('title')} />
            <div className="sm:col-span-2"><Field id="hs-body" label="النص" textarea value={str('body')} onChange={(v) => setField('body', v)} error={err('body')} /></div>
            <Field id="hs-ctalabel" label="نص الزر" value={str('ctaLabel')} onChange={(v) => setField('ctaLabel', v)} required={false} hint="اتركه فارغًا لإخفاء الزر." />
            <Field id="hs-ctato" label="رابط الزر" ltr value={str('ctaTo')} onChange={(v) => setField('ctaTo', v)} error={err('ctaTo')} required={false} hint="وجهة داخلية — مثل /about" />
            <div className="sm:col-span-2"><ImageField id="hs-image" label="الصورة" value={str('image')} onChange={(v) => setField('image', v)} error={err('image')} /></div>
          </div>
        );
      case 'hero':
        return (
          <HeroSlidesEditor
            slides={(draft as HomeContent['hero']).slides}
            onChange={(next) => setField('slides', next)}
            errors={errors}
            selectedId={heroSel}
            onSelect={setHeroSel}
          />
        );
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
            <div className="sm:col-span-2"><ImageUploadField id="hs-nl-image" label="صورة الخلفية (اختياري)" value={str('image')} onChange={(v) => setField('image', v)} hint="تظهر خلف قسم النشرة البريدية. اتركها فارغة لخلفية داكنة سادة." /></div>
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
