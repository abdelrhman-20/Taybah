import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, Menu, Ruler } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { IconButton } from '../../shared/components/IconButton';
import { supabase } from '../../../lib/supabase/client';
import { useCatalog } from '../../storefront/catalog/catalogStore';
import { adminNav } from './adminNav';

export function AdminTopbar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const section = adminNav.find((i) =>
    i.path === '/admin' ? pathname === '/admin' : pathname.startsWith(i.path),
  );

  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // Products with incomplete size data surface here — no sizes selected at
  // all, or sizes selected but no default picked. The form normally blocks
  // both, so these come from legacy seeds or a size value deleted while
  // still assigned. Fixing the product clears the notification.
  const missingSizes = catalog.products.filter(
    (p) => p.sizes.length === 0 || !p.size,
  );

  useEffect(() => {
    if (!bellOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBellOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [bellOpen]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // Network trouble while revoking the session server-side: the local
      // session is still cleared by supabase-js, so leave the admin anyway
      // instead of stranding the user on a page that looks signed in.
      console.error('sign-out request failed:', e instanceof Error ? e.message : e);
    }
    navigate('/admin/login', { replace: true });
  };
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-taupe/50 bg-white/95 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-2">
        <span className="lg:hidden">
          <IconButton label="فتح القائمة" onClick={onMenu}>
            <Menu className="size-5" aria-hidden="true" />
          </IconButton>
        </span>
        <h1 className="text-sm font-semibold tracking-wide text-espresso">
          {section?.label ?? 'الإدارة'}
        </h1>
      </div>
      <div className="flex items-center gap-1">
        <div className="relative" ref={bellRef}>
          <IconButton
            label="الإشعارات"
            className="relative"
            onClick={() => setBellOpen((o) => !o)}
            aria-expanded={bellOpen}
          >
            <Bell className="size-5" aria-hidden="true" />
            {missingSizes.length > 0 && (
              <span className="absolute -top-0.5 -end-0.5 flex size-4 items-center justify-center rounded-full bg-burgundy text-[10px] font-bold text-white">
                {missingSizes.length}
              </span>
            )}
          </IconButton>
          {bellOpen && (
            <div className="absolute end-0 top-12 z-50 w-80 rounded border border-taupe bg-white shadow-xl">
              <h2 className="border-b border-taupe/60 px-4 py-3 text-sm font-semibold text-espresso">
                الإشعارات
              </h2>
              {missingSizes.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-espresso/55">
                  لا إشعارات — بيانات المقاسات مكتملة لكل المنتجات.
                </p>
              ) : (
                <ul className="max-h-80 divide-y divide-taupe/50 overflow-y-auto">
                  {missingSizes.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/admin/products/${p.id}/edit`}
                        onClick={() => setBellOpen(false)}
                        className="flex items-start gap-3 px-4 py-3 transition hover:bg-porcelain/50 focus-visible:outline-2 focus-visible:outline-burgundy"
                      >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
                          <Ruler className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-espresso">
                            {p.name.ar}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-espresso/55">
                            {p.sizes.length === 0
                              ? 'منتج بلا مقاسات — حدّد مقاساته من «إدارة المقاسات» في صفحة التعديل.'
                              : 'لا مقاس افتراضي — اختر «المقاس الافتراضي» في صفحة التعديل.'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <IconButton label="تسجيل الخروج" onClick={signOut}>
          <LogOut className="size-5" aria-hidden="true" />
        </IconButton>
        <span
          className="ms-1 flex size-9 items-center justify-center rounded-full bg-espresso text-xs font-semibold text-porcelain"
          aria-label="فريق العمل"
          title="حساب فريق العمل"
        >
          ط
        </span>
      </div>
    </header>
  );
}
