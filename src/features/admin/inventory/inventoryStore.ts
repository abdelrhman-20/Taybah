import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import {
  PersistenceError,
  classifyError,
  describePersistenceError,
  withTimeout,
} from '../../../lib/persistence/errors';
import { generateId } from '../../shared/utils/id';

// ADMIN-ONLY inventory gateway (tables and RPCs of supabase/migrations/0009_inventory.sql).
//
//  • READS: stock_levels, stock_movements and the private wholesale prices — all
//    admin-only under RLS; a non-admin session just gets no rows, so callers first
//    ask the database whether the session is an admin (checkInventoryAccess).
//  • WRITES: ONLY through the approved SECURITY DEFINER RPCs below. This module
//    never inserts, updates or deletes an inventory table directly (the database
//    grants no such privilege to any API role either).
//  • Every RPC resolves only with the database's own answer; a failure throws a
//    PersistenceError and nothing is reported as saved.
//
// Must only be imported from the admin dashboard: quantities and wholesale prices
// must never reach a storefront code path (guarded by inventoryExposure.test.ts).

export const STOCK_KINDS = [
  'opening',
  'receipt',
  'sale',
  'sale_accounted',
  'return_restock',
  'return_damaged',
  'adjustment',
] as const;
export type StockKind = (typeof STOCK_KINDS)[number];

export const STOCK_KIND_LABELS_AR: Record<StockKind, string> = {
  opening: 'رصيد افتتاحي',
  receipt: 'وارد',
  sale: 'بيع',
  sale_accounted: 'بيع محتسب مسبقًا',
  return_restock: 'مرتجع سليم',
  return_damaged: 'مرتجع تالف',
  adjustment: 'تعديل',
};

export interface StockLevel {
  productId: string;
  onHand: number;
  lowThreshold: number;
  productName: string | null;
  productSku: string | null;
}

export interface StockMovement {
  id: string;
  seq: number;
  productId: string;
  productName: string | null;
  productSku: string | null;
  kind: StockKind;
  quantity: number;
  qtyDelta: number;
  qtyBefore: number;
  qtyAfter: number;
  reason: string;
  reference: string | null;
  orderId: string | null;
  override: boolean;
  actor: string | null;
  actorEmail: string | null;
  createdAt: string;
}

interface LevelRow {
  product_id: string;
  on_hand: number;
  low_threshold: number;
  product_name: string | null;
  product_sku: string | null;
}

interface MovementRow {
  id: string;
  seq: number;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  kind: StockKind;
  quantity: number;
  qty_delta: number;
  qty_before: number;
  qty_after: number;
  reason: string;
  reference: string | null;
  order_id: string | null;
  override: boolean;
  actor: string | null;
  actor_email: string | null;
  created_at: string;
}

const PAGE = 1000;
const LEVEL_COLS = 'product_id, on_hand, low_threshold, product_name, product_sku';
const MOVEMENT_COLS =
  'id, seq, product_id, product_name, product_sku, kind, quantity, qty_delta, qty_before, qty_after, reason, reference, order_id, override, actor, actor_email, created_at';

function fromLevel(r: LevelRow): StockLevel {
  return {
    productId: r.product_id,
    onHand: Number(r.on_hand),
    lowThreshold: Number(r.low_threshold),
    productName: r.product_name,
    productSku: r.product_sku,
  };
}

function fromMovement(r: MovementRow): StockMovement {
  return {
    id: r.id,
    seq: Number(r.seq),
    productId: r.product_id,
    productName: r.product_name,
    productSku: r.product_sku,
    kind: r.kind,
    quantity: Number(r.quantity),
    qtyDelta: Number(r.qty_delta),
    qtyBefore: Number(r.qty_before),
    qtyAfter: Number(r.qty_after),
    reason: r.reason,
    reference: r.reference,
    orderId: r.order_id,
    override: Boolean(r.override),
    actor: r.actor,
    actorEmail: r.actor_email,
    createdAt: r.created_at,
  };
}

// ---- access ----------------------------------------------------------------

// The inventory tables are admin-only under RLS, so a signed-in NON-admin does not
// get an error — it gets an empty list, which would be indistinguishable from "no
// stock initialized yet". Ask the database the same question the policies ask.
export async function checkInventoryAccess(): Promise<'admin' | 'not_admin'> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  const { data, error } = await withTimeout(supabase.rpc('is_admin'));
  if (error) throw classifyError(error);
  return data === true ? 'admin' : 'not_admin';
}

// ---- reads -----------------------------------------------------------------

export async function fetchStockLevels(): Promise<StockLevel[]> {
  const out: StockLevel[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(
      supabase
        .from('stock_levels')
        .select(LEVEL_COLS)
        .order('product_id', { ascending: true })
        .range(from, from + PAGE - 1),
    );
    if (error) throw classifyError(error);
    const rows = (data ?? []) as unknown as LevelRow[];
    out.push(...rows.map(fromLevel));
    if (rows.length < PAGE) return out;
  }
}

// Admin-only wholesale prices (product_internal_pricing, migration 0007) keyed by
// product id. Never part of the catalog documents.
export async function fetchWholesalePrices(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(
      supabase
        .from('product_internal_pricing')
        .select('product_id, wholesale_price')
        .order('product_id', { ascending: true })
        .range(from, from + PAGE - 1),
    );
    if (error) throw classifyError(error);
    const rows = (data ?? []) as unknown as Array<{ product_id: string; wholesale_price: number | string }>;
    for (const r of rows) {
      const n = Number(r.wholesale_price);
      if (Number.isFinite(n)) out.set(r.product_id, n);
    }
    if (rows.length < PAGE) return out;
  }
}

