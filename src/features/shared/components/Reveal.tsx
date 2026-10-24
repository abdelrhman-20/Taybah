import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Entrance styles — only opacity/transform ever animate, never layout, so
// reveals stay cheap on mobile. `start` slides in from the reading-start
// edge (right in RTL, left in LTR); `lift` is `up` with a shorter travel.
export type RevealVariant = 'up' | 'lift' | 'fade' | 'start' | 'scale';

const HIDDEN: Record<RevealVariant, string> = {
  up: 'translate-y-10 opacity-0',
  lift: 'translate-y-5 opacity-0',
  fade: 'opacity-0',
  start: 'ltr:-translate-x-6 rtl:translate-x-6 opacity-0',
  scale: 'scale-[0.97] opacity-0',
};

const SHOWN = 'translate-x-0 translate-y-0 scale-100 opacity-100';

// `null` (no enclosing Reveal) reads as "already shown", so a RevealItem
// used outside one can never leave content stuck invisible.
const RevealVisible = createContext<boolean | null>(null);

// Watches once: after the first intersection the observer disconnects, so
// scrolling back up never replays the entrance.
function useOnceVisible() {
  const ref = useRef<HTMLDivElement>(null);
  // Reduced-motion users and browsers without IntersectionObserver start
  // visible — content can never be stuck hidden waiting on an animation.
  const [visible, setVisible] = useState(
    () =>
      typeof window !== 'undefined' &&
      (typeof IntersectionObserver === 'undefined' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // `visible` only ever flips false -> true; re-running this to watch it
    // would just immediately bail via the guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, visible };
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  variant?: RevealVariant;
  delay?: number;
  duration?: number;
};

// Fades/slides a section in once it enters the viewport — a cheap,
// dependency-free way to give the page a sense of motion as the customer
// scrolls, instead of every section just sitting there on load.
export function Reveal({ children, className = '', variant = 'up', delay = 0, duration = 700 }: RevealProps) {
  const { ref, visible } = useOnceVisible();
  return (
    <RevealVisible.Provider value={visible}>
      <div
        ref={ref}
        style={{ transitionDelay: `${delay}ms`, transitionDuration: `${duration}ms` }}
        className={`transition-all ease-out ${visible ? SHOWN : HIDDEN[variant]} ${className}`}
      >
        {children}
      </div>
    </RevealVisible.Provider>
  );
}

// Staggered child of a Reveal: shares the parent's viewport trigger (no
// extra observers) and adds its own delay, so grids can cascade.
export function RevealItem({ children, className = '', variant = 'up', delay = 0, duration = 450 }: RevealProps) {
  const visible = useContext(RevealVisible) ?? true;
  return (
    <div
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms', transitionDuration: `${duration}ms` }}
      className={`transition-all ease-out ${visible ? SHOWN : HIDDEN[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
