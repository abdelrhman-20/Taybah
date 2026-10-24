import { Link, useLocation } from 'react-router';
import { Heart, Home, LayoutGrid, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { useCart } from '../cart/useCart';
import { useWishlist } from '../wishlist/useWishlist';
import { navHref } from './navData';

const copy = {
  ar: { nav: 'التنقل السريع', home: 'الرئيسية', categories: 'الأقسام', wishlist: 'المفضلة', cart: 'السلة' },
  en: { nav: 'Quick navigation', home: 'Home', categories: 'Categories', wishlist: 'Wishlist', cart: 'Cart' },
};

const itemCls = (active: boolean) =>
  `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-burgundy ${
    active ? 'text-burgundy' : 'text-espresso/65'
  }`;

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -end-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-semibold leading-4 text-white">
      {n}
    </span>
  );
}

// Phone-only fixed bar (hidden from `lg`, where the desktop header takes over).
// Uses only routes and state that exist: home, the categories page, the
// wishlist page, and the cart drawer. There is no customer-account feature, so
// there is no "account" item.
export function BottomNav() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const { pathname } = useLocation();
  const cart = useCart();
  const wishlist = useWishlist();
  const is = (path: string) => pathname === navHref(locale, path) || pathname === `${navHref(locale, path)}/`;
  const link = (to: string, Icon: LucideIcon, label: string, count = 0) => {
    const active = is(to === '/' ? '' : to);
    return (
      <Link to={navHref(locale, to)} aria-current={active ? 'page' : undefined} className={itemCls(active)}>
        <span className="relative">
          <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.6} aria-hidden />
          <Badge n={count} />
        </span>
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label={t.nav}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-taupe/70 bg-porcelain/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <div className="mx-auto flex max-w-xl">
        {link('/', Home, t.home)}
        {link('/categories', LayoutGrid, t.categories)}
        {link('/wishlist', Heart, t.wishlist, wishlist.count)}
        <button type="button" onClick={() => cart.setDrawer(true)} className={itemCls(false)}>
          <span className="relative">
            <ShoppingBag className="size-[22px]" strokeWidth={1.6} aria-hidden />
            <Badge n={cart.count} />
          </span>
          {t.cart}
        </button>
      </div>
    </nav>
  );
}
