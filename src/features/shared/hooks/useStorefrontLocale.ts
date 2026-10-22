import { useParams } from 'react-router';
import { DEFAULT_LOCALE, isStorefrontLocale, type StorefrontLocale } from '../utils/locale';

export function useStorefrontLocale(): StorefrontLocale {
  const { locale } = useParams();
  return isStorefrontLocale(locale) ? locale : DEFAULT_LOCALE;
}
