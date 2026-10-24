import { useState, useSyncExternalStore } from 'react';
import { createSaveRunner } from './saveRunner';

export type { SaveOutcome } from './saveRunner';

// One consistent save lifecycle for every admin write — see saveRunner.ts.
// `run` resolves { ok: true, value } ONLY after the awaited persistence call
// resolved (server confirmed + read back), and { ok: false } after setting a
// user-facing Arabic `error`. The caller keeps its draft either way and decides
// what to do on success (navigate, toast, reset). Duplicate calls while a save
// is in flight are ignored.
export function useSaveAction() {
  const [runner] = useState(createSaveRunner);
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  return {
    run: runner.run,
    busy: state.busy,
    error: state.error,
    clearError: runner.clearError,
  };
}
