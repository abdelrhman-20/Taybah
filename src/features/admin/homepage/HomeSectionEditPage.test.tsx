// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, reloadWith, type Backend } from '../../../test/harness';

// The homepage section editor — the workflow behind "I have to save settings
// repeatedly and they don't stick" — against the FAKE backend (client.mock.ts).

afterEach(cleanup);

async function mount(b: Backend, section = 'story') {
  const home = await import('../../storefront/home/homeStore');
  // persist defaults like a previous successful admin save would have
  for (const r of home.rowsFromHomeContent(home.defaultContent())) b.tables.home_sections.push({ ...r });
  await home.refreshHomeContent();
  const { HomeSectionEditRoute } = await import('./HomeSectionEditPage');
  render(
    <MemoryRouter initialEntries={[`/admin/homepage/${section}`]}>
      <Routes>
        <Route path="/admin/homepage" element={<p>أقسام الصفحة الرئيسية</p>} />
        <Route path="/admin/homepage/:sectionKey" element={<HomeSectionEditRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText(/العنوان/);
  return home;
}

const titleInput = () => screen.getByLabelText(/^العنوان/) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /^(حفظ التعديلات|جارٍ الحفظ…)$/ }) as HTMLButtonElement;
const dbTitle = (b: Backend, id = 'story') =>
  (b.tables.home_sections.find((r) => r.id === id)!.data as { title: string }).title;

async function retitle(to: string) {
  await userEvent.clear(titleInput());
  await userEvent.type(titleInput(), to);
}

describe('homepage section editor', () => {
  it('saves to the database, shows the section list only after confirmation, and survives a fresh browser', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await retitle('عنوان محفوظ');
    await userEvent.click(saveBtn());
    expect(await screen.findByText('أقسام الصفحة الرئيسية')).toBeTruthy();
    expect(dbTitle(b)).toBe('عنوان محفوظ');

    // brand-new private window, no browser storage at all
    await reloadWith(b, 'anon');
    const home2 = await import('../../storefront/home/homeStore');
    await home2.refreshHomeContent();
    expect(home2.getHomeContent().story.title).toBe('عنوان محفوظ');
  });

  it('FAILURE: keeps the editor open with the typed text, explains why, and shows NOTHING as saved', async () => {
    const b = await freshBackend('admin');
    const home = await mount(b);
    const original = dbTitle(b);
    await retitle('لن يُحفظ');
    b.failNext('from:home_sections:upsert', { code: '42501', message: 'new row violates row-level security policy' });
    await userEvent.click(saveBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ليست لديك صلاحية');
    expect(titleInput().value).toBe('لن يُحفظ'); // draft intact
    expect(screen.queryByText('أقسام الصفحة الرئيسية')).toBeNull();
    expect(dbTitle(b)).toBe(original);
    expect(home.getHomeContent().story.title).toBe(original); // the shared store never ran ahead of the server
    expect(saveBtn().disabled).toBe(false);
  });

  it('one retry after a failure is enough — no need to retype', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await retitle('بعد إعادة المحاولة');
    b.failNext('from:home_sections:upsert', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(saveBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    await userEvent.click(saveBtn());
    expect(await screen.findByText('أقسام الصفحة الرئيسية')).toBeTruthy();
    expect(dbTitle(b)).toBe('بعد إعادة المحاولة');
  });

  it('CONFLICT: content changed by another admin since the editor opened is not overwritten', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    // another admin changes the same section after this editor opened
    const row = b.tables.home_sections.find((r) => r.id === 'story')!;
    (row.data as { title: string }).title = 'عنوان المسؤول الآخر';
    await retitle('عنواني المتأخر');
    await userEvent.click(saveBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تم تعديل هذا السجل من مكان آخر');
    expect(dbTitle(b)).toBe('عنوان المسؤول الآخر');
    expect(titleInput().value).toBe('عنواني المتأخر');
  });

  it('DUPLICATE SAVE: a second click while saving sends nothing extra', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await retitle('مرة واحدة');
    const gate = b.hold('from:home_sections:upsert');
    await userEvent.click(saveBtn());
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    await userEvent.click(saveBtn());
    gate.release();
    expect(await screen.findByText('أقسام الصفحة الرئيسية')).toBeTruthy();
    expect(b.calls('from:home_sections:upsert')).toBe(1);
  });

  it('a signed-in non-admin can open the editor but cannot save (rejected before any write)', async () => {
    const b = await freshBackend('user');
    const home = await import('../../storefront/home/homeStore');
    for (const r of home.rowsFromHomeContent(home.defaultContent())) b.tables.home_sections.push({ ...r });
    await home.refreshHomeContent();
    const { HomeSectionEditRoute } = await import('./HomeSectionEditPage');
    render(
      <MemoryRouter initialEntries={['/admin/homepage/story']}>
        <Routes>
          <Route path="/admin/homepage/:sectionKey" element={<HomeSectionEditRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await retitle('محاولة');
    await userEvent.click(saveBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect(b.calls('from:home_sections:upsert')).toBe(0);
  });
});
