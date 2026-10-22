import { Navigate, useLocation } from 'react-router';
import { storedLocalePreference } from '../../features/shared/utils/locale';

export function RootRedirect() {
  return <Navigate to={`/${storedLocalePreference()}`} replace />;
}

// Locale-prefixed admin URLs (e.g. /ar/admin/orders) must reach the admin area,
// not the storefront 404 — strip the leading locale segment.
export function PrefixedAdminRedirect() {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(/^\/[^/]+/, '')} replace />;
}
