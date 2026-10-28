import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Minus, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { getDocsState, subscribeDocs, type DocsState } from '../../storefront/catalog/catalogDocs';
import { useCatalog, resolveCartLines, type ResolvedCartLine } from '../../storefront/catalog/catalogStore';
import type { CartLine } from '../../storefront/cart/useCart';
import type { CatalogProduct } from '../../storefront/catalog/catalogData';
import { attributeByKey, attributeValueLabel } from '../../storefront/catalog/attributeStore';
import { isVariantProduct } from '../../storefront/catalog/variants';
import {
  buildOrderLines,
  createInStoreOrder,
  makeOrderRef,
} from '../../storefront/checkout/orderStore';
import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';
import { generateId } from '../../shared/utils/id';
import { formatPrice } from '../../shared/utils/format';

// «إضافة طلب» — records a walk-in sale. Lines are priced with the live RETAIL
// price (resolveCartLines → product.price / variant.price). The wholesale price
// is never read here, and the database re-validates prices and totals.

const MAX_RESULTS = 30;
const MAX_NOTE = 1000;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

const inputCls =
  'w-full border border-taupe bg-white px-3 py-2 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';

interface Pick {
  key: string;
  productId: string;
  variantId: string | null;
  qty: number;
}

const pickKey = (productId: string, variantId: string | null) =>
  variantId ? `${productId}|v:${variantId}` : `${productId}|`;

// A "sellable unit": a simple product, or one variant of a variant product.
interface Unit {
  key: string;
  productId: string;
  variantId: string | null;
  searchText: string;
}

function toCartLine(p: Pick): CartLine {
  return {
    key: p.key,
    productId: p.productId,
    variantId: p.variantId,
    color: null,
    size: null,
    combo: null,
    name: null,
    price: null,
    image: null,
    qty: p.qty,
  };
}

// Warning shown to the admin; the sale itself is still allowed.
function blockWarning(block: ResolvedCartLine['block'], inactive: boolean): string | null {
  if (block === 'hidden') return 'هذا المنتج غير منشور في المتجر الإلكتروني';
  if (block === 'unavailable') return 'هذا المنتج غير متوفر في المتجر الإلكتروني';
  return inactive ? 'هذه التنويعة غير مفعّلة' : null;
}

function unitsOf(products: CatalogProduct[]): Unit[] {
  const out: Unit[] = [];
  for (const p of products) {
    const base = `${p.name.ar} ${p.name.en} ${p.sku}`.toLowerCase();
    if (isVariantProduct(p)) {
      for (const v of p.variants ?? []) {
        out.push({
          key: pickKey(p.id, v.id),
          productId: p.id,
          variantId: v.id,
          searchText: `${base} ${v.sku}`.toLowerCase(),
        });
      }
    } else {
      out.push({ key: pickKey(p.id, null), productId: p.id, variantId: null, searchText: base });
    }
  }
  return out;
}

// Orders can only be priced/validated against the catalog stored in the
// database. Until it has been migrated the page shows the built-in demo
// catalog, whose products the database does not know — saving would always
// fail, so the form says so up front instead.
function catalogBlock(docs: DocsState): string | null {
  if (docs.initialized) return null;
  if (docs.status === 'loading') return 'جارٍ تحميل الكتالوج من قاعدة البيانات…';
  if (docs.status === 'unconfigured') return 'الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار — لا يمكن حفظ الطلبات.';
  if (docs.status === 'error') return 'تعذّر تحميل الكتالوج من قاعدة البيانات — أعد تحميل الصفحة. لا يمكن حفظ طلب قبل التأكد من الكتالوج.';
  return docs.schemaMissing
    ? 'جداول الكتالوج غير موجودة في قاعدة البيانات (الترحيل 0006 لم يُطبَّق)، والمنتجات المعروضة هنا من الكتالوج المدمج وليست محفوظة في قاعدة البيانات. لا يمكن تسجيل طلب قبل تطبيق الترحيل وترحيل الكتالوج.'
    : 'الكتالوج لم يُرحَّل إلى قاعدة البيانات بعد، والمنتجات المعروضة هنا من الكتالوج المدمج وليست محفوظة في قاعدة البيانات. أكمل «النسخ الاحتياطي والترحيل» أولًا — لا يمكن تسجيل طلب قبل ذلك.';
}

