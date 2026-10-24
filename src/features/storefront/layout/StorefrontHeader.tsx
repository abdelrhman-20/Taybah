import { AssetImage } from '../../shared/components/AssetImage';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Heart, Menu, Search, ShoppingBag, X } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { IconButton } from '../../shared/components/IconButton';
import { BrandMark } from '../../shared/components/BrandMark';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { CategorySelect } from './CategorySelect';
import { MobileNav } from './MobileNav';
import { StorefrontNavBar } from './StorefrontNavBar';
import { navHref } from './navData';
import { useTransitionClick } from './useTransitionClick';
import { useCart } from '../cart/useCart';
import { useWishlist } from '../wishlist/useWishlist';
import { searchProducts } from '../search/searchCatalog';
import { catalogCategories } from '../catalog/catalogData';
import { resolveCartLines, useCatalog } from '../catalog/catalogStore';
import { formatPrice } from '../../shared/utils/format';

const copy = {
  ar: {
    menu: 'فتح القائمة',
    search: 'بحث',
    closeSearch: 'إغلاق البحث',
    searchPlaceholder: 'ابحث عن منتج…',
    allCategories: 'اختر تصنيفًا',
    clear: 'مسح البحث',
    wishlist: 'المفضلة',
    cart: 'سلة التسوق',
  },
  en: {
    menu: 'Open menu',
    search: 'Search',
    closeSearch: 'Close search',
    searchPlaceholder: 'Search for a product…',
    allCategories: 'Choose a category',
    clear: 'Clear search',
    wishlist: 'Wishlist',
    cart: 'Cart',
  },
};

