import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { classifyError } from '../../../lib/persistence/errors';
import { supabaseConfigured } from '../../../lib/supabase/client';
import { listRemoteImages } from './mediaStorage';
import { localImageRef, useImageAssets } from './imageStore';

// Unified media-library view for the admin: persistent Storage images
// (origin 'remote') plus any legacy browser-local images that have not been
// migrated yet (origin 'local', visible only in the browser that owns them).

export interface MediaItem {
  ref: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
  origin: 'remote' | 'local';
}

let version = 0;
const listeners = new Set<() => void>();

// Call after anything that adds or removes a Storage object.
export function notifyMediaChanged(): void {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useMediaLibrary(): {
  items: MediaItem[] | null;
  error: string | null;
  reload: () => void;
} {
  const v = useSyncExternalStore(subscribe, () => version);
  const local = useImageAssets();
  const [remote, setRemote] = useState<MediaItem[] | null>(supabaseConfigured ? null : []);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    listRemoteImages().then(
      (list) => {
        if (cancelled) return;
        setError(null);
        setRemote(list.map((r) => ({ ...r, origin: 'remote' as const })));
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(classifyError(e).code);
        setRemote((prev) => prev ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [v, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const items: MediaItem[] | null =
    remote === null || local === null
      ? null
      : [
          ...remote,
          ...local.map((a) => ({
            ref: localImageRef(a.id),
            name: a.name,
            size: a.size,
            type: a.type,
            createdAt: a.createdAt,
            origin: 'local' as const,
          })),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { items, error, reload };
}
