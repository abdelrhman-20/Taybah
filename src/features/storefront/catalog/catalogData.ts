// TEMPORARY PRESENTATION DATA — frontend-only mock catalog used to develop the
// listing experience before Supabase integration. Photography is placeholder
// imagery (local Unsplash photos in public/images/home — see CREDITS.md; the
// picsum helper below is only a fallback for products without a photo set).
// Product names, prices, attributes, and
// availability are invented for UI purposes; this layer is deliberately isolated
// so a later step can swap these exports for real catalog queries without the
// components below changing their interfaces.

// Data records keep `en` alongside `ar` for internal compatibility and future
// tooling — Taybah renders `ar` everywhere; `en` is never exposed in UI.
export type Localized = { ar: string; en: string };

export interface CatalogCategory {
  slug: string;
  name: Localized;
  description: Localized;
  image: string;
  visible: boolean;
  order: number;
}

export const catalogCategories: CatalogCategory[] = [
  {
    slug: 'rugs',
    visible: true,
    order: 1,
    name: { ar: 'سجاد', en: 'Rugs' },
    description: {
      ar: 'سجاد معقود يدويًا ومنسوج بأنماط تراثية ومعاصرة — قطع تُؤَسِّس الغرفة.',
      en: 'Hand-knotted and flatwoven rugs in heritage and contemporary patterns — pieces that anchor a room.',
    },
    image: '/images/home/category-rugs.jpg',
  },
  {
    slug: 'carpets',
    visible: true,
    order: 2,
    name: { ar: 'موكيت', en: 'Carpets' },
    description: {
      ar: 'موكيت بخامات صوفية ومزيجة يغطي المساحات الكبيرة بدفء وثبات.',
      en: 'Wool and blended carpets covering larger spaces with warmth and weight.',
    },
    image: '/images/home/category-carpets.jpg',
  },
  {
    slug: 'curtains',
    visible: true,
    order: 3,
    name: { ar: 'ستائر', en: 'Curtains' },
    description: {
      ar: 'ستائر كتان ومخمل وفوال — من الشفاف العابر إلى العازل الفاخر.',
      en: 'Linen, velvet, and voile curtains — from airy sheer to opulent blackout.',
    },
    image: '/images/home/category-curtains.jpg',
  },
  {
    slug: 'furnishings',
    visible: true,
    order: 4,
    name: { ar: 'مفروشات', en: 'Furnishings' },
    description: {
      ar: 'أغطية وبطانيات ولُحُف تُكمِل القطع الكبيرة بلمسات ناعمة.',
      en: 'Covers, throws, and quilts that finish larger pieces with soft layers.',
    },
    image: '/images/home/category-furnishings.jpg',
  },
  {
    slug: 'accessories',
    visible: true,
    order: 5,
    name: { ar: 'إكسسوارات المنزل', en: 'Home Accessories' },
    description: {
      ar: 'تفاصيل صغيرة تصنع الفرق — مصابيح ومزهريات وقطع حائط مختارة.',
      en: 'Small details that make the difference — lamps, vases, and wall pieces.',
    },
    image: '/images/home/category-accessories.jpg',
  },
];

export function categoryBySlug(slug: string | undefined): CatalogCategory | undefined {
  return catalogCategories.find((c) => c.slug === slug);
}

export interface CatalogCollection {
  slug: string;
  name: Localized;
  description: Localized;
  image: string;
  visible: boolean;
  order: number;
}

export const catalogCollections: CatalogCollection[] = [
  {
    slug: 'diwan',
    visible: true,
    order: 1,
    name: { ar: 'مجموعة ديوان', en: 'The Diwan Collection' },
    description: {
      ar: 'إيقاعٌ من الزخارف الهندسية والألوان الترابية — أصالة النمط ونظافة الخط المعاصر.',
      en: 'A rhythm of geometric motifs and earthen tones — heritage pattern with clean contemporary lines.',
    },
    image: '/images/home/collection-diwan.jpg',
  },
  {
    slug: 'heritage',
    visible: true,
    order: 2,
    name: { ar: 'مجموعة التراث', en: 'The Heritage Collection' },
    description: {
      ar: 'قطع تحمل ذاكرة الحِرفة — ميداليات وزخارف كلاسيكية بأصالة متوارثة.',
      en: 'Pieces carrying the memory of the craft — classic medallions and inherited motifs.',
    },
    image: '/images/home/collection-heritage.jpg',
  },
  {
    slug: 'atelier',
    visible: true,
    order: 3,
    name: { ar: 'مجموعة أتيليه', en: 'The Atelier Collection' },
    description: {
      ar: 'خطوط نظيفة وخامات طبيعية للبيوت المعاصرة — هدوء بلا زخرفة زائدة.',
      en: 'Clean lines and natural materials for contemporary homes — calm without ornament.',
    },
    image: '/images/home/collection-atelier.jpg',
  },
];

