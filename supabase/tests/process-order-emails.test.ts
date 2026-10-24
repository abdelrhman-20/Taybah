import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the REAL supabase/functions/process-order-emails/index.ts handler
// with Deno, the Supabase client and Resend (global fetch) stubbed. Verifies
// authentication, how provider responses map to outbox outcomes, the
// idempotency key, escaping, and that logs never contain secrets or customer
// data. NOT covered: the Deno runtime itself, real Resend, real Supabase.

type Handler = (req: Request) => Promise<Response>;
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const SECRET = 'worker-secret-value-123';
const API_KEY = 're_test_key_ABCDEFG';
const CUSTOMER = 'mona.customer@example.com';

let rpcCalls: RpcCall[];
let claimRows: unknown[];
let claimError: unknown;
let providerCalls: Array<{ url: string; init: RequestInit }>;
let providerReply: () => Promise<Response>;
let logged: string[];

function stubDeno(env: Record<string, string | undefined>) {
  let captured: Handler | undefined;
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => {
      captured = h;
    },
  });
  return () => captured!;
}

async function load(env: Partial<Record<string, string>> = {}) {
  vi.resetModules();
  const get = stubDeno({
    ORDER_EMAIL_WORKER_SECRET: SECRET,
    RESEND_API_KEY: API_KEY,
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-xyz',
    EMAIL_FROM: 'Taybah <orders@taybah.example>',
    STOREFRONT_URL: 'https://shop.example/Taybah/',
    ...env,
  });
  await import('../functions/process-order-emails/index.ts');
  return get();
}

const post = (headers: Record<string, string> = { 'x-worker-secret': SECRET }) =>
  new Request('https://x.supabase.co/functions/v1/process-order-emails', { method: 'POST', headers });

const row = (over: Record<string, unknown> = {}) => ({
  out_id: 'ob-1',
  out_kind: 'status_update',
  out_status: 'shipped',
  out_attempts: 1,
  out_ref: 'TYB-2026-ABC',
  out_contact: { name: 'منى', email: CUSTOMER },
  out_total: '1250.00',
  ...over,
});

