import { BellRing, X } from 'lucide-react';
import { describeActivity, type Activity } from './activityStore';

// Owner-only pieces of the bell: the list inside the dropdown and the pop-up for a change
// that arrives while the page is open. The caller renders them only for the owner account.

const when = (iso: string) =>
  new Date(iso).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function ActivityList({ items }: { items: Activity[] }) {
  return (
    <section aria-label="نشاط الفريق" className="border-b border-taupe/60">
      <h3 className="px-4 pt-3 text-xs font-semibold tracking-wide text-gold">نشاط الفريق</h3>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-espresso/55">لا توجد تغييرات من الفريق بعد.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-taupe/40 overflow-y-auto">
          {items.slice(0, 20).map((a) => (
            <li key={a.id} className={`flex items-start gap-3 px-4 py-3 ${a.seen ? '' : 'bg-gold/10'}`}>
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${a.seen ? 'bg-transparent' : 'bg-gold'}`}
                aria-label={a.seen ? undefined : 'جديد'}
              />
              <span className="min-w-0">
                <span className="block text-sm leading-6 text-espresso">{describeActivity(a)}</span>
                <span className="block text-[11px] text-espresso/50">{when(a.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActivityToast({ activity, onClose }: { activity: Activity | null; onClose: () => void }) {
  if (!activity) return null;
  return (
    <div
      role="status"
      className="animate-fade-up fixed inset-x-4 top-20 z-50 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-gold/50 bg-espresso px-4 py-3 text-porcelain shadow-xl"
    >
      <BellRing className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
      <p className="flex-1 text-sm leading-6">{describeActivity(activity)}</p>
      <button type="button" onClick={onClose} aria-label="إغلاق" className="shrink-0 text-porcelain/60 hover:text-porcelain">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