export function collectionBySlug(slug: string | undefined): CatalogCollection | undefined {
  return catalogCollections.find((c) => c.slug === slug);
}

export interface ColorOption {
  key: string;
  label: Localized;
  hex: string;
}

export const colorOptions: ColorOption[] = [
  { key: 'burgundy', label: { ar: 'عنابي', en: 'Burgundy' }, hex: '#681D20' },
  { key: 'ivory', label: { ar: 'عاجي', en: 'Ivory' }, hex: '#EFEAE2' },
  { key: 'sand', label: { ar: 'رملي', en: 'Sand' }, hex: '#D8C7AD' },
  { key: 'charcoal', label: { ar: 'فحمي', en: 'Charcoal' }, hex: '#3A3734' },
  { key: 'navy', label: { ar: 'كحلي', en: 'Navy' }, hex: '#2E3B4E' },
  { key: 'sage', label: { ar: 'أخضر مريمي', en: 'Sage' }, hex: '#9DA88F' },
  { key: 'terracotta', label: { ar: 'طيني', en: 'Terracotta' }, hex: '#B4643D' },
  { key: 'gold', label: { ar: 'ذهبي', en: 'Antique Gold' }, hex: '#B58A43' },
];

export const materialOptions: { key: string; label: Localized }[] = [
  { key: 'wool', label: { ar: 'صوف', en: 'Wool' } },
  { key: 'wool-blend', label: { ar: 'صوف مخلوط', en: 'Wool Blend' } },
  { key: 'cotton', label: { ar: 'قطن', en: 'Cotton' } },
  { key: 'linen', label: { ar: 'كتان', en: 'Linen' } },
  { key: 'velvet', label: { ar: 'مخمل', en: 'Velvet' } },
  { key: 'silk-blend', label: { ar: 'حرير مخلوط', en: 'Silk Blend' } },
  { key: 'natural-fiber', label: { ar: 'ألياف طبيعية', en: 'Natural Fiber' } },
  { key: 'synthetic', label: { ar: 'خامات صناعية', en: 'Synthetic' } },
  { key: 'ceramic', label: { ar: 'خزف', en: 'Ceramic' } },
  { key: 'metal', label: { ar: 'معدن', en: 'Metal' } },
  { key: 'wood', label: { ar: 'خشب', en: 'Wood' } },
];

