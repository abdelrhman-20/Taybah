import { useEffect } from 'react';
import { useLocation } from 'react-router';

// React Router (client-side nav) keeps the scroll position from the
// previous page — without this, clicking a footer link lands you at the
// bottom of the new page instead of its top.
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, [pathname]);

  return null;
}
