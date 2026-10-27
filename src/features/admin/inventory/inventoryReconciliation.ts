import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';

// ADMIN-ONLY reconciliation tooling for the moment BEFORE migration 0010 activates stock
// deduction: the activation blockers, the order-by-order decisions and the opening-balance
// import. It only calls the approved admin RPCs of 0009 (never a table), and it never
// invents a value: every quantity and every decision comes from the admin.

export interface Blocker {
  code: string;
  category: string;
  order_id: string | null;
  product_id: string | null;
  detail: string;
}

export interface PreflightRow {
  order_id: string;
  ref: string;
  status: string;
  source: string;
  order_created_at: string;
  classification: 'in_flight' | 'ambiguous' | 'clean_settled';
  issues: string[];
  lines_hash: string;
  needs_decision: boolean;
  decision: 'deduct_on_delivery' | 'already_accounted' | 'settled_legacy' | null;
  decision_matches_lines: boolean | null;
  decision_status_changed: boolean | null;
  product_id: string | null;
  product_name: string | null;
  qty: number | null;
  product_in_catalog: boolean | null;
  stock_initialized: boolean | null;
}

export type OrderDecision = 'deduct_on_delivery' | 'already_accounted';

async function rows<T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> {
  try {
    if (!supabaseConfigured) throw new PersistenceError('unconfigured');
    const { data, error } = await withTimeout(supabase.rpc(name, args));
    if (error) throw classifyError(error);
    if (!Array.isArray(data)) throw new PersistenceError('verify_failed', `${name}: unexpected response`);
    return data as T[];
  } catch (e) {
    throw classifyError(e);
  }
}

export const fetchBlockers = () => rows<Blocker>('inventory_activation_blockers');
export const fetchPreflightRows = () => rows<PreflightRow>('inventory_preflight_report');

export interface DecisionResult {
  status: 'recorded' | 'unchanged';
  decision_id: string;
  decision: OrderDecision;
}

// Order-level decision, bound to the exact lines (lines_hash) the admin was shown: the
// database refuses it if the order's lines are different now.
export async function decideOrder(
  orderId: string,
  decision: OrderDecision,
  reason: string,
  linesHash: string,
): Promise<DecisionResult> {
  try {
    if (!supabaseConfigured) throw new PersistenceError('unconfigured');
    const { data, error } = await withTimeout(
      supabase.rpc('inventory_decide_order', {
        p_order_id: orderId,
        p_decision: decision,
        p_reason: reason,
        p_lines_hash: linesHash,
      }),
    );
    if (error) throw classifyError(error);
    const r = data as DecisionResult | null;
    if (!r || (r.status !== 'recorded' && r.status !== 'unchanged')) {
      throw new PersistenceError('verify_failed', 'unexpected response');
    }
    return r;
  } catch (e) {
    throw classifyError(e);
  }
}

export interface OpeningRow {
  product_id: string;
  quantity: number;
  reason?: string;
}

export interface ImportReport {
  dry_run: boolean;
  created: number;
  skipped: number;
  rejected: number;
  rows: Array<{ product_id: string | null; quantity: unknown; status: string }>;
  catalog_products_not_in_batch_and_uninitialized: number;
  catalog_products_not_in_batch_sample: string[];
}

// Dry run (default) writes NOTHING. A real run never overwrites an existing balance and
// never fills products that are missing from the batch with zero.
export async function importOpening(rowsIn: OpeningRow[], dryRun: boolean): Promise<ImportReport> {
  try {
    if (!supabaseConfigured) throw new PersistenceError('unconfigured');
    const { data, error } = await withTimeout(
      supabase.rpc('inventory_import_opening', { p_rows: rowsIn, p_dry_run: dryRun }),
    );
    if (error) throw classifyError(error);
    const r = data as ImportReport | null;
    if (!r || typeof r.dry_run !== 'boolean' || !Array.isArray(r.rows)) {
      throw new PersistenceError('verify_failed', 'unexpected response');
    }
    return r;
  } catch (e) {
    throw classifyError(e);
  }
}

// CSV / pasted text: `product_id,quantity[,reason]` per line. Blank lines and lines starting
// with # are ignored; a first line starting with "product_id" is a header. A quantity must be a
// whole number — an empty or non-numeric one is an ERROR, never read as zero.
export function parseOpeningCsv(text: string): { rows: OpeningRow[]; errors: string[] } {
  const out: OpeningRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let seenData = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (!seenData && /^product_id\s*,/i.test(line)) {
      seenData = true;
      return;
    }
    seenData = true;
    const parts = line.split(',');
    const productId = (parts[0] ?? '').trim();
    const qtyText = (parts[1] ?? '').trim();
    const reason = parts.slice(2).join(',').trim();
    if (productId === '') {
      errors.push(`سطر ${i + 1}: معرّف المنتج فارغ.`);
      return;
    }
    if (!/^\d{1,9}$/.test(qtyText)) {
      errors.push(`سطر ${i + 1}: الكمية «${qtyText}» ليست عددًا صحيحًا (الصفر يُكتب 0 صراحةً).`);
      return;
    }
    out.push({ product_id: productId, quantity: Number(qtyText), ...(reason ? { reason } : {}) });
  });
  return { rows: out, errors };
}

export const CLASSIFICATION_LABELS_AR: Record<PreflightRow['classification'], string> = {
  in_flight: 'قيد التنفيذ',
  ambiguous: 'غامض (سجل حالات ناقص أو متناقض)',
  clean_settled: 'منتهٍ وسجله سليم',
};

export const ISSUE_LABELS_AR: Record<string, string> = {
  NO_HISTORY: 'لا سجل حالات',
  FIRST_STATUS_UNEXPECTED: 'أول حالة غير متوقعة',
  LAST_STATUS_MISMATCH: 'آخر حالة في السجل لا تطابق الحالية',
  DELIVERED_WITHOUT_ROW: 'مُسلَّم بلا سجل تسليم',
  DUPLICATE_CONSECUTIVE: 'حالتان متتاليتان متطابقتان',
  TIMESTAMP_TIE: 'تساوٍ في أوقات السجل',
  TIMESTAMP_RANGE: 'وقت خارج عمر الطلب',
  REENTERED_DELIVERED: 'خرج من التسليم وعاد إليه',
  UNKNOWN_STATUS: 'حالة غير معروفة',
  LINES_UNPARSEABLE: 'أسطر لا تُقرأ كمنتج وكمية',
};

export const DECISION_LABELS_AR: Record<OrderDecision, { title: string; help: string }> = {
  deduct_on_delivery: {
    title: 'بضاعة الطلب محسوبة داخل الرصيد الافتتاحي — تُخصم عند التسليم',
    help: 'اختره إن كانت بضاعة هذا الطلب موجودة في عدّ المخزن (أو أضفتها إلى الرصيد الافتتاحي) فيُخصم رصيدها عند تسليم الطلب.',
  },
  already_accounted: {
    title: 'بضاعة الطلب غير محسوبة في الرصيد (خرجت وعُدَّت خارجه) — لا خصم عند التسليم',
    help: 'اختره إن كانت البضاعة قد خرجت فعلًا ولم تُضَف إلى الرصيد الافتتاحي، فلا يُخصم شيء عند التسليم ويُسجَّل أثر تدقيق فقط.',
  },
};
