import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase/client';

// WHO MAY SEE THE PROFIT PAGE. Only this one account. Every other admin
// (e.g. the shop-floor account) gets no «الأرباح» menu item and is bounced
// away if they open /admin/profit by hand.
//
// This is a UI restriction: the wholesale prices it is built from are still
// readable by any admin through the database (migration 0007), so the account
// list here is a convenience boundary, not a security one.
export const PROFIT_VIEWER_EMAIL = 'nehro@info.com';

// How the owner is greeted in the admin.
export const OWNER_NAME = 'Mr Nehro';

export function canViewProfit(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === PROFIT_VIEWER_EMAIL;
}

// undefined = still reading the session; null = signed out.
export function useSessionEmail(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(
      ({ data }) => live && setEmail(data.session?.user.email ?? null),
      () => live && setEmail(null),
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      setEmail(next?.user.email ?? null);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return email;
}
