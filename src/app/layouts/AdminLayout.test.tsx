// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog } from '../../test/harness';

// Admin shell against the FAKE backend (client.mock.ts): authentication,
// server-side admin check (public.admins via is_admin()), and the catalog
// migration banner.

afterEach(cleanup);

async function mount() {
  const { AdminLayout } = await import('./AdminLayout');
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin/login" element={<p>صفحة تسجيل الدخول</p>} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>محتوى صفحة الإدارة</p>} />
          <Route path="migration" element={<p>صفحة الترحيل</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout — authentication and authorization', () => {
  it('redirects a signed-out visitor to the login page', async () => {
    await freshBackend('anon');
    await mount();
    expect(await screen.findByText('صفحة تسجيل الدخول')).toBeTruthy();
    expect(screen.queryByText('محتوى صفحة الإدارة')).toBeNull();
  });

  it('a signed-in user who is NOT an admin gets a clear unauthorized screen, not a broken admin UI', async () => {
    const b = await freshBackend('user');
    seedCatalog(b, [product('p1')]);
    await mount();
    expect(await screen.findByText('ليس لديك صلاحية المسؤول')).toBeTruthy();
    expect(screen.queryByText('محتوى صفحة الإدارة')).toBeNull();
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeTruthy();
  });

  it('shows the admin panel to a verified admin', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    await mount();
    expect(await screen.findByText('محتوى صفحة الإدارة')).toBeTruthy();
    expect(screen.queryByText('ليس لديك صلاحية المسؤول')).toBeNull();
  });

  it('when the admin check itself cannot be performed it says so and offers a retry (never a silent pass)', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    b.failNext('rpc:is_admin', new TypeError('Failed to fetch'), { reject: true });
    await mount();
    expect(await screen.findByText('تعذّر التحقق من صلاحياتك')).toBeTruthy();
    expect(screen.queryByText('محتوى صفحة الإدارة')).toBeNull();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
  });
});

describe('AdminLayout — catalog migration banner', () => {
  it('warns that catalog edits are disabled until the migration is done (tables exist, flag unset)', async () => {
    await freshBackend('admin'); // tables present, never initialized
    await mount();
    expect(await screen.findByText('محتوى صفحة الإدارة')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('لم يُرحَّل');
    expect(alert.textContent).not.toContain('0006');
    expect(screen.getByRole('link', { name: 'فتح النسخ الاحتياطي والترحيل' }).getAttribute('href')).toBe('/admin/migration');
  });

  it('names migration 0006 when the catalog tables do not exist at all', async () => {
    const b = await freshBackend('admin');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    await mount();
    expect(await screen.findByText('محتوى صفحة الإدارة')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('0006');
  });

  it('shows no banner once the catalog is migrated', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b, [product('p1')]);
    await mount();
    expect(await screen.findByText('محتوى صفحة الإدارة')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
