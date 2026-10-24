import { useSyncExternalStore } from 'react';
import { placeholderImages } from './homeContent';
import { catalogCategories, catalogProducts } from '../catalog/catalogData';
import { supabase, supabaseConfigured } from '../../../lib/supabase/client';

// HOMEPAGE CONTENT STORE — one shared source of truth for the storefront
// homepage and the admin Homepage manager. Seeds from the section copy that
// previously lived inside each component.
//
// Persistence is two-layered: the `public.home_sections` table is the durable,
// cross-device source of truth (when Supabase is configured); localStorage is
// only a same-browser cache so the page paints instantly before the first
// fetch resolves. Writes apply locally immediately AND upsert to Supabase —
// the returned promise rejects if the remote write fails, so admin UIs can
// report real success/failure instead of guessing.

const STORAGE_KEY = 'taybah:homepage';

export type HomeSectionKey =
  | 'hero'
  | 'shopCategories'
  | 'collections'
  | 'bestSellers'
  | 'story'
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

// Card entries reference real catalog records by slug. Empty text/image fields
// fall back to the catalog record itself, so nothing is duplicated unless the
// admin deliberately overrides it.
export interface ShopCategoryCard {
  slug: string;
  title: string;
  subtitle: string;
  image: string;
}

export interface CollectionCard {
  slug: string;
  title: string;
  description: string;
  image: string;
}

// One hero slide = its own image + its own copy and CTAs. Slides never share
// content; array order is display order, hidden slides never render publicly.
export interface HeroSlideContent {
  id: string;
  visible: boolean;
  image: string;
  eyebrow: string;
  title: string;
  body: string;
  primaryLabel: string;
  primaryTo: string;
  // Optional — the secondary button renders only when both are filled in.
  secondaryLabel: string;
  secondaryTo: string;
}

export interface HomeContent {
  // Render order = array order; hidden sections never render publicly.
  sections: HomeSectionMeta[];
  hero: { slides: HeroSlideContent[] };
  shopCategories: { eyebrow: string; title: string; subtitle: string; cards: ShopCategoryCard[] };
  collections: {
    eyebrow: string;
    title: string;
    subtitle: string;
    actionLabel: string;
    actionTo: string;
    ctaLabel: string;
    cards: CollectionCard[];
  };
  // No real sales metric exists — this is an admin-curated product selection.
  bestSellers: {
    eyebrow: string;
    title: string;
    subtitle: string;
    actionLabel: string;
    actionTo: string;
    productIds: string[];
  };
  story: {
    eyebrow: string;
    title: string;
    body: string;
    ctaLabel: string;
    ctaTo: string;
    image: string;
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
    // Optional background photo for the newsletter band.
    image: string;
  };
}

export const SECTION_LABELS: Record<HomeSectionKey, string> = {
  hero: 'قسم البطل الرئيسي',
  shopCategories: 'تسوّق حسب القسم',
  collections: 'مجموعات صُممت لتبقى',
  bestSellers: 'الأكثر اختيارًا',
  story: 'حكاية طيبة',
  categories: 'الأقسام المميزة',
  products: 'المنتجات المميزة',
  brand: 'تعريف العلامة',
  editorial: 'البانر التحريري',
  collection: 'المجموعة المميزة',
  newsletter: 'النشرة البريدية',
};