function optionsText(r: ResolvedCartLine): string {
  return r.options
    .map(([axis, value]) => `${attributeByKey(axis)?.name.ar ?? axis}: ${attributeValueLabel(axis, value, 'ar') ?? value}`)
    .join(' · ');
}

export function InStoreOrderPage() {
  const catalog = useCatalog();
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const blocked = catalogBlock(docs);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ lines?: string; phone?: string; note?: string }>({});
  // Guards a second submit in the same tick; the id/ref survive a failed
  // attempt so retrying the SAME sale is idempotent (see saveOrder).
  const inFlight = useRef(false);
  const identity = useRef<{ fingerprint: string; id: string; ref: string } | null>(null);

  const units = useMemo(() => unitsOf(catalog.products), [catalog.products]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? units.filter((u) => u.searchText.includes(q)) : units;
    return list.slice(0, MAX_RESULTS);
  }, [units, query]);

  // Every unit shown (picker + cart) resolves through the one shared path.
  const resolvedByKey = useMemo(() => {
    const keys = new Map<string, ResolvedCartLine>();
    const lines = results
      .map((u) => ({ key: u.key, productId: u.productId, variantId: u.variantId, qty: 1 }))
      .concat(picks)
      .map(toCartLine);
    resolveCartLines(lines, catalog).forEach((r) => keys.set(r.line.key, r));
    return keys;
  }, [results, picks, catalog]);

  const cartLines = picks
    .map((p) => ({ pick: p, resolved: resolvedByKey.get(p.key) }))
    .filter((x): x is { pick: Pick; resolved: ResolvedCartLine } => !!x.resolved && x.resolved.name !== null);
  const total = cartLines.reduce((n, x) => n + x.resolved.unitPrice * x.pick.qty, 0);

  const add = (u: Unit) => {
    setFieldErrors((f) => ({ ...f, lines: undefined }));
    setPicks((prev) =>
      prev.some((p) => p.key === u.key)
        ? prev.map((p) => (p.key === u.key ? { ...p, qty: Math.min(999, p.qty + 1) } : p))
        : [...prev, { key: u.key, productId: u.productId, variantId: u.variantId, qty: 1 }],
    );
  };
  const setQty = (key: string, qty: number) =>
    setPicks((prev) => prev.map((p) => (p.key === key ? { ...p, qty: Math.max(1, Math.min(999, qty)) } : p)));
  const remove = (key: string) => setPicks((prev) => prev.filter((p) => p.key !== key));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || blocked) return;
    const errs: typeof fieldErrors = {};
    if (cartLines.length === 0) errs.lines = 'أضف منتجًا واحدًا على الأقل.';
    if (phone.trim() && !PHONE_RE.test(phone.replace(/[\s-]/g, ''))) errs.phone = 'رقم الهاتف غير صالح.';
    if (note.length > MAX_NOTE) errs.note = `الملاحظة أطول من ${MAX_NOTE} حرفًا.`;
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const lines = buildOrderLines(cartLines.map((x) => x.resolved));
      const fingerprint = JSON.stringify([name, phone, note, lines]);
      if (identity.current?.fingerprint !== fingerprint) {
        identity.current = { fingerprint, id: generateId(), ref: makeOrderRef() };
      }
      const saved = await createInStoreOrder({
        id: identity.current.id,
        ref: identity.current.ref,
        customerName: name,
        customerPhone: phone.replace(/[\s-]/g, ''),
        note,
        lines,
      });
      // Only now — after the database returned the stored row — leave the form.
      navigate(`/admin/orders/${saved.id}`);
    } catch (err) {
      const pe = classifyError(err);
      console.error('In-store order failed:', pe.code, pe.detail);
      // Only the database's own validation codes are translated; every other
      // failure keeps its generic, accurate message.
      setError(
        pe.code === 'invalid' && /price_mismatch|total_mismatch/.test(pe.detail)
          ? 'تغيّر سعر أحد المنتجات أثناء التحرير. أعد تحميل الصفحة لرؤية الأسعار الحالية ثم أعد المحاولة — لم يُحفظ الطلب.'
          : pe.code === 'invalid' && /unknown (product|variant)/.test(pe.detail)
            ? 'أحد المنتجات أو التنويعات في الطلب غير موجود في كتالوج قاعدة البيانات (ربما حُذف، أو لم يُرحَّل الكتالوج بعد). أعد تحميل الصفحة واختر منتجات محفوظة — لم يُحفظ الطلب.'
            : describePersistenceError(pe),
      );
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/admin/orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
      >
        <ArrowRight className="size-4" aria-hidden /> الطلبات
      </Link>
      <div className="mt-4">
        <AdminPageHeader
          title="إضافة طلب"
          description="سجّل عملية بيع تمت مباشرة في المتجر. تُحسب الأسعار من سعر التجزئة الحالي، ويُسجَّل الطلب بحالة «تم البيع» دون شحن أو إشعارات بريدية."
        />
      </div>

      {blocked && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso"
        >
          <TriangleAlert className="size-4 shrink-0 text-burgundy" aria-hidden />
          <span className="flex-1 leading-6">{blocked}</span>
          <Link to="/admin/migration" className="font-medium text-burgundy underline-offset-4 hover:underline">
            فتح النسخ الاحتياطي والترحيل
          </Link>
        </div>
      )}

      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-2">
        {/* ---- product picker ---- */}
        <section aria-labelledby="is-products" className="rounded border border-taupe/70 bg-white p-5">
          <h3 id="is-products" className="font-display text-lg text-espresso">اختيار المنتجات</h3>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو رمز المنتج"
              aria-label="البحث في المنتجات"
              className={`${inputCls} pe-3 ps-10`}
            />
          </label>
          <ul className="mt-3 max-h-[28rem] divide-y divide-taupe/50 overflow-y-auto">
            {results.length === 0 && (
              <li className="py-6 text-center text-sm text-espresso/55">لا توجد منتجات مطابقة.</li>
            )}
            {results.map((u) => {
              const r = resolvedByKey.get(u.key);
              if (!r || r.name === null) return null;
              const inactive = !!r.variant && !r.variant.active;
              const warning = blockWarning(r.block, inactive);
              const opts = optionsText(r);
              return (
                <li key={u.key} className="flex items-center gap-3 py-3">
                  <AssetImage src={r.image} alt="" className="size-12 shrink-0 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-espresso">{r.name.ar}</p>
                    {opts && <p className="text-xs text-espresso/55">{opts}</p>}
                    <p className="text-xs text-espresso/55">
                      <span dir="ltr">{r.sku}</span> · {formatPrice(r.unitPrice, 'ar')}
                    </p>
                    {warning && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-burgundy">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {warning}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => add(u)}
                    disabled={!!blocked}
                    aria-label={`إضافة ${r.name.ar}${opts ? ` (${opts})` : ''}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    <Plus className="size-3.5" aria-hidden /> إضافة
                  </button>
                </li>
              );
            })}
          </ul>
          {units.length > MAX_RESULTS && !query.trim() && (
            <p className="mt-2 text-xs text-espresso/50">يُعرض أول {MAX_RESULTS} عنصرًا — استخدم البحث للوصول إلى البقية.</p>
          )}
        </section>

        <div className="space-y-6">
          {/* ---- cart ---- */}
          <section aria-labelledby="is-cart" className="rounded border border-taupe/70 bg-white p-5">
            <h3 id="is-cart" className="font-display text-lg text-espresso">عناصر الطلب</h3>
            {cartLines.length === 0 ? (
              <p className="mt-3 text-sm text-espresso/55">لم تُضف أي منتجات بعد.</p>
            ) : (
              <ul className="mt-3 divide-y divide-taupe/50">
                {cartLines.map(({ pick, resolved: r }) => {
                  const warning = blockWarning(r.block, !!r.variant && !r.variant.active);
                  const opts = optionsText(r);
                  return (
                    <li key={pick.key} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-espresso">{r.name!.ar}</p>
                          {opts && <p className="text-xs text-espresso/55">{opts}</p>}
                          <p className="text-xs text-espresso/55">
                            {formatPrice(r.unitPrice, 'ar')} × {pick.qty}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-espresso">
                          {formatPrice(r.unitPrice * pick.qty, 'ar')}
                        </p>
                      </div>
                      {warning && (
                        <p role="status" className="mt-1 flex items-center gap-1 text-xs text-burgundy">
                          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                          تنبيه: {warning} — سيُسجَّل البيع كما هو.
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" aria-label="إنقاص الكمية" onClick={() => setQty(pick.key, pick.qty - 1)} className="inline-flex size-8 items-center justify-center rounded border border-taupe text-espresso hover:border-burgundy">
                          <Minus className="size-3.5" aria-hidden />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={pick.qty}
                          onChange={(e) => setQty(pick.key, Math.floor(Number(e.target.value)) || 1)}
                          aria-label={`الكمية — ${r.name!.ar}`}
                          className="w-16 border border-taupe bg-white px-2 py-1 text-center text-sm text-espresso"
                        />
                        <button type="button" aria-label="زيادة الكمية" onClick={() => setQty(pick.key, pick.qty + 1)} className="inline-flex size-8 items-center justify-center rounded border border-taupe text-espresso hover:border-burgundy">
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                        <button type="button" aria-label={`حذف ${r.name!.ar}`} onClick={() => remove(pick.key)} className="ms-auto inline-flex size-8 items-center justify-center rounded text-espresso/55 hover:text-burgundy">
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {fieldErrors.lines && (
              <p role="alert" className="mt-3 text-xs font-medium text-burgundy">{fieldErrors.lines}</p>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-taupe/60 pt-3">
              <span className="text-sm font-medium text-espresso">الإجمالي</span>
              <span data-testid="in-store-total" className="font-display text-lg font-medium text-espresso">
                {formatPrice(total, 'ar')}
              </span>
            </div>
          </section>

          {/* ---- customer + note ---- */}
          <section aria-labelledby="is-customer" className="rounded border border-taupe/70 bg-white p-5">
            <h3 id="is-customer" className="font-display text-lg text-espresso">بيانات العميل (اختيارية)</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-espresso">
                الاسم
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-sm text-espresso">
                الهاتف
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                  aria-invalid={fieldErrors.phone ? true : undefined}
                  className={`${inputCls} mt-1`}
                />
                {fieldErrors.phone && <span role="alert" className="mt-1 block text-xs font-medium text-burgundy">{fieldErrors.phone}</span>}
              </label>
              <label className="block text-sm text-espresso">
                ملاحظة
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className={`${inputCls} mt-1`}
                />
                {fieldErrors.note && <span role="alert" className="mt-1 block text-xs font-medium text-burgundy">{fieldErrors.note}</span>}
              </label>
            </div>
          </section>

          {error && (
            <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm leading-6 text-espresso">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !!blocked}
            className="w-full rounded bg-burgundy px-5 py-3 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {submitting ? 'جارٍ الحفظ…' : 'حفظ الطلب'}
          </button>
        </div>
      </form>
    </div>
  );
}
