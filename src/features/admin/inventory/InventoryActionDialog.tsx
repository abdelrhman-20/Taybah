import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import {
  adjustStock,
  describeInventoryError,
  newAttemptKey,
  receiveStock,
  recordStockReturn,
  setLowThreshold,
  setOpeningBalance,
  type InventoryResult,
} from './inventoryStore';
import { classifyError } from '../../../lib/persistence/errors';

export type InventoryAction = 'opening' | 'adjust' | 'receive' | 'return' | 'threshold';

export interface ReturnOrderOption {
  id: string;
  label: string;
}

const TITLES: Record<InventoryAction, string> = {
  opening: 'تهيئة الرصيد الافتتاحي',
  adjust: 'تعديل الكمية',
  receive: 'تسجيل وارد',
  return: 'تسجيل مرتجع',
  threshold: 'الحد الأدنى للمخزون',
};

const SUBMIT: Record<InventoryAction, string> = {
  opening: 'تهيئة الرصيد',
  adjust: 'حفظ التعديل',
  receive: 'تسجيل الوارد',
  return: 'تسجيل المرتجع',
  threshold: 'حفظ الحد الأدنى',
};

const inputCls =
  'w-full border border-taupe bg-white px-3 py-2 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';

// Whole non-negative number or NaN.
const parseWhole = (s: string): number => (/^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : NaN);

