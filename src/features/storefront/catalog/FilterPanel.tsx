import { Check } from 'lucide-react';
import { priceBuckets } from './catalogData';
import {
  enabledValues,
  useAttributes,
  RESERVED_ATTRIBUTE_KEYS,
  type AttributeDef,
} from './attributeStore';
import { useCatalog } from './catalogStore';
import type { useProductFilters } from './useProductFilters';
import type { StorefrontLocale } from '../../shared/utils/locale';

export type FilterControls = ReturnType<typeof useProductFilters>;

const copy = {
  ar: {
    category: 'القسم',
    price: 'السعر',
    color: 'اللون',
    material: 'الخامة',
    size: 'المقاس',
    availability: 'التوفر',
    inStock: 'المتوفر فقط',
    anyPrice: 'كل الأسعار',
  },
  en: {
    category: 'Category',
    price: 'Price',
    color: 'Color',
    material: 'Material',
    size: 'Size',
    availability: 'Availability',
    inStock: 'In stock only',
    anyPrice: 'All prices',
  },
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-espresso/10 pt-5 first:border-t-0 first:pt-0">
      <legend className="mb-3 font-display text-sm tracking-wide text-espresso">{title}</legend>
      <div className="space-y-2">{children}</div>
    </fieldset>
  );
}

const checkRow =
  'flex w-full cursor-pointer items-center gap-2.5 py-0.5 text-sm text-espresso/75 transition hover:text-espresso';
const checkBox = (on: boolean) =>
  `flex size-4 shrink-0 items-center justify-center border transition ${
    on ? 'border-burgundy bg-burgundy text-white' : 'border-espresso/30 bg-transparent'
  }`;

