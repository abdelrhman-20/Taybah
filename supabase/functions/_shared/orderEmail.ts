// Pure (runtime-agnostic) helpers for order emails: rendering, validation,
// provider-response classification. No Deno / Node APIs on purpose, so the
// same file is imported by the Edge Function and unit-tested with vitest
// (see orderEmail.test.ts).

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type EmailKind = 'confirmation' | 'status_update';

// Same labels as src/features/storefront/checkout/orderStore.ts.
export const STATUS_LABELS_AR: Record<OrderStatus, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغٍ',
};

interface StatusCopy {
  subject: (ref: string) => string;
  headline: string;
  body: string;
}

const STATUS_COPY: Record<OrderStatus, StatusCopy> = {
  pending: {
    subject: (ref) => `استلمنا طلبك ${ref} — طيبة`,
    headline: 'تم استلام طلبك',
    body: 'شكرًا لتسوقك من طيبة. استلمنا طلبك وهو قيد المراجعة الآن، وسنتواصل معك لتأكيد التفاصيل. الدفع عند الاستلام.',
  },
  confirmed: {
    subject: (ref) => `تم تأكيد طلبك ${ref} — طيبة`,
    headline: 'تم تأكيد طلبك',
    body: 'راجعنا طلبك وأكدناه. سنبدأ تجهيزه قريبًا وسنوافيك بأي جديد.',
  },
  processing: {
    subject: (ref) => `طلبك ${ref} قيد التجهيز — طيبة`,
    headline: 'طلبك قيد التجهيز',
    body: 'نقوم الآن بتجهيز منتجاتك بعناية وتغليفها تمهيدًا للشحن.',
  },
  shipped: {
    subject: (ref) => `تم شحن طلبك ${ref} — طيبة`,
    headline: 'طلبك في الطريق إليك',
    body: 'تم شحن طلبك وهو في طريقه إليك. يرجى تجهيز مبلغ الطلب للدفع عند الاستلام.',
  },
  delivered: {
    subject: (ref) => `تم تسليم طلبك ${ref} — طيبة`,
    headline: 'تم تسليم طلبك',
    body: 'يسعدنا أن طلبك وصل إليك. نتمنى أن تنال منتجاتنا إعجابك، ونشكرك على ثقتك في طيبة.',
  },
  cancelled: {
    subject: (ref) => `تم إلغاء طلبك ${ref} — طيبة`,
    headline: 'تم إلغاء طلبك',
    body: 'تم إلغاء هذا الطلب. إذا لم تكن أنت من طلب الإلغاء أو كانت لديك أي استفسارات، تواصل معنا وسنكون سعداء بمساعدتك.',
  },
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Deliberately conservative: one @, no whitespace / control chars / angle
// brackets, a dotted domain, and a sane length. Rejects header-injection
// attempts (CR/LF) and multi-recipient strings ("a@b.com, c@d.com").
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 5 || email.length > 254) return false;
  return /^[^\s@<>,;"'()[\]\\]+@[^\s@<>,;"'()[\]\\]+\.[^\s@<>,;"'()[\]\\]{2,}$/.test(email);
}

export function formatTotalAr(total: number): string {
  return `${Number(total).toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`;
}

