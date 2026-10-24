import { useSyncExternalStore } from 'react';
import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { PersistenceError, classifyError, withTimeout } from '../../../lib/persistence/errors';
import type { Localized } from '../catalog/catalogData';
import { attributeByKey } from '../catalog/attributeStore';
import type { ResolvedCartLine } from '../catalog/catalogStore';

// ORDER STORE — backed by Supabase (public.orders, see
// supabase/migrations/0001_orders.sql). Checkout inserts are public (no
// account needed, RLS allows anon insert); reading/updating orders is
// staff-only (any signed-in Supabase Auth user, until a real role
// hierarchy exists — see the migration's comments).
//
// Mirrors the old localStorage store's exact function/type shape on
// purpose, so CheckoutPage, OrderConfirmationPage, and the admin orders
// pages didn't need to change — only this file's internals did.

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغٍ',
};

// One selected axis captured at purchase time — labels stored in BOTH
// locales so order history never resolves the live catalog to render.
export interface OrderLineOption {
  axis: string;
  axisLabel: Localized;
  value: string;
  valueLabel: Localized;
}

export interface OrderLine {
  productId: string;
  slug: string;
  name: Localized;
  color: string | null;
  size: string | null;
  qty: number;
  price: number;
  image: string;
  // ---- variant snapshot --------------------------------------------------
  // All optional — absent on legacy orders and simple-product lines. They
  // freeze the exact purchased combination: renames, repricing, SKU changes,
  // deactivation, or deletion never alter what was ordered.
  variantId?: string | null;
  variantSku?: string | null;
  // Precomputed Arabic display label, e.g. «اللون: عنابي · المقاس: كبير».
  variantLabel?: string | null;
  // Every selected axis with localized axis/value labels.
  options?: OrderLineOption[];
}

export interface GuestOrder {
  id: string;
  ref: string;
  createdAt: string;
  status: OrderStatus;
  contact: {
    name: string;
    phone: string;
    email: string;
  };
  address: {
    country: string;
    governorate: string;
    city: string;
    street: string;
    building: string;
    apartment: string;
    instructions: string;
  };
  delivery: { method: string };
  lines: OrderLine[];
  subtotal: number;
  total: number;
}

interface OrderRow {
  id: string;
  ref: string;
  created_at: string;
  status: OrderStatus;
  contact: GuestOrder['contact'];
  address: GuestOrder['address'];
  delivery: GuestOrder['delivery'];
  lines: OrderLine[];
  subtotal: number;
  total: number;
}

function fromRow(row: OrderRow): GuestOrder {
  return {
    id: row.id,
    ref: row.ref,
    createdAt: row.created_at,
    status: row.status,
    contact: row.contact,
    address: row.address,
    delivery: row.delivery,
    lines: row.lines,
    subtotal: row.subtotal,
    total: row.total,
  };
}

let orders: GuestOrder[] = [];
const listeners = new Set<() => void>();

// 'idle' = nobody is signed in, so there is nothing to load (the order list
// is staff-only). A failed load is 'error' — never shown as an empty list.
export type OrdersLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; code: string };

let loadState: OrdersLoadState = { status: 'idle' };

function notify() {
  listeners.forEach((l) => l());
}

function setLoadState(next: OrdersLoadState) {
  loadState = next;
  notify();
}

export function getOrdersLoadState(): OrdersLoadState {
  return loadState;
}

let loadPromise: Promise<void> | null = null;

async function fetchAll(): Promise<void> {
  if (!supabaseConfigured) return;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    // Signed out: drop any previously loaded staff data.
    orders = [];
    setLoadState({ status: 'idle' });
    return;
  }
  setLoadState({ status: 'loading' });
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('orders')
        .select('id, ref, created_at, status, contact, address, delivery, lines, subtotal, total')
        .order('created_at', { ascending: false }),
    );
    if (error) throw classifyError(error);
    orders = (data ?? []).map(fromRow);
    setLoadState({ status: 'ready' });
  } catch (e) {
    const err = classifyError(e);
    console.error('Failed to load orders:', err.code, err.detail);
    // Keep whatever was loaded before; the UI shows the error + retry.
    setLoadState({ status: 'error', code: err.code });
  }
}

