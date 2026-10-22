import { Link, useParams } from 'react-router';
import { isStorefrontLocale, DEFAULT_LOCALE } from '../utils/locale';

const copy = {
  ar: { title: 'الصفحة غير موجودة', body: 'يبدو أن هذه الصفحة انتقلت أو لم تعد موجودة.', back: 'العودة إلى الرئيسية' },
  en: { title: 'Page not found', body: 'This page may have moved or no longer exists.', back: 'Back to home' },
};

export function NotFoundPage() {
  const { locale } = useParams();
  const active = isStorefrontLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = copy[active];

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
      <p className="font-display text-6xl text-espresso/20">404</p>
      <h1 className="mt-4 font-display text-3xl text-espresso">{t.title}</h1>
      <p className="mt-3 text-sm text-espresso/60">{t.body}</p>
      <Link
        to={`/${active}`}
        className="mt-8 text-sm font-medium text-burgundy underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
      >
        {t.back}
      </Link>
    </div>
  );
}
