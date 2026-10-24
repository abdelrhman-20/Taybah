// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { category, freshBackend, seedCatalog, type Backend } from '../../../test/harness';

// Save lifecycle of a real admin form (categories/collections) against the
// FAKE backend (client.mock.ts): success only after server confirmation;
// failure keeps the draft; duplicate submissions are ignored; stale edits are
// refused.

afterEach(cleanup);

async function mount(path: string, kind: 'category' | 'collection' = 'category') {
  const { TaxonomyFormPage } = await import('./TaxonomyFormPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/categories" element={<p>قائمة التصنيفات</p>} />
        <Route path="/admin/collections" element={<p>قائمة المجموعات</p>} />
        <Route path="/admin/categories/new" element={<TaxonomyFormPage kind="category" />} />
        <Route path="/admin/categories/:categoryId/edit" element={<TaxonomyFormPage kind="category" />} />
        <Route path="/admin/collections/new" element={<TaxonomyFormPage kind={kind} />} />
      </Routes>
    </MemoryRouter>,
  );
  return docs;
}

async function fill(name: string, slug: string) {
  await userEvent.type(screen.getByLabelText('الاسم بالعربي *'), name);
  await userEvent.type(screen.getByLabelText('الـ slug التقني *'), slug);
}

const submitBtn = () => screen.getByRole('button', { name: /حفظ التصنيف|جارٍ الحفظ/ }) as HTMLButtonElement;
const storedCats = (b: Backend) => b.tables.catalog_docs.filter((d) => d.kind === 'category');

describe('category form — save lifecycle', () => {
  it('saves to the database, and only then leaves the form', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/new');
    await fill('سجاد الصلاة', 'prayer-rugs');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('قائمة التصنيفات')).toBeTruthy();
    const row = storedCats(b).find((d) => d.id === 'prayer-rugs')!;
    expect(row).toBeTruthy();
    expect((row.data as { name: { ar: string } }).name.ar).toBe('سجاد الصلاة');
    expect(row.revision).toBe(1);
  });

  it('FAILURE: shows the real reason, keeps every typed value, stays on the form, saves nothing', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/new');
    await fill('سجاد الصلاة', 'prayer-rugs');
    b.failNext('rpc:catalog_write', { code: '42501', message: 'permission denied' });
    await userEvent.click(submitBtn());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ليست لديك صلاحية');
    expect(alert.textContent).toContain('لم يُحفظ شيء');
    expect((screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement).value).toBe('سجاد الصلاة');
    expect((screen.getByLabelText('الـ slug التقني *') as HTMLInputElement).value).toBe('prayer-rugs');
    expect(screen.queryByText('قائمة التصنيفات')).toBeNull();
    expect(storedCats(b).some((d) => d.id === 'prayer-rugs')).toBe(false);
    expect(submitBtn().disabled).toBe(false); // can retry
  });

  it('a retry after a failure succeeds without retyping', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/new');
    await fill('ستائر', 'drapes');
    b.failNext('rpc:catalog_write', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('قائمة التصنيفات')).toBeTruthy();
    expect(storedCats(b).some((d) => d.id === 'drapes')).toBe(true);
  });

  it('DUPLICATE SUBMIT: a second click while saving is ignored — exactly one write is sent', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/new');
    await fill('ستائر', 'drapes');
    const gate = b.hold('rpc:catalog_write'); // server answers late
    await userEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn().disabled).toBe(true));
    expect(submitBtn().textContent).toContain('جارٍ الحفظ');
    await userEvent.click(submitBtn());
    await userEvent.click(submitBtn());
    gate.release();
    expect(await screen.findByText('قائمة التصنيفات')).toBeTruthy();
    expect(b.calls('rpc:catalog_write')).toBe(1);
    expect(storedCats(b).filter((d) => d.id === 'drapes')).toHaveLength(1);
  });

  it('before the catalog migration it refuses with an explanation and sends nothing', async () => {
    const b = await freshBackend('admin'); // flag not set
    await mount('/admin/categories/new');
    await fill('ستائر', 'drapes');
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('لم يتم ترحيل الكتالوج');
    expect(b.calls('rpc:catalog_write')).toBe(0);
    expect((screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement).value).toBe('ستائر');
  });

  it('client-side validation errors never reach the server', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/new');
    await userEvent.click(submitBtn()); // empty form
    expect(await screen.findByText(/الاسم بالعربي مطلوب/)).toBeTruthy();
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });

  it('a duplicate slug is explained by the server and the draft survives', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    // 'rugs' exists in the database but this form was opened before it appeared
    await mount('/admin/categories/new');
    b.putDoc('category', 'other', category('other'), { slug: 'dup', sort_order: 9 });
    await fill('جديد', 'dup');
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toMatch(/مستخدم/);
    expect((screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement).value).toBe('جديد');
  });

  it('EDIT: a stale form (record changed elsewhere since it opened) is refused and the newer data is kept', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    const docs = await mount('/admin/categories/rugs/edit');
    const nameInput = await screen.findByLabelText('الاسم بالعربي *');
    // another admin saves the same category after this form opened, and this
    // tab's background refresh then picks the newer copy up (so the STORE is
    // ahead of the open FORM — the situation the form's own revision guards).
    const row = storedCats(b).find((d) => d.id === 'rugs')!;
    row.revision = 2;
    (row.data as { name: { ar: string } }).name.ar = 'اسم من مسؤول آخر';
    await docs.refreshDocs();
    expect(docs.docRevision('category', 'rugs')).toBe(2);

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'تعديلي المتأخر');
    await userEvent.click(submitBtn());

    expect((await screen.findByRole('alert')).textContent).toContain('تم تعديل هذا السجل من مكان آخر');
    expect((row.data as { name: { ar: string } }).name.ar).toBe('اسم من مسؤول آخر'); // not overwritten
    expect((screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement).value).toBe('تعديلي المتأخر'); // draft kept
  });

  it('EDIT: a normal edit bumps the revision and persists', async () => {
    const b = await freshBackend('admin');
    seedCatalog(b);
    await mount('/admin/categories/rugs/edit');
    const nameInput = await screen.findByLabelText('الاسم بالعربي *');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'سجاد معدّل');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('قائمة التصنيفات')).toBeTruthy();
    const row = storedCats(b).find((d) => d.id === 'rugs')!;
    expect(row.revision).toBe(2);
    expect((row.data as { name: { ar: string } }).name.ar).toBe('سجاد معدّل');
  });
});