export function reloadOrders(): Promise<void> {
  loadPromise ??= fetchAll().finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

// Kicks off the load at module init and whenever the auth session changes
// (signing in as staff reveals previously-hidden rows).
if (typeof window !== 'undefined' && supabaseConfigured) {
  void reloadOrders();
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void reloadOrders();
  });
}

export async function saveOrder(order: GuestOrder) {
  const { error } = await supabase.from('orders').insert({
    id: order.id,
    ref: order.ref,
    status: order.status,
    contact: order.contact,
    address: order.address,
    delivery: order.delivery,
    lines: order.lines,
    subtotal: order.subtotal,
    total: order.total,
  });
  if (error) throw error;
  // Optimistic local update — the customer doesn't have read access to the
  // row they just created (RLS), so there is nothing to re-fetch here.
  orders = [order, ...orders];
  notify();
}

// Changes an order's status and returns only once the database confirmed it.
//  • `expectedStatus` (the status the admin was looking at) makes the update
//    conditional, so a stale screen cannot overwrite a newer change.
//  • An update that matches no row is NEVER reported as success: it is
//    classified as unauthorized (RLS hid the row), conflict (status changed
//    elsewhere) or not_found. If the row already holds the requested status
//    (e.g. a double click) that end state is returned as success.
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  expectedStatus?: OrderStatus,
): Promise<void> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  let query = supabase.from('orders').update({ status }).eq('id', orderId);
  if (expectedStatus) query = query.eq('status', expectedStatus);
  const { data, error } = await withTimeout(query.select('id, status'));
  if (error) throw classifyError(error);

  const updated = (data ?? [])[0] as { id: string; status: OrderStatus } | undefined;
  if (!updated) {
    // Zero rows: find out why.
    const { data: adminOk } = await supabase.rpc('is_admin');
    if (adminOk !== true) throw new PersistenceError('unauthorized', 'not an admin');
    const { data: row, error: readError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .maybeSingle();
    if (readError) throw classifyError(readError);
    if (!row) throw new PersistenceError('not_found', 'order');
    if ((row as { status: OrderStatus }).status !== status) {
      throw new PersistenceError('conflict', 'order status changed elsewhere');
    }
    orders = orders.map((o) => (o.id === orderId ? { ...o, status } : o));
    notify();
    return;
  }
  if (updated.status !== status) throw new PersistenceError('verify_failed', 'status mismatch');
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: updated.status } : o));
  notify();
}

export function getOrders(): GuestOrder[] {
  return orders;
}

export function getOrderById(id: string | undefined): GuestOrder | undefined {
  if (!id) return undefined;
  return orders.find((o) => o.id === id);
}

// Builds immutable order lines from resolved cart lines. Variant identity,
// SKU, localized axis/value labels, unit price, and image all freeze at
// purchase time — later catalog edits, repricing, deactivation, or deletion
// never change what this order records. Legacy simple lines keep the
// existing field shape with variant fields left empty.
export function buildOrderLines(resolved: ResolvedCartLine[]): OrderLine[] {
  return resolved.map((r) => {
    const options = r.variant
      ? r.options.map(([axis, value]) => {
          const def = attributeByKey(axis);
          const vDef = def?.values.find((x) => x.key === value);
          return {
            axis,
            axisLabel: def?.name ?? { ar: axis, en: axis },
            value,
            valueLabel: vDef?.label ?? { ar: value, en: value },
          };
        })
      : undefined;
    return {
      productId: r.line.productId,
      slug: r.product?.slug ?? '',
      name: r.name ?? { ar: '', en: '' },
      color: r.line.color,
      size: r.line.size,
      qty: r.line.qty,
      price: r.unitPrice,
      image: r.image,
      variantId: r.variant?.id ?? null,
      variantSku: r.variant?.sku ?? null,
      variantLabel: options
        ? options.map((o) => `${o.axisLabel.ar}: ${o.valueLabel.ar}`).join(' · ')
        : null,
      options,
    };
  });
}

export function makeOrderRef(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `TYB-${new Date().getFullYear()}-${stamp}${rand}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOrders(): GuestOrder[] {
  return useSyncExternalStore(subscribe, () => orders);
}

export function useOrdersLoadState(): OrdersLoadState {
  return useSyncExternalStore(subscribe, () => loadState);
}

export function useOrder(orderId: string | undefined): GuestOrder | undefined {
  const all = useOrders();
  return all.find((o) => o.id === orderId);
}
