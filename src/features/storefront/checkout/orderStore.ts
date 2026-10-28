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
  | 'cancelled'
  // In-store sale already completed at the counter (source = 'in_store' only).
  | 'sold';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'sold',
];

// Where the order came from. Stored in the database (orders.source) — never
// inferred from customer data or status.
export type OrderSource = 'online' | 'in_store';

export const ORDER_SOURCES: OrderSource[] = ['online', 'in_store'];

export const ORDER_SOURCE_LABELS_AR: Record<OrderSource, string> = {
  online: 'أونلاين',
  in_store: 'من المتجر',
};

// The statuses an admin may move an order of this source to. In-store sales
// have no shipping lifecycle (the database enforces the same rule); online
// orders never use 'sold'.
export function statusesForSource(source: OrderSource): OrderStatus[] {
  return source === 'in_store'
    ? ['sold', 'cancelled']
    : ORDER_STATUSES.filter((s) => s !== 'sold');
}

export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم الاستلام',
  cancelled: 'ملغٍ',
  sold: 'تم البيع',
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
  source: OrderSource;
  note: string | null;
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
  // Absent only when read from a database that has not applied migration 0008.
  source?: OrderSource;
  note?: string | null;
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
    source: row.source ?? 'online',
    note: row.note ?? null,
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

async function fetchAll(background: boolean): Promise<void> {
  if (!supabaseConfigured) return;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    // Signed out: drop any previously loaded staff data.
    orders = [];
    setLoadState({ status: 'idle' });
    return;
  }
  // A background re-read (live updates) of an already-loaded list shows no spinner.
  if (!(background && loadState.status === 'ready')) setLoadState({ status: 'loading' });
  try {
    const base = 'id, ref, created_at, status, contact, address, delivery, lines, subtotal, total';
    let result: { data: unknown; error: { code?: string | null } | null } = await withTimeout(
      supabase.from('orders').select(`${base}, source, note`).order('created_at', { ascending: false }),
    );
    // Migration 0008 not applied yet (undefined column): keep the list working
    // with the legacy columns — every order is then, correctly, an online one.
    if (result.error?.code === '42703') {
      result = await withTimeout(
        supabase.from('orders').select(base).order('created_at', { ascending: false }),
      );
    }
    const { data, error } = result;
    if (error) throw classifyError(error);
    orders = ((data as OrderRow[] | null) ?? []).map(fromRow);
    setLoadState({ status: 'ready' });
  } catch (e) {
    const err = classifyError(e);
    console.error('Failed to load orders:', err.code, err.detail);
    // A failed background re-read keeps the list that is already on screen.
    if (background && loadState.status === 'ready') return;
    // Keep whatever was loaded before; the UI shows the error + retry.
    setLoadState({ status: 'error', code: err.code });
  }
}

// `background`: a silent live-update re-read (no spinner, a failure is not shown).
export function reloadOrders(background = false): Promise<void> {
  loadPromise ??= fetchAll(background).finally(() => {
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

// What online checkout builds: the source is always 'online' and there is no
// note, so neither is part of its input.
export type OnlineOrderInput = Omit<GuestOrder, 'source' | 'note'>;

// Online checkout. Deliberately sends no `source`/`note`: the column default
// ('online') applies, so checkout behaves identically before and after
// migration 0008 and cannot be made to claim another source.
export async function saveOrder(order: OnlineOrderInput) {
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
  if (error) {
    // Primary-key conflict on THIS order's id means an earlier attempt of the
    // same checkout already reached the database and only its response was
    // lost. The order exists exactly once — report success instead of an
    // error that would invite the customer to order again. (A clash on the
    // `ref` unique constraint is a different problem and still throws.)
    const alreadyCreated = error.code === '23505' && /orders_pkey/.test(error.message ?? '');
    if (!alreadyCreated) throw error;
  }
  // Optimistic local update — the customer doesn't have read access to the
  // row they just created (RLS), so there is nothing to re-fetch here.
  orders = [{ ...order, source: 'online', note: null }, ...orders.filter((o) => o.id !== order.id)];
  notify();
}

export interface InStoreOrderInput {
  id: string;
  ref: string;
  customerName: string;
  customerPhone: string;
  note: string;
  // Built with buildOrderLines() from the CURRENT retail prices.
  lines: OrderLine[];
}

// Records a walk-in sale. Direct insert: the database decides whether the
// caller may (admin-only RLS policy) and re-validates prices and totals
// against the live catalog (migration 0008). Resolves only with the row the
// database stored — never optimistically — so a success message always means
// the order is persisted.
export async function createInStoreOrder(input: InStoreOrderInput): Promise<GuestOrder> {
  try {
    return await insertInStoreOrder(input);
  } catch (e) {
    throw classifyError(e);
  }
}

async function insertInStoreOrder(input: InStoreOrderInput): Promise<GuestOrder> {
  if (!supabaseConfigured) throw new PersistenceError('unconfigured');
  const subtotal = input.lines.reduce((n, l) => n + l.price * l.qty, 0);
  const note = input.note.trim();
  const payload = {
    id: input.id,
    ref: input.ref,
    status: 'sold' as const,
    source: 'in_store' as const,
    contact: { name: input.customerName.trim(), phone: input.customerPhone.trim(), email: '' },
    address: { country: '', governorate: '', city: '', street: '', building: '', apartment: '', instructions: '' },
    delivery: { method: 'in_store' },
    lines: input.lines,
    subtotal,
    total: subtotal,
    note: note === '' ? null : note,
  };
  const { error } = await withTimeout(supabase.from('orders').insert(payload));
  if (error) {
    // Same idempotency rule as online checkout: a clash on THIS order's id
    // means an earlier attempt already reached the database. It is only
    // accepted below if the stored row really is this sale.
    const alreadyCreated = error.code === '23505' && /orders_pkey/.test(error.message ?? '');
    if (!alreadyCreated) throw classifyError(error);
  }
  // Read the row back: success is reported only for what the database holds.
  const { data, error: readError } = await withTimeout(
    supabase
      .from('orders')
      .select('id, ref, created_at, status, contact, address, delivery, lines, subtotal, total, source, note')
      .eq('id', input.id),
  );
  if (readError) throw classifyError(readError);
  const stored = ((data ?? []) as unknown as OrderRow[])[0];
  if (!stored || stored.source !== 'in_store' || Number(stored.total) !== subtotal) {
    throw new PersistenceError('verify_failed', 'stored order does not match');
  }
  const saved = fromRow(stored);
  orders = [saved, ...orders.filter((o) => o.id !== saved.id)];
  notify();
  return saved;
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
  try {
    await applyOrderStatus(orderId, status, expectedStatus);
  } catch (e) {
    throw classifyError(e); // callers always see a PersistenceError with a `code`
  }
}

async function applyOrderStatus(
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
