// Taybah is an Arabic-only platform — 'ar' is the only supported locale.
// Catalog records still carry `en` fields for internal compatibility (admin
// cross-referencing, future export tooling) but nothing customer-facing or
// admin-facing renders them.
export const SUPPORTED_LOCALES = ['ar'] as const;

export type StorefrontLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: StorefrontLocale = 'ar';

export const LOCALE_STORAGE_KEY = 'taybah:locale';

export function isStorefrontLocale(value: string | null | undefined): value is StorefrontLocale {
  return value === 'ar';
}

export function localeDirection(): 'rtl' {
  return 'rtl';
}

export function storedLocalePreference(): StorefrontLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isStorefrontLocale(stored)) return stored;
  } catch {
    return DEFAULT_LOCALE;
  }
  return DEFAULT_LOCALE;
}
