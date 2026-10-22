import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

// "The Threshold" — a brief, brand-owned moment between pages instead of an
// instant swap: a porcelain veil covers the page, the destination's name
// rises large at the center with soft beige depth behind it, then it
// clears. The actual route change happens mid-transition, while the veil
// is fully opaque, so the swap itself is never seen.
const SEAL_MS = 420;
const HOLD_MS = 120;
const RELEASE_MS = 380;

type Phase = 'idle' | 'in' | 'out';

type NavigateWithTransition = (to: string, label?: string) => void;

const PageTransitionContext = createContext<NavigateWithTransition | null>(null);

export function usePageTransition() {
  const ctx = useContext(PageTransitionContext);
  if (!ctx) {
    throw new Error('usePageTransition must be used within PageTransitionProvider');
  }
  return ctx;
}

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const timers = useRef<number[]>([]);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => () => timers.current.forEach((id) => clearTimeout(id)), []);

  const run = useCallback<NavigateWithTransition>(
    (to, nextLabel) => {
      if (reducedMotion.current) {
        navigate(to);
        return;
      }
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [
        window.setTimeout(() => {
          navigate(to);
          window.setTimeout(() => setPhase('out'), HOLD_MS);
        }, SEAL_MS),
        window.setTimeout(() => setPhase('idle'), SEAL_MS + HOLD_MS + RELEASE_MS),
      ];
      setLabel(nextLabel ?? '');
      setPhase('in');
    },
    [navigate],
  );

  return (
    <PageTransitionContext.Provider value={run}>
      {children}
      {label && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-[100] flex items-center justify-center px-6 ${
            phase === 'idle' ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
          style={{
            opacity: phase === 'in' ? 1 : 0,
            transition: `opacity ${phase === 'out' ? RELEASE_MS : SEAL_MS}ms cubic-bezier(0.22,1,0.36,1)`,
            backgroundImage:
              'radial-gradient(circle at center, #f7f5f0 0%, #f7f5f0 55%, #f1ece1 100%)',
          }}
        >
          <div className="flex flex-col items-center gap-5">
            <svg
              width="16"
              height="16"
              viewBox="0 0 14 14"
              className="text-gold"
              style={{
                transform: phase === 'in' ? 'scale(1)' : 'scale(0)',
                transition: `transform ${SEAL_MS}ms cubic-bezier(0.22,1,0.36,1)`,
              }}
            >
              <path
                d="M7 0 L9.3 4.7 L14 7 L9.3 9.3 L7 14 L4.7 9.3 L0 7 L4.7 4.7 Z"
                fill="currentColor"
              />
            </svg>
            <span
              className="font-display text-5xl text-espresso sm:text-6xl"
              style={{
                opacity: phase === 'in' ? 1 : 0,
                transform: phase === 'in' ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(10px)',
                // Soft beige depth behind the glyphs — not a glow, not a
                // hard drop shadow — using the design system's taupe tone (§3).
                textShadow:
                  '0 1px 0 rgba(216,207,193,0.9), 0 6px 18px rgba(216,207,193,0.55), 0 16px 36px rgba(216,207,193,0.35)',
                transition: `opacity ${phase === 'out' ? RELEASE_MS : SEAL_MS}ms cubic-bezier(0.22,1,0.36,1) 60ms, transform ${SEAL_MS}ms cubic-bezier(0.22,1,0.36,1) 60ms`,
              }}
            >
              {label}
            </span>
            <span
              className="h-px bg-gold/50"
              style={{
                width: phase === 'in' ? '56px' : '0px',
                transition: `width ${SEAL_MS}ms cubic-bezier(0.22,1,0.36,1) 140ms`,
              }}
            />
          </div>
        </div>
      )}
    </PageTransitionContext.Provider>
  );
}
