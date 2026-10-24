// Test-only stand-in for the real Supabase client (src/lib/supabase/client.ts),
// swapped in via vitest.config.ts's alias so store/unit tests never hit the
// network. Backs the handful of calls orderStore.ts actually makes with an
// in-memory array; reset automatically whenever a test calls
// `vi.resetModules()` and re-imports orderStore, matching this project's
// existing per-test store-isolation pattern.

interface Row {
  [key: string]: unknown;
}

let rows: Row[] = [];

function ordersTable() {
  return {
    insert(values: Row) {
      rows = [{ ...values }, ...rows];
      return Promise.resolve({ error: null });
    },
    select() {
      return {
        order() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
    update(values: Row) {
      return {
        eq(column: string, value: unknown) {
          rows = rows.map((r) => (r[column] === value ? { ...r, ...values } : r));
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// Tests exercise the local/cache path only — remote sync stays off so no
// store test ever attempts a (mocked) network round-trip.
export const supabaseConfigured = false;

export const supabase = {
  from(table: string) {
    if (table === 'orders') return ordersTable();
    throw new Error(`client.mock.ts: unsupported table "${table}"`);
  },
  auth: {
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
};