export function StorefrontHeader() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const cart = useCart();
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryWrapRef = useRef<HTMLDivElement>(null);
  const categoryCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // Brief tactile confirmation on submit — the search itself resolves
  // instantly (local catalog, no network round-trip), so this is a press
  // acknowledgment rather than a real loading state.
  const [submitPulse, setSubmitPulse] = useState(false);
  const catalog = useCatalog();
  const suggestions = useMemo(
    () => searchProducts(query, catalog).slice(0, 5),
    [query, catalog],
  );
  const subtotal = useMemo(
    () =>
      resolveCartLines(cart.lines, catalog)
        .filter((x) => x.name !== null)
        .reduce((n, x) => n + x.unitPrice * x.line.qty, 0),
    [cart.lines, catalog],
  );

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const v = query.trim();
    if (!v) return;
    setSubmitPulse(true);
    setTimeout(() => setSubmitPulse(false), 350);
    setSearchOpen(false);
    setSuggestOpen(false);
    navigate(navHref(locale, `/search?q=${encodeURIComponent(v)}`));
  };
  const onCategoryChange = (slug: string) => {
    setCategory(slug);
    if (slug !== 'all') navigate(navHref(locale, `/category/${slug}`));
  };
  // Opening on hover too (not just click) — the label text, the arrow and
  // the panel all live inside one wrapper (`categoryWrapRef`), so a single
  // pair of handlers on that wrapper covers all of them at once; a short
  // close delay keeps it open while the cursor travels from the label down
  // into the panel.
  const openCategoryNow = () => {
    if (categoryCloseTimer.current) clearTimeout(categoryCloseTimer.current);
    setCategoryOpen(true);
  };
  const closeCategorySoon = () => {
    categoryCloseTimer.current = setTimeout(() => setCategoryOpen(false), 150);
  };
  useEffect(() => {
    if (!categoryOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (categoryWrapRef.current && !categoryWrapRef.current.contains(e.target as Node)) setCategoryOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCategoryOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [categoryOpen]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const homeClick = useTransitionClick(`/${locale}`, locale === 'ar' ? 'طيبة' : 'Taybah');

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const suggestionList = (idPrefix: string, offset: string = 'top-[calc(100%+10px)]') => {
    const visible = suggestOpen && suggestions.length > 0;
    return (
      <ul
        id={idPrefix}
        role="listbox"
        aria-label={t.search}
        className={`absolute inset-x-0 ${offset} z-50 origin-top divide-y divide-taupe/50 overflow-hidden rounded-[18px] border border-taupe/60 bg-porcelain py-1.5 shadow-[0_24px_48px_-20px_rgba(41,34,30,0.35)] transition-all duration-200 ease-out ${
          visible ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0'
        }`}
      >
        {suggestions.map((p, i) => (
          <li key={p.id} role="option" id={`${idPrefix}-${i}`} aria-selected={i === highlight}>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSuggestOpen(false);
                navigate(navHref(locale, `/products/${p.slug}`));
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center gap-3 px-3.5 py-3 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
                i === highlight ? 'bg-burgundy/[0.07]' : ''
              }`}
            >
              <AssetImage src={p.image} alt="" className="size-11 shrink-0 rounded-xl object-cover sm:size-12" />
              <span className="flex-1 truncate font-display text-sm text-espresso">{p.name[locale]}</span>
              <span className="shrink-0 text-xs font-medium text-burgundy" dir="ltr">
                {formatPrice(p.price, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-taupe/60 bg-porcelain lg:bg-porcelain/95 lg:backdrop-blur-sm">
        <Container>
          <div className="flex h-16 items-center justify-between gap-4 lg:h-20">
            <div className="flex items-center gap-1 lg:hidden">
              <IconButton label={t.menu} onClick={() => setMenuOpen(true)}>
                <Menu className="size-5" aria-hidden="true" />
              </IconButton>
            </div>

            <Link
              to={`/${locale}`}
              onClick={homeClick}
              className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
              aria-label="طيبة — الصفحة الرئيسية"
            >
              {/* dir="ltr" so DOM order maps straight to physical position
                  (first child leftmost) regardless of the page's own RTL
                  direction — English wordmark left, divider, Arabic mark
                  right. Hidden below sm: at phone width there's no room for
                  both identities without crowding the header's icon row. */}
              <div dir="ltr" className="hidden items-center gap-4 sm:flex">
                <div className="text-center">
                  <span className="block font-['Fraunces',Georgia,serif] text-2xl leading-none text-burgundy lg:text-3xl">
                    Taybah
                  </span>
                  {/* No letter-spacing here, unlike the Latin wordmark's
                      descriptor style elsewhere — Arabic is cursive, so
                      tracking disconnects each letter from its neighbors
                      and breaks the script instead of looking elegant. */}
                  <span className="mt-1 block text-[11px] font-medium text-gold lg:text-xs">
                    سجاد · مفروشات · ستائر
                  </span>
                </div>
                <OrnamentDivider orientation="vertical" className="h-10 lg:h-12" />
                <BrandMark className="h-12 w-auto lg:h-14" />
              </div>
              <BrandMark className="h-12 w-auto sm:hidden" />
            </Link>

            {/* Permanent desktop search: category selector + input, always
                visible per the reference layout (mobile keeps the toggle
                below since there's no room for it inline). The whole pill
                reacts to focus-within so the glow follows whichever part
                (category button or input) actually has focus. */}
            <form
              role="search"
              onSubmit={submitSearch}
              className="group relative hidden max-w-lg flex-1 items-stretch rounded-full border border-taupe bg-white shadow-sm transition-all duration-300 focus-within:border-burgundy focus-within:shadow-[0_0_0_4px_rgba(104,29,32,0.08),0_10px_28px_-10px_rgba(104,29,32,0.35)] lg:flex"
            >
              {/* Static label — always reads "اختر تصنيفًا" regardless of
                  what's picked; the select itself only ever shows a real
                  category's name once one is actually chosen. Wrapped with
                  the dropdown trigger in one shared hover/outside-click
                  area (`flex` so it adds no visual box of its own — same
                  layout as before, just one hoverable unit instead of two). */}
              <div
                ref={categoryWrapRef}
                className="relative hidden shrink-0 items-stretch lg:flex"
                onMouseEnter={openCategoryNow}
                onMouseLeave={closeCategorySoon}
              >
                <span className="flex shrink-0 cursor-default items-center whitespace-nowrap px-4 text-[13px] text-espresso/75">
                  {t.allCategories}
                </span>
                <CategorySelect
                  value={category}
                  onChange={onCategoryChange}
                  options={catalogCategories.map((c) => ({ slug: c.slug, label: c.name[locale] }))}
                  ariaLabel={t.allCategories}
                  open={categoryOpen}
                  onClose={() => setCategoryOpen(false)}
                />
              </div>
              <span className="my-2.5 w-px shrink-0 bg-taupe" aria-hidden="true" />
              <div className="relative flex flex-1 items-center">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(-1);
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlight((h) => Math.max(h - 1, -1));
                    } else if (e.key === 'Escape') {
                      setSuggestOpen(false);
                    } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
                      e.preventDefault();
                      setSuggestOpen(false);
                      navigate(navHref(locale, `/products/${suggestions[highlight].slug}`));
                    }
                  }}
                  placeholder={t.searchPlaceholder}
                  aria-label={t.search}
                  role="combobox"
                  aria-expanded={suggestOpen && suggestions.length > 0}
                  aria-controls="header-search-suggestions-desktop"
                  aria-activedescendant={highlight >= 0 ? `header-search-suggestions-desktop-${highlight}` : undefined}
                  aria-autocomplete="list"
                  className="h-11 w-full bg-transparent pe-2 ps-4 text-sm text-espresso placeholder:text-espresso/40 placeholder:transition-colors focus:outline-none focus:placeholder:text-espresso/55"
                />
                {query && (
                  <button
                    type="button"
                    aria-label={t.clear}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery('');
                      setHighlight(-1);
                    }}
                    className="me-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-espresso/35 transition-colors duration-150 hover:bg-burgundy/10 hover:text-burgundy"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {suggestionList('header-search-suggestions-desktop')}
              </div>
              <button
                type="submit"
                aria-label={t.search}
                className={`group/btn inline-flex h-11 shrink-0 items-center justify-center rounded-e-full bg-burgundy px-5 text-white transition-all duration-200 hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                  submitPulse ? 'scale-95' : 'scale-100'
                }`}
              >
                <Search className="size-4 transition-transform duration-300 group-hover/btn:scale-110" aria-hidden="true" />
              </button>
            </form>

            <div className="flex items-center gap-0.5">
              <IconButton
                label={searchOpen ? t.closeSearch : t.search}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((v) => !v)}
                className="lg:hidden"
              >
                {searchOpen ? (
                  <X className="size-5" aria-hidden="true" />
                ) : (
                  <Search className="size-5" aria-hidden="true" />
                )}
              </IconButton>

              <Link
                to={navHref(locale, '/wishlist')}
                aria-label={t.wishlist}
                title={t.wishlist}
                className="wishlist-heart-trigger relative hidden size-10 items-center justify-center rounded-full text-espresso transition-colors hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy sm:inline-flex"
              >
                <Heart className="wishlist-heart size-5" aria-hidden="true" />
                {wishlist.count > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-semibold leading-4 text-white">
                    {wishlist.count}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => cart.setDrawer(true)}
                aria-label={t.cart}
                title={t.cart}
                className="relative flex items-center gap-2 rounded-full py-1.5 ps-2 pe-3 text-espresso transition-colors hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
              >
                <span className="relative inline-flex size-10 items-center justify-center">
                  <ShoppingBag className="size-5" aria-hidden="true" />
                  {cart.count > 0 && (
                    <span className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-semibold leading-4 text-white">
                      {cart.count}
                    </span>
                  )}
                </span>
                <span className="hidden text-[13px] font-medium sm:inline" dir="ltr">
                  {formatPrice(subtotal, locale)}
                </span>
              </button>
            </div>
          </div>
        </Container>

        <div
          inert={!searchOpen}
          className={`border-taupe/60 bg-porcelain transition-[max-height] duration-300 lg:hidden ${
            searchOpen ? 'max-h-96 overflow-visible border-b' : 'max-h-0 overflow-hidden'
          }`}
        >
          <Container className="py-4">
            <form
              role="search"
              onSubmit={submitSearch}
              className="group relative flex items-center rounded-full border border-taupe bg-white shadow-sm transition-all duration-300 focus-within:border-burgundy focus-within:shadow-[0_0_0_4px_rgba(104,29,32,0.08),0_10px_28px_-10px_rgba(104,29,32,0.35)]"
            >
              <Search
                className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(-1);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, -1));
                  } else if (e.key === 'Escape') {
                    setSuggestOpen(false);
                  } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
                    e.preventDefault();
                    setSearchOpen(false);
                    setSuggestOpen(false);
                    navigate(navHref(locale, `/products/${suggestions[highlight].slug}`));
                  }
                }}
                placeholder={t.searchPlaceholder}
                aria-label={t.search}
                role="combobox"
                aria-expanded={suggestOpen && suggestions.length > 0}
                aria-controls="header-search-suggestions-mobile"
                aria-activedescendant={highlight >= 0 ? `header-search-suggestions-mobile-${highlight}` : undefined}
                aria-autocomplete="list"
                className="h-12 w-full bg-transparent pe-12 ps-11 text-sm text-espresso placeholder:text-espresso/40 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label={t.clear}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery('');
                    setHighlight(-1);
                  }}
                  className="absolute end-12 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-espresso/35 transition-colors duration-150 hover:bg-burgundy/10 hover:text-burgundy"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
              <button
                type="submit"
                aria-label={t.search}
                className={`group/btn absolute end-1.5 inline-flex size-9 items-center justify-center rounded-full bg-burgundy text-white transition-all duration-200 hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                  submitPulse ? 'scale-95' : 'scale-100'
                }`}
              >
                <Search className="size-4 transition-transform duration-300 group-hover/btn:scale-110" aria-hidden="true" />
              </button>
              {/* Suggestions render inside this relative form. The panel wrapper is
                  overflow-visible while open, so the list is never clipped. */}
              {suggestionList('header-search-suggestions-mobile')}
            </form>
          </Container>
        </div>
      </header>

      <StorefrontNavBar />

      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
