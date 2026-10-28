import { supabase, supabaseConfigured } from '../../lib/supabase/client';
import { refreshDocs } from '../storefront/catalog/catalogDocs';
import { reloadStock } from '../storefront/catalog/stockStore';
import { reloadOrders } from '../storefront/checkout/orderStore';

// LIVE UPDATES — open pages follow the database without a refresh.
//  • Supabase Realtime (migration 0010) pushes a change of catalog_docs / orders;
//    each push just re-reads the affected store (debounced, coalesced).
//  • Stock availability has no row the storefront may subscribe to, so it is
//    re-read every 30 s while the tab is visible.
//  • Safety nets for a missing Realtime setup or a dropped connection: while the
//    channel is not subscribed everything is re-read every 30 s, otherwise every
//    5 min; and everything is re-read when the tab becomes visible or the network
//    comes back.
// Every refresh is a plain re-read: it never writes and never shows a spinner.

const TICK_MS = 30_000;
const SAFETY_EVERY = 10; // ticks (= 5 min) between safety re-reads while Realtime is healthy

let started = false;

function debounce(fn: () => void, ms = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

export function startLiveSync(): void {
  if (started || !supabaseConfigured || typeof window === 'undefined') return;
  started = true;

  const visible = () => document.visibilityState === 'visible';
  const refreshCatalog = () => void refreshDocs();
  const refreshOrdersAndStock = () => {
    void reloadOrders(true);
    void reloadStock();
  };
  const refreshAll = () => {
    refreshCatalog();
    refreshOrdersAndStock();
  };

  let live = false;
  supabase
    .channel('live-shop')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_docs' }, debounce(refreshCatalog))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debounce(refreshOrdersAndStock))
    .subscribe((status) => {
      live = status === 'SUBSCRIBED';
    });

  document.addEventListener('visibilitychange', () => {
    if (visible()) refreshAll();
  });
  window.addEventListener('online', refreshAll);

  let ticks = 0;
  setInterval(() => {
    if (!visible()) return;
    ticks += 1;
    void reloadStock();
    if (!live || ticks % SAFETY_EVERY === 0) {
      refreshCatalog();
      void reloadOrders(true);
    }
  }, TICK_MS);
}
