import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AssetImage } from '../../shared/components/AssetImage';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { ButtonLink } from '../../shared/components/Button';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { navHref } from '../layout/navData';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
import type { HomeContent } from './homeStore';

const copy = {
  ar: { prev: 'الشريحة السابقة', next: 'الشريحة التالية', goTo: (n: number) => `الانتقال إلى الشريحة ${n}` },
  en: { prev: 'Previous slide', next: 'Next slide', goTo: (n: number) => `Go to slide ${n}` },
};

const TRANSITION_MS = 700;

type HeroSlide = HomeContent['hero'] & { image: string };

// Full slide content (image + overlay + text + CTAs) as one block, so the
// text travels WITH its image during the slide transition rather than
// cross-fading separately.
function SlideLayer({
  slide,
  locale,
  style,
  transitioning,
}: {
  slide: HeroSlide;
  locale: ReturnType<typeof useStorefrontLocale>;
  style: CSSProperties;
  transitioning: boolean;
}) {
  const actions = (
    <>
      <ButtonLink to={navHref(locale, slide.primaryTo)} size="lg">
        {slide.primaryLabel}
      </ButtonLink>
      <ButtonLink to={navHref(locale, slide.secondaryTo)} variant="outline" size="lg">
        {slide.secondaryLabel}
      </ButtonLink>
    </>
  );

  return (
    <div
      className={`absolute inset-0 ${transitioning ? 'transition-transform ease-in-out' : ''}`}
      style={{ transitionDuration: transitioning ? `${TRANSITION_MS}ms` : undefined, ...style }}
    >
      <AssetImage
        src={slide.image}
        alt="تشكيلة سجاد ومفروشات طيبة"
        className="absolute inset-0 size-full object-cover"
      />
      <div
        className="pointer-events-none absolute inset-0 from-espresso/55 via-espresso/15 to-transparent rtl:bg-gradient-to-l ltr:bg-gradient-to-r"
        aria-hidden="true"
      />
      <Container className="relative flex h-full items-center">
        <div className="max-w-xl">
          <p className="mb-3 flex items-center gap-2.5 text-[17px] font-semibold tracking-[0.3em] text-gold uppercase">
            <span className="h-px w-5 bg-gold" aria-hidden="true" />
            {slide.eyebrow}
          </p>
          <h1 className="font-display text-[2.2rem] leading-[1.12] text-porcelain sm:text-[2.6rem] lg:text-5xl lg:leading-[1.1]">
            {emphasizeLastWord(slide.title, 'text-gold')}
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-porcelain/85 sm:text-[17px]">{slide.body}</p>
          <OrnamentDivider className="mt-6" />
          <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
        </div>
      </Container>
    </div>
  );
}

// Full-bleed slide — text/CTAs come from the one hero record (content.hero);
// only the image changes between slides (content.images, admin-managed order).
export function HeroSection({ content }: { content: HomeContent['hero'] }) {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const slides = content.images.map((image) => ({ ...content, image }));
  const multi = slides.length > 1;

  const [current, setCurrent] = useState(0);
  // While set, both the outgoing (`current`) and incoming slide render as two
  // layers sliding past each other; `animate` flips a frame later so the
  // incoming layer's starting position paints BEFORE the transition kicks
  // in (otherwise the browser has nothing to animate from).
  const [incoming, setIncoming] = useState<{ index: number; dir: 1 | -1 } | null>(null);
  const [animate, setAnimate] = useState(false);
  const lockedRef = useRef(false);

  // `current` can exceed the list if images shrink (another tab's edit synced
  // via the store) — normalize before indexing or computing directions.
  const active = slides.length ? current % slides.length : 0;

  const navigate = (index: number, dir: 1 | -1) => {
    if (lockedRef.current || index === active) return;
    lockedRef.current = true;
    setIncoming({ index, dir });
    setAnimate(false);
  };
  const go = (dir: 1 | -1) => navigate((active + dir + slides.length) % slides.length, dir);
  const goToDot = (index: number) => {
    if (index === active) return;
    // Shortest-path direction so a dot click still slides the natural way
    // round the loop, not always forward.
    const forwardSteps = (index - active + slides.length) % slides.length;
    const dir: 1 | -1 = forwardSteps <= slides.length / 2 ? 1 : -1;
    navigate(index, dir);
  };

  // Two-frame handoff: the incoming layer must render at its OFF-SCREEN
  // position with no transition first (frame 1), then get the transition
  // class and move to 0 (frame 2) — doing both in one render would give the
  // browser nothing to animate from (no previous paint at the start position).
  useEffect(() => {
    if (!incoming || animate) return;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [incoming, animate]);

  useEffect(() => {
    if (!incoming || !animate) return;
    const timer = setTimeout(() => {
      setCurrent(incoming.index);
      setIncoming(null);
      setAnimate(false);
      lockedRef.current = false;
    }, TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [incoming, animate]);

  const dir = incoming?.dir ?? 1;
  const outgoingX = animate ? (dir > 0 ? '-100%' : '100%') : '0%';
  const incomingX = animate ? '0%' : dir > 0 ? '100%' : '-100%';

  if (!slides.length) return null;

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="relative h-[35em] w-full overflow-hidden">
        <SlideLayer
          slide={slides[active]}
          locale={locale}
          transitioning={Boolean(incoming)}
          style={{ transform: `translateX(${outgoingX})` }}
        />
        {incoming && slides[incoming.index] && (
          <SlideLayer
            slide={slides[incoming.index]}
            locale={locale}
            transitioning
            style={{ transform: `translateX(${incomingX})` }}
          />
        )}

        {multi && (
          <>
            {/* Physical left/right (not logical start/end) — a carousel's arrows
                point the same way regardless of text direction: left arrow on
                the left steps back, right arrow on the right steps forward. */}
            <button
              type="button"
              aria-label={t.prev}
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-porcelain/90 text-espresso shadow transition hover:bg-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:left-6"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t.next}
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-porcelain/90 text-espresso shadow transition hover:bg-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:right-6"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>

            {/* dir="ltr" keeps dot 0 physically leftmost regardless of page
                direction — otherwise the ambient RTL flex order reverses them,
                so clicking the physical-right "next" arrow (index++) would
                light up the dot to the LEFT instead of the one to the right. */}
            <div dir="ltr" className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={t.goTo(i + 1)}
                  aria-current={i === active}
                  onClick={() => goToDot(i)}
                  className="flex size-4 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  <span
                    className={`block rounded-full transition-all duration-300 ${
                      i === active ? 'size-2.5 bg-gold' : 'size-2 border border-gold/70 bg-transparent'
                    }`}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
