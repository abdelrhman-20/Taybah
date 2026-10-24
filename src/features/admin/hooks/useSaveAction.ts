import { useCallback, useRef, useState } from 'react';
import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';

// One consistent save lifecycle for every admin write:
//   idle -> busy (duplicate submits ignored) -> ok | error
// `run` resolves { ok: true, value } ONLY after the awaited persistence call
// resolved (i.e. the server confirmed and read back), and { ok: false } after
// setting a user-facing Arabic `error`. The caller keeps its draft either
// way and decides what to do on success (navigate, toast, reset).
export type SaveOutcome<T> = { ok: true; value: T } | { ok: false };

export function useSaveAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<SaveOutcome<T>> => {
    if (inFlight.current) return { ok: false };
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (e) {
      const err = classifyError(e);
      // Diagnostics only: code + safe detail, never form contents.
      console.error('admin save failed:', err.code, err.detail);
      setError(describePersistenceError(err));
      return { ok: false };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { run, busy, error, clearError };
}
