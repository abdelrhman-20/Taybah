// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { freshBackend, product, seedCatalog, type Backend } from '../../../test/harness';

// «إضافة طلب»: the not-migrated-catalog block and the translation of the
// database's "unknown product" rejection — against the FAKE backend
// (client.mock.ts, a mock of migration 0008).

afterEach(cleanup);

async function mountWith(setup: (b: Backend) => void, role: 'admin' | 'user' = 'admin'): Promise<Backend> {
  const b = await freshBackend(role);
  setup(b);
  const { InStoreOrderPage } = await import('./InStoreOrderPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(
    <MemoryRouter initialEntries={['/admin/orders/new']}>
      <Routes>
        <Route path="/admin/orders/new" element={<InStoreOrderPage />} />
        <Route path="/admin/orders/:orderId" element={<p>صفحة تفاصيل الطلب</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'إضافة طلب' });
  return b;
}

const migrated = (b: Backend) =>
  seedCatalog(b, [product('p1', { price: 1000, name: { ar: 'سجادة كلاسيك', en: 'Classic' } })]);

const addBtn = () => screen.getByRole('button', { name: /^إضافة سجادة كلاسيك/ }) as HTMLButtonElement;
const save = () => screen.getByRole('button', { name: /حفظ الطلب|جارٍ الحفظ/ }) as HTMLButtonElement;

describe('catalog not ready', () => {
  it('an UNMIGRATED catalog: explains why, disables adding and saving, sends nothing', async () => {
    const b = await mountWith((x) => x.setInitialized(false));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('الكتالوج لم يُرحَّل إلى قاعدة البيانات بعد');
    expect(alert.textContent).toContain('لا يمكن تسجيل طلب');
    expect(screen.getByRole('link', { name: 'فتح النسخ الاحتياطي والترحيل' })).toBeTruthy();
    expect(save().disabled).toBe(true);
    const adds = screen.getAllByRole('button', { name: /^إضافة / });
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.every((a) => (a as HTMLButtonElement).disabled)).toBe(true);
    await userEvent.click(save());
    expect(b.calls('from:orders:insert')).toBe(0);
  });

  it('missing catalog tables (0006 not applied) get their own explanation', async () => {
    await mountWith((x) => {
      x.setInitialized(false);
      delete (x.tables as Record<string, unknown>).catalog_docs;
      delete (x.tables as Record<string, unknown>).app_settings;
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('0006');
    expect(save().disabled).toBe(true);
  });

  it('a MIGRATED catalog shows no block, and saving is enabled', async () => {
    await mountWith(migrated);
    expect(screen.queryByRole('link', { name: 'فتح النسخ الاحتياطي والترحيل' })).toBeNull();
    expect(addBtn().disabled).toBe(false);
    await userEvent.click(addBtn());
    expect(save().disabled).toBe(false);
  });
});

describe('server error translation', () => {
  it('translates "unknown product" into an admin-facing explanation and saves nothing', async () => {
    const b = await mountWith(migrated);
    await userEvent.click(addBtn());
    // the product vanished from the database after the page loaded
    b.tables.catalog_docs = b.tables.catalog_docs.filter((d) => d.id !== 'p1');
    await userEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('غير موجود في كتالوج قاعدة البيانات');
    expect(alert.textContent).toContain('لم يُحفظ الطلب');
    expect(b.tables.orders).toHaveLength(0);
  });

  it('does NOT mask unrelated errors: a network failure keeps its own message', async () => {
    const b = await mountWith(migrated);
    await userEvent.click(addBtn());
    b.failNext('from:orders:insert', new TypeError('Failed to fetch'), { reject: true });
    await userEvent.click(save());
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toContain('تعذّر الاتصال بالخادم');
    expect(text).not.toContain('غير موجود في كتالوج');
  });

  it('does NOT mask an unrelated "invalid" rejection either (generic message stays)', async () => {
    const b = await mountWith(migrated);
    await userEvent.click(addBtn());
    b.failNext('from:orders:insert', { code: '22023', message: 'invalid_in_store_order', details: 'bad quantity' });
    await userEvent.click(save());
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toContain('رفض الخادم البيانات');
    expect(text).not.toContain('غير موجود في كتالوج');
    expect(text).not.toContain('تغيّر سعر');
  });

  it('a permission failure keeps the permission message', async () => {
    const b = await mountWith(migrated, 'user');
    await userEvent.click(addBtn());
    await userEvent.click(save());
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toContain('ليست لديك صلاحية');
    expect(b.tables.orders).toHaveLength(0);
  });
});
