import { vi } from 'vitest';
import type { backend as BackendType, Role } from '../lib/supabase/client.mock';

// Shared setup for tests that exercise stores against the in-memory fake
// Supabase backend (src/lib/supabase/client.mock.ts — a MOCK; see its header).
//
// Every call returns a fresh module graph (vi.resetModules) and a freshly
// reset backend. Seed the backend BEFORE importing the store under test:
// stores kick off their first load at import time.

export type Backend = typeof BackendType;

export async function freshBackend(role: Role = 'admin'): Promise<Backend> {
  vi.resetModules();
  // vitest.setup.ts redirects this import to client.mock.ts
  const mod = (await import('../lib/supabase/client')) as unknown as { backend: Backend };
  mod.backend.reset();
  mod.backend.role = role;
  return mod.backend;
}

// Simulates reloading the page / opening a fresh private window: brand-new
// module graph, SAME database contents, different signed-in role.
export async function reloadWith(b: Backend, role: Role = 'anon'): Promise<Backend> {
  const tables = b.tables;
  const objects = b.objects;
  vi.resetModules();
  const mod = (await import('../lib/supabase/client')) as unknown as { backend: Backend };
  mod.backend.reset();
  mod.backend.role = role;
  mod.backend.tables = tables;
  mod.backend.objects = objects;
  return mod.backend;
}

export const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `slug-${id}`,
  sku: `SKU-${id}`.toUpperCase(),
  name: { ar: `منتج ${id}`, en: `Product ${id}` },
  description: { ar: '', en: '' },
  category: 'rugs',
  collection: 'diwan',
  price: 1000,
  compareAtPrice: null,
  availability: 'in_stock',
  colors: ['burgundy'],
  materials: [],
  size: '',
  sizes: [],
  createdAt: '2025-01-01',
  featured: false,
  published: true,
  isNew: false,
  attributes: {},
  image: '/images/a.webp',
  imageHover: '/images/a.webp',
  images: ['/images/a.webp'],
  ...over,
});

export const category = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  name: { ar: slug, en: slug },
  description: { ar: '', en: '' },
  image: '',
  visible: true,
  order: 1,
  ...over,
});

// Seeds an initialized catalog: 1 category, 1 collection, N products.
export function seedCatalog(b: Backend, products: ReturnType<typeof product>[] = []) {
  b.setInitialized(true);
  b.putDoc('category', 'rugs', category('rugs'), { slug: 'rugs', sort_order: 1 });
  b.putDoc('collection', 'diwan', category('diwan'), { slug: 'diwan', sort_order: 1 });
  products.forEach((p, i) =>
    b.putDoc('product', p.id, p, { slug: p.slug, visible: p.published, sort_order: i }),
  );
}
