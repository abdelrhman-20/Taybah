import type { ReactNode } from 'react';
import { CloudOff } from 'lucide-react';
import { useDataReadiness } from '../data/useDataReadiness';
import { LoadingState } from './LoadingState';

// Honest, cause-specific wording: only a real connectivity failure says
// "couldn't reach the server". Other failures show their machine code so a
// support person (or a developer reading a screenshot) can tell them apart.
function failureCopy(code: string): { ar: string; en: string } {
  if (code === 'network') {
    return {
      ar: 'لم نتمكن من الوصول إلى الخادم. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.',
      en: 'We couldn’t reach the server. Check your connection and try again.',
    };
  }
  if (code === 'unauthorized') {
    return {
      ar: 'رفض الخادم الطلب (صلاحيات أو جلسة منتهية). أعد تحميل الصفحة، وإن تكرر الأمر تواصل مع مسؤول الموقع.',
      en: 'The server refused the request (permissions or an expired session). Reload the page.',
    };
  }
  return {
    ar: `حدث خطأ أثناء تحميل المحتوى (رمز: ${code}). أعد المحاولة، وإن تكرر الأمر تواصل مع مسؤول الموقع.`,
    en: `Something went wrong while loading content (code: ${code}). Please try again.`,
  };
}

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
          {failureCopy(r.code).ar}
        </p>
        {bilingual && (
          <p className="max-w-sm text-sm leading-relaxed text-espresso/60" dir="ltr">
            {failureCopy(r.code).en}
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
