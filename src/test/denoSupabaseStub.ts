// TEST-ONLY stand-in for `jsr:@supabase/supabase-js@2`, which the Deno Edge
// Function imports. vitest.config.ts aliases that specifier here so the real
// supabase/functions/process-order-emails/index.ts can be imported and driven
// in tests. Every `rpc` call is forwarded to a function the test installs on
// globalThis.__edgeRpc.
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export function createClient() {
  return {
    rpc: (name: string, args: Record<string, unknown>) =>
      (globalThis as unknown as { __edgeRpc: Rpc }).__edgeRpc(name, args),
  };
}
