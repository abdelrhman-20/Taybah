import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  attributeByKey,
  attributesForCategory,
  attributeValueLabel,
  enabledValues,
  useAttributes,
} from '../../storefront/catalog/attributeStore';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { useOrders } from '../../storefront/checkout/orderStore';
import type { ProductVariant } from '../../storefront/catalog/catalogData';
import {
  MAX_VARIANT_AXES,
  MAX_VARIANT_COMBINATIONS,
  canDeleteVariant,
  comboKey,
  combinationCount,
  generateVariantCombos,
  newVariantId,
  normalizeSku,
  skuTaken,
  suggestVariantSku,
  syncVariantMatrix,

  type VariantIssue,
  type VariantIssueCode,
} from '../../storefront/catalog/variants';
import { formatPrice } from '../../shared/utils/format';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImageUploadField } from '../components/ImageUploadField';

// VARIANT MATRIX PANEL — nested inside the «الخيارات والحالة» card of the
// product form (same options experience, not a standalone section). Manages
// variation-axis designation, combination generation, and per-variant
// editing. All generation/merge rules live in
// storefront/catalog/variants.ts — this file is presentation + wiring only.
//
// Semantics enforced here:
//   • removed combinations are retained as INACTIVE rows — never deleted
//     implicitly — and can only be physically removed when no order
//     references them;
//   • regenerating preserves ids, SKUs, prices, images, and active
//     flags for every still-generated combination;
//   • axes are limited to enabled, variation-capable attributes applicable
//     to the chosen category, max 3, ≤60 generated combinations;
//   • axis VALUES come from the product's own fields (الخيارات والحالة +
//     السمات المخصصة) resolved by axisProductValues — this panel never
//     renders a second set of value checkboxes;
//   • no axes selected = simple product — the matrix UI stays dormant and
//     stored variant data is preserved verbatim.

export interface VariantFieldsPatch {
  variantAxes?: string[];
  variants?: ProductVariant[];
}

const inputCls =
  'w-full border border-taupe bg-white px-2.5 py-1.5 text-xs text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';

const availabilityLabels = {
  in_stock: 'متوفر',
  low_stock: 'باقي قطع قليلة',
  out_of_stock: 'نفدت الكمية',
} as const;

const ISSUE_TEXT: Record<VariantIssueCode, string> = {
  axes_empty: 'توجد تنويعات محفوظة دون محاور محددة — أضف محورًا أو أزل التنويعات.',
  axes_too_many: `الحد الأقصى ${MAX_VARIANT_AXES} محاور للتنويع.`,
  axes_duplicate: 'محور مكرر — أزل التكرار.',
  variants_missing: 'المحاور مختارة لكن المصفوفة لم تُولَّد بعد.',
  axis_unknown: 'محور غير معرّف في السمات.',
  axis_disabled: 'سمة معطّلة لا يمكن استخدامها كمحور تنويع.',
  axis_not_variation_capable: 'سمة غير مفعّلة لدعم التنويعات.',
  axis_out_of_scope: 'سمة لا تنطبق على تصنيف هذا المنتج — أزل المحور أو غيّر التصنيف.',
  combo_incomplete: 'تركيبة لا تغطي كل المحاور.',
  combo_value_unknown: 'قيمة غير معرّفة على سمتها.',
  combo_duplicate: 'تركيبة مكررة داخل المنتج.',
  combo_limit: `عدد التنويعات يتجاوز الحد الأقصى (${MAX_VARIANT_COMBINATIONS}).`,
  variant_id_duplicate: 'معرّف تنويعة مكرر داخل المنتج.',
  sku_empty: 'SKU مطلوب لكل تنويعة.',
  sku_duplicate: 'SKU مستخدم لمنتج أو تنويعة أخرى.',
  product_sku_duplicate: 'SKU المنتج يتعارض مع SKU تنويعة أخرى.',
  price_invalid: 'السعر يجب أن يكون رقمًا غير سالب.',
  compare_at_invalid: 'السعر قبل الخصم يجب أن يتجاوز سعر البيع.',
};

const INTEGER_RE = /^\d+$/;

function parseIntegerField(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null; // cleared → null (inherit / untracked)
  return INTEGER_RE.test(t) ? Number(t) : undefined; // undefined → invalid input
}