// Legacy generic labels — kept exactly as before (existing products,
// orders, and tests reference these keys). Real numeric dimensions are now
// added by the admin directly, per product, via the "add a custom size"
// control in the product form (see ProductFormPage) rather than being
// forced into this fixed preset list.
// Size / dimension values. Illustrative, product-type-appropriate dimensions for
// the DEMO catalog — none of them is a verified manufacturer measurement, and
// all are awaiting the client's real specifications (see
// docs/CATALOG_SIZES_AUDIT.md). `widthCm` × `lengthCm` carry the numeric
// dimensions where the value is a flat width × length; labels are Arabic with
// the unit (سم) written out. Curtain values read "width × drop".
export const sizeOptions: {
  key: string;
  label: Localized;
  widthCm?: number;
  lengthCm?: number;
}[] = [
  // Area rugs
  { key: 'rug-80x150', label: { ar: '80 × 150 سم', en: '80 × 150 cm' }, widthCm: 80, lengthCm: 150 },
  { key: 'rug-120x180', label: { ar: '120 × 180 سم', en: '120 × 180 cm' }, widthCm: 120, lengthCm: 180 },
  { key: 'rug-160x230', label: { ar: '160 × 230 سم', en: '160 × 230 cm' }, widthCm: 160, lengthCm: 230 },
  { key: 'rug-180x270', label: { ar: '180 × 270 سم', en: '180 × 270 cm' }, widthCm: 180, lengthCm: 270 },
  { key: 'rug-200x300', label: { ar: '200 × 300 سم', en: '200 × 300 cm' }, widthCm: 200, lengthCm: 300 },
  // Prayer rugs and runners
  { key: 'prayer-70x110', label: { ar: '70 × 110 سم', en: '70 × 110 cm' }, widthCm: 70, lengthCm: 110 },
  { key: 'runner-80x300', label: { ar: '80 × 300 سم', en: '80 × 300 cm' }, widthCm: 80, lengthCm: 300 },
  // Curtain panels — width × drop
  { key: 'curtain-140x250', label: { ar: 'عرض 140 × ارتفاع 250 سم', en: 'Panel 140 W × 250 H cm' }, widthCm: 140, lengthCm: 250 },
  { key: 'curtain-140x260', label: { ar: 'عرض 140 × ارتفاع 260 سم', en: 'Panel 140 W × 260 H cm' }, widthCm: 140, lengthCm: 260 },
  { key: 'curtain-150x270', label: { ar: 'عرض 150 × ارتفاع 270 سم', en: 'Panel 150 W × 270 H cm' }, widthCm: 150, lengthCm: 270 },
  { key: 'curtain-150x280', label: { ar: 'عرض 150 × ارتفاع 280 سم', en: 'Panel 150 W × 280 H cm' }, widthCm: 150, lengthCm: 280 },
  { key: 'curtain-300x260', label: { ar: 'عرض 300 × ارتفاع 260 سم', en: 'Panel 300 W × 260 H cm' }, widthCm: 300, lengthCm: 260 },
  // Soft furnishings
  { key: 'throw-130x170', label: { ar: '130 × 170 سم', en: '130 × 170 cm' }, widthCm: 130, lengthCm: 170 },
  { key: 'cushion-45x45', label: { ar: '45 × 45 سم (للغطاء الواحد)', en: '45 × 45 cm (per cover)' }, widthCm: 45, lengthCm: 45 },
  { key: 'bedspread-230x250', label: { ar: '230 × 250 سم', en: '230 × 250 cm' }, widthCm: 230, lengthCm: 250 },
  // Accessories — fixed physical dimensions
  { key: 'lamp-h45', label: { ar: 'ارتفاع 45 سم', en: 'Height 45 cm' } },
  { key: 'vases-h28-20', label: { ar: 'ارتفاع 28 و20 سم', en: 'Heights 28 and 20 cm' } },
  { key: 'wall-50x90', label: { ar: '50 × 90 سم', en: '50 × 90 cm' }, widthCm: 50, lengthCm: 90 },
  { key: 'mirror-60x90', label: { ar: '60 × 90 سم', en: '60 × 90 cm' }, widthCm: 60, lengthCm: 90 },
  // Retired generic labels from the first seed. Kept enabled so catalogs saved
  // before the dimension audit still resolve their stored size keys; no seed
  // product uses them any more (disable them in Admin once nothing does).
  { key: 'small', label: { ar: 'صغير', en: 'Small' } },
  { key: 'medium', label: { ar: 'متوسط', en: 'Medium' } },
  { key: 'large', label: { ar: 'كبير', en: 'Large' } },
  { key: 'xl', label: { ar: 'كبير جدًا', en: 'Extra Large' } },
];

export const priceBuckets: { key: string; label: Localized; min: number; max: number | null }[] = [
  { key: 'under-1000', label: { ar: 'أقل من 1,000 ج.م', en: 'Under EGP 1,000' }, min: 0, max: 1000 },
  { key: '1000-3000', label: { ar: 'من 1,000 إلى أقل من 3,000 ج.م', en: 'EGP 1,000 to under 3,000' }, min: 1000, max: 3000 },
  { key: '3000-7000', label: { ar: 'من 3,000 إلى أقل من 7,000 ج.م', en: 'EGP 3,000 to under 7,000' }, min: 3000, max: 7000 },
  { key: 'over-7000', label: { ar: '7,000 ج.م فأكثر', en: 'EGP 7,000 and over' }, min: 7000, max: null },
];

export type Availability = 'in_stock' | 'low_stock' | 'out_of_stock';

// A purchasable combination of attribute values. `combo` maps each axis key
// declared in `CatalogProduct.variantAxes` to exactly one attribute-value
// key; `null` price/compareAtPrice inherit from the product record. Taybah
// has no numeric inventory — `availability` is set manually per variant.
// Variant ids are assigned once at creation (newVariantId()) and stay stable
// across unrelated product edits so order snapshots can reference them.
export interface ProductVariant {
  id: string;
  sku: string;
  combo: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  availability: Availability;
  // Optional numeric stock count — purely additive alongside `availability`
  // (the manual in/low/out-of-stock signal, unchanged). Null/absent means
  // "not tracked numerically", same as every variant before this existed.
  stockQuantity: number | null;
  image: string | null;
  active: boolean;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  sku: string;
  name: Localized;
  description: Localized;
  category: string;
  collection: string;
  price: number;
  compareAtPrice: number | null;
  availability: Availability;
  colors: string[];
  materials: string[];
  size: string;
  sizes: string[];
  createdAt: string;
  featured: boolean;
  published: boolean;
  isNew: boolean;
  // Custom attribute assignments — attrKey -> selected valueKeys. Reserved
  // seeded keys ('color', 'material', 'size') stay in the legacy fields above
  // and must never appear here. Unknown keys/values are preserved, not
  // silently dropped.
  attributes?: Record<string, string[]>;
  // Variant model — absent or empty means a simple product sold directly by
  // the product-level fields above. `variantAxes` lists the attribute keys
  // (max 3) whose values define purchasable combinations; every entry in
  // `variants` (max 60) covers each axis exactly once in `combo`. Inactive
  // variants stay stored but can't be purchased.
  variantAxes?: string[];
  variants?: ProductVariant[];
  image: string;
  imageHover: string;
  images: string[];
}

