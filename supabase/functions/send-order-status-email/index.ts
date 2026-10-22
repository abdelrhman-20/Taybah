// Fired by a Database Webhook on INSERT into public.order_status_history
// (see supabase/migrations/0001_orders.sql — every order creation and every
// status change writes a row there via the orders_log_created /
// orders_log_status_change triggers), so this covers both the initial
// "order received" email and every later status update automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Sandbox sender (no verified domain yet): Resend only lets this address
// deliver to the account owner's own inbox. Once a domain is verified in
// Resend (Domains tab), swap this for something like orders@taybah.com.
const FROM_ADDRESS = 'Taybah <onboarding@resend.dev>';

const STATUS_LABELS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  processing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغٍ',
};

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    order_id: string;
    status: string;
    created_at: string;
  };
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const { order_id, status } = payload.record;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: order, error } = await supabase
      .from('orders')
      .select('ref, contact')
      .eq('id', order_id)
      .single();

    if (error || !order) {
      return new Response(JSON.stringify({ error: error?.message ?? 'order not found' }), {
        status: 404,
      });
    }

    const email = order.contact?.email;
    const name = order.contact?.name ?? '';
    if (!email) {
      return new Response(JSON.stringify({ skipped: 'no contact email' }), { status: 200 });
    }

    const statusLabel = STATUS_LABELS_AR[status] ?? status;

    const html = `
      <div dir="rtl" style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>تحديث حالة طلبك</h2>
        <p>مرحبًا ${name}،</p>
        <p>طلبك رقم <strong>${order.ref}</strong> أصبحت حالته الآن:</p>
        <p style="font-size: 18px; font-weight: bold; color: #7b1e3a;">${statusLabel}</p>
        <p>شكرًا لتسوقك معنا — طيبة.</p>
      </div>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: `تحديث طلبك ${order.ref} — ${statusLabel}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const body = await resendRes.text();
      return new Response(JSON.stringify({ error: 'resend failed', body }), { status: 502 });
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
