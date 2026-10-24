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
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'missing-anon-key',
);