function img(seed: string) {
  return `https://picsum.photos/seed/taybah-${seed}/800/1000`;
}

type RawProduct = Omit<
  CatalogProduct,
  'sku' | 'sizes' | 'images' | 'description' | 'published' | 'isNew'
>;

const rawProducts: RawProduct[] = [
  {
    id: 'p01', slug: 'bokhara-hand-knotted-rug',
    name: { ar: 'سجادة بوخارا معقودة يدويًا', en: 'Bokhara Hand-Knotted Rug' },
    category: 'rugs', collection: 'diwan', price: 12450, compareAtPrice: 15800,
    availability: 'in_stock', colors: ['burgundy', 'ivory'], materials: ['wool'],
    size: 'rug-160x230', createdAt: '2025-09-14', featured: true,
    image: img('p01'), imageHover: img('p01-alt'),
  },
  {
    id: 'p02', slug: 'persian-floral-medallion-rug',
    name: { ar: 'سجادة فارسية بميدالية زهرية', en: 'Persian Floral Medallion Rug' },
    category: 'rugs', collection: 'heritage', price: 9800, compareAtPrice: null,
    availability: 'in_stock', colors: ['navy', 'ivory'], materials: ['wool'],
    size: 'rug-200x300', createdAt: '2025-08-02', featured: true,
    image: img('p02'), imageHover: img('p02-alt'),
  },
  {
    id: 'p03', slug: 'modern-geometric-flatweave-rug',
    name: { ar: 'سجادة هندسية مسطحة النسج', en: 'Modern Geometric Flatweave Rug' },
    category: 'rugs', collection: 'atelier', price: 4250, compareAtPrice: null,
    availability: 'in_stock', colors: ['charcoal', 'sand'], materials: ['cotton'],
    size: 'rug-160x230', createdAt: '2025-10-05', featured: false,
    image: img('p03'), imageHover: img('p03-alt'),
  },
  {
    id: 'p04', slug: 'vintage-overdyed-rug',
    name: { ar: 'سجادة عتقية معاد صبغها', en: 'Vintage Overdyed Rug' },
    category: 'rugs', collection: 'heritage', price: 7900, compareAtPrice: 9900,
    availability: 'low_stock', colors: ['sage', 'ivory'], materials: ['wool'],
    size: 'rug-180x270', createdAt: '2025-06-21', featured: false,
    image: img('p04'), imageHover: img('p04-alt'),
  },
  {
    id: 'p05', slug: 'jute-braided-natural-rug',
    name: { ar: 'سجادة جوت مضفورة طبيعية', en: 'Jute Braided Natural Rug' },
    category: 'rugs', collection: 'atelier', price: 2150, compareAtPrice: null,
    availability: 'in_stock', colors: ['sand'], materials: ['natural-fiber'],
    size: 'rug-120x180', createdAt: '2025-10-11', featured: false,
    image: img('p05'), imageHover: img('p05-alt'),
  },
  {
    id: 'p06', slug: 'silk-touch-prayer-rug',
    name: { ar: 'سجادة صلاة بملمس حريري', en: 'Silk-Touch Prayer Rug' },
    category: 'rugs', collection: 'diwan', price: 1480, compareAtPrice: null,
    availability: 'in_stock', colors: ['burgundy', 'gold'], materials: ['silk-blend'],
    size: 'prayer-70x110', createdAt: '2025-07-19', featured: false,
    image: img('p06'), imageHover: img('p06-alt'),
  },
  {
    id: 'p07', slug: 'axminster-patterned-carpet',
    name: { ar: 'موكيت أكسمنستر بنقشة كلاسيكية', en: 'Axminster Patterned Carpet' },
    category: 'carpets', collection: 'heritage', price: 5600, compareAtPrice: null,
    availability: 'in_stock', colors: ['terracotta', 'ivory'], materials: ['wool-blend'],
    size: '', createdAt: '2025-05-30', featured: false,
    image: img('p07'), imageHover: img('p07-alt'),
  },
  {
    id: 'p08', slug: 'plush-shag-carpet',
    name: { ar: 'موكيت شاج مخملي', en: 'Plush Shag Carpet' },
    category: 'carpets', collection: 'atelier', price: 3750, compareAtPrice: null,
    availability: 'in_stock', colors: ['ivory'], materials: ['synthetic'],
    size: '', createdAt: '2025-09-27', featured: true,
    image: img('p08'), imageHover: img('p08-alt'),
  },
  {
    id: 'p09', slug: 'sisal-runner-carpet',
    name: { ar: 'موكيت سيزال للممرات', en: 'Sisal Runner Carpet' },
    category: 'carpets', collection: 'atelier', price: 1950, compareAtPrice: null,
    availability: 'low_stock', colors: ['sand', 'charcoal'], materials: ['natural-fiber'],
    size: 'runner-80x300', createdAt: '2025-08-15', featured: false,
    image: img('p09'), imageHover: img('p09-alt'),
  },
  {
    id: 'p10', slug: 'wilton-classic-carpet',
    name: { ar: 'موكيت ويلتون كلاسيك', en: 'Wilton Classic Carpet' },
    category: 'carpets', collection: 'diwan', price: 8200, compareAtPrice: null,
    availability: 'out_of_stock', colors: ['navy', 'burgundy'], materials: ['wool-blend'],
    size: '', createdAt: '2025-04-08', featured: false,
    image: img('p10'), imageHover: img('p10-alt'),
  },
  {
    id: 'p11', slug: 'tailored-linen-curtain',
    name: { ar: 'ستارة كتان بقصة أنيقة', en: 'Tailored Linen Curtain' },
    category: 'curtains', collection: 'atelier', price: 1290, compareAtPrice: null,
    availability: 'in_stock', colors: ['ivory'], materials: ['linen'],
    size: 'curtain-140x260', createdAt: '2025-10-02', featured: true,
    image: img('p11'), imageHover: img('p11-alt'),
  },
  {
    id: 'p12', slug: 'velvet-blackout-curtain',
    name: { ar: 'ستارة مخمل عازلة للضوء', en: 'Velvet Blackout Curtain' },
    category: 'curtains', collection: 'diwan', price: 2340, compareAtPrice: 2800,
    availability: 'in_stock', colors: ['burgundy'], materials: ['velvet'],
    size: 'curtain-150x270', createdAt: '2025-09-08', featured: false,
    image: img('p12'), imageHover: img('p12-alt'),
  },
  {
    id: 'p13', slug: 'sheer-voile-panel',
    name: { ar: 'ستارة فوال شفافة', en: 'Sheer Voile Panel' },
    category: 'curtains', collection: 'atelier', price: 640, compareAtPrice: null,
    availability: 'in_stock', colors: ['ivory'], materials: ['synthetic'],
    size: 'curtain-300x260', createdAt: '2025-08-25', featured: false,
    image: img('p13'), imageHover: img('p13-alt'),
  },
  {
    id: 'p14', slug: 'embroidered-linen-drape',
    name: { ar: 'ستارة كتان مطرزة', en: 'Embroidered Linen Drape' },
    category: 'curtains', collection: 'heritage', price: 1870, compareAtPrice: null,
    availability: 'low_stock', colors: ['sage', 'ivory'], materials: ['linen'],
    size: 'curtain-140x250', createdAt: '2025-07-12', featured: false,
    image: img('p14'), imageHover: img('p14-alt'),
  },
  {
    id: 'p15', slug: 'silk-blend-formal-curtain',
    name: { ar: 'ستارة حريرية لغرف الاستقبال', en: 'Silk-Blend Formal Curtain' },
    category: 'curtains', collection: 'diwan', price: 3150, compareAtPrice: null,
    availability: 'in_stock', colors: ['gold', 'ivory'], materials: ['silk-blend'],
    size: 'curtain-150x280', createdAt: '2025-06-17', featured: false,
    image: img('p15'), imageHover: img('p15-alt'),
  },
  {
    id: 'p16', slug: 'velvet-sofa-cover',
    name: { ar: 'غطاء أريكة مخملي', en: 'Velvet Sofa Cover' },
    category: 'furnishings', collection: 'atelier', price: 980, compareAtPrice: null,
    availability: 'in_stock', colors: ['sage'], materials: ['velvet'],
    size: '', createdAt: '2025-10-09', featured: true,
    image: img('p16'), imageHover: img('p16-alt'),
  },
  {
    id: 'p17', slug: 'handwoven-throw-blanket',
    name: { ar: 'بطانية منسوجة يدويًا', en: 'Handwoven Throw Blanket' },
    category: 'furnishings', collection: 'heritage', price: 720, compareAtPrice: null,
    availability: 'in_stock', colors: ['terracotta', 'ivory'], materials: ['cotton'],
    size: 'throw-130x170', createdAt: '2025-09-21', featured: false,
    image: img('p17'), imageHover: img('p17-alt'),
  },
  {
    id: 'p18', slug: 'cushion-cover-set',
    name: { ar: 'طقم أغطية وسائد (٤ قطع)', en: 'Cushion Cover Set of 4' },
    category: 'furnishings', collection: 'diwan', price: 540, compareAtPrice: null,
    availability: 'in_stock', colors: ['burgundy', 'gold'], materials: ['velvet'],
    size: 'cushion-45x45', createdAt: '2025-10-13', featured: false,
    image: img('p18'), imageHover: img('p18-alt'),
  },
  {
    id: 'p19', slug: 'quilted-bedspread',
    name: { ar: 'لحاف سرير مبطّن', en: 'Quilted Bedspread' },
    category: 'furnishings', collection: 'heritage', price: 1690, compareAtPrice: null,
    availability: 'low_stock', colors: ['ivory', 'sand'], materials: ['cotton'],
    size: 'bedspread-230x250', createdAt: '2025-05-11', featured: false,
    image: img('p19'), imageHover: img('p19-alt'),
  },
  {
    id: 'p20', slug: 'brass-table-lamp',
    name: { ar: 'مصباح طاولة نحاسي', en: 'Brass Table Lamp' },
    category: 'accessories', collection: 'atelier', price: 1120, compareAtPrice: 1400,
    availability: 'in_stock', colors: ['gold'], materials: ['metal'],
    size: 'lamp-h45', createdAt: '2025-09-30', featured: false,
    image: img('p20'), imageHover: img('p20-alt'),
  },
  {
    id: 'p21', slug: 'ceramic-vase-duo',
    name: { ar: 'طقم مزهريتين خزفيتين', en: 'Ceramic Vase Duo' },
    category: 'accessories', collection: 'atelier', price: 460, compareAtPrice: null,
    availability: 'in_stock', colors: ['ivory', 'terracotta'], materials: ['ceramic'],
    size: 'vases-h28-20', createdAt: '2025-10-07', featured: false,
    image: img('p21'), imageHover: img('p21-alt'),
  },
  {
    id: 'p22', slug: 'woven-wall-hanging',
    name: { ar: 'معلقة حائط منسوجة', en: 'Woven Wall Hanging' },
    category: 'accessories', collection: 'heritage', price: 890, compareAtPrice: null,
    availability: 'in_stock', colors: ['sand', 'charcoal'], materials: ['cotton'],
    size: 'wall-50x90', createdAt: '2025-08-19', featured: false,
    image: img('p22'), imageHover: img('p22-alt'),
  },
  {
    id: 'p23', slug: 'carved-frame-mirror',
    name: { ar: 'مرآة بإطار منحوت', en: 'Mirror with Carved Frame' },
    category: 'accessories', collection: 'diwan', price: 2450, compareAtPrice: null,
    availability: 'out_of_stock', colors: ['gold'], materials: ['wood'],
    size: 'mirror-60x90', createdAt: '2025-04-26', featured: false,
    image: img('p23'), imageHover: img('p23-alt'),
  },
  {
    id: 'p24', slug: 'scented-candle-trio',
    name: { ar: 'طقم شموع معطرة (٣ قطع)', en: 'Scented Candle Trio' },
    category: 'accessories', collection: 'atelier', price: 380, compareAtPrice: null,
    availability: 'in_stock', colors: ['ivory'], materials: ['synthetic'],
    size: '', createdAt: '2025-10-15', featured: true,
    image: img('p24'), imageHover: img('p24-alt'),
  },
];

