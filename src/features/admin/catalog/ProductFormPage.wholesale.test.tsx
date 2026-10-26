// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// Wholesale price («سعر الجملة») on the product form, against the FAKE backend
// (client.mock.ts — a mock of migration 0007; the real SQL is verified in
// supabase/tests/internal-pricing.test.ts). The price is admin-only internal
// data: it lives in product_internal_pricing, never in the product document.

afterEach(cleanup);

const LABEL = 'سعر الجملة (ج.م)';

async function mount(b: Backend, path = '/admin/products/p1/edit', stored: number | null = 720) {
  seedCatalog(b, [product('p1', { price: 1000 })]);
  if (stored !== null) b.tables.product_internal_pricing.push({ product_id: 'p1', wholesale_price: stored });
  const { ProductFormPage } = await import('./ProductFormPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/products/new" element={<ProductFormPage />} />
        <Route path="/admin/products/:productId/edit" element={<ProductFormPage />} />
        <Route path="/admin/products/:productId" element={<p>تفاصيل المنتج</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText('الاسم بالعربي *');
  return docs;
}

const wholesale = () => screen.getByLabelText(LABEL) as HTMLInputElement;
const nameInput = () => screen.getByLabelText('الاسم بالعربي *') as HTMLInputElement;
const submitBtn = () => screen.getByRole('button', { name: /^(حفظ التعديلات|جارٍ الحفظ…)$/ }) as HTMLButtonElement;
const pricing = (b: Backend) => b.tables.product_internal_pricing.map((r) => Number(r.wholesale_price));
const productRow = (b: Backend) => b.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === 'p1')!;

async function setWholesale(v: string) {
  await userEvent.clear(wholesale());
  if (v) await userEvent.type(wholesale(), v);
}

describe('product form — wholesale price', () => {
  it('is an optional field in the pricing section and loads the stored value when editing', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    expect(wholesale().disabled).toBe(false);
    expect(screen.getByText(/داخلي للمسؤولين فقط/)).toBeTruthy();
  });

  it('sits inside the «التسعير والتصنيف» section, next to the retail and before-discount prices', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    const section = wholesale().closest('section')!;
    expect(section.querySelector('h3')!.textContent).toBe('التسعير والتصنيف');
    expect(section.contains(screen.getByLabelText('السعر (ج.م) *'))).toBe(true);
    expect(section.contains(screen.getByLabelText('السعر قبل الخصم (اختياري)'))).toBe(true);
  });

  it('an untouched fractional stored price is not rewritten (no silent rounding) when other fields are saved', async () => {
    const b = await freshBackend('admin');
    await mount(b, '/admin/products/p1/edit', 650.5);
    await waitFor(() => expect(wholesale().value).toBe('650.5'));
    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), 'اسم جديد');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(b.calls('rpc:catalog_write_product')).toBe(0);
    expect(pricing(b)).toEqual([650.5]);
  });

  it('a product without a wholesale price shows an empty field', async () => {
    const b = await freshBackend('admin');
    await mount(b, '/admin/products/p1/edit', null);
    await waitFor(() => expect(wholesale().disabled).toBe(false));
    expect(wholesale().value).toBe('');
  });

  it('the create form shows the field, empty and enabled, without reading any stored price', async () => {
    const b = await freshBackend('admin');
    await mount(b, '/admin/products/new', null);
    expect(wholesale().value).toBe('');
    expect(wholesale().disabled).toBe(false);
    expect(b.calls('from:product_internal_pricing:select')).toBe(0);
  });

  it('saving a changed price sends ONE atomic write; the price is stored outside the product document', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    await setWholesale('650');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(pricing(b)).toEqual([650]);
    expect(b.calls('rpc:catalog_write_product')).toBe(1);
    expect(b.calls('rpc:catalog_write')).toBe(0);
    expect(JSON.stringify(productRow(b).data)).not.toMatch(/wholesale|650/i);
    expect(productRow(b).revision).toBe(2);
  });

  it('saving WITHOUT touching the price keeps the original catalog_write path and the stored price', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), 'اسم جديد');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(b.calls('rpc:catalog_write')).toBe(1);
    expect(b.calls('rpc:catalog_write_product')).toBe(0);
    expect(pricing(b)).toEqual([720]);
  });

  it('clearing the field removes the stored price', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    await setWholesale('');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(pricing(b)).toEqual([]);
  });

  it('VALIDATION: negative or non-numeric values are refused before anything is sent', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    for (const bad of ['-5', 'abc']) {
      await setWholesale(bad);
      await userEvent.click(submitBtn());
      expect(await screen.findByText(/سعر الجملة يجب أن يكون رقمًا صفرًا أو أكبر/)).toBeTruthy();
      expect(b.calls('rpc:catalog_write_product')).toBe(0);
      expect(b.calls('rpc:catalog_write')).toBe(0);
    }
    expect(pricing(b)).toEqual([720]);
  });

  it('a price ABOVE retail shows an admin-only warning but still saves', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    expect(screen.queryByText(/سعر الجملة أعلى من سعر البيع/)).toBeNull();
    await setWholesale('1500');
    expect((await screen.findByRole('status')).textContent).toContain('للمسؤول فقط');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(pricing(b)).toEqual([1500]);
  });

  it('FAILURE: nothing is half-saved (product and price both unchanged); the draft is kept and a retry succeeds', async () => {
    const b = await freshBackend('admin');
    await mount(b);
    await waitFor(() => expect(wholesale().value).toBe('720'));
    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), 'تعديل لن يُحفظ');
    await setWholesale('999');
    b.failNext('rpc:catalog_write_product', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(submitBtn());
    expect((await screen.findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(wholesale().value).toBe('999');
    expect(pricing(b)).toEqual([720]);
    expect((productRow(b).data as { name: { ar: string } }).name.ar).toBe('منتج p1');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(pricing(b)).toEqual([999]);
  });

  it('if the stored price cannot be loaded the field is disabled and a save never overwrites or clears it', async () => {
    const b = await freshBackend('admin');
    b.failNext('from:product_internal_pricing:select', { code: 'PGRST205', message: 'missing' });
    await mount(b);
    expect((await screen.findAllByRole('alert'))[0].textContent).toContain('تعذّر تحميل سعر الجملة');
    expect(wholesale().disabled).toBe(true);
    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), 'اسم جديد');
    await userEvent.click(submitBtn());
    expect(await screen.findByText('تفاصيل المنتج')).toBeTruthy();
    expect(b.calls('rpc:catalog_write_product')).toBe(0);
    expect(pricing(b)).toEqual([720]);
  });
});
