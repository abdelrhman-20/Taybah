import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { LoadingState } from '../../shared/components/LoadingState';
import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';
import { supabaseConfigured } from '../../../lib/supabase/client';
import { checkInventoryAccess, describeInventoryError } from './inventoryStore';
import {
  CLASSIFICATION_LABELS_AR,
  DECISION_LABELS_AR,
  ISSUE_LABELS_AR,
  decideOrder,
  fetchBlockers,
  fetchPreflightRows,
  importOpening,
  parseOpeningCsv,
  type Blocker,
  type ImportReport,
  type OpeningRow,
  type OrderDecision,
  type PreflightRow,
} from './inventoryReconciliation';

// RECONCILIATION BEFORE ACTIVATION. Stock deduction from orders is switched on by applying
// migration 0010 — there is no button here and no flag. This page shows what 0010 will
// refuse to run over (the blockers), lets the admin record the explicit order-by-order
// decisions it needs, and loads the explicit opening balances. It never fills in a value:
// every quantity and every decision is typed or chosen by the admin.

type Load =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'forbidden' }
  | { status: 'unconfigured' }
  | { status: 'schema_missing' }
  | { status: 'error'; message: string };

interface Result {
  load: Load;
  blockers: Blocker[];
  rows: PreflightRow[];
}

async function loadAll(): Promise<Result> {
  if (!supabaseConfigured) return { load: { status: 'unconfigured' }, blockers: [], rows: [] };
  try {
    if ((await checkInventoryAccess()) !== 'admin') return { load: { status: 'forbidden' }, blockers: [], rows: [] };
    const [blockers, rows] = await Promise.all([fetchBlockers(), fetchPreflightRows()]);
    return { load: { status: 'ready' }, blockers, rows };
  } catch (e) {
    const err = classifyError(e);
    console.error('reconciliation load failed:', err.code, err.detail);
    return {
      load: err.code === 'schema_missing' ? { status: 'schema_missing' } : { status: 'error', message: describePersistenceError(err) },
      blockers: [],
      rows: [],
    };
  }
}

const inputCls =
  'w-full border border-taupe bg-white px-3 py-2 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';

interface OrderGroup {
  orderId: string;
  ref: string;
  status: string;
  classification: PreflightRow['classification'];
  issues: string[];
  linesHash: string;
  decision: PreflightRow['decision'];
  matches: boolean | null;
  statusChanged: boolean | null;
  lines: Array<{ productId: string | null; name: string | null; qty: number | null; inCatalog: boolean | null; initialized: boolean | null }>;
}

function groupOrders(rows: PreflightRow[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  for (const r of rows) {
    if (!r.needs_decision) continue;
    let g = map.get(r.order_id);
    if (!g) {
      g = {
        orderId: r.order_id,
        ref: r.ref,
        status: r.status,
        classification: r.classification,
        issues: r.issues ?? [],
        linesHash: r.lines_hash,
        decision: r.decision,
        matches: r.decision_matches_lines,
        statusChanged: r.decision_status_changed,
        lines: [],
      };
      map.set(r.order_id, g);
    }
    if (r.product_id !== null) {
      g.lines.push({ productId: r.product_id, name: r.product_name, qty: r.qty, inCatalog: r.product_in_catalog, initialized: r.stock_initialized });
    }
  }
  return [...map.values()];
}

function DecisionForm({ group, onDone }: { group: OrderGroup; onDone: (m: string) => void }) {
  const [decision, setDecision] = useState<OrderDecision | null>(null); // no default: the admin chooses
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const delivered = group.status === 'delivered';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (decision === null) return setError('اختر القرار أولًا.');
    if (reason.trim().length < 5) return setError('اكتب سببًا من 5 أحرف على الأقل.');
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await decideOrder(group.orderId, decision, reason.trim(), group.linesHash);
      onDone(
        r.status === 'unchanged'
          ? `الطلب ${group.ref}: القرار نفسه مسجَّل مسبقًا.`
          : `الطلب ${group.ref}: سُجِّل القرار «${DECISION_LABELS_AR[decision].title}».`,
      );
    } catch (err) {
      const pe = classifyError(err);
      setError(
        pe.code === 'invalid' && /lines_changed/.test(pe.detail)
          ? 'تغيّرت أسطر الطلب منذ عرضها — أعد تحميل الصفحة وراجع المنتجات والكميات ثم سجّل القرار.'
          : describeInventoryError(err),
      );
      setBusy(false);
      inFlight.current = false;
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-3 rounded border border-taupe/70 bg-porcelain/40 p-3">
      <fieldset>
        <legend className="text-sm font-medium text-espresso">قرار هذا الطلب *</legend>
        {(Object.keys(DECISION_LABELS_AR) as OrderDecision[]).map((d) => (
          <label key={d} className="mt-2 flex items-start gap-2 text-sm text-espresso">
            <input
              type="radio"
              name={`decision-${group.orderId}`}
              checked={decision === d}
              disabled={delivered && d === 'deduct_on_delivery'}
              onChange={() => setDecision(d)}
              className="mt-1"
            />
            <span>
              {DECISION_LABELS_AR[d].title}
              <span className="block text-xs text-espresso/60">{DECISION_LABELS_AR[d].help}</span>
            </span>
          </label>
        ))}
        {delivered && (
          <p className="mt-1 text-xs text-espresso/60">الطلب مُسلَّم بالفعل، فيُقبل له قرار «لا خصم» فقط.</p>
        )}
      </fieldset>
      <label className="mt-3 block text-sm text-espresso">
        السبب * (5 أحرف على الأقل)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label={`سبب قرار الطلب ${group.ref}`} className={`${inputCls} mt-1`} />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-burgundy">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded bg-burgundy px-4 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-60"
      >
        {busy ? 'جارٍ الحفظ…' : 'تسجيل القرار'}
      </button>
    </form>
  );
}

