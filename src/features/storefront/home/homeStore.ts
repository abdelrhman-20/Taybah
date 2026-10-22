import { useSyncExternalStore } from 'react';
import { placeholderImages } from './homeContent';
import { catalogCategories, catalogProducts } from '../catalog/catalogData';

// HOMEPAGE CONTENT STORE — one shared source of truth for the storefront
// homepage and the admin Homepage manager. Seeds from the section copy that
// previously lived inside each component, persists to localStorage, and syncs
// across tabs via the storage event. Replaced by a CMS/table layer later.

const STORAGE_KEY = 'taybah:homepage';

export type HomeSectionKey =
  | 'hero'
  | 'categories'
  | 'products'
  | 'brand'
  | 'editorial'
  | 'collection'
  | 'newsletter';

export interface HomeSectionMeta {
  key: HomeSectionKey;
  visible: boolean;
}

export interface HomeContent {
  // Render order = array order; hidden sections never render publicly.
  sections: HomeSectionMeta[];
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primaryLabel: string;
    primaryTo: string;
    secondaryLabel: string;
    secondaryTo: string;
    // Slide images in display order — every slide shares the same text/CTAs.
    images: string[];
  };
  categories: { eyebrow: string; title: string; actionLabel: string; slugs: string[] };
  products: { eyebrow: string; title: string; actionLabel: string; productIds: string[] };
  brand: { eyebrow: string; title: string; body1: string; body2: string; image: string };
  editorial: {
    eyebrow: string;
    title: string;
    body: string;
    ctaLabel: string;
    ctaTo: string;
    image: string;
  };
  // The featured-collection section resolves title/description/link from the
  // collection record itself — this config only picks which collection plus
  // the editorial image refs.
  collection: { eyebrow: string; actionLabel: string; slug: string; image1: string; image2: string };
  newsletter: {
    eyebrow: string;
    title: string;
    body: string;
    placeholder: string;
    submitLabel: string;
    privacy: string;
  };
}

export const SECTION_LABELS: Record<HomeSectionKey, string> = {
  hero: 'قسم البطل الرئيسي',
  categories: 'الأقسام المميزة',
  products: 'المنتجات المميزة',
  brand: 'تعريف العلامة',
  editorial: 'البانر التحريري',
  collection: 'المجموعة المميزة',
  newsletter: 'النشرة البريدية',
};

function defaultContent(): HomeContent {
  return {
    sections: [
      { key: 'hero', visible: true },
      { key: 'categories', visible: true },
      { key: 'products', visible: true },
      { key: 'brand', visible: true },
      { key: 'editorial', visible: true },
      { key: 'collection', visible: true },
      { key: 'newsletter', visible: true },
    ],
    hero: {
      eyebrow: 'طيبة — حِرفة أصيلة',
      title: 'حيث تلتقي الحِرفة بالفخامة',
      body: 'سجاد وستائر ومفروشات مختارة بعناية — قطع تحمل روح التراث وتُصمَّم لبيوت اليوم.',
      primaryLabel: 'تسوّق المجموعة',
      primaryTo: '/products',
      secondaryLabel: 'قصتنا',
      secondaryTo: '/about',
      images: [placeholderImages.hero, placeholderImages.brand, placeholderImages.editorial],
    },
    categories: {
      eyebrow: 'الأقسام',
      title: 'تسوّق حسب القسم',
      actionLabel: 'كل الأقسام',
      slugs: catalogCategories.map((c) => c.slug),
    },
    products: {
      eyebrow: 'مختارات',
      title: 'تشكيل لأفضل منتجاتنا',
      actionLabel: 'تصفح كل المنتجات',
      productIds: catalogProducts.filter((p) => p.featured).map((p) => p.id),
    },
    brand: {
      eyebrow: 'طيبة',
      title: 'بيتٌ يُروى كقصة',
      body1:
        'وُلدت طيبة من إيمانٍ بأن البيت ليس مكانًا نسكنه فحسب، بل قصة نرويها بكل تفصيلة فيه. نختار كل سجادة وكل ستارة كما يختار الكاتب كلماته — بعناية، وبحب، وبعينٍ تعرف قيمة الحِرفة.',
      body2:
        'من أنسجة السجاد المعقودة يدويًا إلى كتّان الستائر، تتعاون طيبة مع صنّاع يحملون حرفةً توارثتها الأجيال، لتصل إلى بيتك قطعة تستحق أن تبقى.',
      image: placeholderImages.brand,
    },
    editorial: {
      eyebrow: 'موسم جديد',
      title: 'مجموعة الخريف — دفء يسبق الموسم',
      body: 'أنسجة أعمق، وألوان أهدأ، وقطع صُممت لتُكمل هدوء المساء. اكتشف ما وصل حديثًا.',
      ctaLabel: 'اكتشف المجموعة',
      ctaTo: '/collections',
      image: placeholderImages.editorial,
    },
    collection: {
      eyebrow: 'مجموعة مختارة',
      actionLabel: 'تصفح المجموعة',
      slug: 'diwan',
      image1: placeholderImages.collectionA,
      image2: placeholderImages.collectionB,
    },
    newsletter: {
      eyebrow: 'النشرة البريدية',
      title: 'رسائل قليلة، مختارة بعناية',
      body: 'وصولات جديدة، قصص الحِرفة، ولحظات من طيبة — مرة أو مرتين في الشهر، لا أكثر.',
      placeholder: 'بريدك الإلكتروني',
      submitLabel: 'اشترك',
      privacy: 'نحترم بريدك — يمكنك إلغاء الاشتراك في أي وقت.',
    },
  };
}