// Initial copy per slide, matched to its photo and to real storefront routes
// (/category/rugs, /category/furnishings, /collections). Editable in Admin.
function defaultHeroSlides(): HeroSlideContent[] {
  const [a, b, c] = placeholderImages.heroSlides;
  return [
    {
      id: 'hero-1',
      visible: true,
      image: a,
      eyebrow: 'حرفة أصيلة',
      title: 'تفاصيل تصنع الفخامة',
      body: 'اكتشف سجادًا مختارًا بعناية يضيف الدفء والأناقة إلى منزلك.',
      primaryLabel: 'اكتشف السجاد',
      primaryTo: '/category/rugs',
      secondaryLabel: '',
      secondaryTo: '',
    },
    {
      id: 'hero-2',
      visible: true,
      image: b,
      eyebrow: 'راحة بتفاصيل راقية',
      title: 'لمسات تمنح منزلك روحًا جديدة',
      body: 'اختيارات متناسقة من المفروشات لتصنع مساحة تعبّر عن ذوقك.',
      primaryLabel: 'اكتشف المفروشات',
      primaryTo: '/category/furnishings',
      secondaryLabel: '',
      secondaryTo: '',
    },
    {
      id: 'hero-3',
      visible: true,
      image: c,
      eyebrow: 'اختيارات طيبة',
      title: 'الجمال يبدأ من التفاصيل',
      body: 'تعرّف على مجموعات تجمع بين الأصالة والتصميم المعاصر.',
      primaryLabel: 'اكتشف المجموعات',
      primaryTo: '/collections',
      secondaryLabel: '',
      secondaryTo: '',
    },
  ];
}

