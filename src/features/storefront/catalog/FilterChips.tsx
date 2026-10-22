import { X } from 'lucide-react';
import { priceBuckets } from './catalogData';
import { attributeByKey, attributeValueLabel, useAttributes } from './attributeStore';
import { useCatalog } from './catalogStore';
import { activeFilterCount } from './useProductFilters';
import type { FilterControls } from './FilterPanel';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { clear: 'مسح الكل', remove: 'إزالة الفلتر' },
  en: { clear: 'Clear all', remove: 'Remove filter' },
};

interface Chip {
  key: string;
  label: string;
  remove: () => void;
}

export function FilterChips({
  ctrl,
  locale,
  showCategory = false,
}: {
  ctrl: FilterControls;
  locale: StorefrontLocale;
  showCategory?: boolean;
}) {
  const f = ctrl.filters;
  const t = copy[locale];
  const { categories } = useCatalog();
  useAttributes(); // labels come from the attribute store
  const chips: Chip[] = [];

  if (showCategory) {
    for (const slug of f.categories) {
      const c = categories.find((x) => x.slug === slug);
      chips.push({ key: `cat-${slug}`, label: c?.name[locale] ?? slug, remove: () => ctrl.toggleCategory(slug) });
    }
  }
  for (const key of f.colors) {
    chips.push({
      key: `color-${key}`,
      label: attributeValueLabel('color', key, locale) ?? key,
      remove: () => ctrl.toggleColor(key),
    });
  }
  for (const key of f.materials) {
    chips.push({
      key: `mat-${key}`,
      label: attributeValueLabel('material', key, locale) ?? key,
      remove: () => ctrl.toggleMaterial(key),
    });
  }
  for (const key of f.sizes) {
    chips.push({
      key: `size-${key}`,
      label: attributeValueLabel('size', key, locale) ?? key,
      remove: () => ctrl.toggleSize(key),
    });
  }
  for (const [attrKey, values] of Object.entries(f.custom)) {
    const attr = attributeByKey(attrKey);
    for (const v of values) {
      const label = attributeValueLabel(attrKey, v, locale) ?? v;
      chips.push({
        key: `attr-${attrKey}-${v}`,
        label: attr ? `${attr.name[locale]}: ${label}` : label,
        remove: () => ctrl.toggleAttrValue(attrKey, v),
      });
    }
  }
  if (f.priceBucket) {
    const b = priceBuckets.find((x) => x.key === f.priceBucket);
    chips.push({ key: 'price', label: b?.label[locale] ?? f.priceBucket, remove: () => ctrl.setPriceBucket(null) });
  }
  if (f.inStockOnly) {
    chips.push({
      key: 'stock',
      label: locale === 'ar' ? 'المتوفر فقط' : 'In stock only',
      remove: () => ctrl.setInStockOnly(false),
    });
  }

  if (activeFilterCount(f) === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          aria-label={`${t.remove}: ${chip.label}`}
          className="inline-flex items-center gap-1.5 border border-espresso/20 bg-white px-2.5 py-1 text-xs text-espresso/80 transition hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {chip.label}
          <X className="size-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={ctrl.clearAll}
        className="text-xs font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {t.clear}
      </button>
    </div>
  );
}
