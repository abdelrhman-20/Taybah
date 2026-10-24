import type { ReactNode } from 'react';
import { CloudOff } from 'lucide-react';
import { useDataReadiness } from '../data/useDataReadiness';
import { LoadingState } from './LoadingState';

// Blocks rendering until the persistent catalog + homepage content loaded.
// Without this the first paint would show built-in placeholder content and
// then swap to the real data (or, worse, let an admin edit stale defaults).
export function DataGate({ children, bilingual = false }: { children: ReactNode; bilingual?: boolean }) {
  const r = useDataReadiness();

  if (r.phase === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingState label="جارٍ التحميل…" />
      </div>
    );
  }

  if (r.phase === 'error') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border border-taupe text-espresso/50">
          <CloudOff className="size-6" aria-hidden />
        </span>
        <h2 className="font-display text-xl text-espresso">تعذّر تحميل المحتوى</h2>
        <p className="max-w-sm text-sm leading-relaxed text-espresso/60">
          لم نتمكن من الوصول إلى الخادم. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.
        </p>
        {bilingual && (
          <p className="max-w-sm text-sm leading-relaxed text-espresso/60" dir="ltr">
            We couldn’t reach the server. Check your connection and try again.
          </p>
        )}
        <button
          type="button"
          onClick={r.retry}
          className="rounded bg-burgundy px-6 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
