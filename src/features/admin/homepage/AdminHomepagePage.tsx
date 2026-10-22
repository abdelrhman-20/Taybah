import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, Pencil, RotateCcw } from 'lucide-react';
import {
  resetHomeContent,
  setHomeSections,
  useHomeContent,
  SECTION_LABELS,
  type HomeSectionKey,
} from '../../storefront/home/homeStore';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function AdminHomepagePage() {
  const home = useHomeContent();
  const catalog = useCatalog();
  const [confirmReset, setConfirmReset] = useState(false);

  const preview = (key: HomeSectionKey): string => {
    switch (key) {
      case 'hero':
        return `${home.hero.title} — ${home.hero.images.length} صور`;
      case 'brand':
      case 'editorial':
      case 'newsletter':
        return home[key].title;
      case 'categories':
        return `${home.categories.title} — ${home.categories.slugs.length} قسمًا`;
      case 'products':
        return `${home.products.title} — ${home.products.productIds.length} منتجًا`;
      case 'collection': {
        const name =
          catalog.collections.find((c) => c.slug === home.collection.slug)?.name.ar ??
          home.collection.slug;
        return name;
      }
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= home.sections.length) return;
    const next = [...home.sections];
    [next[index], next[target]] = [next[target], next[index]];
    setHomeSections(next);
  };

  const toggle = (index: number) => {
    const next = home.sections.map((s, i) =>
      i === index ? { ...s, visible: !s.visible } : s,
    );
    setHomeSections(next);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="الصفحة الرئيسية"
        description="إدارة أقسام الصفحة الرئيسية — الظهور والترتيب والمحتوى. التعديلات تظهر في المتجر فورًا."
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="inline-flex items-center gap-2 rounded border border-espresso/25 px-4 py-2 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <RotateCcw className="size-4" aria-hidden /> استعادة الإعدادات الافتراضية
        </button>
      </div>

      <ul className="mt-5 divide-y divide-taupe/60 rounded border border-taupe/70 bg-white">
        {home.sections.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`تقديم ${SECTION_LABELS[s.key]}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <ArrowUp className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === home.sections.length - 1}
                aria-label={`تأخير ${SECTION_LABELS[s.key]}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <ArrowDown className="size-3.5" aria-hidden />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-espresso">{SECTION_LABELS[s.key]}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    s.visible
                      ? 'border-gold/50 bg-gold/10 text-espresso'
                      : 'border-espresso/25 bg-espresso/5 text-espresso/70'
                  }`}
                >
                  {s.visible ? 'ظاهر' : 'مخفي'}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-espresso/55">{preview(s.key)}</p>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-espresso/70">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={s.visible}
                  onChange={() => toggle(i)}
                />
                <span
                  className={`flex size-4 shrink-0 items-center justify-center border transition ${
                    s.visible ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30'
                  }`}
                  aria-hidden
                >
                  {s.visible && (
                    <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-2">
                      <path d="M2 6.5 5 9l5-6" />
                    </svg>
                  )}
                </span>
                إظهار
              </label>
              <Link
                to={`/admin/homepage/${s.key}`}
                aria-label={`تعديل ${SECTION_LABELS[s.key]}`}
                className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <Pencil className="size-4" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmReset}
        title="استعادة الإعدادات الافتراضية"
        body="ستُستبدل كل تعديلات الصفحة الرئيسية بالمحتوى والترتيب الافتراضيين — بما فيها النصوص والأقسام المختارة والترتيب والظهور. لا يمكن التراجع."
        confirmLabel="نعم، استعد الافتراضي"
        onConfirm={() => {
          resetHomeContent();
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
