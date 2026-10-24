import { useSyncExternalStore } from 'react';
import { getDoc, getDocsState, subscribeDocs, writeDocs, type DocPut } from '../catalog/catalogDocs';

// STOREFRONT NAVIGATION STORE — typed view over the persistent navigation
// documents (public.catalog_docs, kind 'nav', ids 'main' and 'footer'; see
// catalogDocs.ts). Shared by the public header (desktop + mobile) and footer
// link columns. Until the catalog is migrated (`initialized`) the built-in
// default menus are served. Mutations resolve only after the server confirmed
// the write. The internal Admin sidebar is separate (admin/layout/adminNav.ts).

export type NavGroup = 'main' | 'footer';
export type NavItemKind = 'internal' | 'external';

export interface StorefrontNavItem {
  id: string;
  label: string;
  kind: NavItemKind;
  // internal: a storefront path like '/products' (locale prefix added at
  // render). external: a full https?:// URL rendered with safe link attrs.
  // May be '' when the item carries children — a pure dropdown trigger.
  path: string;
  visible: boolean;
  // Exactly one child level (main nav only; the footer stays flat).
  children?: StorefrontNavItem[];
}

export interface StorefrontNavState {
  main: StorefrontNavItem[];
  footer: StorefrontNavItem[];
}

export function isSafeNavUrl(kind: NavItemKind, path: string): boolean {
  const p = path.trim();
  if (kind === 'internal') return p.startsWith('/') && !p.startsWith('//');
  try {
    const url = new URL(p);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function item(
  id: string,
  label: string,
  path: string,
  kind: NavItemKind = 'internal',
): StorefrontNavItem {
  return { id, label, path, kind, visible: true };
}

export function defaultNav(): StorefrontNavState {
  return {
    main: [
      item('shop', 'تسوق الكل', '/products'),
      item('rugs', 'سجاد', '/category/rugs'),
      item('carpets', 'موكيت', '/category/carpets'),
      item('curtains', 'ستائر', '/category/curtains'),
      item('furnishings', 'مفروشات', '/category/furnishings'),
      item('accessories', 'إكسسوارات', '/category/accessories'),
      item('collections', 'المجموعات', '/collections'),
    ],
    footer: [
      item('contact', 'تواصل معنا', '/contact'),
      item('shipping', 'الشحن والإرجاع', '/shipping-returns'),
      item('faq', 'الأسئلة الشائعة', '/faq'),
      item('about', 'من نحن', '/about'),
    ],
  };
}

function sanitizeItems(list: unknown, allowChildren: boolean): StorefrontNavItem[] {
  if (!Array.isArray(list)) return [];
  const out: StorefrontNavItem[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<StorefrontNavItem>;
    const kind: NavItemKind = r.kind === 'external' ? 'external' : 'internal';
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    if (typeof r.label !== 'string' || !r.label.trim()) continue;
    // Children are sanitized first (grandchildren dropped) — a parent may
    // keep an empty destination and act purely as a dropdown trigger.
    const children = allowChildren ? sanitizeItems(r.children, false) : [];
    const hasKids = children.length > 0;
    const path = typeof r.path === 'string' ? r.path : '';
    if (path !== '' && !isSafeNavUrl(kind, path)) {
      if (!hasKids) continue; // invalid destination and nothing to show — drop
      // unsafe parent destination downgraded to a pure trigger
      out.push({
        id: r.id,
        label: r.label,
        kind,
        path: '',
        visible: r.visible !== false,
        children,
      });
      seen.add(r.id);
      continue;
    }
    if (path === '' && !hasKids) continue; // leaf with no destination — drop
    seen.add(r.id);
    out.push({
      id: r.id,
      label: r.label,
      kind,
      path,
      visible: r.visible !== false,
      ...(allowChildren && hasKids ? { children } : {}),
    });
  }
  return out;
}

// Stored groups win as-is; missing groups seed from defaults. Unsafe stored
// destinations are dropped rather than rendered.
export function migrateNav(raw: Partial<StorefrontNavState> | null): StorefrontNavState {
  const defaults = defaultNav();
  if (!raw || typeof raw !== 'object') return defaults;
  const main = raw.main === undefined ? defaults.main : sanitizeItems(raw.main, true);
  const footer = raw.footer === undefined ? defaults.footer : sanitizeItems(raw.footer, false);
  return { main, footer };
}

interface NavDocData { items?: unknown }

function derive(): StorefrontNavState {
  if (!getDocsState().initialized) return defaultNav();
  const defaults = defaultNav();
  const group = (g: NavGroup): unknown[] | undefined => {
    const d = getDoc('nav', g);
    const items = (d?.data as NavDocData | undefined)?.items;
    return Array.isArray(items) ? items : undefined;
  };
  const main = group('main');
  const footer = group('footer');
  return migrateNav({
    main: main as StorefrontNavItem[] | undefined,
    footer: footer as StorefrontNavItem[] | undefined,
  }) ?? defaults;
}

let cache: { version: number; value: StorefrontNavState } | null = null;

export function getNavigation(): StorefrontNavState {
  const version = getDocsState().version;
  if (!cache || cache.version !== version) cache = { version, value: derive() };
  return cache.value;
}

export function useNavigation(): StorefrontNavState {
  return useSyncExternalStore(subscribeDocs, getNavigation);
}

export function navDocOp(group: NavGroup, items: StorefrontNavItem[]): DocPut {
  return {
    op: 'put',
    kind: 'nav',
    id: group,
    slug: null,
    visible: true,
    sortOrder: group === 'main' ? 0 : 1,
    data: { items },
  };
}

export function saveNavGroup(group: NavGroup, items: StorefrontNavItem[]): Promise<void> {
  return writeDocs([navDocOp(group, items)]);
}

export function upsertNavItem(group: NavGroup, item: StorefrontNavItem): Promise<void> {
  const list = getNavigation()[group];
  const exists = list.some((i) => i.id === item.id);
  return saveNavGroup(
    group,
    exists ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item],
  );
}

export function removeNavItem(group: NavGroup, id: string): Promise<void> {
  return saveNavGroup(group, getNavigation()[group].filter((i) => i.id !== id));
}

// Restores BOTH menus to the built-in defaults in one atomic write.
export function resetNavigation(): Promise<void> {
  const d = defaultNav();
  return writeDocs([navDocOp('main', d.main), navDocOp('footer', d.footer)]);
}

export function flattenForFooter(main: StorefrontNavItem[]): StorefrontNavItem[] {
  return main
    .filter((i) => i.visible)
    .flatMap((i) => [...(i.path ? [i] : []), ...(i.children ?? []).filter((c) => c.visible)]);
}
