import { createBrowserRouter, Navigate } from 'react-router';
import { StorefrontLayout } from '../layouts/StorefrontLayout';
import { AdminLayout } from '../layouts/AdminLayout';
import { PrefixedAdminRedirect, RootRedirect } from './RootRedirect';
import { HomePage } from '../../features/storefront/home/HomePage';
import { ProductsPage } from '../../features/storefront/catalog/ProductsPage';
import { CategoryPage } from '../../features/storefront/catalog/CategoryPage';
import { CategoriesPage } from '../../features/storefront/catalog/CategoriesPage';
import { CollectionsPage } from '../../features/storefront/catalog/CollectionsPage';
import { CollectionPage } from '../../features/storefront/catalog/CollectionPage';
import { ProductPage } from '../../features/storefront/product/ProductPage';
import { CartPage } from '../../features/storefront/cart/CartPage';
import { WishlistPage } from '../../features/storefront/wishlist/WishlistPage';
import { SearchPage } from '../../features/storefront/search/SearchPage';
import { AboutPage } from '../../features/storefront/pages/AboutPage';
import { ContactPage } from '../../features/storefront/pages/ContactPage';
import { FaqPage } from '../../features/storefront/pages/FaqPage';
import { PrivacyPage } from '../../features/storefront/pages/PrivacyPage';
import { TermsPage } from '../../features/storefront/pages/TermsPage';
import { ShippingReturnsPage } from '../../features/storefront/pages/ShippingReturnsPage';
import { CheckoutPage } from '../../features/storefront/checkout/CheckoutPage';
import { OrderConfirmationPage } from '../../features/storefront/checkout/OrderConfirmationPage';
import { AdminDashboardPage } from '../../features/admin/dashboard/AdminDashboardPage';
import { OrdersPage } from '../../features/admin/orders/OrdersPage';
import { OrderDetailsPage } from '../../features/admin/orders/OrderDetailsPage';
import { InStoreOrderPage } from '../../features/admin/orders/InStoreOrderPage';
import { AdminInventoryPage } from '../../features/admin/inventory/AdminInventoryPage';
import { InventoryMovementsPage } from '../../features/admin/inventory/InventoryMovementsPage';
import { InventoryReconciliationPage } from '../../features/admin/inventory/InventoryReconciliationPage';
import { AdminPlaceholderPage } from '../../features/admin/components/AdminPlaceholderPage';
import { AdminProductsPage } from '../../features/admin/catalog/AdminProductsPage';
import { ProductFormPage } from '../../features/admin/catalog/ProductFormPage';
import { AdminProductDetailsPage } from '../../features/admin/catalog/AdminProductDetailsPage';
import { AdminCategoriesPage } from '../../features/admin/catalog/AdminCategoriesPage';
import { AdminCollectionsPage } from '../../features/admin/catalog/AdminCollectionsPage';
import { TaxonomyFormPage } from '../../features/admin/catalog/TaxonomyFormPage';
import { AdminHomepagePage } from '../../features/admin/homepage/AdminHomepagePage';
import { HomeSectionEditRoute } from '../../features/admin/homepage/HomeSectionEditPage';
import { AdminNavigationPage } from '../../features/admin/navigation/AdminNavigationPage';
import { AdminMediaPage } from '../../features/admin/media/AdminMediaPage';
import { AdminMigrationPage } from '../../features/admin/migration/AdminMigrationPage';
import { AdminAttributesPage } from '../../features/admin/attributes/AdminAttributesPage';
import { AttributeFormPage } from '../../features/admin/attributes/AttributeFormPage';
import { adminNav } from '../../features/admin/layout/adminNav';
import { NotFoundPage } from '../../features/shared/components/NotFoundPage';
import { AdminLoginPage } from '../../features/admin/auth/AdminLoginPage';

export const router = createBrowserRouter(
  [
  { path: '/', element: <RootRedirect /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  {
    path: '/:locale',
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'products/:slug', element: <ProductPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'category/:slug', element: <CategoryPage /> },
      { path: 'collections', element: <CollectionsPage /> },
      { path: 'collection/:slug', element: <CollectionPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'wishlist', element: <WishlistPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'faq', element: <FaqPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'shipping-returns', element: <ShippingReturnsPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'order-confirmation/:orderId', element: <OrderConfirmationPage /> },
      { path: 'admin', element: <Navigate to="/admin" replace /> },
      { path: 'admin/*', element: <PrefixedAdminRedirect /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/new', element: <InStoreOrderPage /> },
      { path: 'orders/:orderId', element: <OrderDetailsPage /> },
      { path: 'products', element: <AdminProductsPage /> },
      { path: 'products/new', element: <ProductFormPage /> },
      { path: 'products/:productId', element: <AdminProductDetailsPage /> },
      { path: 'products/:productId/edit', element: <ProductFormPage /> },
      { path: 'inventory', element: <AdminInventoryPage /> },
      { path: 'inventory/movements', element: <InventoryMovementsPage /> },
      { path: 'inventory/reconciliation', element: <InventoryReconciliationPage /> },
      { path: 'categories', element: <AdminCategoriesPage /> },
      { path: 'categories/new', element: <TaxonomyFormPage kind="category" /> },
      { path: 'categories/:categoryId/edit', element: <TaxonomyFormPage kind="category" /> },
      { path: 'collections', element: <AdminCollectionsPage /> },
      { path: 'collections/new', element: <TaxonomyFormPage kind="collection" /> },
      { path: 'collections/:collectionId/edit', element: <TaxonomyFormPage kind="collection" /> },
      { path: 'homepage', element: <AdminHomepagePage /> },
      { path: 'homepage/:sectionKey', element: <HomeSectionEditRoute /> },
      { path: 'navigation', element: <AdminNavigationPage /> },
      { path: 'media', element: <AdminMediaPage /> },
      { path: 'migration', element: <AdminMigrationPage /> },
      { path: 'attributes', element: <AdminAttributesPage /> },
      { path: 'attributes/new', element: <AttributeFormPage /> },
      { path: 'attributes/:attrKey', element: <AttributeFormPage /> },
      ...adminNav
        .filter(
          (i) =>
            !['dashboard', 'orders', 'products', 'inventory', 'categories', 'collections', 'homepage', 'navigation', 'media', 'attributes', 'migration'].includes(i.key),
        )
        .map((i) => ({
          path: i.path.replace('/admin/', ''),
          element: <AdminPlaceholderPage title={i.label} />,
        })),
      { path: '*', element: <Navigate to="/admin" replace /> },
    ],
  },
    { path: '*', element: <RootRedirect /> },
  ],
  // Deployed under /<repo>/ on GitHub Pages; BASE_URL is '/' in dev.
  { basename: import.meta.env.BASE_URL },
);
