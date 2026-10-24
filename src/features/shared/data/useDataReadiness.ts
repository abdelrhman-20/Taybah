import { useCallback, useSyncExternalStore } from 'react';
import { getDocsState, refreshDocs, subscribeDocs } from '../../storefront/catalog/catalogDocs';
import {
  getHomeSyncState,
  refreshHomeContent,
  useHomeSyncState,
} from '../../storefront/home/homeStore';

// Whether the server-backed content (catalog docs + homepage sections) has
// been loaded. The app renders nothing from placeholder/default data while
// 'loading', and shows a retry screen on a first-load 'error' — it never
// quietly falls back to invented demo content when the backend is
// unreachable. A refresh that fails AFTER a successful load keeps showing
// the last good data.
export type Readiness =
  | { phase: 'loading' }
  | { phase: 'error'; code: string }
  | { phase: 'ready' };

export function useDataReadiness(): Readiness & { retry: () => void } {
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const home = useHomeSyncState();

  const retry = useCallback(() => {
    void refreshDocs();
    void refreshHomeContent();
  }, []);

  if (docs.status === 'loading' || home.status === 'loading') {
    return { phase: 'loading', retry };
  }
  if (docs.status === 'error' && !docs.everLoaded) {
    return { phase: 'error', code: docs.error ?? 'unknown', retry };
  }
  if (home.status === 'error' && !home.hadData) {
    return { phase: 'error', code: home.message, retry };
  }
  return { phase: 'ready', retry };
}

// Non-React access, for tests and tooling.
export function currentReadiness(): Readiness['phase'] {
  const docs = getDocsState();
  const home = getHomeSyncState();
  if (docs.status === 'loading' || home.status === 'loading') return 'loading';
  if (docs.status === 'error' && !docs.everLoaded) return 'error';
  if (home.status === 'error' && !home.hadData) return 'error';
  return 'ready';
}
