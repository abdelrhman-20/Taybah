import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Missing env is fatal in dev (catches a forgotten .env.local early) but must
// not crash a deployed build — e.g. the GitHub Pages demo, where secrets may
// not be configured. There the storefront still renders (catalog is local);
// only auth/orders calls fail, and their callers already surface errors.
if (!url || !anonKey) {
  const message =
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env.local (see .env.example).';
  if (import.meta.env.DEV) throw new Error(message);
  console.warn(message);
}

// The anon/publishable key is safe to ship to the browser — Postgres row
// level security (see supabase/migrations/) is the real access boundary,
// not this key. Never put the service-role key or the database password
// here or anywhere else under src/.
// True only when real project config was baked into the build — lets auth
// surfaces distinguish "service not configured" from genuine failures
// without inspecting (or logging) any secret values.
export const supabaseConfigured = Boolean(url && anonKey);

// Each browser TAB keeps its own login. By default supabase-js stores the session in
// localStorage (shared by every tab) and announces sign-ins / sign-outs to all tabs
// on a BroadcastChannel named after the storage key — so logging out in one tab logged
// every tab out. Here the session lives in sessionStorage (per tab, survives a reload)
// under a key that is unique to the tab, which also gives each tab its own channel.
// Cost: a brand-new tab, or a tab the browser discarded, asks for the password again.
function perTabAuth(): { storage: Storage; storageKey: string } | undefined {
  try {
    const store = window.sessionStorage;
    let id = store.getItem('taybah-tab-id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      store.setItem('taybah-tab-id', id);
    }
    return { storage: store, storageKey: `sb-auth-${id}` };
  } catch {
    return undefined; // no sessionStorage (blocked / SSR): keep the library default
  }
}

// `||` not `??` — unset CI secrets arrive as empty strings, not undefined,
// and createClient('') throws at module load (blank page on Pages).
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'missing-anon-key',
  { auth: perTabAuth() },
);
