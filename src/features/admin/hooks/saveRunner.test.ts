import { describe, expect, it, vi } from 'vitest';
import { createSaveRunner } from './saveRunner';
import { PersistenceError } from '../../../lib/persistence/errors';

describe('save runner (admin save lifecycle)', () => {
  it('reports busy while the save is in flight and ok only after it resolved', async () => {
    const r = createSaveRunner();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const p = r.run(async () => {
      await gate;
      return 42;
    });
    expect(r.getState().busy).toBe(true);
    release();
    await expect(p).resolves.toEqual({ ok: true, value: 42 });
    expect(r.getState()).toEqual({ busy: false, error: null });
  });

  it('ignores duplicate submissions while one is in flight', async () => {
    const r = createSaveRunner();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const fn = vi.fn(async () => {
      await gate;
    });
    const first = r.run(fn);
    const second = await r.run(fn); // double click
    expect(second).toEqual({ ok: false });
    release();
    await first;
    expect(fn).toHaveBeenCalledTimes(1);
    // after completion a new save is allowed again
    await r.run(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('turns a failure into an Arabic message, reports not-ok, and never throws', async () => {
    const r = createSaveRunner();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await r.run(async () => {
      throw new PersistenceError('unauthorized', 'rows written 0/1');
    });
    spy.mockRestore();
    expect(out).toEqual({ ok: false });
    expect(r.getState().busy).toBe(false);
    expect(r.getState().error).toContain('صلاحية');
    expect(r.getState().error).toContain('لم يُحفظ شيء');
  });

  it('clears the previous error when a new save starts', async () => {
    const r = createSaveRunner();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await r.run(async () => {
      throw new Error('boom');
    });
    spy.mockRestore();
    expect(r.getState().error).not.toBeNull();
    const done = r.run(async () => 1);
    expect(r.getState().error).toBeNull();
    await done;
  });

  it('notifies subscribers and supports clearError', async () => {
    const r = createSaveRunner();
    const seen: boolean[] = [];
    const off = r.subscribe(() => seen.push(r.getState().busy));
    await r.run(async () => 1);
    expect(seen).toEqual([true, false]);
    off();
    await r.run(async () => 1);
    expect(seen).toHaveLength(2);
  });
});
