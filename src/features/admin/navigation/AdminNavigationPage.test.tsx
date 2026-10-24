// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { freshBackend, seedCatalog, type Backend } from '../../../test/harness';

// Navigation editor against the FAKE backend (client.mock.ts).

afterEach(cleanup);

const item = (id: string, label: string, path: string) => ({ id, label, kind: 'internal', path, visible: true });

async function mount(b: Backend) {
  seedCatalog(b);
  b.putDoc('nav', 'main', { items: [item('shop', 'تسوق الكل', '/products'), item('rugs', 'سجاد', '/category/rugs')] });
  b.putDoc('nav', 'footer', { items: [item('faq', 'الأسئلة الشائعة', '/faq')] });
  const { AdminNavigationPage } = await import('./AdminNavigationPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter>
      <AdminNavigationPage />
    </MemoryRouter>,
  );
}

const mainItems = (b: Backend) =>
  ((b.tables.catalog_docs.find((d) => d.kind === 'nav' && d.id === 'main')!.data as { items: Array<{ id: string; label: string; visible: boolean }> }).items);

async function openAddMain() {
  await userEvent.click(screen.getAllByRole('button', { name: /إضافة رابط$/ })[0]);
}
async function fillLink(label: string, path: string) {
  await userEvent.type(screen.getByLabelText('الاسم بالعربي *'), label);
  await userEvent.type(screen.getByLabelText(/الوجهة/), path);
}
const saveBtn = () => screen.getByRole('button', { name: /^(إضافة الرابط|حفظ الرابط|جارٍ الحفظ…)$/ }) as HTMLButtonElement;

describe('navigation editor — save lifecycle', () => {
  it('adds a link: the menu changes only after the database confirmed it', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await openAddMain();
    await fillLink('المجموعات', '/collections');
    await userEvent.click(saveBtn());
    await waitFor(() => expect(mainItems(b).map((i) => i.label)).toContain('المجموعات'));
    await waitFor(() => expect(screen.queryByLabelText('الاسم بالعربي *')).toBeNull()); // form closed after success
    expect(screen.getByText('المجموعات')).toBeTruthy();
  });

  it('FAILURE: the form stays open with the typed values, the real reason is shown, nothing is saved', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await openAddMain();
    await fillLink('المجموعات', '/collections');
    b.failNext('rpc:catalog_write', { code: '42501', message: 'permission denied' });
    await userEvent.click(saveBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect((screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement).value).toBe('المجموعات');
    expect(mainItems(b).map((i) => i.label)).not.toContain('المجموعات');
    expect(saveBtn().disabled).toBe(false);
  });

  it('toggling visibility persists, and a failure is surfaced without changing what is shown', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    const first = () => screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(first().checked).toBe(true);
    b.failNext('rpc:catalog_write', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(first());
    expect((await screen.findAllByRole('alert'))[0].textContent).toContain('تعذّر الاتصال بالخادم');
    expect(first().checked).toBe(true); // still shows the real (unchanged) state
    expect(mainItems(b).every((i) => i.visible)).toBe(true);

    await userEvent.click(first());
    await waitFor(() => expect(mainItems(b).some((i) => !i.visible)).toBe(true));
    await waitFor(() => expect(first().checked).toBe(false));
  });

  it('deleting a link needs confirmation and persists; a failed delete keeps the dialog open with the error', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await userEvent.click(screen.getAllByRole('button', { name: /^حذف/ })[0]);
    const dialog = await screen.findByRole('alertdialog');
    b.failNext('rpc:catalog_write', { code: '42501', message: 'forbidden' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'حذف الرابط' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect(mainItems(b)).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'حذف الرابط' }));
    await waitFor(() => expect(mainItems(b)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('refuses edits until the catalog is migrated (nothing sent)', async () => {
    const b = await freshBackend('admin'); // built-in menus, flag unset
    const { AdminNavigationPage } = await import('./AdminNavigationPage');
    const docs = await import('../../storefront/catalog/catalogDocs');
    await docs.whenDocsSettled();
    render(
      <MemoryRouter>
        <AdminNavigationPage />
      </MemoryRouter>,
    );
    await openAddMain();
    await fillLink('رابط', '/x');
    await userEvent.click(saveBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('لم يتم ترحيل الكتالوج');
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });
});
