import type { MouseEvent } from 'react';
import { usePageTransition } from './PageTransition';

// Intercepts a plain left-click on an internal link and routes it through
// the page-transition overlay instead of navigating instantly. Clicks that
// should behave natively (modifier keys, middle/right click, already
// prevented by the caller) are left alone.
export function useTransitionClick(to: string, label?: string) {
  const transitionNavigate = usePageTransition();
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    transitionNavigate(to, label);
  };
}
