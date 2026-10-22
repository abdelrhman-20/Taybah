import { useState } from 'react';
import { NavLink } from 'react-router';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from './navData';
import { useNavigation, type StorefrontNavItem } from './navStore';
import { useTransitionClick } from './useTransitionClick';

const linkCls =
  'pb-1 text-[13px] font-medium tracking-wide transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy';

function NavDestination({
  item,
  className,
  onNavigate,
}: {
  item: StorefrontNavItem;
  className?: string;
  onNavigate?: () => void;
}) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, item.path);
  const transitionClick = useTransitionClick(to, item.label);
  if (item.kind === 'external') {
    return (
      <a
        href={item.path}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={`${linkCls} text-espresso hover:text-burgundy ${className ?? ''}`}
      >
        {item.label}
      </a>
    );
  }
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        onNavigate?.();
        transitionClick(e);
      }}
      className={({ isActive }) =>
        `${linkCls} ${
          isActive ? 'border-b border-gold text-burgundy' : 'text-espresso hover:text-burgundy'
        } ${className ?? ''}`
      }
    >
      {item.label}
    </NavLink>
  );
}

function ChildLink({
  item,
  onNavigate,
  emphasis = false,
}: {
  item: StorefrontNavItem;
  onNavigate: () => void;
  // Used for the dropdown's own "shortcut to the parent item" row (e.g. a
  // bold "تسوق الكل" above its children) — same mini-card as the rest, just
  // a bit heavier so it reads as the primary option.
  emphasis?: boolean;
}) {
  const locale = useStorefrontLocale();
  const to = navHref(locale, item.path);
  const transitionClick = useTransitionClick(to, item.label);
  const cls = `flex items-center justify-between gap-2 whitespace-nowrap rounded-xl border border-taupe/50 bg-white px-4 py-2.5 text-[13px] ${
    emphasis ? 'font-semibold' : ''
  } text-espresso transition-colors duration-150 hover:border-burgundy/20 hover:bg-burgundy/[0.05] hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy`;
  const chevron = <ChevronLeft className="size-3.5 shrink-0 text-espresso/30" aria-hidden="true" />;

  if (item.kind === 'external') {
    return (
      <a href={item.path} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={cls}>
        {item.label}
        {chevron}
      </a>
    );
  }
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        onNavigate();
        transitionClick(e);
      }}
      className={cls}
    >
      {item.label}
      {chevron}
    </NavLink>
  );
}

export function DesktopNav() {
  const nav = useNavigation();
  const items = nav.main.filter((i) => i.visible);
  const [openId, setOpenId] = useState<string | null>(null);
  const close = () => setOpenId(null);

  return (
    <nav aria-label="التنقل الرئيسي" className="hidden lg:block">
      <ul className="flex items-baseline gap-9">
        {items.map((item) => {
          const children = (item.children ?? []).filter((c) => c.visible);
          if (children.length === 0) {
            return (
              <li key={item.id}>
                <NavDestination item={item} />
              </li>
            );
          }
          const open = openId === item.id;
          return (
            <li
              key={item.id}
              className="relative"
              onMouseEnter={() => setOpenId(item.id)}
              onMouseLeave={close}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
              }}
            >
              <span className="flex items-center gap-1">
                {item.path ? (
                  <NavDestination item={item} />
                ) : (
                  <span className={`${linkCls} text-espresso`}>{item.label}</span>
                )}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="true"
                  aria-label={`${open ? 'إغلاق' : 'فتح'} قائمة ${item.label}`}
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="inline-flex size-5 items-center justify-center text-espresso/70 transition hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
              </span>
              {/* The visible gap above the panel (pt-2) is an actual element
                  in this wrapper, not a margin — margin would leave a real
                  empty strip of screen between the trigger and the panel
                  that belongs to neither, so the mouse crossing it fires
                  this `<li>`'s onMouseLeave before ever reaching the panel.
                  Padding keeps that same visual gap, but as space still
                  inside this hoverable subtree. */}
              <div
                className={`absolute top-full start-0 z-50 pt-2 transition-opacity duration-200 ease-out ${
                  open ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
                }`}
              >
                <ul
                  className={`flex min-w-60 origin-top flex-col gap-1.5 rounded-2xl border border-taupe/60 bg-porcelain p-2 shadow-[0_20px_40px_-18px_rgba(41,34,30,0.3)] transition-transform duration-200 ease-out ${
                    open ? 'translate-y-0 scale-100' : '-translate-y-1.5 scale-[0.98]'
                  }`}
                >
                  {item.path && (
                    <li>
                      <ChildLink item={item} onNavigate={close} emphasis />
                    </li>
                  )}
                  {children.map((child) => (
                    <li key={child.id}>
                      <ChildLink item={child} onNavigate={close} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
