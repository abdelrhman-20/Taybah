import { useEffect, useRef, useState } from 'react';

// Counts up from the previously shown value to `value` (ease-out). Falls back
// to the plain value when the visitor prefers reduced motion or the browser
// has no animation frames, so the number is always correct and never stuck.

function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return false;
  return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function AnimatedNumber({
  value,
  format = (n) => String(n),
  ms = 900,
}: {
  value: number;
  format?: (n: number) => string;
  ms?: number;
}) {
  const animate = motionAllowed();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!animate) return;
    const begin = from.current;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = begin + (value - begin) * eased;
      from.current = current;
      setShown(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, animate]);

  return <>{format(animate ? Math.round(shown) : value)}</>;
}
