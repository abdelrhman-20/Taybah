import { AssetImage } from '../../shared/components/AssetImage';
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import { Lightbox } from './Lightbox';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { prev: 'الصورة السابقة', next: 'الصورة التالية', zoom: 'تكبير الصورة', thumb: (n: number) => `الصورة ${n}` },
  en: { prev: 'Previous image', next: 'Next image', zoom: 'Zoom image', thumb: (n: number) => `Image ${n}` },
};

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

  // A selected variant's image arrives prepended to `images` — reset to the
  // first slot so the variant image shows as primary immediately, and going
  // back to a variant without one restores the product's base gallery.
  // Render-phase adjust (React's "adjust state when props change" pattern).
  const [seenImages, setSeenImages] = useState(images);
  if (seenImages !== images) {
    setSeenImages(images);
    setIndex(0);
  }

  const go = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 40) return;
    go(locale === 'ar' ? dx : -dx); // physical swipe forward follows direction
  };

  const arrow = 'absolute top-1/2 -translate-y-1/2 inline-flex size-10 items-center justify-center rounded-full bg-white/85 text-espresso shadow transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

  return (
    <div>
      <div
        className="relative overflow-hidden bg-taupe/20"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          onClick={() => setLightbox(true)}
          aria-label={t.zoom}
          className="group block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <AssetImage
            src={images[index]}
            alt={alt}
            className="aspect-[4/5] w-full object-cover"
            draggable={false}
          />
          <span className="absolute end-3 bottom-3 inline-flex size-9 items-center justify-center rounded-full bg-white/85 text-espresso opacity-0 shadow transition group-hover:opacity-100">
            <ZoomIn className="size-4" aria-hidden />
          </span>
        </button>

        {images.length > 1 && (
          <>
            <button type="button" aria-label={t.prev} onClick={() => go(-1)} className={`${arrow} start-3`}>
              <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
            </button>
            <button type="button" aria-label={t.next} onClick={() => go(1)} className={`${arrow} end-3`}>
              <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </button>
            <span className="absolute start-3 bottom-3 rounded-full bg-espresso/60 px-2.5 py-1 text-[11px] text-white" dir="ltr">
              {index + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {images.length > 1 && (
        <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <li key={src} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t.thumb(i + 1)}
                aria-current={i === index}
                className={`block overflow-hidden border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                  i === index ? 'border-burgundy' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <AssetImage src={src} alt="" className="h-20 w-16 object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <Lightbox
          images={images}
          index={index}
          alt={alt}
          locale={locale}
          onNavigate={setIndex}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
