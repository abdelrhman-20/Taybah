import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';

const SHOW_AFTER_PX = 480;

// Fixed, physical bottom-left (not logical start/end) — it sits in a
// screen corner regardless of text direction, same as the reference and
// unrelated to RTL reading order.
export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="العودة إلى الأعلى"
      title="العودة إلى الأعلى"
      className="fixed bottom-6 left-6 z-30 inline-flex size-11 items-center justify-center rounded-full bg-white text-espresso shadow-lg ring-1 ring-espresso/10 transition hover:bg-porcelain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <ChevronUp className="size-5" aria-hidden="true" />
    </button>
  );
}