// The copy every slide used to share (before slides had their own content).
// Only used to recognise an untouched legacy save.
const LEGACY_HERO_TEXT = {
  eyebrow: 'طيبة — حِرفة أصيلة',
  title: 'حيث تلتقي الحِرفة بالفخامة',
  body: 'سجاد وستائر ومفروشات مختارة بعناية — قطع تحمل روح التراث وتُصمَّم لبيوت اليوم.',
  primaryLabel: 'تسوّق المجموعة',
  primaryTo: '/products',
  secondaryLabel: 'قصتنا',
  secondaryTo: '/about',
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Hero migration. New shape: sanitize each slide independently. Legacy shape
// (one shared text block + `images[]` / single `image`): every stored image
// becomes its own slide carrying the saved text — nothing the admin saved is
// lost. If that text is still the untouched old default, the slides get the
// new distinct per-slide defaults instead, keeping their stored images.
function migrateHero(rawHero: unknown): HomeContent['hero'] {
  const defaults = defaultHeroSlides();
  if (!isRecord(rawHero)) return { slides: defaults };
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

  if (Array.isArray(rawHero.slides)) {
    const seen = new Set<string>();
    const slides = rawHero.slides.filter(isRecord).map((x, i): HeroSlideContent => {
      let id = str(x.id).trim() || `slide-${i + 1}`;
      while (seen.has(id)) id += '-x';
      seen.add(id);
      return {
        id,
        visible: x.visible !== false,
        image: str(x.image),
        eyebrow: str(x.eyebrow),
        title: str(x.title),
        body: str(x.body),
        primaryLabel: str(x.primaryLabel),
        primaryTo: str(x.primaryTo),
        secondaryLabel: str(x.secondaryLabel),
        secondaryTo: str(x.secondaryTo),
      };
    });
    return { slides: slides.length ? slides : defaults };
  }

  const textKeys = Object.keys(LEGACY_HERO_TEXT) as (keyof typeof LEGACY_HERO_TEXT)[];
  const hasText = textKeys.some((k) => typeof rawHero[k] === 'string');
  const storedImages = Array.isArray(rawHero.images)
    ? rawHero.images.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : typeof rawHero.image === 'string' && rawHero.image.trim()
      ? [rawHero.image]
      : [];
  if (!storedImages.length && !hasText) return { slides: defaults };

  const shared = Object.fromEntries(
    textKeys.map((k) => [k, str(rawHero[k], LEGACY_HERO_TEXT[k])]),
  ) as typeof LEGACY_HERO_TEXT;
  const untouched = shared.title === LEGACY_HERO_TEXT.title && shared.body === LEGACY_HERO_TEXT.body;
  const images = storedImages.length ? storedImages : defaults.map((d) => d.image);
  return {
    slides: images.map((image, i) => {
      const distinct = untouched ? defaults[i] : undefined;
      return {
        id: `hero-${i + 1}`,
        visible: true,
        image,
        eyebrow: distinct?.eyebrow ?? shared.eyebrow,
        title: distinct?.title ?? shared.title,
        body: distinct?.body ?? shared.body,
        primaryLabel: distinct?.primaryLabel ?? shared.primaryLabel,
        primaryTo: distinct?.primaryTo ?? shared.primaryTo,
        secondaryLabel: distinct ? distinct.secondaryLabel : shared.secondaryLabel,
        secondaryTo: distinct ? distinct.secondaryTo : shared.secondaryTo,
      };
    }),
  };
}

function defaultContent(): HomeContent {
  return {
    sections: [
      { key: 'hero', visible: true },
      { key: 'shopCategories', visible: true },
      { key: 'collections', visible: true },
      { key: 'bestSellers', visible: true },
      { key: 'story', visible: true },
      // Superseded by the four sections above — kept (hidden) so the admin
      // can still bring them back.
      { key: 'categories', visible: false },
      { key: 'products', visible: false },
      { key: 'brand', visible: false },
      // Not part of the approved homepage layout — kept (hidden) so the
      // admin can still enable them.
      { key: 'editorial', visible: false },
      { key: 'collection', visible: false },
      { key: 'newsletter', visible: true },
    ],
    hero: { slides: defaultHeroSlides() },
    shopCategories: {
      eyebrow: 'اكتشف طيبة',
      title: 'تسوّق حسب القسم',
      subtitle: 'لكل زاوية في منزلك … اكتشف تشكيلتنا المختارة بعناية',
      cards: [
        { slug: 'rugs', title: '', subtitle: 'حرفة أصيلة تحت قدميك', image: '/images/home/category-rugs.webp' },
        { slug: 'curtains', title: '', subtitle: 'توازن بين الضوء والخصوصية', image: '/images/home/category-curtains.webp' },
        { slug: 'carpets', title: '', subtitle: 'دفء يمنحك الراحة', image: '/images/home/category-carpets.webp' },
        { slug: 'furnishings', title: '', subtitle: 'راحة وأناقة تدوم', image: '/images/home/category-furnishings.webp' },
        { slug: 'accessories', title: '', subtitle: 'تفاصيل تصنع الفرق', image: '/images/home/category-accessories.webp' },
      ],
    },
    collections: {
      eyebrow: '',
      title: 'مجموعات صُممت لتبقى',
      subtitle: 'مختارات تعبّر عن ذوق رفيع، تجمع بين الأصالة والتصميم المعاصر',
      actionLabel: 'عرض جميع المجموعات',
      actionTo: '/collections',
      ctaLabel: 'تسوّق المجموعة',
      cards: [
        { slug: 'diwan', title: 'ديوان', description: '', image: '/images/home/collection-diwan.webp' },
        { slug: 'heritage', title: 'تراث', description: '', image: '/images/home/collection-heritage.webp' },
        { slug: 'atelier', title: 'أتيليه', description: '', image: '/images/home/collection-atelier.webp' },
      ],
    },
    bestSellers: {
      eyebrow: '',
      title: 'الأكثر اختيارًا',
      subtitle: 'منتجات أحبها عملاؤنا وتجمع بين الجودة والتصميم الأصيل',
      actionLabel: 'عرض جميع المنتجات',
      actionTo: '/products',
      // Four featured products — one row on desktop, matching the design.
      productIds: catalogProducts
        .filter((p) => p.featured)
        .slice(0, 4)
        .map((p) => p.id),
    },
    story: {
      eyebrow: 'حكايتنا',
      title: 'حكاية طيبة',
      body: 'من الحرفة الأصيلة إلى منازلكم … نختار بعناية ما يجمع بين الجمال والجودة، لنقدم قطعًا تزين حياتكم وتدوم معكم سنوات طويلة.',
      ctaLabel: 'اكتشف قصتنا',
      ctaTo: '/about',
      image: placeholderImages.brand,
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
      image: '/images/home/product-p19-3.webp',
    },
  };
}

export const HOME_SECTION_KEYS: HomeSectionKey[] = [
  'hero',
  'shopCategories',
  'collections',
  'bestSellers',
  'story',
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
    if (!m || typeof m.key !== 'string' || !HOME_SECTION_KEYS.includes(m.key as HomeSectionKey))
      continue;
    const key = m.key as HomeSectionKey;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ key, visible: m.visible !== false });
  }
  // One-time upgrade of content saved before the four newer sections existed:
  // they slot in right below the hero (in order), and the older sections they
  // supersede are hidden so the page doesn't show duplicates. The admin can
  // re-enable any of them.
  const NEW_KEYS: HomeSectionKey[] = ['shopCategories', 'collections', 'bestSellers', 'story'];
  if (NEW_KEYS.every((k) => !seen.has(k)) && sections.length > 0) {
    const heroAt = sections.findIndex((x) => x.key === 'hero');
    sections.splice(heroAt + 1, 0, ...NEW_KEYS.map((key) => ({ key, visible: true })));
    for (const m of sections) {
      if (m.key === 'categories' || m.key === 'products' || m.key === 'brand') m.visible = false;
    }
    NEW_KEYS.forEach((k) => seen.add(k));
  }
  for (const key of HOME_SECTION_KEYS) {
    if (!seen.has(key)) sections.push({ key, visible: true });
  }

  const merge = <T extends object>(key: keyof HomeContent): T => ({
    ...(defaults[key] as T),
    ...((raw[key] as Partial<T> | undefined) ?? {}),
  });

  const hero = migrateHero(raw.hero);

  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const records = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter(
          (c): c is Record<string, unknown> =>
            !!c && typeof c === 'object' && typeof (c as { slug?: unknown }).slug === 'string',
        )
      : [];
  const shopCategories = merge<HomeContent['shopCategories']>('shopCategories');
  const rawShop = (raw.shopCategories as { cards?: unknown } | undefined)?.cards;
  shopCategories.cards = Array.isArray(rawShop)
    ? records(rawShop).map((c) => ({
        slug: c.slug as string,
        title: str(c.title, ''),
        subtitle: str(c.subtitle, ''),
        image: str(c.image, ''),
      }))
    : defaults.shopCategories.cards;
  const collections = merge<HomeContent['collections']>('collections');
  const rawColl = (raw.collections as { cards?: unknown } | undefined)?.cards;
  collections.cards = Array.isArray(rawColl)
    ? records(rawColl).map((c) => ({
        slug: c.slug as string,
        title: str(c.title, ''),
        description: str(c.description, ''),
        image: str(c.image, ''),
      }))
    : defaults.collections.cards;
  const bestSellers = merge<HomeContent['bestSellers']>('bestSellers');
  const rawIds = (raw.bestSellers as { productIds?: unknown } | undefined)?.productIds;
  bestSellers.productIds = Array.isArray(rawIds)
    ? rawIds.filter((x): x is string => typeof x === 'string')
    : defaults.bestSellers.productIds;

  return {
    sections,
    hero,
    shopCategories,
    collections,
    bestSellers,
    story: merge<HomeContent['story']>('story'),
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

// ---- Supabase sync ---------------------------------------------------------
//
// Row shape mirrors home_sections: { id, enabled, display_order, data } where
// `data` is exactly that section's HomeContent[key] object. Section order and
// visibility live in every row (order = array position), so a full upsert
// keeps meta and content consistent in one write.

export interface HomeSectionRow {
  id: string;
  enabled: boolean;
  display_order: number;
  data: unknown;
}

export function rowsFromHomeContent(c: HomeContent): HomeSectionRow[] {
  return c.sections.map((s, i) => ({
    id: s.key,
    enabled: s.visible,
    display_order: i,
    data: c[s.key],
  }));
}

// Rebuilds HomeContent from table rows. Sections with no row are appended
// hidden (RLS hides disabled rows from the public anyway, so absent = off)
// and keep `base`'s data — this is what stops a public-scope fetch (which
// never sees disabled rows) from clobbering an admin's saved-but-hidden
// section content in the same browser.
export function homeContentFromRows(rows: HomeSectionRow[], base: HomeContent): HomeContent {
  const raw: Record<string, unknown> = {};
  const meta: HomeSectionMeta[] = [];
  const seen = new Set<HomeSectionKey>();
  for (const r of rows) {
    if (!r || !HOME_SECTION_KEYS.includes(r.id as HomeSectionKey) || seen.has(r.id as HomeSectionKey))
      continue;
    const key = r.id as HomeSectionKey;
    seen.add(key);
    meta.push({ key, visible: r.enabled !== false });
    raw[key] = r.data;
  }
  for (const key of HOME_SECTION_KEYS) {
    if (seen.has(key)) continue;
    meta.push({ key, visible: false });
    raw[key] = base[key];
  }
  raw.sections = meta;
  return migrate(raw as Partial<HomeContent>);
}

let content: HomeContent = readAll();
const listeners = new Set<() => void>();

function apply(next: HomeContent) {
  content = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
  } catch {
    // storage unavailable — state lives in memory for this session
  }
  listeners.forEach((l) => l());
}

