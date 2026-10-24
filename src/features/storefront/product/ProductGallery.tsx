import { AssetImage } from '../../shared/components/AssetImage';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { Lightbox } from './Lightbox';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { prev: 'الصورة السابقة', next: 'الصورة التالية', zoom: 'تكبير الصورة', thumb: (n: number, total: number) => `عرض الصورة ${n} من ${total}`, thumbs: 'صور المنتج' },
  en: { prev: 'Previous image', next: 'Next image', zoom: 'Zoom image', thumb: (n: number, total: number) => `Show image ${n} of ${total}`, thumbs: 'Product images' },
};

// Desktop: large primary image with a vertical thumbnail strip beside it (the
// strip is the same height as the image and scrolls if there are many).
// Below `lg` the strip becomes a horizontal row under the image.
export function ProductGallery({
  images,
  alt,
  locale,
}: {
  images: string[];
  alt: string;
  locale: StorefrontLocale;
}) {
  const t = copy[locale];
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const touchX = useRef<number | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A selected variant's image arrives prepended to `images` — reset to the
  // first slot so the variant image shows as primary immediately, and going
  // back to a variant without one restores the product's base gallery.
  // Render-phase adjust (React's "adjust state when props change" pattern).
  const [seenImages, setSeenImages] = useState(images);
  if (seenImages !== images) {
    setSeenImages(images);
    setIndex(0);
  }

  const count = images.length;
  const current = count ? Math.min(index, count - 1) : 0;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 40) return;
    go(locale === 'ar' ? dx : -dx); // physical swipe forward follows direction
  };

  // Arrow keys move through the thumbnails (and focus follows): down / the
  // end-side arrow = next, up / the start-side arrow = previous.
  const onThumbKey = (e: KeyboardEvent) => {
    const rtl = locale === 'ar';
    const next = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const prev = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!next && !prev) return;
    e.preventDefault();
    const target = (current + (next ? 1 : -1) + count) % count;
    setIndex(target);
    thumbRefs.current[target]?.focus();
  };

  const arrow =
    'absolute top-1/2 -translate-y-1/2 inline-flex size-10 items-center justify-center rounded-full bg-white/85 text-espresso shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_6rem] lg:gap-3">
      <div
        className="relative overflow-hidden rounded-md bg-taupe/20"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={onTouchEnd}
      >
        <AssetImage
          src={images[current]}
          alt={alt}
          className="aspect-[4/3] w-full object-cover"
          draggable={false}
        />
        <button
          type="button"
          onClick={() => setLightbox(true)}
          aria-label={t.zoom}
          className="absolute end-3 bottom-3 inline-flex size-10 items-center justify-center rounded-full bg-white/90 text-espresso shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <Maximize2 className="size-4" aria-hidden />
        </button>

        {count > 1 && (
          <>
            <button type="button" aria-label={t.prev} onClick={() => go(-1)} className={`${arrow} start-3`}>
              <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
            </button>
            <button type="button" aria-label={t.next} onClick={() => go(1)} className={`${arrow} end-3`}>
              <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </button>
            <span className="absolute start-3 bottom-3 rounded-full bg-espresso/60 px-2.5 py-1 text-[11px] text-white" dir="ltr">
              {current + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="relative mt-3 lg:mt-0">
          <ul
            aria-label={t.thumbs}
            className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:absolute lg:inset-0 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0"
            onKeyDown={onThumbKey}
          >
            {images.map((src, i) => (
              <li key={`${src}-${i}`} className="w-20 shrink-0 lg:w-full">
                <button
                  type="button"
                  ref={(el) => {
                    thumbRefs.current[i] = el;
                  }}
                  onClick={() => setIndex(i)}
                  aria-label={t.thumb(i + 1, count)}
                  aria-current={i === current}
                  tabIndex={i === current ? 0 : -1}
                  className={`block w-full overflow-hidden rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                    i === current ? 'border-burgundy' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <AssetImage src={src} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lightbox && (
        <Lightbox
          images={images}
          index={current}
          alt={alt}
          locale={locale}
          onNavigate={setIndex}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
