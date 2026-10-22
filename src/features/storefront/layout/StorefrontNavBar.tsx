import { Phone } from 'lucide-react';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { Container } from '../../shared/components/Container';
import { BrowseMenu } from './BrowseMenu';
import { DesktopNav } from './DesktopNav';
import { HOTLINE_NUMBER } from './storeContact';

const copy = {
  ar: { hotline: 'الخط الساخن' },
  en: { hotline: 'Hotline' },
};

// Third header row: the "browse products" trigger, the main link list, and
// the hotline — desktop only (mobile keeps the hamburger + MobileNav drawer).
export function StorefrontNavBar() {
  const locale = useStorefrontLocale();
  const t = copy[locale];

  return (
    <div className="hidden border-t border-taupe/60 bg-porcelain lg:block">
      <Container className="flex items-center justify-between">
        <BrowseMenu />
        <DesktopNav />
        <a
          href={`tel:${HOTLINE_NUMBER}`}
          className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-espresso transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
          dir="ltr"
        >
          <Phone className="size-4 text-burgundy" aria-hidden="true" />
          <span>{HOTLINE_NUMBER}</span>
          <span className="sr-only">{t.hotline}</span>
        </a>
      </Container>
    </div>
  );
}
