// TEMPORARY PRESENTATION DATA — not real store data, not connected to any
// backend. Photography is temporary Unsplash stock (Unsplash License) served
// from public/images/home — see CREDITS.md there — until the client supplies
// final approved images. Every image below is only a seed default: each one is
// replaceable in Admin → الصفحة الرئيسية. Category/product content comes from
// ../catalog/catalogData.ts (the isolated mock catalog layer swapped for
// Supabase queries later).

const home = (file: string) => `/images/home/${file}`;

export const placeholderImages = {
  heroSlides: [home('hero-1.jpg'), home('hero-2.jpg'), home('hero-3.jpg')],
  editorial: home('editorial-lounge.jpg'),
  collectionA: home('product-p02-1.jpg'),
  collectionB: home('product-p15-1.jpg'),
  brand: home('story-weaving.jpg'),
};
