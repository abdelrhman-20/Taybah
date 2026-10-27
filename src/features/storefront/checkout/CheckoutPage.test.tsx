// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, type Backend } from '../../../test/harness';

// Guest checkout against the FAKE backend (client.mock.ts): the one
// customer-facing flow that writes to the database. Every order triggers a
// confirmation email, so duplicates matter.

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function mount(b: Backend) {
  const { addToCart } = await import('../cart/useCart');
  const { catalogProducts } = await import('../catalog/catalogData');
  const docs = await import('../catalog/catalogDocs');
  await docs.whenDocsSettled();
  addToCart(catalogProducts[0], { color: 'burgundy', size: catalogProducts[0].size }, 1);
  const { CheckoutPage } = await import('./CheckoutPage');
  const cart = await import('../cart/useCart');
  render(
    <MemoryRouter initialEntries={['/ar/checkout']}>
      <Routes>
        <Route path="/:locale/checkout" element={<CheckoutPage />} />
        <Route path="/:locale/order-confirmation/:orderId" element={<p>تم استلام الطلب</p>} />
      </Routes>
    </MemoryRouter>,
  );
  void b;
  return cart;
}

async function fillForm(opts: { building?: string } = {}) {
  await userEvent.type(screen.getByLabelText('الاسم الكامل'), 'منى أحمد');
  await userEvent.type(screen.getByLabelText('رقم الهاتف المحمول'), '01012345678');
  await userEvent.type(screen.getByLabelText('البريد الإلكتروني'), 'mona@example.com');
  const gov = screen.getByLabelText('المحافظة') as HTMLSelectElement;
  await userEvent.selectOptions(gov, gov.options[1].value);
  await userEvent.type(screen.getByLabelText('المدينة / المنطقة'), 'مدينة نصر');
  await userEvent.type(screen.getByLabelText('الشارع بالتفصيل'), 'شارع التسعين');
  await userEvent.type(screen.getByLabelText('رقم المبنى'), opts.building ?? '12');
}

const submit = () => screen.getByRole('button', { name: /^(تأكيد الطلب|جارٍ إرسال الطلب…)$/ }) as HTMLButtonElement;

describe('guest checkout', () => {
  it('creates ONE pending order in the database, clears the cart and shows the confirmation', async () => {
    const b = await freshBackend('anon');
    const cart = await mount(b);
    await fillForm();
    await userEvent.click(submit());
    expect(await screen.findByText('تم استلام الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
    const o = b.tables.orders[0] as { status: string; source: string; contact: { email: string }; ref: string; lines: unknown[] };
    expect(o.status).toBe('pending');
    expect(o.source).toBe('online'); // checkout never produces an in-store order
    expect(o.contact.email).toBe('mona@example.com');
    expect(o.lines).toHaveLength(1);
    expect(cart.getCartLines()).toHaveLength(0);
  });

  it('FAILURE: shows the error, KEEPS the cart and every typed value, and nothing is created', async () => {
    const b = await freshBackend('anon');
    const cart = await mount(b);
    await fillForm();
    b.failNext('from:orders:insert', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(submit());
    expect(await screen.findByText(/تعذّر إرسال الطلب/)).toBeTruthy();
    expect(b.tables.orders).toHaveLength(0);
    expect(cart.getCartLines()).toHaveLength(1); // not cleared
    expect((screen.getByLabelText('الاسم الكامل') as HTMLInputElement).value).toBe('منى أحمد');
    expect(submit().disabled).toBe(false);
    await screen.findByRole('button', { name: 'تأكيد الطلب' });
    await userEvent.click(submit()); // plain retry works
    expect(await screen.findByText('تم استلام الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1);
  });

  it('LOST RESPONSE: the order was saved but the customer saw an error — retrying does NOT create a second order', async () => {
    const b = await freshBackend('anon');
    await mount(b);
    await fillForm();
    b.loseResponseNext('from:orders:insert'); // the server applies it; the answer never arrives
    await userEvent.click(submit());
    expect(await screen.findByText(/تعذّر إرسال الطلب/)).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1); // it did go through
    const firstId = b.tables.orders[0].id;

    await userEvent.click(submit()); // the customer tries again
    expect(await screen.findByText('تم استلام الطلب')).toBeTruthy();
    expect(b.tables.orders).toHaveLength(1); // still exactly one order => one confirmation email
    expect(b.tables.orders[0].id).toBe(firstId);
  });

  it('DUPLICATE SUBMIT: a rapid second submit while the first is in flight is ignored', async () => {
    const b = await freshBackend('anon');
    await mount(b);
    await fillForm();
    const gate = b.hold('from:orders:insert');
    await userEvent.click(submit());
    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(submit().textContent).toContain('جارٍ إرسال الطلب');
    await userEvent.click(submit());
    await userEvent.click(submit());
    gate.release();
    expect(await screen.findByText('تم استلام الطلب')).toBeTruthy();
    expect(b.calls('from:orders:insert')).toBe(1);
    expect(b.tables.orders).toHaveLength(1);
  });

  it('SAME-TICK DOUBLE SUBMIT (Enter pressed twice / scripted): the handler itself refuses a second order', async () => {
    const b = await freshBackend('anon');
    await mount(b);
    await fillForm();
    const gate = b.hold('from:orders:insert');
    const form = submit().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form); // bypasses the (disabled) button entirely
    fireEvent.submit(form);
    gate.release();
    expect(await screen.findByText('تم استلام الطلب')).toBeTruthy();
    expect(b.calls('from:orders:insert')).toBe(1);
    expect(b.tables.orders).toHaveLength(1);
  });

  it('a guest can never create an order in a privileged status from this flow', async () => {
    const b = await freshBackend('anon');
    await mount(b);
    await fillForm();
    await userEvent.click(submit());
    await screen.findByText('تم استلام الطلب');
    expect(b.tables.orders.every((o) => o.status === 'pending')).toBe(true);
  });

  it('client-side validation errors do not touch the database', async () => {
    const b = await freshBackend('anon');
    await mount(b);
    await userEvent.click(submit());
    expect((await screen.findAllByText(/مطلوب|اكتب/)).length).toBeGreaterThan(0);
    expect(b.calls('from:orders:insert')).toBe(0);
  });
});
