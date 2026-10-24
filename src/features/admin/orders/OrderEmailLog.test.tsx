// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { freshBackend, type Backend } from '../../../test/harness';

// The admin email-status panel against the FAKE backend (client.mock.ts).
// Requirement under test: show what the provider actually reported — accepted,
// failed, skipped, pending — and NEVER claim inbox delivery.

afterEach(cleanup);

const outbox = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  id,
  order_id: 'o1',
  kind: 'status_update',
  status: 'shipped',
  state,
  attempts: 1,
  last_error: null,
  sent_at: null,
  created_at: '2026-01-01T10:00:00Z',
  ...over,
});

async function mount(b: Backend, rows: ReturnType<typeof outbox>[]) {
  b.tables.order_email_outbox.push(...rows);
  const { OrderEmailLog } = await import('./OrderEmailLog');
  render(<OrderEmailLog orderId="o1" status="shipped" />);
}

describe('order email log', () => {
  it('describes a provider-accepted email as accepted — never as delivered', async () => {
    const b = await freshBackend('admin');
    await mount(b, [outbox('a', 'sent', { sent_at: '2026-01-01T10:01:00Z' })]);
    expect(await screen.findByText('قبِل مزوّد البريد الرسالة')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('لا تضمن وصولها إلى صندوق العميل');
    expect(text).not.toMatch(/تم التسليم|تم تسليم|وصلت/);
  });

  it('a FAILED email is called out with the reason and a retry; the order status itself is said to be saved', async () => {
    const b = await freshBackend('admin');
    await mount(b, [outbox('f', 'failed', { attempts: 5, last_error: 'provider_http_403' })]);
    expect(await screen.findByText('فشل الإرسال')).toBeTruthy();
    expect(screen.getByText(/رفض مزوّد البريد الطلب/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('تم حفظ حالة الطلب بنجاح');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });

  it('retry re-queues the email through the admin-only RPC and the list reflects it', async () => {
    const b = await freshBackend('admin');
    await mount(b, [outbox('f', 'failed', { attempts: 5, last_error: 'provider_http_503' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getByText('في قائمة الانتظار')).toBeTruthy());
    expect(b.calls('rpc:retry_order_email')).toBe(1);
    expect(b.tables.order_email_outbox[0].state).toBe('pending');
    expect(screen.queryByRole('button', { name: 'إعادة المحاولة' })).toBeNull();
  });

  it('a retry that the server refuses is reported', async () => {
    const b = await freshBackend('admin');
    await mount(b, [outbox('f', 'failed', { last_error: 'provider_http_503' })]);
    b.failNext('rpc:retry_order_email', { code: '42501', message: 'forbidden' });
    await userEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    expect((await screen.findAllByRole('alert')).some((a) => /تعذّرت إعادة المحاولة/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByText('فشل الإرسال')).toBeTruthy();
  });

  it('shows skipped (no customer email) and pending states plainly', async () => {
    const b = await freshBackend('admin');
    await mount(b, [
      outbox('s', 'skipped', { last_error: 'no_customer_email' }),
      outbox('p', 'pending', { status: 'processing', created_at: '2026-01-01T09:00:00Z' }),
    ]);
    expect(await screen.findByText('لم تُرسل')).toBeTruthy();
    expect(screen.getByText('لا يوجد بريد إلكتروني صالح للعميل')).toBeTruthy();
    expect(screen.getByText('في قائمة الانتظار')).toBeTruthy();
  });

  it('when the outbox cannot be read (migration 0005 not applied) it says so instead of claiming success', async () => {
    const b = await freshBackend('admin');
    delete b.tables.order_email_outbox;
    const { OrderEmailLog } = await import('./OrderEmailLog');
    render(<OrderEmailLog orderId="o1" status="pending" />);
    expect(await screen.findByText(/تعذّر تحميل سجل الإشعارات/)).toBeTruthy();
    expect(within(document.body).queryByText('قبِل مزوّد البريد الرسالة')).toBeNull();
  });

  it('an order with no notifications says there are none', async () => {
    const b = await freshBackend('admin');
    await mount(b, []);
    expect(await screen.findByText('لا توجد إشعارات مسجّلة لهذا الطلب.')).toBeTruthy();
  });
});
