import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase/client';
import type { OrderStatus } from '../../storefront/checkout/orderStore';

// Read-only view of public.order_email_outbox (admin RLS) plus the one
// client-callable write, the retry_order_email RPC. See
// supabase/migrations/0005_order_email_outbox.sql. The browser never sends
// email or talks to the email provider — it can only observe and re-queue.

export type EmailState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface OrderEmailRow {
  id: string;
  orderId: string;
  kind: 'confirmation' | 'status_update';
  status: OrderStatus;
  state: EmailState;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  order_id: string;
  kind: OrderEmailRow['kind'];
  status: OrderStatus;
  state: EmailState;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, order_id, kind, status, state, attempts, last_error, sent_at, created_at';

function fromRow(r: Row): OrderEmailRow {
  return {
    id: r.id,
    orderId: r.order_id,
    kind: r.kind,
    status: r.status,
    state: r.state,
    attempts: r.attempts,
    lastError: r.last_error,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

export async function fetchOrderEmails(orderId: string): Promise<OrderEmailRow[]> {
  const { data, error } = await supabase
    .from('order_email_outbox')
    .select(COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(fromRow);
}

// Order ids that have at least one permanently failed email — drives the
// warning marker in the orders list.
export async function fetchOrderIdsWithFailedEmails(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('order_email_outbox')
    .select('order_id')
    .eq('state', 'failed');
  if (error) throw error;
  return new Set((data ?? []).map((r: { order_id: string }) => r.order_id));
}

export async function retryOrderEmail(id: string): Promise<void> {
  const { error } = await supabase.rpc('retry_order_email', { p_id: id });
  if (error) throw error;
}

const IN_FLIGHT: EmailState[] = ['pending', 'sending'];

// Loads an order's email log and keeps polling while anything is still in
// flight. `unavailable` = the outbox can't be read (migration 0005 not
// applied, or not an admin) — shown as a neutral note, never as success.
export function useOrderEmails(orderId: string, statusKey: string) {
  const [rows, setRows] = useState<OrderEmailRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRows(await fetchOrderEmails(orderId));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [orderId]);

  // statusKey changes right after an admin applies a status, which is when a
  // new outbox row appears.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void reload();
    };
    run();
    const t1 = setTimeout(run, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t1);
    };
  }, [reload, statusKey]);

  const inFlight = rows?.some((r) => IN_FLIGHT.includes(r.state)) ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [inFlight, reload]);

  return { rows, unavailable, reload };
}
