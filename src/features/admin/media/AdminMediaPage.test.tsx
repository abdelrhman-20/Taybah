// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { freshBackend } from '../../../test/harness';

// Media-library delete guard for a LOCAL (IndexedDB) image. The library view
// and the image store are replaced by stubs so the test isolates the guard's
// decision; the reference scan and catalog state are the real ones against the
// FAKE backend (client.mock.ts).

const deleteImageAsset = vi.fn(async () => undefined);
vi.mock('../../shared/assets/imageStore', async (orig) => ({
  ...(await orig<typeof import('../../shared/assets/imageStore')>()),
  deleteImageAsset: (...a: unknown[]) => (deleteImageAsset as (...x: unknown[]) => Promise<void>)(...a),
}));
vi.mock('../../shared/assets/mediaLibrary', () => ({
  notifyMediaChanged: vi.fn(),
  useMediaLibrary: () => ({
    items: [
      { ref: 'local:asset-1', name: 'old-rug.jpg', size: 10, type: 'image/jpeg', createdAt: '2025-01-01T00:00:00Z', origin: 'local' },
    ],
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock('../components/ImageUploadField', () => ({ ImageUploadField: () => null }));

beforeEach(() => {
  localStorage.clear();
  deleteImageAsset.mockClear();
});
afterEach(cleanup);

async function mount() {
  const { AdminMediaPage } = await import('./AdminMediaPage');
  const docs = await import('../../storefront/catalog/catalogDocs');
  await docs.whenDocsSettled();
  render(<AdminMediaPage />);
}

describe('media library — deleting a local image', () => {
  it('BEFORE the migration: deletion is blocked with the reason even though the demo catalog does not use the image', async () => {
    const b = await freshBackend('admin'); // not initialized
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'حذف old-rug.jpg' }));
    const dlg = await screen.findByRole('alertdialog');
    expect(within(dlg).getByText('لا يمكن حذف الصورة')).toBeTruthy();
    expect(dlg.textContent).toContain('لم يُرحَّل الكتالوج بعد');
    expect(screen.queryByRole('button', { name: 'حذف نهائي' })).toBeNull();
    expect(deleteImageAsset).not.toHaveBeenCalled();
    void b;
  });

  it('AFTER the migration, an unreferenced local image can be deleted', async () => {
    const b = await freshBackend('admin');
    b.setInitialized(true);
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'حذف old-rug.jpg' }));
    await userEvent.click(await screen.findByRole('button', { name: 'حذف نهائي' }));
    expect(deleteImageAsset).toHaveBeenCalledWith('asset-1');
  });

  it('AFTER the migration, un-migrated browser data that still uses it keeps deletion blocked', async () => {
    const b = await freshBackend('admin');
    b.setInitialized(true);
    localStorage.setItem('taybah:catalog', JSON.stringify({ products: [{ id: 'x', image: 'local:asset-1' }] }));
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'حذف old-rug.jpg' }));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg.textContent).toContain('taybah:catalog');
    expect(screen.queryByRole('button', { name: 'حذف نهائي' })).toBeNull();
    expect(deleteImageAsset).not.toHaveBeenCalled();
  });
});
