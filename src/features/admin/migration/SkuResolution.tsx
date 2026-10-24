import { normalizeSku } from '../../storefront/catalog/variants';
import {
  skuRowsNeedingNewValue,
  type ConflictReason,
  type MigrationPlan,
  type SkuOverrides,
} from './migrationEngine';

// Lists every SKU that must be replaced before the catalog can be imported,
// and lets the admin type the replacement. Nothing is renamed automatically;
// replacements apply to the imported copy only (the backup ZIP keeps the
// original values). Changing any value invalidates the previous dry run.

const REASON_AR = {
  duplicate_in_data: 'مكرر داخل بياناتك المحلية',
  taken_in_database: 'مستخدم بالفعل في منتج مخزّن في قاعدة البيانات',
} as const;

export function SkuResolution({
  base,
  effective,
  serverConflicts,
  overrides,
  onChange,
}: {
  // plan built WITHOUT overrides: defines which rows exist (so they don't
  // disappear while the admin is typing)
  base: MigrationPlan;
  // plan built WITH the overrides: used to validate what was typed
  effective: MigrationPlan;
  serverConflicts: ReadonlyArray<{ id: string; reason: ConflictReason; sku?: string }>;
  overrides: SkuOverrides;
  onChange: (key: string, value: string) => void;
}) {
  const rows = skuRowsNeedingNewValue(base, serverConflicts);
  if (rows.length === 0) return null;

  const stillDuplicated = new Set(effective.skuProblems.map((p) => p.sku));
  const stillTaken = new Set(
    serverConflicts.filter((c) => c.reason === 'sku_taken' && c.sku).map((c) => c.sku as string),
  );

  return (
    <div className="rounded border border-burgundy/30 bg-burgundy/5 p-3 text-xs leading-6" role="group" aria-label="رموز SKU المكررة">
      <p className="font-medium text-burgundy">
        رموز SKU تحتاج إلى قيمة جديدة قبل الاستيراد ({rows.length})
      </p>
      <p className="text-espresso/70">
        قاعدة البيانات تمنع تكرار الرمز (SKU) بين المنتجات والتنويعات. لا يُغيَّر أي شيء تلقائيًا: اكتب رمزًا جديدًا
        لكل صف. يُطبَّق على النسخة المستوردة فقط، وتحتفظ النسخة الاحتياطية بالقيم الأصلية. بعد التعديل أعد تشغيل
        الفحص التجريبي. المنتج الذي لم يُحلّ تعارضه لا يُستورد ولا يمكن اعتماد الترحيل.
      </p>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => {
          const value = overrides[r.key] ?? '';
          const norm = normalizeSku(value);
          const problem =
            norm === ''
              ? 'اكتب رمزًا جديدًا'
              : stillDuplicated.has(norm) || stillTaken.has(norm)
                ? 'هذا الرمز مستخدم أيضًا — اختر رمزًا مختلفًا'
                : null;
          const id = `sku-fix-${r.key}`;
          return (
            <li key={r.key} className="rounded border border-taupe/60 bg-white p-2">
              <p className="text-espresso">
                {r.productName}{' '}
                <span className="text-espresso/50" dir="ltr">
                  ({r.productId}
                  {r.variantId !== null ? ` · تنويعة ${r.variantId}` : ''})
                </span>
              </p>
              <p className="text-espresso/70">
                الرمز الحالي: <span dir="ltr" className="font-mono">{r.sku}</span> — {REASON_AR[r.reason]}
              </p>
              <label htmlFor={id} className="mt-1 block font-medium text-espresso">
                الرمز الجديد
              </label>
              <input
                id={id}
                dir="ltr"
                value={value}
                onChange={(e) => onChange(r.key, e.target.value)}
                className="w-full rounded border border-taupe bg-white px-3 py-1.5 font-mono text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy sm:max-w-xs"
                aria-invalid={problem !== null}
                aria-describedby={problem ? `${id}-err` : undefined}
              />
              {problem && (
                <p id={`${id}-err`} className="mt-0.5 text-burgundy">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