// Placeholder enrichment — SKU, available-size options, gallery images, and
// bilingual descriptions added for the PDP UI. Replaced by real columns
// (products.sku, product_images, variant options) when Supabase lands.

// Sizes per product. One entry = a fixed dimension shown as a specification (no
// selector). Several entries only where real variants exist (p03). Empty =
// dimension not set: the selling model or the real measurements are not known
// yet (fitted carpet sold by roll/area, sofa cover by sofa, candle set).
const sizeOptionsPerProduct: Record<string, string[]> = {
  p01: ['rug-160x230'],
  p02: ['rug-200x300'],
  p03: ['rug-120x180', 'rug-160x230', 'rug-200x300'],
  p04: ['rug-180x270'],
  p05: ['rug-120x180'],
  p06: ['prayer-70x110'],
  p07: [],
  p08: [],
  p09: ['runner-80x300'],
  p10: [],
  p11: ['curtain-140x260'],
  p12: ['curtain-150x270'],
  p13: ['curtain-300x260'],
  p14: ['curtain-140x250'],
  p15: ['curtain-150x280'],
  p16: [],
  p17: ['throw-130x170'],
  p18: ['cushion-45x45'],
  p19: ['bedspread-230x250'],
  p20: ['lamp-h45'],
  p21: ['vases-h28-20'],
  p22: ['wall-50x90'],
  p23: ['mirror-60x90'],
  p24: [],
};