function OpeningImport({ onDone }: { onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [report, setReport] = useState<{ forText: string; data: ImportReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const parsed = useMemo(() => parseOpeningCsv(text), [text]);
  // A real run is only offered for the exact text that passed a clean dry run.
  const dryOk = report !== null && report.forText === text && report.data.dry_run && report.data.rejected === 0 && parsed.errors.length === 0;

  const run = async (dryRun: boolean) => {
    if (inFlight.current) return;
    if (parsed.errors.length > 0) return setError('صحّح أخطاء الأسطر أولًا — لا يُقرأ شيء على أنه صفر.');
    if (parsed.rows.length === 0) return setError('أدخل سطرًا واحدًا على الأقل: معرّف_المنتج،الكمية');
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = await importOpening(parsed.rows as OpeningRow[], dryRun);
      setReport({ forText: text, data });
      if (!dryRun) onDone(`تم الاستيراد: ${data.created} رصيد افتتاحي جديد، ${data.skipped} موجود مسبقًا لم يُمسّ.`);
    } catch (err) {
      setError(describeInventoryError(err));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const statusLabel: Record<string, string> = {
    would_create: 'سيُنشأ',
    already_initialized: 'مُهيَّأ مسبقًا (لن يُمسّ)',
    unknown_product: 'منتج غير موجود في الكتالوج',
    duplicate_in_batch: 'مكرر في الدفعة',
    invalid: 'غير صالح',
  };

  return (
    <section aria-labelledby="rc-import" className="rounded border border-taupe/70 bg-white p-5">
      <h3 id="rc-import" className="font-display text-lg text-espresso">استيراد الأرصدة الافتتاحية</h3>
      <p className="mt-1 text-xs leading-5 text-espresso/65">
        سطر لكل منتج: <span dir="ltr">product_id,quantity</span> (والسبب اختياري). الصفر قرار صريح فاكتبه 0. لا يستبدل الاستيراد
        رصيدًا موجودًا، ولا يملأ المنتجات غير المذكورة بالصفر. يبدأ بفحص تجريبي لا يكتب شيئًا.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        dir="ltr"
        aria-label="الأرصدة الافتتاحية"
        placeholder={'product_id,quantity\nabc123,12\ndef456,0'}
        className={`${inputCls} mt-3 font-mono`}
      />
      {parsed.errors.length > 0 && (
        <ul role="alert" className="mt-2 list-disc ps-5 text-xs text-burgundy">
          {parsed.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-burgundy">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void run(true)} disabled={busy} className="rounded border border-espresso/25 px-4 py-2 text-sm font-medium text-espresso hover:border-espresso disabled:opacity-60">
          فحص تجريبي
        </button>
        <button type="button" onClick={() => void run(false)} disabled={busy || !dryOk} className="rounded bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy/90 disabled:opacity-50">
          تنفيذ الاستيراد
        </button>
      </div>
      {report && (
        <div className="mt-4 text-sm text-espresso" aria-live="polite">
          <p>
            {report.data.dry_run ? 'نتيجة الفحص التجريبي (لم يُكتب شيء)' : 'نتيجة التنفيذ'}: {report.data.created} {report.data.dry_run ? 'سيُنشأ' : 'أُنشئ'} ·{' '}
            {report.data.skipped} موجود مسبقًا · {report.data.rejected} مرفوض.
          </p>
          <ul className="mt-2 divide-y divide-taupe/40 text-xs">
            {report.data.rows.map((r, i) => (
              <li key={`${r.product_id}-${i}`} className="flex justify-between gap-3 py-1.5">
                <span dir="ltr">{r.product_id ?? '—'}</span>
                <span className={r.status === 'would_create' || r.status === 'already_initialized' ? 'text-espresso/70' : 'font-medium text-burgundy'}>
                  {statusLabel[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
          {report.data.catalog_products_not_in_batch_and_uninitialized > 0 && (
            <p className="mt-2 text-xs text-burgundy">
              {report.data.catalog_products_not_in_batch_and_uninitialized} منتجًا في الكتالوج بلا رصيد وغير مذكور في هذه الدفعة (لن يُملأ بالصفر
              تلقائيًا){report.data.catalog_products_not_in_batch_sample.length > 0 ? ` — منها: ${report.data.catalog_products_not_in_batch_sample.slice(0, 10).join('، ')}` : ''}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function InventoryReconciliationPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [nonce, setNonce] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAll().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const load: Load = result?.load ?? { status: 'loading' };
  const blockers = useMemo(() => result?.blockers ?? [], [result]);
  const groups = useMemo(() => groupOrders(result?.rows ?? []), [result]);
  const refresh = (m: string) => {
    setMessage(m);
    setNonce((n) => n + 1);
  };

  const byCategory = useMemo(() => {
    const m = new Map<string, Blocker[]>();
    for (const b of blockers) m.set(b.category, [...(m.get(b.category) ?? []), b]);
    return [...m.entries()];
  }, [blockers]);
  const CATEGORY_AR: Record<string, string> = { coverage: 'منتجات بلا رصيد افتتاحي', decision: 'قرارات الطلبات', integrity: 'سلامة السجل' };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/admin/inventory" className="inline-flex items-center gap-2 text-sm font-medium text-espresso/60 transition hover:text-burgundy">
        <ArrowRight className="size-4" aria-hidden /> المخزون
      </Link>
      <div className="mt-4">
        <AdminPageHeader
          title="تسوية الجرد قبل التفعيل"
          description="خصم المخزون من الطلبات يبدأ بتطبيق الترحيل 0010 نفسه — لا يوجد زر ولا مفتاح هنا. هذه الصفحة تعرض ما سيمنع الترحيل من العمل، وتسجّل قرارات الطلبات والأرصدة الافتتاحية التي يطلبها. لا شيء يُخمَّن: كل كمية وكل قرار منك."
        />
      </div>

      {load.status === 'loading' && <LoadingState label="جارٍ تحميل التسوية…" />}
      {load.status === 'forbidden' && (
        <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">ليست لديك صلاحية — سجّل الدخول بحساب مسؤول.</p>
      )}
      {load.status === 'unconfigured' && (
        <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">الاتصال بقاعدة البيانات غير مُعدّ في هذا الإصدار.</p>
      )}
      {load.status === 'schema_missing' && (
        <p role="alert" className="rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm leading-6 text-espresso">
          دوال التسوية غير موجودة: الترحيل <span dir="ltr">0009_inventory.sql</span> لم يُطبَّق بعد (راجع <span dir="ltr">docs/INVENTORY_SETUP.md</span>).
        </p>
      )}
      {load.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso">
          <span className="flex-1">تعذّر تحميل التسوية — {load.message}</span>
          <button type="button" onClick={() => setNonce((n) => n + 1)} className="rounded border border-espresso/25 px-4 py-1.5 text-xs font-medium text-espresso hover:border-espresso">إعادة المحاولة</button>
        </div>
      )}

      {load.status === 'ready' && (
        <div className="space-y-6">
          {message && (
            <p role="status" className="rounded border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-espresso">
              {message}
            </p>
          )}

          <section aria-labelledby="rc-blockers" className="rounded border border-taupe/70 bg-white p-5">
            <h3 id="rc-blockers" className="font-display text-lg text-espresso">عوائق التفعيل</h3>
            {blockers.length === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-espresso">
                <CheckCircle2 className="size-4 text-gold" aria-hidden />
                لا توجد عوائق: لن يرفض الترحيل 0010 العمل بسبب التسوية. (التفعيل نفسه ما زال قرارك وإجراءً منفصلًا.)
              </p>
            ) : (
              <>
                <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-burgundy">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{blockers.length} عائقًا يمنع تطبيق الترحيل 0010 — يرفض العمل (دون تغيير أي شيء) حتى تُحَل كلها.</span>
                </p>
                {byCategory.map(([cat, list]) => (
                  <div key={cat} className="mt-3">
                    <h4 className="text-sm font-medium text-espresso">{CATEGORY_AR[cat] ?? cat} ({list.length})</h4>
                    <ul className="mt-1 divide-y divide-taupe/40 text-xs">
                      {list.slice(0, 50).map((b, i) => (
                        <li key={`${b.code}-${b.order_id}-${b.product_id}-${i}`} className="py-1.5">
                          <span className="font-mono text-burgundy" dir="ltr">{b.code}</span> — {b.detail}
                          {b.product_id && <span className="text-espresso/55" dir="ltr"> [{b.product_id}]</span>}
                        </li>
                      ))}
                    </ul>
                    {list.length > 50 && <p className="mt-1 text-xs text-espresso/55">…و{list.length - 50} أخرى.</p>}
                  </div>
                ))}
              </>
            )}
          </section>

          <section aria-labelledby="rc-orders" className="rounded border border-taupe/70 bg-white p-5">
            <h3 id="rc-orders" className="font-display text-lg text-espresso">طلبات تحتاج قرارًا صريحًا ({groups.length})</h3>
            <p className="mt-1 text-xs leading-5 text-espresso/65">
              كل طلب لم ينتهِ بعد (أو سجل حالاته غامض) يحتاج قرارًا على مستوى الطلب. يُعرض لكل طلب كل منتجاته وكمياته، والقرار مربوط بهذه الأسطر بالضبط.
            </p>
            {groups.length === 0 ? (
              <p className="mt-3 text-sm text-espresso/65">لا توجد طلبات تحتاج قرارًا.</p>
            ) : (
              <ul className="mt-3 space-y-4">
                {groups.map((g) => (
                  <li key={g.orderId} className="rounded border border-taupe/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm font-medium text-espresso" dir="ltr">{g.ref}</span>
                      <span className="text-xs text-espresso/65">
                        الحالة: {g.status} · {CLASSIFICATION_LABELS_AR[g.classification]}
                      </span>
                    </div>
                    {g.issues.length > 0 && (
                      <p className="mt-1 text-xs text-burgundy">
                        ملاحظات: {g.issues.map((i) => ISSUE_LABELS_AR[i] ?? i).join('، ')}
                      </p>
                    )}
                    <table className="mt-2 w-full text-sm">
                      <thead>
                        <tr className="text-xs text-espresso/55">
                          <th className="py-1 text-start font-medium">المنتج</th>
                          <th className="py-1 text-start font-medium">الكمية</th>
                          <th className="py-1 text-start font-medium">في الكتالوج</th>
                          <th className="py-1 text-start font-medium">رصيد افتتاحي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-taupe/40">
                        {g.lines.map((l) => (
                          <tr key={l.productId}>
                            <td className="py-1.5">{l.name ?? l.productId}<span className="ms-2 text-xs text-espresso/50" dir="ltr">{l.productId}</span></td>
                            <td className="py-1.5">{l.qty}</td>
                            <td className="py-1.5">{l.inCatalog ? 'نعم' : <span className="text-burgundy">لا (محذوف)</span>}</td>
                            <td className="py-1.5">{l.initialized ? 'نعم' : <span className="text-burgundy">لا</span>}</td>
                          </tr>
                        ))}
                        {g.lines.length === 0 && (
                          <tr><td colSpan={4} className="py-1.5 text-xs text-burgundy">لا توجد أسطر مقروءة لهذا الطلب.</td></tr>
                        )}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs">
                      {g.decision === null || g.decision === 'settled_legacy' ? (
                        <span className="font-medium text-burgundy">لا يوجد قرار صريح.</span>
                      ) : (
                        <span className="text-espresso/75">
                          القرار الحالي: {DECISION_LABELS_AR[g.decision].title}
                          {g.matches === false && <strong className="text-burgundy"> — تغيّرت الأسطر بعده</strong>}
                          {g.statusChanged && <strong className="text-burgundy"> — تغيّرت الحالة بعده</strong>}
                        </span>
                      )}
                    </p>
                    <DecisionForm group={g} onDone={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <OpeningImport onDone={refresh} />
        </div>
      )}
    </div>
  );
}
