import { vi } from 'vitest';

// orderStore.ts talks to Supabase — every test run swaps in the in-memory
// test double (src/lib/supabase/client.mock.ts) so store tests never hit
// the network. Mocking here (relative to this root-level setup file)
// intercepts the module by its resolved path, regardless of how deep the
// importing file's own relative path is.
vi.mock('./src/lib/supabase/client', () => import('./src/lib/supabase/client.mock'));
