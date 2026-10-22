import type { StorefrontLocale } from '../../shared/utils/locale';

// Nav items live in navStore.ts (reactive, admin-editable). This module keeps
// only the locale-prefixed href helper used across storefront components.

export function navHref(locale: StorefrontLocale, path: string): string {
  return `/${locale}${path}`;
}
