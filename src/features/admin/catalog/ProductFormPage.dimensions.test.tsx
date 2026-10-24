// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// The dimensions («المقاسات») manager on the product edit page, against the
// FAKE backend (client.mock.ts). Two worlds:
//  - catalog NOT migrated: on /products/p07/edit the product is the built-in
//    demo copy and every write is refused (intentional guard). The dialog must
//    say so UP FRONT, disable the controls, send nothing, and touch no browser data.
//  - catalog migrated: add / select / default / enable / delete persist to the
//    database and the default always stays one of the selected dimensions.

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const size = (key: string, ar: string, w: number, l: number, over: Record<string, unknown> = {}) => ({
  key,
  label: { ar, en: '' },
  widthCm: w,
  lengthCm: l,
  enabled: true,
  order: 1,
  ...over,
});
const sizeAttr = (values: unknown[]) => ({
  key: 'size',
  name: { ar: 'المقاس', en: 'Size' },
  display: 'chips',
  categories: [],
  required: false,
  variationCapable: true,
  filterable: false,
  enabled: true,
  order: 3,
  values,
});

async function mount(path: string) {
  const { ProductFormPage } = await import('./ProductFormPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/products/:productId/edit" element={<ProductFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText('الاسم بالعربي *');
  return docs;
}
const openDims = async () => {
  await userEvent.click(screen.getByRole('button', { name: /إدارة المقاسات/ }));
  return screen.findByRole('dialog', { name: 'إدارة المقاسات' });
};
const MSG = 'لم يتم ترحيل الكتالوج';

describe('dimensions — catalog NOT migrated (/products/p07/edit)', () => {
  it('states the reason up front, disables add / save / delete, sends nothing, and leaves browser data untouched', async () => {
    const b = await freshBackend('admin'); // uninitialized: built-in demo catalog is served
    const legacy = JSON.stringify({ products: [{ id: 'p07', sizes: ['mine'] }] });
    localStorage.setItem('taybah:catalog', legacy);
    await mount('/admin/products/p07/edit');
    const dlg = await openDims();

    expect(within(dlg).getByRole('alert').textContent).toContain(MSG);
    expect(within(dlg).getByRole('alert').textContent).toContain('بياناتك المحلية لم تُمَسّ');
    expect(
      within(dlg).getByRole('link', { name: 'فتح النسخ الاحتياطي والترحيل' }).getAttribute('href'),
    ).toBe('/admin/migration');
    expect((within(dlg).getByRole('button', { name: 'إضافة' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dlg).getByRole('button', { name: 'حفظ التعديلات' }) as HTMLButtonElement).disabled).toBe(true);
    for (const del of within(dlg).getAllByRole('button', { name: /^حذف / })) {
      expect((del as HTMLButtonElement).disabled).toBe(true);
    }
    await userEvent.type(within(dlg).getByLabelText('العرض (سم)'), '280');
    await userEvent.type(within(dlg).getByLabelText('الطول (سم)'), '200');
    await userEvent.click(within(dlg).getByRole('button', { name: 'إضافة' }));

    expect(b.calls('rpc:catalog_write')).toBe(0);
    expect(b.tables.catalog_docs).toHaveLength(0);
    expect(localStorage.getItem('taybah:catalog')).toBe(legacy); // never overwritten
  });

  it('the default dimension and existing options are shown unchanged, and a refresh behaves the same', async () => {
    await freshBackend('admin');
    await mount('/admin/products/p07/edit');
    const dlg1 = await openDims();
    const defaultBefore = (within(dlg1).getByLabelText('المقاس الافتراضي للمنتج') as HTMLSelectElement).value;
    const labelsBefore = within(dlg1)
      .getAllByRole('textbox')
      .map((t) => (t as HTMLInputElement).value);
    cleanup();
    // "refresh": brand-new module graph, same (empty) database
    await freshBackend('admin');
    await mount('/admin/products/p07/edit');
    const dlg2 = await openDims();
    expect(within(dlg2).getByRole('alert').textContent).toContain(MSG);
    expect((within(dlg2).getByLabelText('المقاس الافتراضي للمنتج') as HTMLSelectElement).value).toBe(defaultBefore);
    expect(
      within(dlg2)
        .getAllByRole('textbox')
        .map((t) => (t as HTMLInputElement).value),
    ).toEqual(labelsBefore);
  });

  it('closing the dialog leaves the form usable (nothing was changed)', async () => {
    await freshBackend('admin');
    await mount('/admin/products/p07/edit');
    const dlg = await openDims();
    await userEvent.click(within(dlg).getByRole('button', { name: 'إغلاق' }));
    expect(screen.queryByRole('dialog', { name: 'إدارة المقاسات' })).toBeNull();
  });
});

describe('dimensions — catalog migrated (persisted to the database)', () => {
  async function setup() {
    const b: Backend = await freshBackend('admin');
    seedCatalog(b, [product('p1', { sizes: ['280x200', '160x230'], size: '280x200' })]);
    b.putDoc(
      'attribute',
      'size',
      sizeAttr([
        size('280x200', '280 × 200 سم', 280, 200),
        size('160x230', '160 × 230 سم', 160, 230, { order: 2 }),
      ]),
      { sort_order: 3 },
    );
    await mount('/admin/products/p1/edit');
    return b;
  }
  const dbSize = (b: Backend) =>
    b.tables.catalog_docs.find((d) => d.kind === 'attribute' && d.id === 'size')!.data as {
      values: Array<{ key: string; enabled: boolean; widthCm?: number }>;
    };
  const dbProduct = (b: Backend) =>
    b.tables.catalog_docs.find((d) => d.kind === 'product' && d.id === 'p1')!.data as {
      sizes: string[];
      size: string;
    };

  it('no warning is shown and controls are enabled', async () => {
    await setup();
    const dlg = await openDims();
    expect(within(dlg).queryByText(new RegExp(MSG))).toBeNull();
    expect((within(dlg).getByRole('button', { name: 'حفظ التعديلات' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('adds a dimension: registered, selected for the product, existing ids/labels/availability kept', async () => {
    const b = await setup();
    const dlg = await openDims();
    await userEvent.type(within(dlg).getByLabelText('العرض (سم)'), '300');
    await userEvent.type(within(dlg).getByLabelText('الطول (سم)'), '400');
    await userEvent.click(within(dlg).getByRole('button', { name: 'إضافة' }));
    await waitFor(() => expect(dbSize(b).values.map((v) => v.key)).toContain('300x400'));
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() =>
      expect(dbProduct(b).sizes).toEqual(expect.arrayContaining(['280x200', '160x230', '300x400'])),
    );
    expect(dbProduct(b).size).toBe('280x200'); // default untouched
    expect(dbSize(b).values.find((v) => v.key === '280x200')).toMatchObject({ enabled: true, widthCm: 280 });
  });

  it('changes the default dimension', async () => {
    const b = await setup();
    const dlg = await openDims();
    await userEvent.selectOptions(within(dlg).getByLabelText('المقاس الافتراضي للمنتج'), '160x230');
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(dbProduct(b).size).toBe('160x230'));
    expect(dbProduct(b).sizes).toEqual(['280x200', '160x230']);
  });

  it('marks a dimension unavailable (enabled flag) without touching its id or label', async () => {
    const b = await setup();
    const dlg = await openDims();
    const rows = within(dlg).getAllByRole('listitem');
    await userEvent.click(within(rows[0]).getByRole('checkbox', { name: /مفعّلة/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(dbSize(b).values.find((v) => v.key === '280x200')!.enabled).toBe(false));
    expect(dbSize(b).values.map((v) => v.key)).toEqual(['280x200', '160x230']);
  });

  it('unselecting the default dimension never leaves a dangling default', async () => {
    const b = await setup();
    const dlg = await openDims();
    const rows = within(dlg).getAllByRole('listitem');
    await userEvent.click(within(rows[0]).getByRole('checkbox', { name: /للمنتج/ })); // the default
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(dbProduct(b).sizes).toEqual(['160x230']));
    expect(dbProduct(b).size).toBe(''); // cleared, never pointing at an unselected size
  });

  it('deleting the default dimension removes it everywhere and clears the default', async () => {
    const b = await setup();
    const dlg = await openDims();
    await userEvent.click(within(dlg).getByRole('button', { name: 'حذف 280 × 200 سم' }));
    const confirm = await screen.findAllByRole('button', { name: /حذف/ });
    await userEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(dbSize(b).values.map((v) => v.key)).toEqual(['160x230']));
    expect(dbProduct(b)).toMatchObject({ sizes: ['160x230'], size: '' });
  });

  it('FAILED save: dialog stays open with the reason and drafts; nothing changed; retry works', async () => {
    const b = await setup();
    const dlg = await openDims();
    await userEvent.selectOptions(within(dlg).getByLabelText('المقاس الافتراضي للمنتج'), '160x230');
    b.failNext('rpc:catalog_write', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    expect((await within(dlg).findByRole('alert')).textContent).toContain('تعذّر الاتصال بالخادم');
    expect(dbProduct(b).size).toBe('280x200');
    expect((within(dlg).getByLabelText('المقاس الافتراضي للمنتج') as HTMLSelectElement).value).toBe('160x230');
    await userEvent.click(within(dlg).getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(dbProduct(b).size).toBe('160x230'));
  });
});
