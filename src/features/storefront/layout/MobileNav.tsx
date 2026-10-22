import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { ChevronDown, X } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { IconButton } from '../../shared/components/IconButton';
import { BrandMark } from '../../shared/components/BrandMark';
import { navHref } from './navData';
import { useNavigation, type StorefrontNavItem } from './navStore';
import { useTransitionClick } from './useTransitionClick';

const copy = {
  ar: { close: 'إغلاق القائمة', nav: 'القائمة الرئيسية' },
  en: { close: 'Close menu', nav: 'Main menu' },
};

function MobileNavLink({
  item,
  open,
  onClose,
  className,
}: {
  item: StorefrontNavItem;
  open: boolean;
  onClose: () => void;
  className: string;
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
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={`${className} text-espresso hover:bg-espresso/5`}
      >
        {item.label}
      </a>
    );
  }
  return (
    <NavLink
      to={to}
      onClick={(e) => {
        onClose();
        transitionClick(e);
      }}
      tabIndex={open ? 0 : -1}
      className={({ isActive }) =>
        `${className} ${isActive ? 'text-burgundy' : 'text-espresso hover:bg-espresso/5'}`
      }
    >
      {item.label}
    </NavLink>
  );
}

export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const nav = useNavigation();
  const items = nav.main.filter((i) => i.visible);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 lg:hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-espresso/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute inset-y-0 start-0 flex w-80 max-w-[85vw] flex-col bg-porcelain shadow-xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        }`}
        aria-label={t.nav}
      >
        <div className="flex h-16 items-center justify-between border-b border-taupe/60 px-5">
          <BrandMark className="h-10 w-auto" />
          <IconButton label={t.close} onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
        <nav aria-label={t.nav} className="flex-1 overflow-y-auto px-5 py-6">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const children = (item.children ?? []).filter((c) => c.visible);
              const expanded = expandedId === item.id;
              const itemCls = `block rounded px-3 py-3 font-display text-xl transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-burgundy`;
              const link = (extra?: string) => (
                <MobileNavLink
                  item={item}
                  open={open}
                  onClose={onClose}
                  className={`${itemCls} ${extra ?? ''}`}
                />
              );
              if (children.length === 0) {
                return <li key={item.id}>{link()}</li>;
              }
              return (
                <li key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    {item.path ? (
                      <span className="flex-1">{link('w-full')}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        tabIndex={open ? 0 : -1}
                        aria-expanded={expanded}
                        className={`${itemCls} flex-1 text-start text-espresso hover:bg-espresso/5`}
                      >
                        {item.label}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      tabIndex={open ? 0 : -1}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'طي' : 'فتح'} قائمة ${item.label}`}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                    >
                      <ChevronDown
                        className={`size-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>
                  </div>
                  {expanded && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-s-2 border-espresso/15 ms-3 ps-3">
                      {children.map((child) => (
                        <li key={child.id}>
                          <MobileNavLink
                            item={child}
                            open={open}
                            onClose={onClose}
                            className="block rounded px-3 py-2.5 text-base transition-colors focus-visible:outline-2 focus-visible:outline-burgundy"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
