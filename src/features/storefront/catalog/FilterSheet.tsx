import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { FilterPanel, type FilterControls } from './FilterPanel';
import type { AttributeDef } from './attributeStore';
import { Button } from '../../shared/components/Button';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { title: 'الفلاتر', show: 'عرض النتائج', clear: 'مسح الكل' },
  en: { title: 'Filters', show: 'Show results', clear: 'Clear all' },
};

// Mobile filter bottom sheet — slides up, closes via button/backdrop/Escape.
export function FilterSheet({
  open,
  onClose,
  ctrl,
  locale,
  showCategory = false,
  resultCount,
  facets = [],
}: {
  open: boolean;
  onClose: () => void;
  ctrl: FilterControls;
  locale: StorefrontLocale;
  showCategory?: boolean;
  resultCount: number;
  facets?: AttributeDef[];
}) {
  const t = copy[locale];
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => {
      document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 md:hidden" role="dialog" aria-modal="true" aria-label={t.title}>
      <button
        type="button"
        aria-label={t.title}
        onClick={onClose}
        className="absolute inset-0 bg-espresso/50"
      />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-porcelain shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-espresso/10 px-5 py-4">
          <h2 className="font-display text-lg text-espresso">{t.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}
            className="inline-flex size-9 items-center justify-center rounded-full text-espresso/70 transition hover:bg-espresso/5 hover:text-espresso focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <FilterPanel ctrl={ctrl} locale={locale} showCategory={showCategory} facets={facets} />
        </div>
        <div className="flex items-center gap-3 border-t border-espresso/10 px-5 py-4">
          <Button type="button" onClick={onClose} className="flex-1">
            {t.show} ({resultCount})
          </Button>
          <button
            type="button"
            onClick={ctrl.clearAll}
            className="text-sm font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.clear}
          </button>
        </div>
      </div>
    </div>
  );
}
