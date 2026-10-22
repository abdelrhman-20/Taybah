import { Phone } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { HOTLINE_NUMBER, SOCIAL_LINKS } from './storeContact';

const copy = {
  ar: { hotline: 'الخط الساخن' },
  en: { hotline: 'Hotline' },
};

export function AnnouncementBar() {
  const locale = useStorefrontLocale();
  const t = copy[locale];

  return (
    <div className="bg-espresso text-porcelain/85">
      <Container className="flex h-10 items-center justify-between gap-4 text-[11px] tracking-wide">
        <div className="flex items-center gap-3">
          {SOCIAL_LINKS.map(({ id, label, href, icon: Icon }) => (
            <a
              key={id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              className="text-porcelain/70 transition-colors hover:text-gold"
            >
              <Icon className="size-5" />
            </a>
          ))}
        </div>
        <a
          href={`tel:${HOTLINE_NUMBER}`}
          className="flex items-center gap-1.5 whitespace-nowrap text-porcelain/85 transition-colors hover:text-gold"
        >
          <Phone className="size-3.5" aria-hidden="true" />
          <span dir="ltr">{HOTLINE_NUMBER}</span>
          <span className="hidden sm:inline">: {t.hotline}</span>
        </a>
      </Container>
    </div>
  );
}
