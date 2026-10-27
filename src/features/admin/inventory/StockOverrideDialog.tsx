import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { classifyError } from '../../../lib/persistence/errors';
import { describeInventoryError, newAttemptKey } from './inventoryStore';
import { MIN_OVERRIDE_REASON, parseShortfalls, type Shortfall } from './inventoryOverrides';

// The explicit confirmation behind a stock-override: shows exactly what is short, asks
// for a reason (>= 5 characters) and an explicit tick, and hands the SAME shortfall back
// to the database, which refuses the override if the stock moved since this was shown.
// A retry of the identical request reuses one attempt key; a changed request (new reason,
// or a refreshed shortfall) gets a new one. Every typed value survives a failure.
export function StockOverrideDialog({
  title,
  intro,
  shortfalls,
  nameOf,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  intro: string;
  shortfalls: Shortfall[];
  nameOf: (productId: string) => string;
  confirmLabel: string;
  // Must throw on failure; resolves only after the database confirmed.
  onConfirm: (reason: string, attemptKey: string, confirmed: Shortfall[]) => Promise<void>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(shortfalls);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    reasonRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (reason.trim().length < MIN_OVERRIDE_REASON) {
      setError(`اكتب سببًا من ${MIN_OVERRIDE_REASON} أحرف على الأقل.`);
      return;
    }
    if (!confirmed) {
      setError('أكّد صراحةً أنك تريد المتابعة رغم نقص المخزون.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([reason.trim(), current]);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newAttemptKey() };
      await onConfirm(reason.trim(), attempt.current.key, current);
      onClose();
    } catch (err) {
      const pe = classifyError(err);
      console.error('stock override failed:', pe.code);
      if (pe.code === 'shortfall_changed') {
        // The stock moved since this was shown: show the fresh numbers and require a NEW confirmation.
        const fresh = parseShortfalls(pe.detail);
        if (fresh.length > 0) setCurrent(fresh);
        setConfirmed(false);
      }
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
        aria-label={title}
        onSubmit={submit}
        noValidate
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded border border-burgundy/40 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
            <TriangleAlert className="size-4.5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-lg text-espresso">{title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-espresso/70">{intro}</p>
          </div>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-taupe/60 text-xs text-espresso/55">
              <th className="py-2 text-start font-medium">المنتج</th>
              <th className="py-2 text-start font-medium">المطلوب</th>
              <th className="py-2 text-start font-medium">المتاح</th>
              <th className="py-2 text-start font-medium">النقص</th>
              <th className="py-2 text-start font-medium">الرصيد بعد العملية</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-taupe/40">
            {current.map((s) => (
              <tr key={s.product_id}>
                <td className="py-2 text-espresso">{nameOf(s.product_id)}</td>
                <td className="py-2 text-espresso/80">{s.requested}</td>
                <td className="py-2 text-espresso/80">{s.available}</td>
                <td className="py-2 font-semibold text-burgundy">{s.shortfall}</td>
                <td className="py-2 font-semibold text-burgundy" dir="ltr">{s.available - s.requested}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-3">
          <label className="block text-sm text-espresso">
            سبب التجاوز * (5 أحرف على الأقل — يُسجَّل في سجل التدقيق)
            <input
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="mt-1 w-full border border-taupe bg-white px-3 py-2 text-sm text-espresso focus:border-burgundy focus:outline-1 focus:outline-burgundy"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-espresso">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
            <span>أؤكد المتابعة رغم نقص المخزون، وأن الرصيد سينزل تحت الصفر وأن هذا سيُسجَّل باسمي.</span>
          </label>
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
            {busy ? 'جارٍ التنفيذ…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
