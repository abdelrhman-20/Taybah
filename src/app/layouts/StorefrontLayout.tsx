import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import {
  DEFAULT_LOCALE,
  isStorefrontLocale,
  LOCALE_STORAGE_KEY,
  localeDirection,
} from '../../features/shared/utils/locale';
import { AnnouncementBar } from '../../features/storefront/layout/AnnouncementBar';
import { StorefrontHeader } from '../../features/storefront/layout/StorefrontHeader';
import { StorefrontFooter } from '../../features/storefront/layout/StorefrontFooter';
import { BottomNav } from '../../features/storefront/layout/BottomNav';
import { BackToTopButton } from '../../features/storefront/layout/BackToTopButton';
import { CartDrawer } from '../../features/storefront/cart/CartDrawer';
import { PageTransitionProvider } from '../../features/storefront/layout/PageTransition';
import { ErrorBoundary } from '../../features/shared/components/ErrorBoundary';
import { Reveal } from '../../features/shared/components/Reveal';
import { ScrollToTop } from '../../features/shared/components/ScrollToTop';
import { DataGate } from '../../features/shared/components/DataGate';

const skipLabel = { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' };

export function StorefrontLayout() {
  const { locale } = useParams();
  const location = useLocation();

  useEffect(() => {
    if (!isStorefrontLocale(locale)) return;
    const root = document.documentElement;
    root.lang = locale;
    root.dir = localeDirection();
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      return;
    }
  }, [locale]);

  if (!isStorefrontLocale(locale)) {
    const suffix = locale ? location.pathname.slice(locale.length + 1) : '';
    return <Navigate to={`/${DEFAULT_LOCALE}${suffix}`} replace />;
  }

  return (
    <PageTransitionProvider>
      <DataGate bilingual>
      <div className="flex min-h-screen flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <ScrollToTop />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded focus:bg-burgundy focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          {skipLabel[locale]}
        </a>
        <AnnouncementBar />
        <StorefrontHeader />
        <main id="main-content" className="flex-1">
          <ErrorBoundary
            title="حدث خطأ غير متوقع"
            body="واجهت هذه الصفحة مشكلة فنية. يمكنك إعادة المحاولة أو العودة إلى الصفحة الرئيسية."
            retryLabel="إعادة المحاولة"
            recoveryLabel="العودة إلى الرئيسية"
            recoveryHref={`/${locale}`}
          >
            <Outlet />
          </ErrorBoundary>
        </main>
        <Reveal variant="fade" duration={600}>
          <StorefrontFooter />
        </Reveal>
        <CartDrawer />
        <BottomNav />
        <BackToTopButton />
      </div>
      </DataGate>
    </PageTransitionProvider>
  );
}
