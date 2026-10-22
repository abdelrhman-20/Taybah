import { defineConfig } from 'vitest/config';

// Unit tests are pure-TypeScript store/business logic — node environment,
// no browser plugins needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