export interface MovementFilters {
  productId?: string;
  kind?: StockKind;
  // ISO timestamps (inclusive)
  from?: string;
  to?: string;
}

// Newest first. Fetches one row more than asked so the caller knows whether a
// next page exists without a count query.
export async function fetchMovements(
  filters: MovementFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: StockMovement[]; hasMore: boolean }> {
  let query = supabase.from('stock_movements').select(MOVEMENT_COLS).order('seq', { ascending: false });
  if (filters.productId) query = query.eq('product_id', filters.productId);
  if (filters.kind) query = query.eq('kind', filters.kind);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);
  const start = page * pageSize;
  const { data, error } = await withTimeout(query.range(start, start + pageSize));
  if (error) throw classifyError(error);
  const rows = ((data ?? []) as unknown as MovementRow[]).map(fromMovement);
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

// ---- writes: RPCs only ------------------------------------------------------

export type InventoryResultStatus = 'created' | 'exists' | 'recorded' | 'replayed' | 'unchanged' | 'updated' | 'delivered';

export interface InventoryResult {
  status: InventoryResultStatus;
  product_id?: string;
  on_hand?: number;
  requested?: number;
  low_threshold?: number;
  movement_id?: string;
  kind?: StockKind;
  quantity?: number;
  qty_delta?: number;
  qty_before?: number;
  qty_after?: number;
  // shortage-override operations (migration 0010)
  order_id?: string;
  deductions?: Array<{ product_id: string; quantity: number; qty_before: number; qty_after: number; override: boolean; shortfall: number }>;
}

const STATUSES: InventoryResultStatus[] = ['created', 'exists', 'recorded', 'replayed', 'unchanged', 'updated', 'delivered'];

export async function callRpc(name: string, args: Record<string, unknown>): Promise<InventoryResult> {
  try {
    if (!supabaseConfigured) throw new PersistenceError('unconfigured');
    const { data, error } = await withTimeout(supabase.rpc(name, args));
    if (error) throw classifyError(error);
    const r = data as InventoryResult | null;
    if (!r || typeof r !== 'object' || !STATUSES.includes(r.status)) {
      // An answer that is not the documented shape is never reported as saved.
      throw new PersistenceError('verify_failed', `${name}: unexpected response`);
    }
    return r;
  } catch (e) {
    throw classifyError(e);
  }
}

// A fresh idempotency key per ATTEMPT (UUID: letters, digits, hyphen — accepted by
// the database's key format). The dialog keeps it across retries of the identical
// request and replaces it when the request changes.
export const newAttemptKey = (): string => generateId();

export const setOpeningBalance = (productId: string, quantity: number, reason: string) =>
  callRpc('inventory_set_opening', { p_product_id: productId, p_quantity: quantity, p_reason: reason });

export const adjustStock = (productId: string, counted: number, reason: string, key: string) =>
  callRpc('inventory_adjust', {
    p_product_id: productId,
    p_counted: counted,
    p_reason: reason,
    p_idempotency_key: key,
  });

export const receiveStock = (
  productId: string,
  quantity: number,
  reference: string | null,
  reason: string,
  key: string,
) =>
  callRpc('inventory_receive', {
    p_product_id: productId,
    p_quantity: quantity,
    p_reference: reference,
    p_reason: reason,
    p_idempotency_key: key,
  });

// `resellable` has no default: the admin must choose (the database rejects null).
export const recordStockReturn = (
  productId: string,
  quantity: number,
  resellable: boolean,
  reason: string,
  orderId: string | null,
  key: string,
) =>
  callRpc('inventory_record_return', {
    p_product_id: productId,
    p_quantity: quantity,
    p_resellable: resellable,
    p_reason: reason,
    p_order_id: orderId,
    p_idempotency_key: key,
  });

export const setLowThreshold = (productId: string, threshold: number) =>
  callRpc('inventory_set_threshold', { p_product_id: productId, p_threshold: threshold });

// ---- messages ----------------------------------------------------------------

// Arabic, admin-facing. Only the database's own validation details are translated;
// every other failure keeps the generic, accurate message.
export function describeInventoryError(e: unknown): string {
  const err = classifyError(e);
  if (err.code === 'invalid') {
    const d = err.detail.toLowerCase();
    if (/price_mismatch|total_mismatch/.test(d))
      return 'تغيّر سعر أحد المنتجات أثناء التحرير. أعد تحميل الصفحة لرؤية الأسعار الحالية ثم أعد المحاولة — لم يُحفظ الطلب.';
    if (d.includes('unknown product'))
      return 'المنتج غير موجود في كتالوج قاعدة البيانات — أكمل ترحيل الكتالوج أولًا. لم يُحفظ شيء.';
    if (d.includes('exceeds the sold quantity'))
      return 'كمية المرتجع تتجاوز الكمية المباعة في هذا الطلب (الصالح والتالف معًا). لم يُسجَّل شيء.';
    if (d.includes('not part of that order'))
      return 'هذا المنتج ليس ضمن الطلب المختار. لم يُسجَّل شيء.';
    if (d.includes('unknown order')) return 'الطلب المختار غير موجود. لم يُسجَّل شيء.';
    if (d.includes('out of range')) return 'الكمية الناتجة خارج الحد المسموح. لم يُسجَّل شيء.';
    if (d.includes('reason of at least')) return 'اكتب سببًا من 3 أحرف على الأقل.';
    if (d.includes('choose whether')) return 'اختر هل المرتجع صالح لإعادة البيع أم تالف.';
    if (d.includes('quantity') || d.includes('threshold'))
      return 'قيمة غير صالحة — أدخل عددًا صحيحًا ضمن الحدود المسموحة. لم يُحفظ شيء.';
  }
  return describePersistenceError(err);
}
