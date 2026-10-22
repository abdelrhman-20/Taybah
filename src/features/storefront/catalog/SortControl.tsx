import { ChevronDown } from 'lucide-react';
import type { SortKey } from './useProductFilters';
import type { StorefrontLocale } from '../../shared/utils/locale';
import type { Localized } from './catalogData';

const options: { key: SortKey; label: Localized }[] = [
  { key: 'featured', label: { ar: 'المميزة', en: 'Featured' } },
  { key: 'price-asc', label: { ar: 'السعر: من الأقل للأعلى', en: 'Price: low to high' } },
  { key: 'price-desc', label: { ar: 'السعر: من الأعلى للأقل', en: 'Price: high to low' } },
  { key: 'newest', label: { ar: 'الأحدث', en: 'Newest' } },
];

export function SortControl({
  value,
  onChange,
  locale,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
  locale: StorefrontLocale;
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">ترتيب حسب</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="appearance-none border border-espresso/20 bg-white py-2 pe-9 ps-3.5 text-sm text-espresso transition hover:border-espresso/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label[locale]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 size-4 text-espresso/50 rtl:-scale-x-100" />
    </label>
  );
}
