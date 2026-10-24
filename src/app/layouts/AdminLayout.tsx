import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { DatabaseZap, ShieldAlert, WifiOff } from 'lucide-react';
import { AdminSidebar } from '../../features/admin/layout/AdminSidebar';
import { AdminTopbar } from '../../features/admin/layout/AdminTopbar';
import { ErrorBoundary } from '../../features/shared/components/ErrorBoundary';
import { ScrollToTop } from '../../features/shared/components/ScrollToTop';
import { DataGate } from '../../features/shared/components/DataGate';
import { useAdminSession } from '../../features/admin/auth/useAdminSession';
import { LoadingState } from '../../features/shared/components/LoadingState';
import { getDocsState, subscribeDocs } from '../../features/storefront/catalog/catalogDocs';
import { supabase, supabaseConfigured } from '../../lib/supabase/client';

function Notice({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-porcelain/60 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-taupe text-burgundy">
        {icon}
      </span>
      <h1 className="font-display text-2xl text-espresso">{title}</h1>
      <p className="max-w-md text-sm leading-7 text-espresso/65">{body}</p>
      <div className="flex gap-3">{children}</div>
    </div>
  );
}

const btn =
  'rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso focus-visible:outline-2 focus-visible:outline-burgundy';

// Shown above every admin page until the one-time catalog migration has been
// completed and verified: until then products/categories/attributes/menus
// are read-only (the storefront still serves the built-in catalog).
function CatalogMigrationBanner() {
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const { pathname } = useLocation();
  if (!supabaseConfigured || docs.status !== 'ready' || docs.initialized) return null;
  if (pathname.startsWith('/admin/migration')) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex flex-wrap items-center gap-3 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-espresso"
    >
      <DatabaseZap className="size-4 shrink-0 text-burgundy" aria-hidden />
      <span className="flex-1 leading-6">
        {docs.schemaMissing
          ? 'جداول الكتالوج غير موجودة في قاعدة البيانات بعد (الترحيل 0006 لم يُطبَّق)، لذلك تعديلات الكتالوج معطّلة. المتجر يعرض الكتالوج المدمج حاليًا.'
          : 'الكتالوج (المنتجات والتصنيفات والسمات والقوائم) لم يُرحَّل إلى قاعدة البيانات بعد، لذلك تعديلاته معطّلة. المتجر يعرض الكتالوج المدمج حاليًا.'}
      </span>
      <Link to="/admin/migration" className="font-medium text-burgundy underline-offset-4 hover:underline">
        فتح النسخ الاحتياطي والترحيل
      </Link>
    </div>
  );
}

export function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, loading, access, recheck } = useAdminSession();
  const location = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    root.lang = 'ar';
    root.dir = 'rtl';
  }, []);

  if (loading || access === 'checking') {
    return <LoadingState />;
  }

  if (!session || access === 'signed_out') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (access === 'not_admin') {
    return (
      <Notice
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="ليس لديك صلاحية المسؤول"
        body="تم تسجيل الدخول، لكن هذا الحساب غير مُضاف إلى قائمة المسؤولين في قاعدة البيانات، لذلك لن يُحفظ أي تعديل. اطلب من مالك المشروع إضافة حسابك، أو سجّل الدخول بحساب آخر."
      >
        <button type="button" className={btn} onClick={recheck}>
          إعادة الفحص
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            void supabase.auth.signOut();
          }}
        >
          تسجيل الخروج
        </button>
      </Notice>
    );
  }

  if (access === 'error') {
    return (
      <Notice
        icon={<WifiOff className="size-6" aria-hidden />}
        title="تعذّر التحقق من صلاحياتك"
        body="لم نتمكن من الوصول إلى الخادم للتحقق من حساب المسؤول. تحقق من الاتصال ثم أعد المحاولة."
      >
        <button type="button" className={btn} onClick={recheck}>
          إعادة المحاولة
        </button>
      </Notice>
    );
  }

  return (
    <div className="flex min-h-screen bg-porcelain/60">
      <ScrollToTop />
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <ErrorBoundary
            title="حدث خطأ غير متوقع"
            body="واجهت هذه الصفحة مشكلة فنية. يمكنك إعادة المحاولة أو العودة إلى لوحة التحكم."
            retryLabel="إعادة المحاولة"
            recoveryLabel="العودة إلى لوحة التحكم"
            recoveryHref="/admin"
          >
            <DataGate>
              <CatalogMigrationBanner />
              <Outlet />
            </DataGate>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
