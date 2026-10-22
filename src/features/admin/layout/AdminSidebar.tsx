import { useEffect } from 'react';
import { NavLink } from 'react-router';
import { X } from 'lucide-react';
import { IconButton } from '../../shared/components/IconButton';
import { adminNav } from './adminNav';

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center border-b border-taupe/50 px-5">
        <span className="font-display text-xl text-espresso">طيبة</span>
        <span className="ms-2 rounded bg-burgundy/10 px-1.5 py-0.5 text-[10px] font-semibold text-burgundy">
          الإدارة
        </span>
      </div>
      <nav aria-label="الإدارة" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {adminNav.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.path}
                end={item.path === '/admin'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded px-3 py-2.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-burgundy ${
                    isActive
                      ? 'bg-burgundy/10 font-medium text-burgundy'
                      : 'text-espresso/70 hover:bg-espresso/5 hover:text-espresso'
                  }`
                }
              >
                <item.icon className="size-4.5 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-e border-taupe/50 bg-white lg:flex">
        <SidebarContent />
      </aside>

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
          className={`absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-label="قائمة الإدارة"
        >
          <div className="absolute end-2 top-3.5">
            <IconButton label="إغلاق القائمة" onClick={onClose}>
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </div>
          <SidebarContent onNavigate={onClose} />
        </aside>
      </div>
    </>
  );
}