const finishCall = () => rpcCalls.find((c) => c.name === 'finish_order_email');
const reply = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  rpcCalls = [];
  claimRows = [row()];
  claimError = null;
  providerCalls = [];
  providerReply = reply(200, { id: 'msg_123' });
  logged = [];
  (globalThis as unknown as { __edgeRpc: unknown }).__edgeRpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'claim_order_emails') return { data: claimError ? null : claimRows, error: claimError };
    return { data: null, error: null };
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    providerCalls.push({ url, init });
    return providerReply();
  });
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('process-order-emails — access control', () => {
  it('rejects anything but POST', async () => {
    const h = await load();
    const res = await h(new Request('https://x/functions/v1/process-order-emails', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('fails CLOSED (503) when the worker secret is not configured, and does nothing', async () => {
    const h = await load({ ORDER_EMAIL_WORKER_SECRET: '' });
    const res = await h(post());
    expect(res.status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
    expect(providerCalls).toHaveLength(0);
  });

  it.each([
    ['no secret header', {}],
    ['wrong secret', { 'x-worker-secret': 'nope' }],
    ['a prefix of the secret', { 'x-worker-secret': SECRET.slice(0, 5) }],
    ['the secret plus extra', { 'x-worker-secret': SECRET + 'x' }],
    ['the public anon key as a Bearer token', { Authorization: 'Bearer sb_publishable_whatever' }],
  ])('401 for %s — no database access, no email', async (_label, headers) => {
    const h = await load();
    const res = await h(post(headers as Record<string, string>));
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(providerCalls).toHaveLength(0);
  });

  it('503 when the Resend key is missing — rows are NOT claimed, so they stay pending', async () => {
    const h = await load({ RESEND_API_KEY: '' });
    const res = await h(post());
    expect(res.status).toBe(503);
    expect(rpcCalls.find((c) => c.name === 'claim_order_emails')).toBeUndefined();
  });
});

describe('process-order-emails — sending', () => {
  it('sends via Resend with the key, an idempotency key and the right recipient, then records the provider id', async () => {
    const h = await load();
    const res = await h(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 1, sent: 1, failed: 0, retry: 0, skipped: 0 });

    expect(providerCalls).toHaveLength(1);
    const { url, init } = providerCalls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Idempotency-Key']).toBe('order-email-ob-1');
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual([CUSTOMER]);
    expect(body.from).toBe('Taybah <orders@taybah.example>');
    expect(body.subject).toContain('TYB-2026-ABC');
    expect(body.html).toContain('dir="rtl"');
    expect(body.html).toContain('1,250 ج.م');
    expect(body.html).toContain('https://shop.example/Taybah/');
    expect(body.text).toContain('TYB-2026-ABC');

    expect(finishCall()!.args).toEqual({
      p_id: 'ob-1',
      p_outcome: 'sent',
      p_provider_id: 'msg_123',
      p_error: null,
    });
  });

  it('customer-controlled text is escaped in the HTML sent to the provider', async () => {
    claimRows = [row({ out_contact: { name: '<img src=x onerror=alert(1)>', email: CUSTOMER } })];
    const h = await load();
    await h(post());
    const html = JSON.parse(String(providerCalls[0].init.body)).html as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it.each([
    [403, { message: 'domain not verified' }, 'failed', 'provider_http_403'],
    [401, { message: 'bad key' }, 'failed', 'provider_http_401'],
    [422, { message: `invalid to: ${CUSTOMER}` }, 'failed', 'provider_http_422'],
    [429, { message: 'rate limit' }, 'retry', 'provider_http_429'],
    [500, {}, 'retry', 'provider_http_500'],
    [503, {}, 'retry', 'provider_http_503'],
  ])('provider %i is recorded as %s with a short code, never the provider body', async (status, body, outcome, code) => {
    providerReply = reply(status, body);
    const h = await load();
    const res = await h(post());
    expect(res.status).toBe(200);
    expect(finishCall()!.args).toEqual({ p_id: 'ob-1', p_outcome: outcome, p_provider_id: null, p_error: code });
  });

  it('a 2xx WITHOUT a message id is never recorded as sent', async () => {
    providerReply = reply(200, {});
    const h = await load();
    await h(post());
    expect(finishCall()!.args).toMatchObject({ p_outcome: 'retry', p_error: 'provider_no_message_id', p_provider_id: null });
  });

  it('a non-JSON provider response is handled (retry, not a crash)', async () => {
    providerReply = () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }));
    const h = await load();
    const res = await h(post());
    expect(res.status).toBe(200);
    expect(finishCall()!.args).toMatchObject({ p_outcome: 'retry', p_error: 'provider_http_502' });
  });

  it('a network failure reaching Resend is a retry', async () => {
    providerReply = () => Promise.reject(new TypeError('fetch failed'));
    const h = await load();
    await h(post());
    expect(finishCall()!.args).toMatchObject({ p_outcome: 'retry', p_error: 'provider_unreachable', p_provider_id: null });
  });

  it('a missing or invalid customer email is skipped without calling the provider', async () => {
    claimRows = [row({ out_id: 'a', out_contact: { name: 'x' } }), row({ out_id: 'b', out_contact: { email: 'a@b.co, c@d.co' } })];
    const h = await load();
    const res = await h(post());
    expect(await res.json()).toMatchObject({ claimed: 2, skipped: 2, sent: 0 });
    expect(providerCalls).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.name === 'finish_order_email').map((c) => c.args.p_error)).toEqual([
      'no_customer_email',
      'no_customer_email',
    ]);
  });

  it('processes a batch independently: one failure does not stop the others', async () => {
    claimRows = [row({ out_id: 'a' }), row({ out_id: 'b' }), row({ out_id: 'c' })];
    let n = 0;
    providerReply = () => (++n === 2 ? reply(503, {})() : reply(200, { id: `msg_${n}` })());
    const h = await load();
    const res = await h(post());
    expect(await res.json()).toMatchObject({ claimed: 3, sent: 2, retry: 1 });
    expect(rpcCalls.filter((c) => c.name === 'finish_order_email').map((c) => c.args.p_outcome)).toEqual(['sent', 'retry', 'sent']);
  });

  it('an empty queue is a no-op', async () => {
    claimRows = [];
    const h = await load();
    const res = await h(post());
    expect(await res.json()).toMatchObject({ claimed: 0 });
    expect(providerCalls).toHaveLength(0);
  });

  it('a failing claim RPC returns 500 worker_failed and sends nothing', async () => {
    claimError = { code: 'XX000', message: 'db down' };
    const h = await load();
    const res = await h(post());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'worker_failed' });
    expect(providerCalls).toHaveLength(0);
  });

  it('a failing finish RPC does not crash the batch (row is reclaimed later; provider dedupes by key)', async () => {
    (globalThis as unknown as { __edgeRpc: unknown }).__edgeRpc = async (name: string) =>
      name === 'claim_order_emails' ? { data: claimRows, error: null } : { data: null, error: { code: 'XX000' } };
    const h = await load();
    const res = await h(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1 });
  });
});

describe('process-order-emails — log hygiene', () => {
  it('never logs secrets, API keys, the customer email, name, or provider response bodies', async () => {
    providerReply = reply(422, { message: `invalid recipient ${CUSTOMER}` });
    const h = await load();
    await h(post());
    claimError = { code: 'XX000', message: `boom for ${CUSTOMER}` };
    await h(post());
    const all = logged.join('\n');
    for (const secret of [SECRET, API_KEY, 'service-role-key-xyz', CUSTOMER, 'منى']) {
      expect(all).not.toContain(secret);
    }
    expect(all.length).toBeGreaterThan(0); // it does log counts / codes
  });
});
