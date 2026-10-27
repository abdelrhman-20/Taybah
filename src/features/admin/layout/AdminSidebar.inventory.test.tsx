// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminSidebar } from './AdminSidebar';
import { adminNav } from './adminNav';

afterEach(cleanup);

describe('admin navigation — inventory', () => {
  it('has a «المخزون» entry right after «المنتجات», pointing at /admin/inventory', () => {
    const keys = adminNav.map((i) => i.key);
    expect(keys.indexOf('inventory')).toBe(keys.indexOf('products') + 1);
    const item = adminNav.find((i) => i.key === 'inventory')!;
    expect(item).toMatchObject({ label: 'المخزون', path: '/admin/inventory' });
  });

  it('renders the sidebar link, which is the current page on /admin/inventory and on the movement history', () => {
    for (const path of ['/admin/inventory', '/admin/inventory/movements']) {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AdminSidebar open={false} onClose={() => undefined} />
        </MemoryRouter>,
      );
      const link = screen.getByRole('link', { name: 'المخزون' });
      expect(link.getAttribute('href')).toBe('/admin/inventory');
      expect(link.getAttribute('aria-current')).toBe('page');
      // «المنتجات» is not highlighted by the inventory page
      expect(screen.getByRole('link', { name: 'المنتجات' }).getAttribute('aria-current')).toBeNull();
      cleanup();
    }
  });

  it('keeps every other entry exactly where it was (the inventory entry is the only addition)', () => {
    expect(adminNav.map((i) => i.key)).toEqual([
      'dashboard', 'orders', 'products', 'inventory', 'categories', 'collections', 'homepage',
      'navigation', 'media', 'attributes', 'customers', 'promotions', 'migration', 'settings',
    ]);
  });
});