// DEMO variants: the flatweave rug is the one product with selectable sizes.
// Per-size price and stock are NOT known, so every variant inherits the
// product's price and availability (`price: null`, `stockQuantity: null`) —
// real per-size prices/stock are awaiting the client.
const demoSizeVariants: Record<string, string[]> = {
  p03: ['rug-120x180', 'rug-160x230', 'rug-200x300'],
};

const productDescriptions: Record<string, Localized> = {
  p01: { ar: 'نسيج صوف معقود يدويًا بزخارف بوخارا التراثية — كثافة عالية وألوان ثابتة تدوم لعقود.', en: 'Hand-knotted wool pile with heritage Bokhara motifs — dense weave and lasting color.' },
  p02: { ar: 'ميدالية زهرية كلاسيكية بخيوط صوفية نقية، نسجتها ورش متخصصة بحرفية عالية.', en: 'A classic floral medallion woven in pure wool by specialist workshops.' },
  p03: { ar: 'نسج مسطح بخطوط هندسية نظيفة — خفيفة الوزن وسهلة العناية للمساحات المعاصرة.', en: 'Flat-woven geometric lines — lightweight and easy-care for contemporary spaces.' },
  p04: { ar: 'قطعة عتقية أعيد صبغها بألوان هادئة؛ كل سجادة فريدة بلطخاتها وعمرها.', en: 'A vintage piece re-dyed in muted tones — each rug is one of a kind.' },
  p05: { ar: 'جوت مضفور بألياف طبيعية خام — ملمس ترابي دافئ يناسب المداخل والمجالس.', en: 'Braided raw jute — a warm earthen texture for entries and sitting rooms.' },
  p06: { ar: 'سجادة صلاة بملمس حريري ناعم وزخرفة محرابية تقليدية وحواف مثبتة.', en: 'A prayer rug with a silky-soft touch, traditional mihrab motif, and bound edges.' },
  p07: { ar: 'موكيت أكسمنستر بنقشة كلاسيكية ووبر كثيف يتحمل الاستخدام اليومي الكثيف.', en: 'Axminster weave with a classic pattern and dense pile built for daily wear.' },
  p08: { ar: 'وبر شاج طويل وفائق النعومة بلون عاجي — راحة فاخرة لغرف المعيشة والنوم.', en: 'A long, ultra-soft shag pile in ivory — plush comfort for living rooms and bedrooms.' },
  p09: { ar: 'سيزال طبيعي بعرض الممرات — متانة عالية ومظهر نظيف للمسارات.', en: 'Natural sisal in runner widths — durable and clean-lined for walkways.' },
  p10: { ar: 'موكيت ويلتون تقليدي بنقوش محبوكة بدقة وألوان عميقة ثابتة.', en: 'Traditional Wilton carpet with precisely woven motifs and deep, stable colors.' },
  p11: { ar: 'كتان طبيعي بقصة مستقيمة أنيقة وإضاءة ناعمة تمر عبر النسيج.', en: 'Natural linen with a clean tailored drop that filters light softly.' },
  p12: { ar: 'مخمل ثقيل يعزل الضوء والضجيج — إحساس مسرحي فاخر للغرف الرئيسية.', en: 'Heavy velvet that blocks light and sound — a theatrical luxury for main rooms.' },
  p13: { ar: 'فوال شفاف خفيف يضيف طبقة ناعمة دون حجب الإضاءة الطبيعية.', en: 'Feather-light sheer voile adding a soft layer without blocking daylight.' },
  p14: { ar: 'كتان مطرز بخيوط نباتية على الحواف — تفصيلة حرفية هادئة.', en: 'Linen drapes with botanical embroidery along the edges — a quiet craft detail.' },
  p15: { ar: 'مزيج حريري بلمعان خافت وانسياب فاخر لغرف الاستقبال الرسمية.', en: 'A silk blend with a soft sheen and elegant fall for formal reception rooms.' },
  p16: { ar: 'غطاء مخمل مرن يجدد الأريكة بلمسة دافئة وسهلة الإزالة للغسيل.', en: 'A stretch velvet cover renewing the sofa in a warm, washable layer.' },
  p17: { ar: 'بطانية قطنية منسوجة يدويًا بشراشيب مضفورة — طبقة دفء خفيفة.', en: 'A handwoven cotton throw with braided fringes — a light layer of warmth.' },
  p18: { ar: 'أربع أغطية وسائد مخملية بسحّابات مخفية وألوان عنابية وذهبية.', en: 'Four velvet cushion covers with hidden zips in burgundy and antique gold.' },
  p19: { ar: 'لحاف قطني مبطّن بخياطة مزخرفة — دفء متوسط لكل الفصول.', en: 'A quilted cotton bedspread with decorative stitching — mid-weight warmth year-round.' },
  p20: { ar: 'مصباح نحاسي مصقول بقاعدة ثابتة وإضاءة دافئة جانبية.', en: 'A polished brass lamp with a weighted base and warm side glow.' },
  p21: { ar: 'مزهريتان خزفيتان بملمس مطفي وأحجام متدرجة للرفوف والطاولات.', en: 'Two matte ceramic vases in graduated sizes for shelves and tables.' },
  p22: { ar: 'معلقة حائط منسوجة بخيوط قطنية على قضيب خشبي — فن يدوي هادئ.', en: 'A handwoven cotton wall hanging on a wooden rod — quiet handmade art.' },
  p23: { ar: 'مرآة بإطار خشبي منحوت بتفاصيل كلاسيكية — قطعة مركزية للمدخل.', en: 'A mirror in a classically carved wooden frame — an entryway centerpiece.' },
  p24: { ar: 'ثلاث شموع معطرة بروائح دافئة في أوعية زجاجية قابلة لإعادة الاستخدام.', en: 'Three scented candles in reusable glass vessels with warm fragrance notes.' },
};