export interface EmailOrder {
  ref: string;
  status: OrderStatus;
  customerName: string;
  total: number;
  storefrontUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// Brand tokens mirror src/styles/globals.css.
const C = {
  porcelain: '#f7f5f0',
  burgundy: '#681d20',
  gold: '#b58a43',
  espresso: '#29221e',
  taupe: '#d8cfc1',
};
const FONT = "'Cairo','Segoe UI',Tahoma,Arial,sans-serif";

export function renderOrderEmail(order: EmailOrder): RenderedEmail {
  const copy = STATUS_COPY[order.status];
  const name = order.customerName.trim().slice(0, 80);
  const greeting = name ? `مرحبًا ${name}،` : 'مرحبًا،';
  const total = formatTotalAr(order.total);
  const statusLabel = STATUS_LABELS_AR[order.status];
  const url = safeHttpUrl(order.storefrontUrl);

  const text = [
    greeting,
    '',
    copy.headline,
    copy.body,
    '',
    `رقم الطلب: ${order.ref}`,
    `الحالة: ${statusLabel}`,
    `إجمالي الطلب: ${total}`,
    ...(url ? ['', `تابع التسوق: ${url}`] : []),
    '',
    'طيبة — للسجاد والمفروشات والستائر',
  ].join('\n');

  const button = url
    ? `<tr><td align="center" style="padding:8px 32px 32px;">
         <a href="${escapeHtml(url)}" style="display:inline-block;background:${C.burgundy};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 32px;border-radius:27px;">تابع التسوق</a>
       </td></tr>`
    : '';

  const row = (label: string, value: string, ltr = false) =>
    `<tr>
       <td style="padding:10px 0;border-bottom:1px solid ${C.taupe};color:${C.espresso};opacity:.7;font-size:14px;">${label}</td>
       <td style="padding:10px 0;border-bottom:1px solid ${C.taupe};color:${C.espresso};font-size:15px;font-weight:600;text-align:left;"${ltr ? ' dir="ltr"' : ''}>${value}</td>
     </tr>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(copy.headline)}</title>
</head>
<body style="margin:0;padding:0;background:${C.porcelain};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.porcelain};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:600px;background:#ffffff;border:1px solid ${C.taupe};font-family:${FONT};text-align:right;">
    <tr><td align="center" style="background:${C.burgundy};padding:24px 16px;border-bottom:3px solid ${C.gold};">
      <div style="font-family:${FONT};font-size:30px;font-weight:700;color:#ffffff;letter-spacing:1px;">طيبة</div>
      <div style="font-family:${FONT};font-size:12px;color:${C.taupe};margin-top:4px;">للسجاد والمفروشات والستائر</div>
    </td></tr>
    <tr><td style="padding:32px 32px 8px;font-family:${FONT};color:${C.espresso};">
      <p style="margin:0 0 12px;font-size:15px;">${escapeHtml(greeting)}</p>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.5;color:${C.burgundy};">${escapeHtml(copy.headline)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.9;">${escapeHtml(copy.body)}</p>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;font-family:${FONT};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${row('رقم الطلب', escapeHtml(order.ref), true)}
        ${row('حالة الطلب', escapeHtml(statusLabel))}
        ${row('إجمالي الطلب', escapeHtml(total))}
      </table>
    </td></tr>
    ${button}
    <tr><td align="center" style="padding:20px 32px;background:${C.porcelain};border-top:1px solid ${C.taupe};font-family:${FONT};font-size:12px;line-height:1.8;color:${C.espresso};opacity:.75;">
      وصلتك هذه الرسالة لأنك أجريت طلبًا على متجر طيبة. للاستفسار، ردّ على هذه الرسالة أو تواصل معنا عبر المتجر.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject(order.ref), html, text };
}

// ---------------------------------------------------------------------------
// Provider response handling
// ---------------------------------------------------------------------------

export type SendOutcome =
  | { outcome: 'sent'; providerId: string }
  // Transient — worth another attempt after backoff.
  | { outcome: 'retry'; error: string }
  // Will not succeed without human action (bad key, unverified domain,
  // rejected address). Admin can retry once fixed.
  | { outcome: 'failed'; error: string };

// Maps a Resend HTTP response to an outbox outcome. `error` is always a short
// code — never the provider body, which can echo the recipient address.
// "sent" requires BOTH a 2xx and a message id: no id, no acceptance.
export function classifyProviderResponse(status: number, body: unknown): SendOutcome {
  if (status >= 200 && status < 300) {
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.length > 0) return { outcome: 'sent', providerId: id };
    return { outcome: 'retry', error: 'provider_no_message_id' };
  }
  const error = `provider_http_${status}`;
  if (status === 429 || status === 409 || status === 408 || status >= 500) {
    return { outcome: 'retry', error };
  }
  return { outcome: 'failed', error };
}

// ---------------------------------------------------------------------------
// Worker core (dependency-injected so it is testable without Deno/network)
// ---------------------------------------------------------------------------

export interface ClaimedEmail {
  outboxId: string;
  kind: EmailKind;
  status: string;
  attempts: number;
  ref: string;
  contact: { name?: unknown; email?: unknown } | null;
  total: number;
}

export type FinishOutcome =
  | { outcome: 'sent'; providerId: string }
  | { outcome: 'retry'; error: string }
  | { outcome: 'failed'; error: string }
  | { outcome: 'skipped'; error: string };

export interface WorkerDeps {
  claim(limit: number): Promise<ClaimedEmail[]>;
  finish(outboxId: string, result: FinishOutcome): Promise<void>;
  send(args: { idempotencyKey: string; to: string; email: RenderedEmail }): Promise<SendOutcome>;
  storefrontUrl?: string | null;
}

export interface BatchSummary {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  skipped: number;
}

export async function processOutbox(deps: WorkerDeps, limit = 10): Promise<BatchSummary> {
  const summary: BatchSummary = { claimed: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };
  const rows = await deps.claim(limit);
  summary.claimed = rows.length;

  for (const row of rows) {
    let result: FinishOutcome;
    try {
      const to = row.contact?.email;
      if (!isValidEmail(to)) {
        result = { outcome: 'skipped', error: 'no_customer_email' };
      } else if (!isOrderStatus(row.status)) {
        result = { outcome: 'skipped', error: 'unknown_status' };
      } else {
        const email = renderOrderEmail({
          ref: row.ref,
          status: row.status,
          customerName: typeof row.contact?.name === 'string' ? row.contact.name : '',
          total: row.total,
          storefrontUrl: deps.storefrontUrl,
        });
        // The outbox id is the idempotency key: if we crash after the
        // provider accepts but before we record it, the retry is deduped
        // by the provider instead of mailing the customer twice.
        result = await deps.send({
          idempotencyKey: `order-email-${row.outboxId}`,
          to: to.trim(),
          email,
        });
      }
    } catch {
      result = { outcome: 'retry', error: 'worker_exception' };
    }
    summary[result.outcome] += 1;
    try {
      await deps.finish(row.outboxId, result);
    } catch {
      // Row stays 'sending'; claim_order_emails() reclaims it after the
      // lock timeout and the idempotency key prevents a duplicate mail.
    }
  }
  return summary;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
