// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend } from '../../../test/harness';

afterEach(cleanup);

async function mount() {
  const { AdminLoginPage } = await import('./AdminLoginPage');
  render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<p>داخل الإدارة</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), 'admin@example.com');
  await userEvent.type(screen.getByLabelText('كلمة المرور'), 'correct horse');
  await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
}

describe('AdminLoginPage', () => {
  it('signs in and leaves the login page', async () => {
    await freshBackend('anon');
    await mount();
    await fillAndSubmit();
    expect(await screen.findByText('داخل الإدارة')).toBeTruthy();
  });

  it('a wrong password shows the credentials message and re-enables the form', async () => {
    const b = await freshBackend('anon');
    b.failNext('auth:signIn', { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' });
    await mount();
    await fillAndSubmit();
    expect(await screen.findByText('البريد الإلكتروني أو كلمة المرور غير صحيحة.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'تسجيل الدخول' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('REGRESSION: a request that throws (offline) reports a connectivity problem and does not leave the button stuck', async () => {
    const b = await freshBackend('anon');
    b.failNext('auth:signIn', new TypeError('Failed to fetch'), { reject: true });
    await mount();
    await fillAndSubmit();
    expect(await screen.findByText(/تعذر الوصول إلى خدمة تسجيل الدخول/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'تسجيل الدخول' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // not stuck on «جارٍ الدخول…»
    expect(screen.queryByText('البريد الإلكتروني أو كلمة المرور غير صحيحة.')).toBeNull(); // not misreported as bad credentials
  });
});