// Temporary stock photography (Unsplash License — see public/images/home/CREDITS.md)
// until the client supplies final product photography. Each entry is the
// product's gallery in display order (first = main image, second = hover
// image). Applies to seed products only; products edited in Admin keep
// whatever images they were saved with.
const seedPhotos: Record<string, string[]> = {
  p01: ['p01-1', 'p01-2', 'p01-3', 'p01-4'],
  p02: ['p02-1', 'p02-2', 'p02-3', 'p02-4'],
  p03: ['p03-1', 'p03-2', 'p03-3', 'p03-4'],
  p04: ['p04-1', 'p04-2', 'p04-3'],
  p05: ['p05-1', 'p05-2', 'p05-3', 'p05-4'],
  p06: ['p06-1', 'p06-2', 'p06-3', 'p06-4'],
  p07: ['p07-1', 'p07-2', 'p07-3'],
  p08: ['p08-1', 'p08-2', 'p08-3'],
  p09: ['p09-1', 'p09-2', 'p09-3'],
  p10: ['p10-1', 'p10-2', 'p10-3'],
  p11: ['p11-1', 'p11-2', 'p11-3'],
  p12: ['p12-1', 'p12-2', 'p12-3'],
  p13: ['p13-1', 'p13-2', 'p13-3'],
  p14: ['p14-1', 'p14-2', 'p14-3'],
  p15: ['p15-1', 'p15-2'],
  p16: ['p16-1', 'p16-2', 'p16-3'],
  p17: ['p17-1', 'p17-2', 'p17-3', 'p17-4'],
  p18: ['p18-1', 'p18-2', 'p18-3', 'p18-4'],
  p19: ['p19-1', 'p19-2', 'p19-3', 'p19-4'],
  p20: ['p20-1', 'p20-2'],
  p21: ['p21-1', 'p21-2', 'p21-3', 'p21-4'],
  p22: ['p22-1', 'p22-2', 'p22-3'],
  p23: ['p23-1', 'p23-2', 'p23-3', 'p23-4'],
  p24: ['p24-1', 'p24-2', 'p24-3'],
};

