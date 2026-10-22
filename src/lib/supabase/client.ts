import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env.local (see .env.example).',
  );
}

// The anon/publishable key is safe to ship to the browser — Postgres row
// level security (see supabase/migrations/) is the real access boundary,
// not this key. Never put the service-role key or the database password
// here or anywhere else under src/.
export const supabase = createClient(url, anonKey);