const SECTION_KEYS: HomeSectionKey[] = [
  'hero',
  'categories',
  'products',
  'brand',
  'editorial',
  'collection',
  'newsletter',
];

// Forward-compat merge: stored order/visibility wins, missing sections append
// at the end, and unknown stored fields inside a section survive untouched.
function migrate(raw: Partial<HomeContent> | null): HomeContent {
  const defaults = defaultContent();
  if (!raw || typeof raw !== 'object') return defaults;

  const storedMeta = Array.isArray(raw.sections) ? raw.sections : [];
  const seen = new Set<HomeSectionKey>();
  const sections: HomeSectionMeta[] = [];
  for (const m of storedMeta) {
    if (!m || typeof m.key !== 'string' || !SECTION_KEYS.includes(m.key as HomeSectionKey))
      continue;
    const key = m.key as HomeSectionKey;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ key, visible: m.visible !== false });
  }
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) sections.push({ key, visible: true });
  }

  const merge = <T extends object>(key: keyof HomeContent): T => ({
    ...(defaults[key] as T),
    ...((raw[key] as Partial<T> | undefined) ?? {}),
  });

  // Legacy shape stored `hero.image: string` — fold it into `images[]` and
  // guarantee at least one slide (validation requires one anyway). `images`
  // must be read from the RAW stored hero: merge() already backfills the
  // defaults, so a merged array can't tell stored from seeded.
  const { image: legacyImage, ...heroRest } = merge<
    HomeContent['hero'] & { image?: string }
  >('hero');
  const rawImages = (raw.hero as { images?: unknown } | undefined)?.images;
  const storedImages = Array.isArray(rawImages)
    ? rawImages.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  const hero: HomeContent['hero'] = {
    ...heroRest,
    images: storedImages.length
      ? storedImages
      : legacyImage?.trim()
        ? [legacyImage]
        : defaults.hero.images,
  };

  return {
    sections,
    hero,
    categories: merge<HomeContent['categories']>('categories'),
    products: merge<HomeContent['products']>('products'),
    brand: merge<HomeContent['brand']>('brand'),
    editorial: merge<HomeContent['editorial']>('editorial'),
    collection: merge<HomeContent['collection']>('collection'),
    newsletter: merge<HomeContent['newsletter']>('newsletter'),
  };
}

function readAll(): HomeContent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultContent();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultContent();
    return migrate(parsed as Partial<HomeContent>);
  } catch {
    return defaultContent();
  }
}

let content: HomeContent = readAll();
const listeners = new Set<() => void>();

function persist(next: HomeContent) {
  content = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
  } catch {
    // storage unavailable — state lives in memory for this session
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      content = readAll();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHomeContent(): HomeContent {
  return useSyncExternalStore(subscribe, () => content);
}

export function getHomeContent(): HomeContent {
  return content;
}

export function setHomeSections(sections: HomeSectionMeta[]) {
  persist({ ...content, sections });
}

export function updateHomeSection<K extends HomeSectionKey>(
  key: K,
  value: HomeContent[K],
) {
  persist({ ...content, [key]: value });
}

export function resetHomeContent() {
  persist(defaultContent());
}
