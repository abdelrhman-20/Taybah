import type { StorefrontLocale } from './locale';

export function formatPrice(amount: number, locale: StorefrontLocale): string {
  const formatted = amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return locale === 'ar' ? `${formatted} ج.م` : `EGP ${formatted}`;
}
