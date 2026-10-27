import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Default environment is node (stores / business logic / SQL). UI tests opt in
// to jsdom with a `// @vitest-environment jsdom` docblock. Everything runs
// against in-memory fakes (src/lib/supabase/client.mock.ts) or an in-process
// Postgres (supabase/tests) — nothing here talks to a real Supabase project.
export default defineConfig({
  resolve: {
    alias: {
      // The Deno Edge Function imports this jsr: specifier; tests substitute a stub.
      'jsr:@supabase/supabase-js@2': fileURLToPath(new URL('./src/test/denoSupabaseStub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    // Many files boot an in-process Postgres (PGlite, WASM) or render whole admin pages in
    // jsdom; with ~66 files running in parallel the 5 s default timed out under load (CI
    // runs `npm test` before every deploy). A timeout, not an assertion: nothing is weakened.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
