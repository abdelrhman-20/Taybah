// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { freshBackend } from '../../../test/harness';

// UI behavior of the content gate against the FAKE backend (client.mock.ts).
// Includes the production regression: tables missing -> the storefront must
// RENDER, not show the "couldn't load" screen.

afterEach(cleanup);

async function mount(bilingual = false) {
  const { DataGate } = await import('./DataGate');
  const docs = await import('../../storefront/catalog/catalogDocs');
  const home = await import('../../storefront/home/homeStore');
  render(
    <DataGate bilingual={bilingual}>
      <p>محتوى المتجر</p>
    </DataGate>,
  );
  return { docs, home };
}

describe('DataGate', () => {
  it('renders children once catalog and homepage content loaded', async () => {
    await freshBackend('anon');
    await mount();
    expect(await screen.findByText('محتوى المتجر')).toBeTruthy();
  });

  it('shows a loading state (not placeholder content) while the first load is in flight', async () => {
    const b = await freshBackend('anon');
    b.hold('from:catalog_docs:select'); // never released: stays loading
    await mount();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('محتوى المتجر')).toBeNull();
  });

  it('REGRESSION: with catalog tables missing (migration 0006 not applied) the app still renders', async () => {
    const b = await freshBackend('anon');
    delete b.tables.catalog_docs;
    delete b.tables.app_settings;
    await mount();
    expect(await screen.findByText('محتوى المتجر')).toBeTruthy();
    expect(screen.queryByText('تعذّر تحميل المحتوى')).toBeNull();
  });

  it('a genuine network failure shows the error screen with the "couldn\'t reach the server" copy and a retry that recovers', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:app_settings:select', new TypeError('Failed to fetch'), { reject: true });
    await mount(true);
    expect(await screen.findByText('تعذّر تحميل المحتوى')).toBeTruthy();
    expect(screen.getByText(/لم نتمكن من الوصول إلى الخادم/)).toBeTruthy();
    expect(screen.getByText(/couldn’t reach the server/)).toBeTruthy();
    expect(screen.queryByText('محتوى المتجر')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' })); // fault was one-shot
    expect(await screen.findByText('محتوى المتجر')).toBeTruthy();
  });

  it('an auth/permission failure says so — it does NOT claim the server was unreachable', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:catalog_docs:select', { code: 'PGRST301', message: 'JWT expired' });
    await mount();
    expect(await screen.findByText(/رفض الخادم الطلب/)).toBeTruthy();
    expect(screen.queryByText(/لم نتمكن من الوصول إلى الخادم/)).toBeNull();
  });

  it('an unrelated database error shows its code for support, not a connectivity message', async () => {
    const b = await freshBackend('anon');
    b.failNext('from:catalog_docs:select', { code: 'XX000', message: 'boom' });
    await mount();
    expect(await screen.findByText(/رمز: unknown/)).toBeTruthy();
    expect(screen.queryByText(/لم نتمكن من الوصول إلى الخادم/)).toBeNull();
  });

  it('keeps showing content when a LATER refresh fails (last good data wins)', async () => {
    const b = await freshBackend('anon');
    const { docs } = await mount();
    await screen.findByText('محتوى المتجر');
    b.failNext('from:catalog_docs:select', new TypeError('Failed to fetch'), { reject: true });
    await docs.refreshDocs();
    await waitFor(() => expect(docs.getDocsState().status).toBe('error'));
    expect(screen.getByText('محتوى المتجر')).toBeTruthy();
  });
});
