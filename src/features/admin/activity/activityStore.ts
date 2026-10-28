import { useSyncExternalStore } from 'react';
import { supabase, supabaseConfigured } from '../../../lib/supabase/client';
import { withTimeout } from '../../../lib/persistence/errors';
import { getCatalog } from '../../storefront/catalog/catalogStore';
import { attributeValueLabel } from '../../storefront/catalog/attributeStore';
import { ORDER_STATUS_LABELS_AR, type OrderStatus } from '../../storefront/checkout/orderStore';
import { formatPrice } from '../../shared/utils/format';

// OWNER NOTIFICATIONS — what the other admin accounts changed (public.activity_log,
// migration 0011). The database only returns rows to the owner account; every other
// account reads an empty list, so nothing here can leak to them. The owner's pages
// subscribe to new rows over Realtime and re-read every minute as a safety net.

export type ActivityKind =
  | 'stock_changed'
  | 'stock_tracked'
  | 'stock_untracked'
  | 'price_changed'
  | 'wholesale_changed'
  | 'visibility_changed'
  | 'product_created'
  | 'product_deleted'
  | 'order_status'
  | 'in_store_sale';

export interface Activity {
  id: number;
  createdAt: string;
  actor: string; // e-mail
  kind: ActivityKind;
  subject: string | null;
  detail: Record<string, unknown>;
  seen: boolean;
}

interface ActivityRow {
  id: number;
  created_at: string;
  actor: string;
  kind: ActivityKind;
  subject: string | null;
  detail: Record<string, unknown> | null;
  seen_at: string | null;
}

const KEEP = 50;
const POLL_MS = 60_000;

function fromRow(r: ActivityRow): Activity {
  return {
    id: Number(r.id),
    createdAt: r.created_at,
    actor: r.actor,
    kind: r.kind,
    subject: r.subject,
    detail: r.detail ?? {},
    seen: r.seen_at !== null,
  };
}

let items: Activity[] = [];
const listeners = new Set<() => void>();

function publish(next: Activity[]) {
  items = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivity(): Activity[] {
  return useSyncExternalStore(subscribe, () => items);
}

async function load(): Promise<void> {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('activity_log')
        .select('id, created_at, actor, kind, subject, detail, seen_at')
        .order('created_at', { ascending: false })
        .limit(KEEP),
    );
    // Not migrated yet / offline: keep what is shown.
    if (error) return;
    publish(((data ?? []) as unknown as ActivityRow[]).map(fromRow));
  } catch {
    // network failure: same as above
  }
}

// Starts following the log (owner pages only). `onNew` fires for a row that arrives live,
// never for the initial load. Returns the stop function.
export function startActivity(onNew?: (a: Activity) => void): () => void {
  if (!supabaseConfigured) return () => {};
  void load();
  const channel = supabase
    .channel('owner-activity')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload) => {
      const a = fromRow(payload.new as ActivityRow);
      if (items.some((x) => x.id === a.id)) return;
      publish([a, ...items].slice(0, KEEP));
      onNew?.(a);
    })
    .subscribe();
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, POLL_MS);
  return () => {
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}

export async function markAllSeen(): Promise<void> {
  if (!items.some((a) => !a.seen)) return;
  const { error } = await supabase.rpc('activity_mark_seen');
  if (!error) publish(items.map((a) => ({ ...a, seen: true })));
}

// ---- wording ------------------------------------------------------------------------

const who = (email: string) => {
  const name = email.split('@')[0] ?? email;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const price = (v: unknown) => (v === null || v === undefined || Number.isNaN(num(v)) ? '—' : formatPrice(num(v), 'ar'));

// Product (and variant) name from the live catalog; the id itself if it is gone.
function unitName(productId: string | null, variantId: string): string {
  if (!productId) return '';
  const p = getCatalog().products.find((x) => x.id === productId);
  if (!p) return productId;
  const v = variantId ? p.variants?.find((x) => x.id === variantId) : undefined;
  if (!v) return p.name.ar;
  const options = Object.entries(v.combo)
    .map(([axis, value]) => attributeValueLabel(axis, value, 'ar') ?? value)
    .join(' · ');
  return options ? `${p.name.ar} (${options})` : p.name.ar;
}

export function describeActivity(a: Activity): string {
  const by = who(a.actor);
  const d = a.detail;
  const named = str(d.name) || a.subject || '';
  switch (a.kind) {
    case 'stock_changed':
      return `${by} عدّل مخزون «${unitName(a.subject, str(d.variant))}» من ${num(d.from)} إلى ${num(d.to)}`;
    case 'stock_tracked':
      return `${by} بدأ متابعة مخزون «${unitName(a.subject, str(d.variant))}» بكمية ${num(d.qty)}`;
    case 'stock_untracked':
      return `${by} أوقف متابعة مخزون «${unitName(a.subject, str(d.variant))}»`;
    case 'price_changed':
      return `${by} غيّر سعر «${named}» من ${price(d.from)} إلى ${price(d.to)}`;
    case 'wholesale_changed':
      return `${by} غيّر سعر الجملة لـ «${named}» من ${price(d.from)} إلى ${price(d.to)}`;
    case 'visibility_changed':
      return `${by} ${d.visible ? 'أظهر' : 'أخفى'} «${named}» ${d.visible ? 'في' : 'من'} المتجر`;
    case 'product_created':
      return `${by} أضاف منتجًا جديدًا «${named}»`;
    case 'product_deleted':
      return `${by} حذف المنتج «${named}»`;
    case 'order_status': {
      const to = str(d.to) as OrderStatus;
      return `${by} غيّر حالة الطلب ${a.subject ?? ''} إلى «${ORDER_STATUS_LABELS_AR[to] ?? to}»`;
    }
    case 'in_store_sale':
      return `${by} سجّل بيع من المحل ${a.subject ?? ''} بإجمالي ${price(d.total)}`;
    default:
      return `${by} عدّل شيئًا`;
  }
}