export type HomeSyncState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

let syncState: HomeSyncState = supabaseConfigured ? { status: 'loading' } : { status: 'unconfigured' };
let refreshPromise: Promise<void> | null = null;

export function getHomeSyncState(): HomeSyncState {
  return syncState;
}

// Pulls the durable rows and rebuilds local content. An empty table means
// nothing was ever saved remotely — keep the local/default content rather
// than wiping it.
async function refreshFromRemote(): Promise<void> {
  if (!supabaseConfigured) return;
  try {
    const { data, error } = await supabase
      .from('home_sections')
      .select('id, enabled, display_order, data')
      .order('display_order', { ascending: true });
    if (error) {
      // Safe diagnostics — PostgREST error code/message only, no credentials.
      console.error('homeStore sync failed:', error.code, error.message);
      syncState = { status: 'error', message: error.message };
      return;
    }
    if (data && data.length > 0) apply(homeContentFromRows(data as HomeSectionRow[], content));
    syncState = { status: 'ready' };
  } catch (e) {
    syncState = { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export function refreshHomeContent(): Promise<void> {
  refreshPromise ??= refreshFromRemote().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

if (supabaseConfigured) {
  void refreshHomeContent();
  // The first fetch usually runs before an admin logs in, so it only sees
  // RLS-public rows. Re-fetch on every auth change: after SIGNED_IN the
  // admin's session returns the hidden rows' data too.
  supabase.auth.onAuthStateChange(() => {
    void refreshHomeContent();
  });
}

export class HomeSyncError extends Error {}

// Waits for any in-flight fetch first (so the freshest server state is the
// base), then applies the user's edit on top and upserts it — otherwise a
// save made mid-fetch could write stale local data over the server's, or the
// fetch could overwrite the just-saved edit.
async function persistImpl(next: HomeContent): Promise<void> {
  if (!supabaseConfigured) {
    apply(next);
    throw new HomeSyncError('unconfigured');
  }
  await refreshHomeContent().catch(() => {});
  apply(next);
  const { error } = await supabase
    .from('home_sections')
    .upsert(rowsFromHomeContent(next), { onConflict: 'id' });
  if (error) {
    // Keep the PostgREST code in the message (e.g. "PGRST205: ...") — it
    // distinguishes missing-table from RLS-denied without exposing secrets.
    console.error('homeStore save failed:', error.code, error.message);
    throw new HomeSyncError(`${error.code ?? 'SAVE_ERROR'}: ${error.message}`);
  }
}

// Callers that await get the real outcome; callers that fire-and-forget
// shouldn't trip unhandled-rejection handlers, so observe the rejection here
// too. (Awaiting still surfaces it — a handled promise can be awaited.)
function persist(next: HomeContent): Promise<void> {
  const p = persistImpl(next);
  p.catch(() => {});
  return p;
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

export function setHomeSections(sections: HomeSectionMeta[]): Promise<void> {
  return persist({ ...content, sections });
}

export function updateHomeSection<K extends HomeSectionKey>(
  key: K,
  value: HomeContent[K],
): Promise<void> {
  return persist({ ...content, [key]: value });
}

export function resetHomeContent(): Promise<void> {
  return persist(defaultContent());
}
