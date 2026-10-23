import { useRef, useState } from 'react';
import { Menu, ChevronDown } from 'lucide-react';
import { NavLink } from 'react-router';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from './navData';
import { flattenForFooter, useNavigation, type StorefrontNavItem } from './navStore';
import { useTransitionClick } from './useTransitionClick';

const copy = {
  ar: { label: 'تصفح منتجاتنا' },
  en: { label: 'Browse products' },
};

// The big "Browse products" trigger + the full category list it reveals —
// the same flattened (main + children) set the footer's shop column already
// uses, so the dropdown never drifts out of sync with the real nav data.
export function BrowseMenu() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const nav = useNavigation();
  const items = flattenForFooter(nav.main);
  // "Shop all" (navStore's always-first 'shop' item) gets its own full-width
  // row above the two-column grid of categories — found by id, not position,
  // so it still works if nav order ever changes.
  const shopItem = items.find((i) => i.id === 'shop');
  const gridItems = items.filter((i) => i.id !== 'shop');
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const close = () => setOpen(false);

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[0px_0px_24px_24px] bg-burgundy px-5 py-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        <Menu className="size-4" aria-hidden="true" />
        {t.label}
        <ChevronDown
          className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div
        role="menu"
        className={`absolute top-full start-0 z-50 mt-2 w-80 transition-all duration-200 ease-out ${
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1.5 opacity-0 pointer-events-none'
        }`}
      >
        <div className="rounded-2xl border border-espresso/10 bg-white p-2.5 shadow-[0_18px_40px_-16px_rgba(41,34,30,0.35)]">
          {shopItem && <BrowseMenuLink item={shopItem} onNavigate={close} className="mb-1.5" />}
          <div className="grid grid-cols-2 gap-1.5">
            {gridItems.map((item) => (
              <BrowseMenuLink key={item.id} item={item} onNavigate={close} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowseMenuLink({
  item,
  onNavigate,
  className = '',
}: {
  item: StorefrontNavItem;
  onNavigate: () => void;
  className?: string;
}) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, item.path);
  const transitionClick = useTransitionClick(to, item.label);
  const cls =
    `group block rounded-lg px-3 py-2.5 text-[13px] tracking-wide text-espresso transition-colors duration-150 hover:bg-porcelain hover:text-burgundy focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-burgundy ${className}`;
  const label = (
    <span className="inline-block transition-transform duration-150 group-hover:scale-[1.08] rtl:origin-right ltr:origin-left">
      {item.label}
    </span>
  );

  if (item.kind === 'external') {
    return (
      <a href={item.path} target="_blank" rel="noopener noreferrer" onClick={onNavigate} role="menuitem" className={cls}>
        {label}
      </a>
    );
  }
  return (
    <NavLink
      to={to}
      role="menuitem"
      onClick={(e) => {
        onNavigate();
        transitionClick(e);
      }}
      className={({ isActive }) => `${cls} ${isActive ? 'bg-porcelain text-burgundy' : ''}`}
    >
      {label}
    </NavLink>
  );
}
