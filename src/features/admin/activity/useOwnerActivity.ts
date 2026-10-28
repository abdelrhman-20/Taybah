import { useEffect, useState } from 'react';
import { startActivity, useActivity, type Activity } from './activityStore';

// Follows the log while `enabled`; `toast` is the newest live arrival (cleared after 8 s).
export function useOwnerActivity(enabled: boolean) {
  const items = useActivity();
  const [toast, setToast] = useState<Activity | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return startActivity((a) => setToast(a));
  }, [enabled]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = enabled ? items : [];
  return {
    items: visible,
    unseen: visible.filter((a) => !a.seen).length,
    toast: enabled ? toast : null,
    dismissToast: () => setToast(null),
  };
}