const seedPhotoUrl = (key: string) => `/images/home/product-${key}.jpg`;

export const catalogProducts: CatalogProduct[] = rawProducts.map((raw) => {
  const photos = seedPhotos[raw.id]?.map(seedPhotoUrl);
  const p = photos ? { ...raw, image: photos[0], imageHover: photos[1] ?? photos[0] } : raw;
  const variantSizes = demoSizeVariants[p.id];
  const variantFields: Pick<CatalogProduct, 'variantAxes' | 'variants'> = variantSizes
    ? {
        variantAxes: ['size'],
        variants: variantSizes.map((key) => ({
          id: `${p.id}-v-${key}`,
          sku: `TYB-${p.id.toUpperCase()}-${key.replace(/^[a-z]+-/, '').toUpperCase()}`,
          combo: { size: key },
          price: null,
          compareAtPrice: null,
          availability: p.availability,
          stockQuantity: null,
          image: null,
          active: true,
        })),
      }
    : {};
  return {
    ...p,
    ...variantFields,
    sku: `TYB-${p.id.toUpperCase()}`,
    sizes: sizeOptionsPerProduct[p.id] ?? [p.size],
    images: photos ?? [p.image, p.imageHover, img(`${p.id}-b`), img(`${p.id}-c`)],
    description: productDescriptions[p.id] ?? p.name,
    published: true,
    isNew: p.createdAt >= '2025-10-01',
  };
});

export function productBySlug(slug: string | undefined): CatalogProduct | undefined {
  return catalogProducts.find((p) => p.slug === slug);
}
