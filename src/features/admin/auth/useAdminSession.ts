import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase/client';

// Admin auth state. A signed-in Supabase user is NOT automatically an admin:
// the database only lets rows in public.admins write (is_admin() in RLS and
// every write RPC). This hook asks the database the same question the RLS
// policies ask, so the UI can say "you are not an admin" up front instead of
// letting every save fail.
//
//   checking    – session or admin check still in flight
//   signed_out  – no session
//   admin       – signed in and listed in public.admins
//   not_admin   – signed in, but the database says this user may not write
//   error       – could not ask (network); retry available
export type AdminAccess = 'checking' | 'signed_out' | 'admin' | 'not_admin' | 'error';

interface CheckResult {
  key: string; // `${userId}:${nonce}` the result belongs to
  access: 'admin' | 'not_admin' | 'error';
}

export function useAdminSession(): {
  session: Session | null;
  loading: boolean;
  access: AdminAccess;
  recheck: () => void;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(
      ({ data }) => {
        setSession(data.session);
        setLoading(false);
      },
      (e: unknown) => {
        // Could not even read the stored session: treat as signed out
        // rather than spinning forever.
        console.error('session read failed:', e instanceof Error ? e.message : e);
        setSession(null);
        setLoading(false);
      },
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  const key = userId ? `${userId}:${nonce}` : null;

  useEffect(() => {
    if (loading || !key) return;
    let cancelled = false;
    void Promise.resolve(supabase.rpc('is_admin')).then(
      ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('admin check failed:', error.code, error.message);
          setResult({ key, access: 'error' });
        } else {
          setResult({ key, access: data === true ? 'admin' : 'not_admin' });
        }
      },
      () => {
        if (!cancelled) setResult({ key, access: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loading, key]);

  // Derived, not stored: no synchronous setState inside effects.
  const access: AdminAccess = loading
    ? 'checking'
    : !userId
      ? 'signed_out'
      : result && result.key === key
        ? result.access
        : 'checking';

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { session, loading, access, recheck };
}
