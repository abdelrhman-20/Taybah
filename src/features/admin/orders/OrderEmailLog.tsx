import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { ORDER_STATUS_LABELS_AR } from '../../storefront/checkout/orderStore';
import { retryOrderEmail, useOrderEmails, type OrderEmailRow } from './orderEmailStore';

// Wording is deliberately conservative: «sent» means the email provider
// accepted the message — not that it reached the customer's inbox.
const STATE_LABEL: Record<OrderEmailRow['state'], string> = {
  pending: 'في قائمة الانتظار',
  sending: 'جارٍ الإرسال',
  sent: 'قبِل مزوّد البريد الرسالة',
  failed: 'فشل الإرسال',
  skipped: 'لم تُرسل',
};

function errorText(code: string | null): string | null {
  if (!code) return null;
  if (code === 'no_customer_email') return 'لا يوجد بريد إلكتروني صالح للعميل';
  if (code === 'superseded') return 'تم تخطيها لأن إشعارًا أحدث أُرسل';
  if (code === 'provider_http_401' || code === 'provider_http_403')
    return 'رفض مزوّد البريد الطلب — تحقق من مفتاح الخدمة ونطاق المرسل';
  if (code === 'provider_unreachable') return 'تعذّر الاتصال بمزوّد البريد';
  return `رمز الخطأ: ${code}`;
}

const stateCls: Record<OrderEmailRow['state'], string> = {
  pending: 'text-espresso/70',
  sending: 'text-espresso/70',
  sent: 'text-espresso',
  failed: 'font-semibold text-burgundy',
  skipped: 'text-espresso/60',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OrderEmailLog({ orderId, status }: { orderId: string; status: string }) {
  const { rows, unavailable, reload } = useOrderEmails(orderId, status);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState(false);

  const retry = async (id: string) => {
    setRetrying(id);
    setRetryError(false);
    try {
      await retryOrderEmail(id);
      await reload();
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(null);
    }
  };

  const hasFailed = rows?.some((r) => r.state === 'failed') ?? false;

  return (
    <section aria-labelledby="od-emails" className="mt-6 rounded border border-taupe/70 bg-white p-5">
      <h3 id="od-emails" className="font-display text-lg text-espresso">إشعارات البريد الإلكتروني</h3>

      {hasFailed && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-xs font-medium text-burgundy">
          <MailWarning className="size-4 shrink-0" aria-hidden />
          تعذّر إرسال بعض الإشعارات إلى العميل. تم حفظ حالة الطلب بنجاح — يمكنك إعادة المحاولة.
        </p>
      )}

      {unavailable ? (
        <p className="mt-3 text-xs text-espresso/55">
          تعذّر تحميل سجل الإشعارات (قد لا يكون إعداد البريد مكتملًا بعد).
        </p>
      ) : rows === null ? (
        <p className="mt-3 text-xs text-espresso/55">جارٍ التحميل…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-espresso/55">لا توجد إشعارات مسجّلة لهذا الطلب.</p>
      ) : (
        <ul className="mt-3 divide-y divide-taupe/50">
          {rows.map((r) => {
            const detail = errorText(r.lastError);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <span className="text-espresso">
                  {r.kind === 'confirmation' ? 'تأكيد الطلب' : 'تحديث الحالة'}
                  {' — '}
                  {ORDER_STATUS_LABELS_AR[r.status] ?? r.status}
                </span>
                <span className={stateCls[r.state]}>{STATE_LABEL[r.state]}</span>
                <span className="text-xs text-espresso/50">{when(r.sentAt ?? r.createdAt)}</span>
                {detail && <span className="w-full text-xs text-espresso/60">{detail}</span>}
                {r.state === 'failed' && (
                  <button
                    type="button"
                    disabled={retrying === r.id}
                    onClick={() => void retry(r.id)}
                    className="ms-auto rounded border border-burgundy px-3 py-1 text-xs font-medium text-burgundy transition hover:bg-burgundy hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    {retrying === r.id ? 'جارٍ…' : 'إعادة المحاولة'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {retryError && (
        <p role="alert" className="mt-2 text-xs font-medium text-burgundy">
          تعذّرت إعادة المحاولة — حاول مرة أخرى.
        </p>
      )}
      <p className="mt-3 text-[11px] leading-5 text-espresso/45">
        «قبِل مزوّد البريد الرسالة» تعني أن الخدمة استلمت الرسالة للإرسال، ولا تضمن وصولها إلى صندوق العميل.
      </p>
    </section>
  );
}
