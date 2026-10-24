import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_STATUSES,
  classifyProviderResponse,
  escapeHtml,
  isValidEmail,
  processOutbox,
  renderOrderEmail,
  timingSafeEqual,
  type ClaimedEmail,
  type FinishOutcome,
  type SendOutcome,
  type WorkerDeps,
} from './orderEmail.ts';

const baseOrder = { ref: 'TYB-2026-ABC123', customerName: 'منى أحمد', total: 12500 };

describe('renderOrderEmail', () => {
  it.each(ORDER_STATUSES)('renders an Arabic RTL email for %s', (status) => {
    const e = renderOrderEmail({ ...baseOrder, status, storefrontUrl: 'https://shop.example/Taybah/' });
    expect(e.html).toContain('dir="rtl"');
    expect(e.html).toContain('lang="ar"');
    expect(e.html).toContain('width=device-width');
    expect(e.html).toContain('TYB-2026-ABC123');
    expect(e.html).toContain('12,500 ج.م');
    expect(e.html).toContain('مرحبًا منى أحمد');
    expect(e.html).toContain('https://shop.example/Taybah/');
    expect(e.subject).toContain('TYB-2026-ABC123');
    expect(e.text).toContain('12,500 ج.م');
  });

  it('uses distinct subjects per status', () => {
    const subjects = ORDER_STATUSES.map((status) => renderOrderEmail({ ...baseOrder, status }).subject);
    expect(new Set(subjects).size).toBe(ORDER_STATUSES.length);
  });

  it('falls back to a generic greeting when the name is missing', () => {
    const e = renderOrderEmail({ ...baseOrder, customerName: '  ', status: 'shipped' });
    expect(e.html).toContain('مرحبًا،');
  });

  it('escapes customer-controlled values (no HTML injection)', () => {
    const e = renderOrderEmail({
      ...baseOrder,
      customerName: '<script>alert(1)</script>"x"',
      status: 'pending',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });

  it('omits the button for missing or non-http storefront URLs', () => {
    expect(renderOrderEmail({ ...baseOrder, status: 'pending' }).html).not.toContain('تابع التسوق</a>');
    const bad = renderOrderEmail({ ...baseOrder, status: 'pending', storefrontUrl: 'javascript:alert(1)' });
    expect(bad.html).not.toContain('javascript:');
  });
});

describe('isValidEmail / escapeHtml / timingSafeEqual', () => {
  it('validates emails conservatively', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('a@b.com, c@d.com')).toBe(false);
    expect(isValidEmail('a@b.com\r\nBcc: x@y.com')).toBe(false);
  });
  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('compares secrets', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
});

describe('classifyProviderResponse', () => {
  it('only reports sent for 2xx WITH a message id', () => {
    expect(classifyProviderResponse(200, { id: 'msg_1' })).toEqual({ outcome: 'sent', providerId: 'msg_1' });
    expect(classifyProviderResponse(200, {})).toMatchObject({ outcome: 'retry' });
    expect(classifyProviderResponse(200, null)).toMatchObject({ outcome: 'retry' });
  });
  it('retries transient errors', () => {
    for (const s of [408, 409, 429, 500, 503]) {
      expect(classifyProviderResponse(s, {})).toEqual({ outcome: 'retry', error: `provider_http_${s}` });
    }
  });
  it('fails permanently on client errors, with a code not the body', () => {
    for (const s of [400, 401, 403, 422]) {
      expect(classifyProviderResponse(s, { message: 'to: leak@example.com invalid' })).toEqual({
        outcome: 'failed',
        error: `provider_http_${s}`,
      });
    }
  });
});

function claimed(over: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return {
    outboxId: 'ob-1',
    kind: 'status_update',
    status: 'shipped',
    attempts: 1,
    ref: 'TYB-1',
    contact: { name: 'منى', email: 'mona@example.com' },
    total: 100,
    ...over,
  };
}

function harness(rows: ClaimedEmail[], send: WorkerDeps['send']) {
  const finished: Array<[string, FinishOutcome]> = [];
  const deps: WorkerDeps = {
    claim: async () => rows,
    finish: async (id, result) => {
      finished.push([id, result]);
    },
    send,
  };
  return { deps, finished };
}

describe('processOutbox', () => {
  it('marks sent only with the provider id and passes the idempotency key', async () => {
    const send = vi.fn(async (): Promise<SendOutcome> => ({ outcome: 'sent', providerId: 'msg_9' }));
    const { deps, finished } = harness([claimed()], send);
    const summary = await processOutbox(deps);
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(finished).toEqual([['ob-1', { outcome: 'sent', providerId: 'msg_9' }]]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'order-email-ob-1', to: 'mona@example.com' }),
    );
  });

  it('skips (and never calls the provider) when the customer email is missing or invalid', async () => {
    const send = vi.fn();
    const { deps, finished } = harness(
      [
        claimed({ outboxId: 'a', contact: { name: 'x' } }),
        claimed({ outboxId: 'b', contact: { email: 'garbage' } }),
        claimed({ outboxId: 'c', contact: null }),
      ],
      send,
    );
    const summary = await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(3);
    expect(finished.every(([, r]) => r.outcome === 'skipped')).toBe(true);
  });

  it('records provider failures without marking them sent', async () => {
    const { deps, finished } = harness(
      [claimed({ outboxId: 'a' }), claimed({ outboxId: 'b' })],
      vi.fn()
        .mockResolvedValueOnce({ outcome: 'retry', error: 'provider_http_503' })
        .mockResolvedValueOnce({ outcome: 'failed', error: 'provider_http_403' }),
    );
    const summary = await processOutbox(deps);
    expect(summary).toMatchObject({ sent: 0, retry: 1, failed: 1 });
    expect(finished.map(([, r]) => r.outcome)).toEqual(['retry', 'failed']);
  });

  it('turns a thrown send into a retry and keeps processing the batch', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'sent', providerId: 'm' });
    const { deps, finished } = harness([claimed({ outboxId: 'a' }), claimed({ outboxId: 'b' })], send);
    await processOutbox(deps);
    expect(finished).toEqual([
      ['a', { outcome: 'retry', error: 'worker_exception' }],
      ['b', { outcome: 'sent', providerId: 'm' }],
    ]);
  });

  it('skips rows with an unknown status', async () => {
    const send = vi.fn();
    const { deps, finished } = harness([claimed({ status: 'bogus' })], send);
    await processOutbox(deps);
    expect(send).not.toHaveBeenCalled();
    expect(finished[0][1]).toEqual({ outcome: 'skipped', error: 'unknown_status' });
  });

  it('does nothing when the queue is empty (duplicate/repeated invocations are harmless)', async () => {
    const send = vi.fn();
    const { deps, finished } = harness([], send);
    expect(await processOutbox(deps)).toMatchObject({ claimed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(finished).toEqual([]);
  });

  it('survives finish() failing (row is reclaimed later; provider dedupes by key)', async () => {
    const deps: WorkerDeps = {
      claim: async () => [claimed()],
      finish: async () => {
        throw new Error('db down');
      },
      send: async () => ({ outcome: 'sent', providerId: 'm' }),
    };
    await expect(processOutbox(deps)).resolves.toMatchObject({ sent: 1 });
  });
});
