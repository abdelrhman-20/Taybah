import { classifyError, describePersistenceError } from '../../../lib/persistence/errors';

// Framework-free core of the admin save lifecycle (wrapped by useSaveAction):
//   idle -> busy -> ok | error
// A second run() while one is in flight is IGNORED (duplicate-submit guard),
// `ok` is reported only after the awaited persistence call resolved, and a
// failure produces a user-facing Arabic message while the caller keeps its
// draft.

export type SaveOutcome<T> = { ok: true; value: T } | { ok: false };

export interface SaveState {
  busy: boolean;
  error: string | null;
}

export interface SaveRunner {
  run<T>(fn: () => Promise<T>): Promise<SaveOutcome<T>>;
  getState(): SaveState;
  subscribe(listener: () => void): () => void;
  clearError(): void;
}

export function createSaveRunner(): SaveRunner {
  let state: SaveState = { busy: false, error: null };
  let inFlight = false;
  const listeners = new Set<() => void>();

  const set = (next: SaveState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<SaveOutcome<T>> {
      if (inFlight) return { ok: false };
      inFlight = true;
      set({ busy: true, error: null });
      try {
        const value = await fn();
        set({ busy: false, error: null });
        return { ok: true, value };
      } catch (e) {
        const err = classifyError(e);
        // Diagnostics only: code + safe detail, never form contents.
        console.error('admin save failed:', err.code, err.detail);
        set({ busy: false, error: describePersistenceError(err) });
        return { ok: false };
      } finally {
        inFlight = false;
      }
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearError() {
      if (state.error !== null) set({ ...state, error: null });
    },
  };
}
