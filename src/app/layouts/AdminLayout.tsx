import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AdminSidebar } from '../../features/admin/layout/AdminSidebar';
import { AdminTopbar } from '../../features/admin/layout/AdminTopbar';
import { ErrorBoundary } from '../../features/shared/components/ErrorBoundary';
import { ScrollToTop } from '../../features/shared/components/ScrollToTop';
import { useAdminSession } from '../../features/admin/auth/useAdminSession';
import { LoadingState } from '../../features/shared/components/LoadingState';

export function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, loading } = useAdminSession();
  const location = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    root.lang = 'ar';
    root.dir = 'rtl';
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  if (!session) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
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
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
