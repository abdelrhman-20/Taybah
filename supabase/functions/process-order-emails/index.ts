// Outbox worker for order emails. Invoked ONLY by the database (trigger →
// pg_net, and a pg_cron retry sweep) — see
// supabase/migrations/0005_order_email_outbox.sql. Browsers never call it.
//
// Auth: shared secret in the `x-worker-secret` header (deploy with
// --no-verify-jwt; the secret is the gate). Fails closed if unset.
//
// Required secrets:  RESEND_API_KEY, ORDER_EMAIL_WORKER_SECRET
// Optional secrets:  EMAIL_FROM, STOREFRONT_URL
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  classifyProviderResponse,
  processOutbox,
  timingSafeEqual,
  type ClaimedEmail,
  type EmailKind,
  type SendOutcome,
} from '../_shared/orderEmail.ts';

const WORKER_SECRET = Deno.env.get('ORDER_EMAIL_WORKER_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Taybah <onboarding@resend.dev>';
const STOREFRONT_URL = Deno.env.get('STOREFRONT_URL') ?? null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface ClaimRow {
  out_id: string;
  out_kind: EmailKind;
  out_status: string;
  out_attempts: number;
  out_ref: string;
  out_contact: ClaimedEmail['contact'];
  out_total: number | string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!WORKER_SECRET) return json({ error: 'worker_not_configured' }, 503);
  if (!timingSafeEqual(req.headers.get('x-worker-secret') ?? '', WORKER_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!RESEND_API_KEY) {
    // Leave rows pending; they are retried once the secret is set.
    console.error('RESEND_API_KEY is not set; nothing sent');
    return json({ error: 'provider_not_configured' }, 503);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const summary = await processOutbox(
      {
        storefrontUrl: STOREFRONT_URL,
        async claim(limit) {
          const { data, error } = await supabase.rpc('claim_order_emails', { p_limit: limit });
          if (error) throw new Error(`claim failed: ${error.code ?? 'unknown'}`);
          return ((data ?? []) as ClaimRow[]).map((r) => ({
            outboxId: r.out_id,
            kind: r.out_kind,
            status: r.out_status,
            attempts: r.out_attempts,
            ref: r.out_ref,
            contact: r.out_contact,
            total: Number(r.out_total),
          }));
        },
        async finish(outboxId, result) {
          const { error } = await supabase.rpc('finish_order_email', {
            p_id: outboxId,
            p_outcome: result.outcome,
            p_provider_id: result.outcome === 'sent' ? result.providerId : null,
            p_error: result.outcome === 'sent' ? null : result.error,
          });
          if (error) throw new Error(`finish failed: ${error.code ?? 'unknown'}`);
        },
        async send({ idempotencyKey, to, email }): Promise<SendOutcome> {
          try {
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
              },
              body: JSON.stringify({
                from: EMAIL_FROM,
                to: [to],
                subject: email.subject,
                html: email.html,
                text: email.text,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const body = await res.json().catch(() => null);
            return classifyProviderResponse(res.status, body);
          } catch {
            return { outcome: 'retry', error: 'provider_unreachable' };
          }
        },
      },
      10,
    );
    // Counts only — no addresses, names, or provider bodies in logs.
    console.log('order-email batch', JSON.stringify(summary));
    return json(summary);
  } catch (err) {
    console.error('order-email worker error:', err instanceof Error ? err.message : 'unknown');
    return json({ error: 'worker_failed' }, 500);
  }
});
