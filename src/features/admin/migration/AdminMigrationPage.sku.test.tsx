// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { category, freshBackend, product, type Backend } from '../../../test/harness';

// Duplicate-SKU handling in the migration UI against the FAKE backend
// (client.mock.ts). The page must: block execution while duplicates are
// unresolved, change nothing automatically, accept an explicit replacement,
// require a fresh dry run, and leave the backup ZIP with the ORIGINAL values.

let backupBlobs: Blob[];
const RAW = () => localStorage.getItem('taybah:catalog')!;

beforeEach(() => {
  localStorage.clear();
  backupBlobs = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    backupBlobs.push(b);
    return 'blob:backup';
  });
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(cleanup);

const legacy = (products: unknown[]) =>
  localStorage.setItem(
    'taybah:catalog',
    JSON.stringify({ products, categories: [category('rugs')], collections: [category('diwan')] }),
  );

async function mount() {
  const { AdminMigrationPage } = await import('./AdminMigrationPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter>
      <AdminMigrationPage />
    </MemoryRouter>,
  );
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function readBackupAndDryRun() {
  await userEvent.click(btn('قراءة بيانات هذا المتصفح'));
  await screen.findByText(/المصدر: هذا المتصفح/);
  await userEvent.click(btn('تنزيل النسخة الاحتياطية'));
  await screen.findByText('تم تجهيز النسخة الاحتياطية.');
  await userEvent.click(btn('تشغيل الفحص التجريبي'));
  await screen.findByText(/سيُضاف:/);
}

const dbSkus = (b: Backend) =>
  Object.fromEntries(
    b.tables.catalog_docs
      .filter((d) => d.kind === 'product')
      .map((d) => [d.id as string, (d.data as { sku: string }).sku]),
  );

describe('migration page — duplicate SKUs inside the legacy data', () => {
  it('blocks execution, lists exactly the LATER duplicate, and renames nothing by itself', async () => {
    const b = await freshBackend('admin');
    legacy([product('a', { sku: 'DUP-1' }), product('b', { sku: ' dup-1 ' })]);
    await mount();
    await readBackupAndDryRun();

    const group = screen.getByRole('group', { name: 'رموز SKU المكررة' });
    expect(within(group).getAllByRole('textbox')).toHaveLength(1); // only the later product needs a value
    expect(within(group).getByText(/منتج b/)).toBeTruthy();
    expect(btn('بدء الترحيل').disabled).toBe(true);
    expect(screen.getByText(/حلّ تكرارات رمز SKU/)).toBeTruthy();
    expect(b.tables.catalog_docs).toHaveLength(0); // nothing written
  });

  it('after the admin types a new SKU a FRESH dry run is required, then the migration runs; both products are imported', async () => {
    const b = await freshBackend('admin');
    legacy([product('a', { sku: 'DUP-1' }), product('b', { sku: ' dup-1 ' })]);
    await mount();
    await readBackupAndDryRun();

    await userEvent.type(screen.getByLabelText('الرمز الجديد'), 'DUP-1-B');
    expect(btn('بدء الترحيل').disabled).toBe(true); // the earlier dry run no longer applies
    await userEvent.click(btn('تشغيل الفحص التجريبي'));
    await screen.findByText(/سيُضاف:/);
    expect(btn('بدء الترحيل').disabled).toBe(false);

    await userEvent.click(btn('بدء الترحيل'));
    await screen.findByText(/تم التحقق:/);
    const skus = dbSkus(b);
    expect(skus.a).toBe('DUP-1'); // first occurrence untouched
    expect(skus.b).toBe('DUP-1-B'); // explicit replacement, applied to the import only
    expect(btn('اعتماد وتفعيل').disabled).toBe(false);
  });

  it('a blank replacement keeps execution blocked', async () => {
    const b = await freshBackend('admin');
    legacy([product('a', { sku: 'X' }), product('b', { sku: 'x' })]);
    await mount();
    await readBackupAndDryRun();
    const input = screen.getByLabelText('الرمز الجديد');
    await userEvent.type(input, 'tmp');
    await userEvent.clear(input);
    expect(screen.getByText('اكتب رمزًا جديدًا')).toBeTruthy();
    expect(btn('بدء الترحيل').disabled).toBe(true);
    expect(b.tables.catalog_docs).toHaveLength(0);
  });

  it('a replacement that duplicates another SKU is flagged and still blocks', async () => {
    await freshBackend('admin');
    legacy([product('a', { sku: 'X' }), product('b', { sku: 'x' }), product('c', { sku: 'TAKEN' })]);
    await mount();
    await readBackupAndDryRun();
    await userEvent.type(screen.getByLabelText('الرمز الجديد'), ' taken ');
    expect(await screen.findByText(/مستخدم أيضًا/)).toBeTruthy();
    await userEvent.click(btn('تشغيل الفحص التجريبي'));
    await screen.findByText(/سيُضاف:/);
    expect(btn('بدء الترحيل').disabled).toBe(true);
  });

  it('the backup ZIP keeps the ORIGINAL duplicate values — replacements never touch the backup or the browser data', async () => {
    await freshBackend('admin');
    legacy([product('a', { sku: 'DUP-1' }), product('b', { sku: ' dup-1 ' })]);
    const original = RAW();
    await mount();
    await readBackupAndDryRun();
    await userEvent.type(screen.getByLabelText('الرمز الجديد'), 'DUP-1-B');

    expect(RAW()).toBe(original); // browser data untouched
    const { parseBackupZip } = await import('./legacyBundle');
    expect(backupBlobs).toHaveLength(1);
    // jsdom's Blob is not Node's: read it with jsdom's FileReader
    const zip = await new Promise<Uint8Array>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(backupBlobs[0]);
    });
    const restored = parseBackupZip(zip);
    expect(restored.bundle.storage.catalog.raw).toBe(original); // original strings, verbatim
    expect(JSON.parse(restored.bundle.storage.catalog.raw!).products[1].sku).toBe(' dup-1 ');
  });
});

describe('migration page — SKU already used by a stored product', () => {
  it('the database conflict appears after the dry run with a row to fix; the stored product is never changed', async () => {
    const b = await freshBackend('admin');
    b.putDoc('product', 'stored', product('stored', { sku: 'ACME-1' }), { slug: 'slug-stored' });
    legacy([product('incoming', { sku: 'acme-1' })]);
    await mount();
    await readBackupAndDryRun();

    const group = await screen.findByRole('group', { name: 'رموز SKU المكررة' });
    expect(within(group).getByText(/مستخدم بالفعل في منتج مخزّن/)).toBeTruthy();
    expect(btn('بدء الترحيل').disabled).toBe(true);

    await userEvent.type(within(group).getByLabelText('الرمز الجديد'), 'ACME-1-NEW');
    await userEvent.click(btn('تشغيل الفحص التجريبي'));
    await waitFor(() => expect(btn('بدء الترحيل').disabled).toBe(false));
    await userEvent.click(btn('بدء الترحيل'));
    await screen.findByText(/تم التحقق:/);
    expect(dbSkus(b)).toMatchObject({ stored: 'ACME-1', incoming: 'ACME-1-NEW' });
  });
});

describe('migration page — clean data is unaffected', () => {
  it('no SKU panel appears and the flow is exactly as before', async () => {
    await freshBackend('admin');
    legacy([product('a', { sku: 'A-1' }), product('b', { sku: 'B-1' })]);
    await mount();
    await readBackupAndDryRun();
    expect(screen.queryByRole('group', { name: 'رموز SKU المكررة' })).toBeNull();
    expect(btn('بدء الترحيل').disabled).toBe(false);
  });
});
