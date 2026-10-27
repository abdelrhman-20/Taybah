import { defineConfig } from 'vitest/config';

// Multi-connection inventory concurrency checks. Deliberately NOT part of `npm test`:
// they need a disposable local PostgreSQL (see supabase/tests/concurrency/inventory.concurrency.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/concurrency/**/*.concurrency.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
