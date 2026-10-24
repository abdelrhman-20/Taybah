import { defineConfig } from 'vitest/config';

// Default environment is node (stores / business logic / SQL). UI tests opt in
// to jsdom with a `// @vitest-environment jsdom` docblock. Everything runs
// against in-memory fakes (src/lib/supabase/client.mock.ts) or an in-process
// Postgres (supabase/tests) — nothing here talks to a real Supabase project.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
