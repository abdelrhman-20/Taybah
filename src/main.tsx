import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { ErrorBoundary } from './features/shared/components/ErrorBoundary';
import { startLiveSync } from './features/shared/liveSync';
import './styles/globals.css';

startLiveSync();

// Last-resort catch-all — StorefrontLayout/AdminLayout each wrap their own
// <Outlet/> with a boundary that keeps header/nav/sidebar usable, so this
// one only fires for something that breaks above/outside both layouts
// (e.g. the router itself, or RootRedirect's locale-detection logic).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      title="تعذر تحميل التطبيق"
      body="حدثت مشكلة غير متوقعة. حاول إعادة تحميل الصفحة."
      retryLabel="إعادة المحاولة"
      recoveryLabel="إعادة تحميل الصفحة"
      recoveryHref="/"
    >
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