// Every stock change here goes through an approved SECURITY DEFINER RPC (see
// inventoryStore.ts). The dialog reports success ONLY after the database answered,
// keeps every typed value on failure, and reuses one idempotency key for retries of
// the identical request (a changed request gets a new key).
export function InventoryActionDialog({
  action,
  productId,
  productName,
  sku,
  onHand,
  threshold,
  orders,
  onClose,
  onDone,
}: {
  action: InventoryAction;
  productId: string;
  productName: string;
  sku: string;
  // null = the product has no initialized balance
  onHand: number | null;
  threshold: number;
  orders: ReturnOrderOption[];
  onClose: () => void;
  // Called with the confirmed outcome message; the page reloads the balances.
  onDone: (message: string) => Promise<void> | void;
}) {
  const [qty, setQty] = useState(action === 'threshold' ? String(threshold) : action === 'adjust' ? String(onHand ?? 0) : '');
  const [reason, setReason] = useState(
    action === 'opening' ? 'رصيد افتتاحي' : action === 'receive' ? 'استلام مخزون' : '',
  );
  const [reference, setReference] = useState('');
  const [resellable, setResellable] = useState<'yes' | 'no' | null>(null); // no default on purpose
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    firstRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = parseWhole(qty);
  const current = onHand ?? 0;

  const preview = (() => {
    if (Number.isNaN(n)) return null;
    if (action === 'adjust') {
      const d = n - current;
      return d === 0 ? `لا تغيير — الرصيد الحالي ${current}.` : `الرصيد ${current} ← ${n} (الفرق ${d > 0 ? '+' : ''}${d}).`;
    }
    if (action === 'receive') return `الرصيد ${current} ← ${current + n}.`;
    if (action === 'return' && resellable === 'yes') return `مرتجع سليم: الرصيد ${current} ← ${current + n}.`;
    if (action === 'return' && resellable === 'no')
      return `مرتجع تالف: لن يتغيّر الرصيد (${current})، ويُسجَّل في سجل الحركات فقط.`;
    return null;
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;

    const min = action === 'receive' || action === 'return' ? 1 : 0;
    if (Number.isNaN(n) || n < min) {
      setError(
        action === 'threshold'
          ? 'أدخل الحد الأدنى كعدد صحيح (صفر أو أكثر).'
          : min === 1
            ? 'أدخل كمية صحيحة (1 أو أكثر).'
            : 'أدخل كمية صحيحة (صفر أو أكثر).',
      );
      return;
    }
    if (action !== 'threshold' && reason.trim().length < 3) {
      setError('اكتب سببًا من 3 أحرف على الأقل.');
      return;
    }
    if (action === 'return' && resellable === null) {
      setError('اختر هل المرتجع صالح لإعادة البيع أم تالف.');
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([action, productId, n, reason.trim(), reference.trim(), resellable, orderId]);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newAttemptKey() };
      const key = attempt.current.key;

      let r: InventoryResult;
      if (action === 'opening') r = await setOpeningBalance(productId, n, reason.trim());
      else if (action === 'adjust') r = await adjustStock(productId, n, reason.trim(), key);
      else if (action === 'receive')
        r = await receiveStock(productId, n, reference.trim() === '' ? null : reference.trim(), reason.trim(), key);
      else if (action === 'return')
        r = await recordStockReturn(productId, n, resellable === 'yes', reason.trim(), orderId === '' ? null : orderId, key);
      else r = await setLowThreshold(productId, n);

      await onDone(outcomeMessage(action, productName, r, n));
      onClose();
    } catch (err) {
      console.error('inventory action failed:', classifyError(err).code, classifyError(err).detail);
      setError(describeInventoryError(err));
      setBusy(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4" role="presentation">
      <button type="button" aria-label="إغلاق" onClick={() => !busy && onClose()} className="absolute inset-0 bg-espresso/50" />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[action]}
        onSubmit={submit}
        noValidate
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded border border-taupe bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg text-espresso">{TITLES[action]}</h3>
            <p className="mt-1 text-sm text-espresso/65">{productName}</p>
            <p className="text-xs text-espresso/50" dir="ltr">{sku}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="إغلاق النافذة" className="rounded p-1 text-espresso/60 hover:text-burgundy">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {onHand !== null && action !== 'opening' && (
            <p className="text-sm text-espresso/70">
              الرصيد الحالي: <strong className="text-espresso">{onHand}</strong>
            </p>
          )}

          {action === 'return' && (
            <fieldset className="rounded border border-taupe p-3">
              <legend className="px-1 text-sm font-medium text-espresso">حالة المرتجع *</legend>
              <label className="flex items-start gap-2 py-1 text-sm text-espresso">
                <input type="radio" name="resellable" checked={resellable === 'yes'} onChange={() => setResellable('yes')} className="mt-1" />
                <span>صالح لإعادة البيع — يُضاف إلى المخزون</span>
              </label>
              <label className="flex items-start gap-2 py-1 text-sm text-espresso">
                <input type="radio" name="resellable" checked={resellable === 'no'} onChange={() => setResellable('no')} className="mt-1" />
                <span>تالف — لا يُضاف إلى المخزون ويُسجَّل في السجل فقط</span>
              </label>
            </fieldset>
          )}

          <label className="block text-sm text-espresso">
            {action === 'opening' && 'الرصيد الافتتاحي (الكمية الفعلية الآن) *'}
            {action === 'adjust' && 'الكمية المعدودة فعليًا *'}
            {action === 'receive' && 'الكمية الواردة *'}
            {action === 'return' && 'كمية المرتجع *'}
            {action === 'threshold' && 'الحد الأدنى للتنبيه *'}
            <input
              ref={firstRef}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              className={`${inputCls} mt-1`}
            />
          </label>
          {action === 'threshold' && (
            <p className="text-xs leading-5 text-espresso/60">
              يظهر تنبيه «منخفض» حين يصل الرصيد إلى هذا الحد أو أقل. الصفر يعطّل تنبيه المنخفض (يبقى تنبيه «نفد»).
            </p>
          )}

          {action === 'receive' && (
            <label className="block text-sm text-espresso">
              المرجع (اختياري، مثل رقم الفاتورة)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={`${inputCls} mt-1`} />
            </label>
          )}

          {action === 'return' && (
            <label className="block text-sm text-espresso">
              الطلب (اختياري)
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">بدون ربط بطلب</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-espresso/55">عند الربط لا يمكن أن يتجاوز المرتجع الكمية المباعة في الطلب.</span>
            </label>
          )}

          {action !== 'threshold' && (
            <label className="block text-sm text-espresso">
              السبب *
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${inputCls} mt-1`} />
            </label>
          )}

          {preview && <p className="rounded bg-porcelain px-3 py-2 text-xs text-espresso/75">{preview}</p>}
          {error && (
            <p role="alert" className="text-sm font-medium text-burgundy">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso">
            إلغاء
          </button>
          <button type="submit" disabled={busy} className="rounded bg-burgundy px-5 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-burgundy">
            {busy ? 'جارٍ الحفظ…' : SUBMIT[action]}
          </button>
        </div>
      </form>
    </div>
  );
}

// The message shown after the DATABASE confirmed — describing what it actually did,
// not what was asked (e.g. an opening that already existed is reported as such).
function outcomeMessage(action: InventoryAction, name: string, r: InventoryResult, n: number): string {
  switch (r.status) {
    case 'exists':
      return `«${name}»: الرصيد مُهيَّأ مسبقًا ويساوي ${r.on_hand} — لم يتغيّر (المطلوب ${r.requested}). استخدم «تعديل الكمية» للتصحيح.`;
    case 'unchanged':
      return `«${name}»: لا تغيير — الكمية المعدودة تساوي الرصيد الحالي (${r.on_hand}).`;
    case 'replayed':
      return `«${name}»: سُجِّلت هذه العملية سابقًا ولم تُكرَّر (الرصيد ${r.qty_after}).`;
    case 'updated':
      return `«${name}»: تم ضبط الحد الأدنى على ${r.low_threshold}.`;
    case 'created':
      return `«${name}»: تمت تهيئة الرصيد الافتتاحي (${r.on_hand}).`;
    default:
      break;
  }
  switch (r.kind) {
    case 'adjustment':
      return `«${name}»: تم تعديل الرصيد من ${r.qty_before} إلى ${r.qty_after} (${(r.qty_delta ?? 0) > 0 ? '+' : ''}${r.qty_delta}).`;
    case 'receipt':
      return `«${name}»: تم تسجيل وارد +${r.quantity} — الرصيد ${r.qty_after}.`;
    case 'return_restock':
      return `«${name}»: تم تسجيل مرتجع سليم +${r.quantity} — الرصيد ${r.qty_after}.`;
    case 'return_damaged':
      return `«${name}»: تم تسجيل مرتجع تالف (${r.quantity}) — لم يتغيّر الرصيد (${r.qty_after}).`;
    default:
      return `«${name}»: تم الحفظ (${action}، ${n}).`;
  }
}
