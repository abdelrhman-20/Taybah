import { describe, expect, it } from 'vitest';
import { PersistenceError, classifyError, describePersistenceError, withTimeout } from './errors';
import { jsonEqual, stableStringify } from './stableJson';

describe('classifyError', () => {
  it.each([
    [{ code: 'CF001', message: 'revision_conflict' }, 'conflict'],
    [{ code: 'CF002', message: 'not_found' }, 'not_found'],
    [{ code: 'CF003', message: 'already_exists' }, 'exists'],
    [{ code: 'CF004', message: 'duplicate_slug' }, 'duplicate_slug'],
    [{ code: 'CF005', message: 'duplicate_sku', details: 'Key (sku)=(abc-1) already exists.' }, 'duplicate_sku'],
    [{ code: '22023', message: 'invalid_ops' }, 'invalid'],
    [{ code: '42501', message: 'forbidden' }, 'unauthorized'],
    [{ code: '42501', message: 'new row violates row-level security policy' }, 'unauthorized'],
    [{ message: 'permission denied for table catalog_docs' }, 'unauthorized'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'unauthorized'],
    [{ code: 'PGRST205', message: "Could not find the table 'public.x'" }, 'schema_missing'],
    [{ code: '42883', message: 'function does not exist' }, 'schema_missing'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ message: 'AbortError: signal aborted' }, 'network'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
  ])('maps %j to %s', (input, code) => {
    expect(classifyError(input).code).toBe(code);
  });

  it('passes an existing PersistenceError through unchanged', () => {
    const e = new PersistenceError('conflict', 'x');
    expect(classifyError(e)).toBe(e);
  });

  it('keeps diagnostics short and free of credentials-shaped input', () => {
    const e = classifyError({ code: 'XX000', message: 'a'.repeat(1000), details: 'd'.repeat(1000) });
    expect(e.detail.length).toBeLessThanOrEqual(300);
  });
});

describe('describePersistenceError', () => {
  it('gives every code a non-empty Arabic message', () => {
    const codes = [
      'unconfigured', 'not_initialized', 'unauthorized', 'conflict', 'not_found', 'exists',
      'duplicate_slug', 'duplicate_sku', 'invalid', 'schema_missing', 'verify_failed', 'network', 'unknown',
    ] as const;
    for (const c of codes) {
      const msg = describePersistenceError(new PersistenceError(c));
      expect(msg.length).toBeGreaterThan(10);
      expect(/[؀-ۿ]/.test(msg)).toBe(true);
    }
  });

  it('the duplicate-SKU message tells the admin what to do and that nothing was saved', () => {
    const msg = describePersistenceError(new PersistenceError('duplicate_sku'));
    expect(msg).toContain('SKU');
    expect(msg).toContain('غيّره');
    expect(msg).toContain('لم يُحفظ شيء');
  });

  it('states plainly when nothing was saved', () => {
    expect(describePersistenceError(new PersistenceError('network'))).toContain('لم يُحفظ شيء');
    expect(describePersistenceError(new PersistenceError('conflict'))).toContain('لم يُحفظ شيء');
  });
});

describe('withTimeout', () => {
  it('rejects with a network error when the call never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toMatchObject({ code: 'network' });
  });
  it('passes through a value that settles in time', async () => {
    await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
  });
});

describe('stableJson', () => {
  it('ignores key order (jsonb normalisation) at any depth', () => {
    expect(jsonEqual({ a: 1, b: { c: [1, { x: 1, y: 2 }] } }, { b: { c: [1, { y: 2, x: 1 }] }, a: 1 })).toBe(true);
  });
  it('still detects real differences, including array order', () => {
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
  it('treats undefined fields as absent', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('inventory error codes (migration 0009)', () => {
  it('maps IS001 to stock_not_initialized and IS005 to idempotency_key_reuse', () => {
    expect(classifyError({ code: 'IS001', message: 'stock_not_initialized', details: 'p1' }).code).toBe('stock_not_initialized');
    const reuse = classifyError({ code: 'IS005', message: 'idempotency_key_reuse', details: 'differs: counted' });
    expect(reuse.code).toBe('idempotency_key_reuse');
    expect(reuse.detail).toContain('differs: counted');
  });

  it('gives both a non-empty Arabic message that says nothing was saved', () => {
    for (const code of ['stock_not_initialized', 'idempotency_key_reuse'] as const) {
      const msg = describePersistenceError(new PersistenceError(code));
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).toMatch(/[\u0600-\u06FF]/);
      expect(msg).toMatch(/لم يُ(حفظ|سجَّل)/);
    }
  });
});

