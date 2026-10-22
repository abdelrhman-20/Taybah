import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { ProductListing } from '../catalog/ProductListing';
import { searchProducts } from './searchCatalog';
import { useCatalog } from '../catalog/catalogStore';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'البحث',
    resultsFor: 'نتائج البحث عن',
    placeholder: 'ابحث عن سجاد، ستائر، مفروشات…',
    submit: 'بحث',
    idleTitle: 'ابحث في المتجر',
    idleDesc: 'اكتب اسم منتج أو قسمًا أو خامة — مثل "سجاد" أو "مخمل".',
    noResultsTitle: (q: string) => `لا توجد نتائج لـ "${q}"`,
    noResultsDesc: 'جرّب كلمات مختلفة، أو تأكد من الإملاء، أو تصفح الأقسام.',
    browse: 'تصفح كل المنتجات',
  },
  en: {
    home: 'Home',
    title: 'Search',
    resultsFor: 'Search results for',
    placeholder: 'Search rugs, curtains, furnishings…',
    submit: 'Search',
    idleTitle: 'Search the store',
    idleDesc: 'Type a product name, category, or material — like "rug" or "velvet".',
    noResultsTitle: (q: string) => `No results for "${q}"`,
    noResultsDesc: 'Try different words, check the spelling, or browse the categories.',
    browse: 'Browse all products',
  },
};

export function SearchPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = (searchParams.get('q') ?? '').trim();

  const [input, setInput] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) {
    setLastQ(q);
    setInput(q);
  }

  const catalog = useCatalog();
  const results = useMemo(() => searchProducts(q, catalog), [q, catalog]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(navHref(locale, `/search?q=${encodeURIComponent(input.trim())}`));
  };

  const searchForm = (
    <form onSubmit={submit} className="mt-5 max-w-xl" role="search">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
          aria-hidden
        />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.placeholder}
          aria-label={t.title}
          className="w-full rounded-full border border-taupe bg-white py-3 pe-14 ps-11 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
        />
        <button
          type="submit"
          aria-label={t.submit}
          className="absolute end-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-burgundy text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <Search className="size-4" aria-hidden />
        </button>
      </div>
    </form>
  );

  return (
    <ProductListing
      products={results}
      title={q ? `${t.resultsFor} "${q}"` : t.title}
      breadcrumb={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]}
      showCategory
      headerSlot={searchForm}
      emptyTitle={q ? t.noResultsTitle(q) : t.idleTitle}
      emptyDesc={q ? t.noResultsDesc : t.idleDesc}
      emptyAction={
        q ? (
          <Link
            to={navHref(locale, '/products')}
            className="border border-burgundy px-6 py-2.5 text-sm font-medium text-burgundy transition hover:bg-burgundy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.browse}
          </Link>
        ) : null
      }
    />
  );
}
