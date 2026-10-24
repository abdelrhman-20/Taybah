import { defineConfig } from 'vitest/config';

// Unit tests are pure-TypeScript store/business logic — node environment,
// no browser plugins needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