export function FilterPanel({
  ctrl,
  locale,
  showCategory = false,
  facets = [],
}: {
  ctrl: FilterControls;
  locale: StorefrontLocale;
  showCategory?: boolean;
  // Enabled+filterable custom attributes applicable to this listing.
  facets?: AttributeDef[];
}) {
  const t = copy[locale];
  const f = ctrl.filters;
  const { categories } = useCatalog();
  const attrs = useAttributes();
  // Facet visibility is decided by the listing's `facets` prop (enabled +
  // filterable + category-scoped + has enabled values) — that predicate is the
  // single source of truth and applies identically to the reserved
  // color/material/size attributes and custom attributes. Reserved groups
  // keep their bespoke UIs but render only when their attribute qualifies.
  const attr = (k: string) => attrs.find((a) => a.key === k);
  const facetKeys = new Set(facets.map((a) => a.key));
  const colors = enabledValues('color');
  const materials = enabledValues('material');
  const sizes = enabledValues('size');

  return (
    <div className="space-y-6">
      {showCategory && (
        <Group title={t.category}>
          {categories.filter((c) => c.visible).map((c) => {
            const on = f.categories.includes(c.slug);
            return (
              <label key={c.slug} className={checkRow}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => ctrl.toggleCategory(c.slug)}
                />
                <span className={checkBox(on)} aria-hidden>
                  {on && <Check className="size-3" />}
                </span>
                {c.name[locale]}
              </label>
            );
          })}
        </Group>
      )}

      <Group title={t.price}>
        <label className={checkRow}>
          <input
            type="radio"
            name="price-bucket"
            className="sr-only"
            checked={f.priceBucket === null}
            onChange={() => ctrl.setPriceBucket(null)}
          />
          <span
            className={`size-4 shrink-0 rounded-full border transition ${
              f.priceBucket === null ? 'border-[5px] border-burgundy' : 'border-espresso/30'
            }`}
            aria-hidden
          />
          {t.anyPrice}
        </label>
        {priceBuckets.map((b) => {
          const on = f.priceBucket === b.key;
          return (
            <label key={b.key} className={checkRow}>
              <input
                type="radio"
                name="price-bucket"
                className="sr-only"
                checked={on}
                onChange={() => ctrl.setPriceBucket(b.key)}
              />
              <span
                className={`size-4 shrink-0 rounded-full border transition ${
                  on ? 'border-[5px] border-burgundy' : 'border-espresso/30'
                }`}
                aria-hidden
              />
              {b.label[locale]}
            </label>
          );
        })}
      </Group>

      {facetKeys.has('color') && colors.length > 0 && (
      <Group title={attr('color')?.name[locale] ?? t.color}>
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => {
            const on = f.colors.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => ctrl.toggleColor(c.key)}
                aria-pressed={on}
                title={c.label[locale]}
                className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                  on
                    ? 'border-burgundy bg-burgundy/5 text-espresso'
                    : 'border-espresso/15 text-espresso/70 hover:border-espresso/40'
                }`}
              >
                <span
                  className="size-3.5 rounded-full border border-espresso/15"
                  style={{ backgroundColor: c.hex }}
                  aria-hidden
                />
                {c.label[locale]}
              </button>
            );
          })}
        </div>
      </Group>
      )}

      {facetKeys.has('material') && materials.length > 0 && (
      <Group title={attr('material')?.name[locale] ?? t.material}>
        {materials.map((m) => {
          const on = f.materials.includes(m.key);
          return (
            <label key={m.key} className={checkRow}>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => ctrl.toggleMaterial(m.key)}
              />
              <span className={checkBox(on)} aria-hidden>
                {on && <Check className="size-3" />}
              </span>
              {m.label[locale]}
            </label>
          );
        })}
      </Group>
      )}

      {facetKeys.has('size') && sizes.length > 0 && (
      <Group title={attr('size')?.name[locale] ?? t.size}>
        {sizes.map((s) => {
          const on = f.sizes.includes(s.key);
          return (
            <label key={s.key} className={checkRow}>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => ctrl.toggleSize(s.key)}
              />
              <span className={checkBox(on)} aria-hidden>
                {on && <Check className="size-3" />}
              </span>
              {s.label[locale]}
            </label>
          );
        })}
      </Group>
      )}

      {facets.filter((a) => !(RESERVED_ATTRIBUTE_KEYS as readonly string[]).includes(a.key)).map((a) => {
        const values = a.values.filter((v) => v.enabled).sort((x, y) => x.order - y.order);
        if (values.length === 0) return null;
        const selected = f.custom[a.key] ?? [];
        return (
          <Group key={a.key} title={a.name[locale]}>
            {a.display === 'swatch' ? (
              <div className="flex flex-wrap gap-2">
                {values.map((v) => {
                  const on = selected.includes(v.key);
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => ctrl.toggleAttrValue(a.key, v.key)}
                      aria-pressed={on}
                      title={v.label[locale]}
                      className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                        on
                          ? 'border-burgundy bg-burgundy/5 text-espresso'
                          : 'border-espresso/15 text-espresso/70 hover:border-espresso/40'
                      }`}
                    >
                      {v.hex && (
                        <span
                          className="size-3.5 rounded-full border border-espresso/15"
                          style={{ backgroundColor: v.hex }}
                          aria-hidden
                        />
                      )}
                      {v.label[locale]}
                    </button>
                  );
                })}
              </div>
            ) : (
              values.map((v) => {
                const on = selected.includes(v.key);
                return (
                  <label key={v.key} className={checkRow}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => ctrl.toggleAttrValue(a.key, v.key)}
                    />
                    <span className={checkBox(on)} aria-hidden>
                      {on && <Check className="size-3" />}
                    </span>
                    {v.label[locale]}
                  </label>
                );
              })
            )}
          </Group>
        );
      })}

      <Group title={t.availability}>
        <label className={checkRow}>
          <input
            type="checkbox"
            className="sr-only"
            checked={f.inStockOnly}
            onChange={(e) => ctrl.setInStockOnly(e.target.checked)}
          />
          <span className={checkBox(f.inStockOnly)} aria-hidden>
            {f.inStockOnly && <Check className="size-3" />}
          </span>
          {t.inStock}
        </label>
      </Group>
    </div>
  );
}
