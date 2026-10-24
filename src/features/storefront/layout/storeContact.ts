import {
  FacebookIcon,
  InstagramIcon,
  TelegramIcon,
  TiktokIcon,
  WhatsappIcon,
  YoutubeIcon,
} from './BrandIcons';

// Placeholder contact details — replace with the real hotline number and
// social profile URLs once available. Kept as plain '#' links until then so
// nothing in the header points at a dead/fabricated destination.

export const HOTLINE_NUMBER = '19600';

// Optional contact details. Leave empty until the client confirms the real
// values — the Contact page shows each one only when it is set, so nothing
// placeholder-looking ever reaches customers.
export const STORE_EMAIL = '';
export const STORE_ADDRESS = '';

export interface SocialLink {
  id: string;
  label: string;
  href: string;
  icon: typeof FacebookIcon;
  // Platform brand color, applied as the pill's hover background (see
  // the announcement bar's icons; the hero rail uses a fixed brand tone).
  color: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  { id: 'facebook', label: 'فيسبوك', href: '#', icon: FacebookIcon, color: '#1877F2' },
  { id: 'instagram', label: 'انستجرام', href: '#', icon: InstagramIcon, color: '#C13584' },
  { id: 'whatsapp', label: 'واتساب', href: '#', icon: WhatsappIcon, color: '#25D366' },
  { id: 'youtube', label: 'يوتيوب', href: '#', icon: YoutubeIcon, color: '#FF0000' },
  { id: 'tiktok', label: 'تيك توك', href: '#', icon: TiktokIcon, color: '#29221e' },
  { id: 'telegram', label: 'تيليجرام', href: '#', icon: TelegramIcon, color: '#26A5E4' },
];
