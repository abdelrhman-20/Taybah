import { AssetImage } from '../../shared/components/AssetImage';
import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { close: 'إغلاق', prev: 'الصورة السابقة', next: 'الصورة التالية' },
  en: { close: 'Close', prev: 'Previous image', next: 'Next image' },
};

export function Lightbox({
  images,
  index,
  alt,
  locale,
  onNavigate,
  onClose,
}: {
  images: string[];
  index: number;
  alt: string;
  locale: StorefrontLocale;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const t = copy[locale];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    closeRef.current?.focus();
    const next = () => onNavigate((index + 1) % images.length);
    const prev = () => onNavigate((index - 1 + images.length) % images.length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Arrow keys follow the VISUAL direction, not a fixed next/prev
      // mapping — "prev" sits at the start side (`start-4` below) and "next"
      // at the end side, so in RTL (start = right, end = left) the physical
      // Right key must go to prev and the physical Left key to next, the
      // mirror of LTR. Matches ProductGallery.tsx's swipe-direction handling.
      if (e.key === 'ArrowRight') (locale === 'ar' ? prev : next)();
      if (e.key === 'ArrowLeft') (locale === 'ar' ? next : prev)();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [index, images.length, onNavigate, onClose, locale]);

  const arrow =
    'absolute top-1/2 -translate-y-1/2 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

  return (
    <div className="fixed inset-0 z-80 bg-espresso/95" role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" aria-label={t.close} onClick={onClose} className="absolute inset-0 cursor-zoom-out" />
      <AssetImage
        src={images[index]}
        alt={alt}
        className="pointer-events-none absolute inset-0 m-auto max-h-[85vh] max-w-[92vw] object-contain"
      />

      <button
        ref={closeRef}
        type="button"
        aria-label={t.close}
        onClick={onClose}
        className="absolute end-4 top-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <X className="size-5" />
      </button>

      {images.length > 1 && (
        <>
          <button type="button" aria-label={t.prev} onClick={() => onNavigate((index - 1 + images.length) % images.length)} className={`${arrow} start-4`}>
            <ChevronLeft className="size-6 rtl:-scale-x-100" aria-hidden />
          </button>
          <button type="button" aria-label={t.next} onClick={() => onNavigate((index + 1) % images.length)} className={`${arrow} end-4`}>
            <ChevronRight className="size-6 rtl:-scale-x-100" aria-hidden />
          </button>
          {/* start-1/2 is `right:50%` in RTL — pairing it with a always-leftward
              -translate-x-1/2 shifts the badge a full half-width off-center;
              the RTL variant flips the translate so it centers correctly in
              both directions (same pattern as MobileNav.tsx's drawer). */}
          <span className="absolute bottom-5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white" dir="ltr">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}
