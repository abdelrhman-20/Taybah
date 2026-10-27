import {
  Boxes,
  DatabaseBackup,
  FolderTree,
  Images,
  LayoutDashboard,
  Layers,
  ListOrdered,
  Package,
  PanelsTopLeft,
  Settings,
  ShoppingCart,
  SwatchBook,
  TicketPercent,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface AdminNavItem {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export const adminNav: AdminNavItem[] = [
  { key: 'dashboard', label: 'لوحة التحكم', path: '/admin', icon: LayoutDashboard },
  { key: 'orders', label: 'الطلبات', path: '/admin/orders', icon: ShoppingCart },
  { key: 'products', label: 'المنتجات', path: '/admin/products', icon: Package },
  { key: 'inventory', label: 'المخزون', path: '/admin/inventory', icon: Boxes },
  { key: 'categories', label: 'التصنيفات', path: '/admin/categories', icon: FolderTree },
  { key: 'collections', label: 'المجموعات', path: '/admin/collections', icon: Layers },
  { key: 'homepage', label: 'الصفحة الرئيسية', path: '/admin/homepage', icon: PanelsTopLeft },
  { key: 'navigation', label: 'التنقل', path: '/admin/navigation', icon: ListOrdered },
  { key: 'media', label: 'مكتبة الصور', path: '/admin/media', icon: Images },
  { key: 'attributes', label: 'السمات', path: '/admin/attributes', icon: SwatchBook },
  { key: 'customers', label: 'العملاء', path: '/admin/customers', icon: Users },
  { key: 'promotions', label: 'العروض', path: '/admin/promotions', icon: TicketPercent },
  { key: 'migration', label: 'النسخ الاحتياطي والترحيل', path: '/admin/migration', icon: DatabaseBackup },
  { key: 'settings', label: 'الإعدادات', path: '/admin/settings', icon: Settings },
];