export function VariantMatrixSection({
  productId,
  sku,
  price,
  compareAtPrice,
  category,
  axes,
  axisValues,
  variants,
  issues,
  error,
  onChange,
}: {
  productId: string | undefined;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  category: string;
  axes: string[];
  // Resolved per-axis values sourced from the product's own fields
  // (axisValuesForAxes) — read-only here; the admin edits them in
  // الخيارات والحالة / السمات المخصصة.
  axisValues: Record<string, string[]>;
  variants: ProductVariant[];
  issues: VariantIssue[];
  error?: string;
  onChange: (patch: VariantFieldsPatch) => void;
}) {
  // Designating ≥1 axis is what turns the product into a variant product —
  // there is no separate enable toggle. axes.length === 0 = simple product;
  // stored variant data then renders as a preserved notice only.
  const enabled = axes.length > 0;

  const catalog = useCatalog();
  const orders = useOrders();
  useAttributes(); // axis labels/eligibility resolve from the live registry

  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState('');

  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  // Axes selectable for the current category — enabled, variation-capable,
  // in scope, and carrying at least one enabled value.
  const eligibleAxes = attributesForCategory(category).filter(
    (a) => a.variationCapable && enabledValues(a.key).length > 0,
  );

  // Axes that fail the CURRENT category/enabled/variationCapable rules after
  // a category change — selections and variants are preserved, but saving is
  // blocked until the admin resolves them (validator flags them too).
  const staleAxes = axes
    .map((axis) => ({ axis, attr: attributeByKey(axis) }))
    .filter(
      ({ attr }) =>
        !attr ||
        !attr.enabled ||
        !attr.variationCapable ||
        !(attr.categories.length === 0 || attr.categories.includes(category)),
    );

  // Live generation preview — null when invalid (>60, empty selection, bad
  // axes). genKeys drives the "removed from matrix" orphan flag on rows.
  const generated = useMemo(
    () =>
      enabled && axes.length > 0 ? generateVariantCombos(axes, axisValues) : null,
    [enabled, axes, axisValues],
  );
  const genKeys = useMemo(
    () => (generated ? new Set(generated.map(comboKey)) : null),
    [generated],
  );
  const orphanIds = useMemo(
    () =>
      genKeys
        ? new Set(
            variants.filter((v) => !genKeys.has(comboKey(v.combo))).map((v) => v.id),
          )
        : new Set<string>(),
    [variants, genKeys],
  );
  const totalCount = combinationCount(axes, axisValues);
  const overCap = totalCount > MAX_VARIANT_COMBINATIONS;

  const patchVariant = (id: string, patch: Partial<ProductVariant>) =>
    onChange({ variants: variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  const removeAxis = (axis: string) =>
    onChange({ variantAxes: axes.filter((a) => a !== axis) });

  const addAxis = (axis: string) =>
    onChange({ variantAxes: [...axes, axis] });

  // Merge generation output into stored variants — same routine used at
  // save-time, so the previewed matrix is exactly what persists.
  const regenerate = () => {
    const taken = new Set(variants.map((v) => normalizeSku(v.sku)));
    const isTaken = (s: string) =>
      normalizeSku(s) === normalizeSku(sku) ||
      skuTaken(s, catalog.products, { productId }) ||
      taken.has(normalizeSku(s));
    const res = syncVariantMatrix(axes, axisValues, variants, (combo) => {
      const suggested = suggestVariantSku(sku, combo, isTaken);
      taken.add(normalizeSku(suggested));
      return {
        id: newVariantId(),
        sku: suggested,
        combo,
        price: null,
        compareAtPrice: null,
        stockQuantity: null,
        availability: 'in_stock',
        image: null,
        active: true,
      };
    });
    if (res) onChange({ variants: res.variants });
  };

  const toggleChecked = (id: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyBulk = (apply: (v: ProductVariant) => Partial<ProductVariant>) => {
    onChange({ variants: variants.map((v) => (checked.has(v.id) ? { ...v, ...apply(v) } : v)) });
    setChecked(new Set());
  };

  const applyBulkPrice = () => {
    const parsed = parseIntegerField(bulkPrice);
    if (parsed === undefined) {
      setBulkError('السعر يجب أن يكون عددًا صحيحًا غير سالب، أو فارغًا ليرث سعر المنتج.');
      return;
    }
    setBulkError(null);
    applyBulk(() => ({ price: parsed }));
  };

  const pendingVariant = variants.find((v) => v.id === pendingDelete);
  const pendingBlocked =
    pendingVariant !== undefined &&
    !canDeleteVariant(
      { id: productId ?? '', variantAxes: axes, variants },
      pendingVariant.id,
      orders,
    );

  const referencedCount = variants.filter(
    (v) =>
      !canDeleteVariant({ id: productId ?? '', variantAxes: axes, variants }, v.id, orders),
  ).length;
  const clearAllBlocked = referencedCount > 0;

  const issuesByVariant = new Map<string, VariantIssueCode[]>();
  for (const i of issues) {
    if (!i.variantId) continue;
    const list = issuesByVariant.get(i.variantId) ?? [];
    list.push(i.code);
    issuesByVariant.set(i.variantId, list);
  }
  const sectionIssues = issues.filter((i) => !i.variantId);

  return (
    <div className="mt-6 border-t border-taupe/50 pt-5">
      <h4 className="text-xs font-semibold tracking-wide text-espresso">
        تنويعات قابلة للشراء
      </h4>
      <p className="mt-1 text-[11px] text-espresso/55">
        حدّد أي خيارات المنتج تُعرِّف تركيبات الشراء (مثل اللون × المقاس) — لكل
        تركيبة SKU وسعر وتوفر مستقل. القيم تؤخذ تلقائيًا من اختيارات المنتج أعلاه.
      </p>

      {/* ---- axis designation -------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {eligibleAxes.map((a) => {
          const on = axes.includes(a.key);
          const blocked = !on && axes.length >= MAX_VARIANT_AXES;
          return (
            <button
              key={a.key}
              type="button"
              disabled={blocked}
              aria-pressed={on}
              onClick={() => (on ? removeAxis(a.key) : addAxis(a.key))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-burgundy disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                  ? 'border-burgundy bg-burgundy/10 text-burgundy'
                  : 'border-espresso/25 text-espresso/70 hover:border-burgundy/50 hover:text-burgundy'
              }`}
            >
              {a.name.ar}
            </button>
          );
        })}
        {eligibleAxes.length === 0 && axes.length === 0 && (
          <p className="text-xs text-espresso/50">
            لا سمات مؤهلة للتنويع لهذا التصنيف — فعّل «تدعم التنويعات» للسمة من
            صفحة السمات.
          </p>
        )}
        {axes.length > 0 && (
          <span className="text-[10px] text-espresso/45">
            {axes.length} / {MAX_VARIANT_AXES} محاور
          </span>
        )}
      </div>

      {!enabled && variants.length > 0 && (
        <div className="mt-4 rounded border border-gold/60 bg-gold/10 p-3.5 text-xs text-espresso">
          <p className="font-semibold">
            هذا المنتج يحتوي على {variants.length} تنويعة محفوظة — ستبقى مخزّنة ولن تُحذف
            تلقائيًا.
          </p>
          <button
            type="button"
            onClick={() => setClearAllOpen(true)}
            className="mt-2 font-medium text-burgundy underline-offset-2 hover:underline"
          >
            إزالة جميع التنويعات
          </button>
        </div>
      )}

      {/* ---- issues summary ---------------------------------------------- */}
      {(issues.length > 0 || error) && (
        <div className="mt-4 rounded border border-burgundy/40 bg-burgundy/5 p-3.5 text-xs text-espresso">
          <p className="font-semibold text-burgundy">
            {issues.length > 0
              ? `${issues.length} مشكلة في إعداد التنويعات — يجب حلها قبل الحفظ`
              : ''}
            {error ? ` ${error}` : ''}
          </p>
          {sectionIssues.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc space-y-0.5">
              {sectionIssues.map((i, idx) => (
                <li key={idx}>{ISSUE_TEXT[i.code]}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {enabled && (
        <div className="mt-5 space-y-5">
          {/* ---- axes ---------------------------------------------------- */}
          <div>
            {staleAxes.length > 0 && (
              <div className="mt-3 rounded border border-burgundy/40 bg-burgundy/5 p-3 text-xs text-espresso">
                <p className="font-semibold text-burgundy">
                  محاور تحتاج مراجعة — لا تنطبق على التصنيف الحالي أو لم تعد مؤهلة
                </p>
                <ul className="mt-1.5 space-y-1">
                  {staleAxes.map(({ axis, attr }) => (
                    <li key={axis} className="flex flex-wrap items-center gap-2">
                      <span>{attr?.name.ar ?? axis}</span>
                      <button
                        type="button"
                        onClick={() => removeAxis(axis)}
                        className="font-medium text-burgundy underline-offset-2 hover:underline"
                      >
                        إزالة المحور
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 space-y-4">
              {axes.map((axis) => {
                const attr = attributeByKey(axis);
                // Values are sourced from the product's own fields
                // (الخيارات والحالة / السمات المخصصة) — read-only here.
                const sourced = axisValues[axis] ?? [];
                return (
                  <div
                    key={axis}
                    className="rounded border border-taupe/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold tracking-wide text-espresso">
                        {attr?.name.ar ?? axis}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAxis(axis)}
                        className="text-xs font-medium text-burgundy underline-offset-2 hover:underline"
                      >
                        إزالة المحور
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-espresso/55">
                      {sourced.length > 0
                        ? `${sourced.length} قيمة من اختيارات المنتج`
                        : 'لا قيم مختارة لهذه السمة — أضفها في «الخيارات والحالة» أو «السمات المخصصة» أولًا.'}
                    </p>
                    {sourced.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sourced.map((valueKey) => {
                          const def = attr?.values.find((v) => v.key === valueKey);
                          return (
                            <span
                              key={valueKey}
                              className="inline-flex items-center gap-1.5 rounded-full border border-taupe/70 bg-taupe/15 px-2.5 py-1 text-[11px] font-medium text-espresso"
                            >
                              {attr?.display === 'swatch' && def?.hex && (
                                <span
                                  className="size-3 rounded-full border border-espresso/15"
                                  style={{ backgroundColor: def.hex }}
                                  aria-hidden
                                />
                              )}
                              {attributeValueLabel(axis, valueKey, 'ar') ?? valueKey}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-[10px] text-espresso/40">
                      تُدار القيم من «الخيارات والحالة» أو «السمات المخصصة» — القيم المعطّلة لا تدخل التوليد.
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- generation ----------------------------------------------- */}
          {axes.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={regenerate}
                disabled={generated === null}
                className="inline-flex items-center gap-1.5 rounded bg-espresso px-5 py-2 text-xs font-medium text-white transition hover:bg-espresso/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
              >
                <Plus className="size-3.5" aria-hidden />
                توليد / تحديث المصفوفة
              </button>
              <span className={`text-xs ${overCap ? 'font-semibold text-burgundy' : 'text-espresso/55'}`}>
                {overCap
                  ? `التركيبات المحتملة ${totalCount} — تتجاوز الحد الأقصى ${MAX_VARIANT_COMBINATIONS}، قلّل قيم المنتج المختارة.`
                  : generated === null
                    ? 'أضف قيمة واحدة على الأقل لكل محور في «الخيارات والحالة».'
                    : `${totalCount} تركيبة محتملة · الحد الأقصى ${MAX_VARIANT_COMBINATIONS}`}
              </span>
            </div>
          )}

          {/* ---- bulk actions --------------------------------------------- */}
          {variants.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 rounded border border-taupe/60 bg-taupe/15 p-3">
              <span className="text-xs font-semibold text-espresso">
                {checked.size} محددة — إجراءات جماعية:
              </span>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                placeholder="سعر البيع"
                aria-label="سعر البيع للمحددة"
                className={`${inputCls} w-24`}
              />
              <button
                type="button"
                disabled={checked.size === 0}
                onClick={applyBulkPrice}
                className="rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50"
              >
                تطبيق السعر
              </button>
              <button
                type="button"
                disabled={checked.size === 0}
                onClick={() => applyBulk(() => ({ active: true }))}
                className="rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50"
              >
                تفعيل
              </button>
              <button
                type="button"
                disabled={checked.size === 0}
                onClick={() => applyBulk(() => ({ active: false }))}
                className="rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50"
              >
                إلغاء التفعيل
              </button>
              {bulkError && <p className="w-full text-xs text-burgundy">{bulkError}</p>}
            </div>
          )}

          {/* ---- matrix ----------------------------------------------------- */}
          {variants.length > 0 && (
            <div className="overflow-x-auto rounded border border-taupe/60">
              <table className="w-full min-w-[920px] text-start text-xs">
                <thead>
                  <tr className="border-b border-taupe/60 bg-taupe/20 text-espresso/60">
                    <th className="px-2 py-2 text-start">
                      <input
                        type="checkbox"
                        aria-label="تحديد الكل"
                        checked={variants.length > 0 && checked.size === variants.length}
                        onChange={(e) =>
                          setChecked(e.target.checked ? new Set(variants.map((v) => v.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-2 py-2 text-start font-medium">التركيبة</th>
                    <th className="px-2 py-2 text-start font-medium">SKU</th>
                    <th className="px-2 py-2 text-start font-medium">السعر</th>
                    <th className="px-2 py-2 text-start font-medium">قبل الخصم</th>
                    <th className="px-2 py-2 text-start font-medium">الكمية بالمخزون</th>
                    <th className="px-2 py-2 text-start font-medium">التوفر</th>
                    <th className="px-2 py-2 text-start font-medium">الصورة</th>
                    <th className="px-2 py-2 text-start font-medium">مفعّلة</th>
                    <th className="px-2 py-2 text-start font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const orphan = orphanIds.has(v.id);
                    const rowIssues = issuesByVariant.get(v.id) ?? [];
                    return (
                      <tr
                        key={v.id}
                        className={`border-b border-taupe/40 align-top last:border-0 ${
                          !v.active ? 'bg-espresso/[0.03]' : ''
                        }`}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label={`تحديد ${v.sku}`}
                            checked={checked.has(v.id)}
                            onChange={() => toggleChecked(v.id)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                            {axes.map((axis) => (
                              <span key={axis}>
                                <span className="text-espresso/50">
                                  {attributeByKey(axis)?.name.ar ?? axis}:
                                </span>{' '}
                                <span className="font-medium text-espresso">
                                  {attributeValueLabel(axis, v.combo[axis], 'ar') ??
                                    v.combo[axis]}
                                </span>
                              </span>
                            ))}
                            {orphan && (
                              <span className="rounded-full border border-gold/60 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-espresso">
                                مزالة من التوليد
                              </span>
                            )}
                            {!v.active && !orphan && (
                              <span className="rounded-full border border-espresso/20 px-1.5 py-0.5 text-[10px] text-espresso/55">
                                غير مفعّلة
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            dir="ltr"
                            value={v.sku}
                            onChange={(e) => patchVariant(v.id, { sku: e.target.value })}
                            aria-invalid={rowIssues.some(
                              (c) => c === 'sku_empty' || c === 'sku_duplicate',
                            )}
                            className={`${inputCls} w-32 font-mono`}
                          />
                          {rowIssues
                            .filter((c) => c === 'sku_empty' || c === 'sku_duplicate')
                            .map((c) => (
                              <p key={c} className="mt-1 text-[10px] text-burgundy">
                                {ISSUE_TEXT[c]}
                              </p>
                            ))}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={v.price ?? ''}
                            onChange={(e) => {
                              const parsed = parseIntegerField(e.target.value);
                              if (parsed !== undefined)
                                patchVariant(v.id, { price: parsed });
                            }}
                            placeholder={price !== null ? `يُرث: ${formatPrice(price, 'ar')}` : 'يُرث من المنتج'}
                            aria-invalid={rowIssues.includes('price_invalid')}
                            className={`${inputCls} w-24`}
                          />
                          {v.price === null && price !== null && (
                            <p className="mt-0.5 text-[10px] text-espresso/45">
                              {formatPrice(price, 'ar')}
                            </p>
                          )}
                          {rowIssues.includes('price_invalid') && (
                            <p className="mt-1 text-[10px] text-burgundy">
                              {ISSUE_TEXT.price_invalid}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={v.compareAtPrice ?? ''}
                            onChange={(e) => {
                              const parsed = parseIntegerField(e.target.value);
                              if (parsed !== undefined)
                                patchVariant(v.id, { compareAtPrice: parsed });
                            }}
                            placeholder={
                              compareAtPrice !== null
                                ? `يُرث: ${formatPrice(compareAtPrice, 'ar')}`
                                : 'يُرث من المنتج'
                            }
                            aria-invalid={rowIssues.includes('compare_at_invalid')}
                            className={`${inputCls} w-24`}
                          />
                          {rowIssues.includes('compare_at_invalid') && (
                            <p className="mt-1 text-[10px] text-burgundy">
                              {ISSUE_TEXT.compare_at_invalid}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={v.stockQuantity ?? ''}
                            onChange={(e) => {
                              const parsed = parseIntegerField(e.target.value);
                              if (parsed !== undefined) patchVariant(v.id, { stockQuantity: parsed });
                            }}
                            placeholder="غير متتبَّعة"
                            className={`${inputCls} w-20`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={v.availability}
                            onChange={(e) =>
                              patchVariant(v.id, {
                                availability: e.target
                                  .value as ProductVariant['availability'],
                              })
                            }
                            className={`${inputCls} w-28`}
                          >
                            {Object.entries(availabilityLabels).map(([val, label]) => (
                              <option key={val} value={val}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <ImageUploadField
                            id={`pv-img-${v.id}`}
                            label=""
                            compact
                            value={v.image ?? ''}
                            onChange={(ref) => patchVariant(v.id, { image: ref || null })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label="تفعيل التنويعة"
                            checked={v.active}
                            disabled={orphan}
                            title={
                              orphan
                                ? 'تركيبة مزالة من التوليد — أعد اختيار قيمها لتفعيلها من جديد'
                                : undefined
                            }
                            onChange={(e) => patchVariant(v.id, { active: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setPendingDelete(v.id)}
                            aria-label="حذف التنويعة"
                            className="inline-flex size-7 items-center justify-center rounded-full text-espresso/50 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                          {rowIssues
                            .filter(
                              (c) =>
                                c !== 'sku_empty' &&
                                c !== 'sku_duplicate' &&
                                c !== 'price_invalid' &&
                                c !== 'compare_at_invalid'
                            )
                            .map((c) => (
                              <p key={c} className="mt-1 text-[10px] text-burgundy">
                                {ISSUE_TEXT[c]}
                              </p>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {variants.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setClearAllOpen(true)}
                className="text-xs font-medium text-burgundy underline-offset-2 hover:underline"
              >
                إزالة جميع التنويعات
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingBlocked ? 'لا يمكن حذف التنويعة' : 'حذف التنويعة'}
        body={
          pendingBlocked
            ? `التنويعة «${pendingVariant?.sku ?? ''}» مرتبطة بطلبات سابقة — لا يمكن حذفها نهائيًا حفاظًا على سلامة سجل الطلبات. يمكنك إلغاء تفعيلها بدلًا من ذلك.`
            : `حذف التنويعة «${pendingVariant?.sku ?? ''}» نهائيًا؟ لا تُستخدم في أي طلب سابق ويمكن إزالتها بأمان.`
        }
        confirmLabel={pendingBlocked ? undefined : 'حذف نهائي'}
        onConfirm={
          pendingBlocked
            ? undefined
            : () => {
                onChange({ variants: variants.filter((v) => v.id !== pendingDelete) });
                setChecked((s) => {
                  const next = new Set(s);
                  if (pendingDelete) next.delete(pendingDelete);
                  return next;
                });
                setPendingDelete(null);
              }
        }
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title={clearAllBlocked ? 'لا يمكن إزالة كل التنويعات' : 'إزالة جميع التنويعات'}
        body={
          clearAllBlocked
            ? `${referencedCount} تنويعة مرتبطة بطلبات سابقة ولا يمكن حذفها نهائيًا — يمكن إلغاء تفعيلها فقط. أزل التنويعات غير المرتبطة فرديًا إن أردت.`
            : `إزالة ${variants.length} تنويعة نهائيًا من هذا المنتج؟ لا تُستخدم في أي طلب سابق.`
        }
        confirmLabel={clearAllBlocked ? undefined : 'إزالة الكل'}
        onConfirm={
          clearAllBlocked
            ? undefined
            : () => {
                onChange({
                  variantAxes: [],
                  variants: [],
                });
                setChecked(new Set());
                setClearAllOpen(false);
              }
        }
        onCancel={() => setClearAllOpen(false)}
      />
    </div>
  );
}
