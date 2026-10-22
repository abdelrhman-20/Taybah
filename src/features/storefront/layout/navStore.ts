import { useSyncExternalStore } from 'react';

// STOREFRONT NAVIGATION STORE — shared reactive config for the public header
// (desktop + mobile) and footer link columns. Admin edits persist to
// localStorage and appear immediately; the internal Admin sidebar is managed
// separately in features/admin/layout/adminNav.ts and is unaffected.

const STORAGE_KEY = 'taybah:navigation';

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

function defaultNav(): StorefrontNavState {
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
function migrate(raw: Partial<StorefrontNavState> | null): StorefrontNavState {
  const defaults = defaultNav();
  if (!raw || typeof raw !== 'object') return defaults;
  const main = raw.main === undefined ? defaults.main : sanitizeItems(raw.main, true);
  const footer = raw.footer === undefined ? defaults.footer : sanitizeItems(raw.footer, false);
  return { main, footer };
}

function readAll(): StorefrontNavState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultNav();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultNav();
    return migrate(parsed as Partial<StorefrontNavState>);
  } catch {
    return defaultNav();
  }
}

let nav: StorefrontNavState = readAll();
const listeners = new Set<() => void>();

function persist(next: StorefrontNavState) {
  nav = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nav));
  } catch {
    // storage unavailable — state lives in memory for this session
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      nav = readAll();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavigation(): StorefrontNavState {
  return useSyncExternalStore(subscribe, () => nav);
}

export function saveNavGroup(group: NavGroup, items: StorefrontNavItem[]) {
  persist({ ...nav, [group]: items });
}

export function upsertNavItem(group: NavGroup, item: StorefrontNavItem) {
  const list = nav[group];
  const exists = list.some((i) => i.id === item.id);
  saveNavGroup(
    group,
    exists ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item],
  );
}

export function removeNavItem(group: NavGroup, id: string) {
  saveNavGroup(group, nav[group].filter((i) => i.id !== id));
}

export function resetNavigation() {
  persist(defaultNav());
}

// Flattens the main menu into footer-safe links. The footer always stays
// flat (sanitizeItems never gives footer items children), but a main-menu
// item can be a pure dropdown trigger (`path === ''` with `children`) —
// rendering one as-is in the footer would be a dead link to the homepage
// with its children silently dropped. Mirrors DesktopNav.tsx's own
// path-vs-children handling: keep the item only when it has a real
// destination of its own, and always flatten in its visible children.
export function flattenForFooter(main: StorefrontNavItem[]): StorefrontNavItem[] {
  return main
    .filter((i) => i.visible)
    .flatMap((i) => [...(i.path ? [i] : []), ...(i.children ?? []).filter((c) => c.visible)]);
}
