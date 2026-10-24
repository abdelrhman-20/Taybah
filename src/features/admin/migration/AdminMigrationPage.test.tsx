// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { freshBackend, product, type Backend } from '../../../test/harness';

// The migration page end to end against the FAKE backend (client.mock.ts):
// the safeguards (backup first, dry run first, conflicts block activation) and
// the happy path. The import RPC's own SQL is verified in supabase/tests.

beforeEach(() => {
  // jsdom has no object-URL support or navigation; the backup "download"
  // is observed through these stubs.
  URL.createObjectURL = vi.fn(() => 'blob:backup');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(cleanup);

async function mount(b: Backend) {
  const { AdminMigrationPage } = await import('./AdminMigrationPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter>
      <AdminMigrationPage />
    </MemoryRouter>,
  );
  void b;
  return docs;
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function readSource() {
  await userEvent.click(btn('قراءة بيانات هذا المتصفح'));
  await screen.findByText(/المصدر: هذا المتصفح/);
}

describe('migration page — safeguards', () => {
  it('nothing can be executed before the source is read, the backup is saved and the dry run is done', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    expect(btn('تنزيل النسخة الاحتياطية').disabled).toBe(true);
    expect(btn('تشغيل الفحص التجريبي').disabled).toBe(true);
    expect(btn('بدء الترحيل').disabled).toBe(true);
    expect(btn('اعتماد وتفعيل').disabled).toBe(true);

    await readSource();
    // source read, but still no backup / no dry run => execution stays locked
    expect(btn('بدء الترحيل').disabled).toBe(true);
    expect(screen.getByText('نزّل النسخة الاحتياطية أولًا.')).toBeTruthy();

    await userEvent.click(btn('تنزيل النسخة الاحتياطية'));
    await screen.findByText('تم تجهيز النسخة الاحتياطية.');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1); // the zip was produced for download
    expect(btn('بدء الترحيل').disabled).toBe(true); // backup alone is not enough
    expect(screen.getByText('شغّل الفحص التجريبي أولًا.')).toBeTruthy();

    await userEvent.click(btn('تشغيل الفحص التجريبي'));
    await screen.findByText(/سيُضاف:/);
    expect(btn('بدء الترحيل').disabled).toBe(false); // now allowed
    expect(b.tables.catalog_docs).toHaveLength(0); // the dry run wrote nothing
  });

  it('the dry run explains what the browser never saved (it will import the built-in content)', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await readSource();
    expect(screen.getByText(/لم يُحفظ في هذا المصدر أي تعديل/)).toBeTruthy();
  });

  it('a corrupt local data source blocks everything and says why', async () => {
    const b = await freshBackend('admin');
    localStorage.setItem('taybah:catalog', '{not json');
    await mount(b);
    await readSource();
    expect(screen.getByText(/تالفة ولا يمكن قراءتها/)).toBeTruthy();
    expect(btn('تنزيل النسخة الاحتياطية').disabled).toBe(false); // you can still keep a backup of what exists
    expect(btn('تشغيل الفحص التجريبي').disabled).toBe(true);
    localStorage.clear();
  });
});

describe('migration page — run', () => {
  async function prepare(b: Backend) {
    const docs = await mount(b);
    await readSource();
    await userEvent.click(btn('تنزيل النسخة الاحتياطية'));
    await screen.findByText('تم تجهيز النسخة الاحتياطية.');
    await userEvent.click(btn('تشغيل الفحص التجريبي'));
    await screen.findByText(/سيُضاف:/);
    return docs;
  }

  it('happy path: imports, verifies against the database, then activation switches the catalog on', async () => {
    const b = await freshBackend('admin');
    const docs = await prepare(b);
    await userEvent.click(btn('بدء الترحيل'));
    await screen.findByText(/تم التحقق:/);
    expect(b.tables.catalog_docs.length).toBeGreaterThan(20);
    expect(docs.getDocsState().initialized).toBe(false); // verified, but NOT yet live

    expect(btn('اعتماد وتفعيل').disabled).toBe(false);
    await userEvent.click(btn('اعتماد وتفعيل'));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'اعتماد وتفعيل' }));
    await waitFor(() => expect(docs.getDocsState().initialized).toBe(true));
    expect(await screen.findByText(/الكتالوج مُرحَّل ومُفعَّل/)).toBeTruthy();
  });

  it('CONFLICTS are listed, nothing is overwritten, and activation stays blocked', async () => {
    const b = await freshBackend('admin');
    // the database already holds a DIFFERENT version of a built-in product
    b.putDoc('product', 'p01', product('p01', { price: 424242 }), { slug: 'bokhara-hand-knotted-rug' });
    await prepare(b);
    expect(screen.getAllByText(/تعارضات/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/product\/p01/).length).toBeGreaterThan(0); // the conflicting record is named
    await userEvent.click(btn('بدء الترحيل'));
    await screen.findByText(/تم التحقق|فشل التحقق/);
    expect((b.tables.catalog_docs.find((d) => d.id === 'p01')!.data as { price: number }).price).toBe(424242); // untouched
    expect(btn('اعتماد وتفعيل').disabled).toBe(true);
  });

  it('a failed import is reported (not shown as success) and the catalog is not activated', async () => {
    const b = await freshBackend('admin');
    const docs = await prepare(b);
    b.failNext('rpc:catalog_import', { code: '42501', message: 'forbidden' });
    await userEvent.click(btn('بدء الترحيل'));
    expect((await screen.findAllByRole('alert')).some((a) => /صلاحية/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.queryByText(/تم التحقق:/)).toBeNull();
    expect(docs.getDocsState().initialized).toBe(false);
    expect(btn('اعتماد وتفعيل').disabled).toBe(true);
  });

  it('rollback switches the storefront back to the built-in catalog without deleting any data', async () => {
    const b = await freshBackend('admin');
    const docs = await prepare(b);
    await userEvent.click(btn('بدء الترحيل'));
    await screen.findByText(/تم التحقق:/);
    await userEvent.click(btn('اعتماد وتفعيل'));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'اعتماد وتفعيل' }));
    await waitFor(() => expect(docs.getDocsState().initialized).toBe(true));
    const before = b.tables.catalog_docs.length;

    await userEvent.click(btn('الرجوع إلى الكتالوج المدمج'));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'رجوع' }));
    await waitFor(() => expect(docs.getDocsState().initialized).toBe(false));
    expect(b.tables.catalog_docs).toHaveLength(before);
  });
});
