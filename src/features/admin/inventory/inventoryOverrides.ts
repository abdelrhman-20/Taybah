import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';
import {
  buildInStoreOrderPayload,
  confirmStoredInStoreOrder,
  type GuestOrder,
  type InStoreOrderInput,
} from '../../storefront/checkout/orderStore';
import { callRpc, type InventoryResult } from './inventoryStore';

// ADMIN-ONLY shortage overrides (migration 0010). The ONLY way past «المخزون غير كافٍ»:
// two admin-authorized, audited SECURITY DEFINER RPCs. Each is bound to the exact
// shortfall the admin saw (the database refuses it if the stock moved meanwhile), needs
// a reason of at least five characters, and carries an attempt key: a retry of the
// IDENTICAL request reuses the key (and is reported as already done), a changed request
// gets a new one. Nothing here is reachable from the storefront.

export interface Shortfall {
  product_id: string;
  requested: number;
  available: number;
  shortfall: number;
}

export const MIN_OVERRIDE_REASON = 5;

// The database reports the shortfall as JSON in the error detail (IS002 / IS007).
export function parseShortfalls(detail: string | undefined): Shortfall[] {
  if (!detail) return [];
  try {
    const raw = JSON.parse(detail) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (x): x is Shortfall =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as Shortfall).product_id === 'string' &&
        Number.isFinite((x as Shortfall).requested) &&
        Number.isFinite((x as Shortfall).available) &&
        Number.isFinite((x as Shortfall).shortfall),
    );
  } catch {
    return [];
  }
}

// Delivers an ONLINE order although stock is short. Resolves only with the database's answer.
export function deliverOrderWithOverride(args: {
  orderId: string;
  expectedStatus: string;
  attemptKey: string;
  shortfalls: Shortfall[];
  reason: string;
}): Promise<InventoryResult> {
  return callRpc('inventory_deliver_order_override', {
    p_order_id: args.orderId,
    p_expected_status: args.expectedStatus,
    p_attempt_key: args.attemptKey,
    p_confirmed_shortfall: args.shortfalls,
    p_reason: args.reason,
  });
}

// Records an in-store sale although stock is short, then reads the stored order back.
export async function createInStoreOrderWithOverride(
  input: InStoreOrderInput,
  attemptKey: string,
  shortfalls: Shortfall[],
  reason: string,
): Promise<GuestOrder> {
  try {
    const payload = buildInStoreOrderPayload(input);
    await callRpc('inventory_create_in_store_order_override', {
      p_order: {
        id: payload.id,
        ref: payload.ref,
        contact: payload.contact,
        address: payload.address,
        delivery: payload.delivery,
        lines: payload.lines,
        subtotal: payload.subtotal,
        total: payload.total,
        note: payload.note,
      },
      p_attempt_key: attemptKey,
      p_confirmed_shortfall: shortfalls,
      p_reason: reason,
    });
    return await confirmStoredInStoreOrder(payload.id, payload.subtotal);
  } catch (e) {
    throw classifyError(e);
  }
}

// Arabic explanation for the refusals the order integration produces, or null when the
// error is not one of them (the caller then uses its generic message).
export function describeStockRefusal(e: unknown, nameOf: (productId: string) => string): string | null {
  const err = classifyError(e);
  switch (err.code) {
    case 'stock_not_initialized': {
      const names = err.detail
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map(nameOf);
      return names.length > 0
        ? `لا يمكن إتمام العملية: لا رصيد افتتاحي للمنتجات التالية — ${names.join('، ')}. هيّئ رصيدها من صفحة المخزون أولًا. لم يتغيّر شيء.`
        : describePersistenceError(err);
    }
    case 'legacy_order_decision_required':
    case 'order_lines_locked':
    case 'order_lines_invalid':
      return describePersistenceError(err);
    default:
      return null;
  }
}

