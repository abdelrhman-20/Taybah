// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// Save lifecycle of the product editor against the FAKE backend (client.mock.ts).

afterEach(cleanup);

async function mount(b: Backend, path = '/admin/products/p1/edit') {
  seedCatalog(b, [product('p1', { price: 1000 })]);
  const { ProductFormPage } = await import('./ProductFormPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/products/:productId/edit" element={<ProductFormPage />} />
        <Route path="/admin/products/:productId" element={<p>تفاصيل المنتج</p>} />
        <Route path="/admin/products" element={<p>قائمة المنتجات</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText('الاسم بالعربي *');
  return docs;
}

const nameInput = () => screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement;
const priceInput = () => screen.getByLabelText('السعر (ج.م) *') as HTMLInputElement;
const submitBtn = () => screen.getByRole('button', { name: /^(حفظ التعديلات|جارٍ الحفظ…)$/ }) as HTMLButtonElement;
const row = (b: Backend) => b.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === 'p1')!;
const dbName = (b: Backend) => (row(b).data as { name: { ar: string } }).name.ar;

async function rename(to: string) {
  await userEvent.clear(nameInput());
  await userEvent.type(nameInput(), to);
}

describe('product editor — save lifecycle', () => {
  it('saves the edit, bumps the revision, and navigates only after the server confirmed', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await rename('اسم جديد');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(dbName(b)).toBe('اسم جديد');
    expect(row(b).revision).toBe(2);
  });

  it('FAILURE: shows the reason, keeps the typed values, stays on the form, and a retry succeeds', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await rename('تعديل لن يُحفظ');
    b.failNext('rpc:catalog_write', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(nameInput().value).toBe('تعديل لن يُحفظ');
    expect(screen.queryByText('تفاصيل المنتج')).toBeNull();
    expect(dbName(b)).toBe('منتج p1');
    // retry without retyping
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(dbName(b)).toBe('تعديل لن يُحفظ');
  });

  it('a non-admin save attempt is refused with the unauthorized message; nothing changes', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await rename('محاولة');
    b.failNext('rpc:catalog_write', { code: '42501', message: 'forbidden' });
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('ليست لديك صلاحية');
    expect(dbName(b)).toBe('منتج p1');
  });

  it('STALE: a product changed elsewhere since the form opened is NOT overwritten', async () => {
    const b = await freshBackend('admin');
    const docs = await mount(b);
    // another admin edits the product; this tab's background refresh sees it
    row(b).revision = 5;
    (row(b).data as { price: number }).price = 7777;
    await docs.refreshDocs();

    await rename('تعديلي القديم');
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تم تعديل هذا السجل من مكان آخر');
    expect((row(b).data as { price: number }).price).toBe(7777);
    expect(dbName(b)).toBe('منتج p1');
    expect(nameInput().value).toBe('تعديلي القديم'); // draft preserved for the user to re-apply
  });

  it('DUPLICATE SUBMIT: one write is sent however often the button is pressed', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await rename('مرة واحدة');
    const gate = b.hold('rpc:catalog_write');
    await userEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn().disabled).toBe(true));
    await userEvent.click(submitBtn());
    await userEvent.click(submitBtn());
    gate.release();
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(b.calls('rpc:catalog_write')).toBe(1);
    expect(row(b).revision).toBe(2);
  });

  it('validation problems never reach the server and keep the form', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await userEvent.clear(priceInput());
    await userEvent.click(submitBtn());
    expect(await screen.findByText(/السعر مطلوب ويجب أن يكون أكبر من صفر/)).toBeTruthy();
    expect(b.calls('rpc:catalog_write')).toBe(0);
  });

  it('before the catalog migration, editing a built-in product is refused with an explanation and sends nothing', async () => {
    const b = await freshBackend('admin'); // flag not set: the built-in demo catalog is shown
    const { ProductFormPage } = await import('./ProductFormPage');
    const docs = await import('../../storefront/catalog/catalogDocs');
    await docs.whenDocsSettled();
    render(
      <MemoryRouter initialEntries={['/admin/products/p01/edit']}>
        <Routes>
          <Route path="/admin/products/:productId/edit" element={<ProductFormPage />} />
          <Route path="/admin/products/:productId" element={<p>تفاصيل المنتج</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await rename('اسم جديد');
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('لم يتم ترحيل الكتالوج');
    expect(b.calls('rpc:catalog_write')).toBe(0);
    expect(screen.queryByText('تفاصيل المنتج')).toBeNull();
    expect(nameInput().value).toBe('اسم جديد');
  });
});
