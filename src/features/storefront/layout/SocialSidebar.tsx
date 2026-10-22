import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Share2 } from 'lucide-react';
import { SOCIAL_LINKS } from './storeContact';

// Radius of the circle the platform icons sit on. The cluster's own
// rightward shift on expand (92px — a little more than this radius, so the
// leftmost icons still clear the screen's left edge) is set in globals.css
// on .social-radial:focus-within / .is-open.
const RADIUS = 70;

const ITEM_POSITIONS = SOCIAL_LINKS.map((_, i) => {
  const angle = (-90 + i * (360 / SOCIAL_LINKS.length)) * (Math.PI / 180);
  return { dx: Math.cos(angle) * RADIUS, dy: Math.sin(angle) * RADIUS };
});

// Floating radial social menu, pinned to the screen's left edge, vertically
// centered. Collapsed to a single trigger circle by default; on hover (or
// keyboard focus, or a tap on touch devices) the whole cluster shifts right
// and the platform icons fan out around the trigger in a circle. All
// movement uses `transform: translate(...)`, which is physical (not
// logical), so it needs no RTL-direction workaround — translateX always
// means "toward the right" regardless of the page's own RTL direction.
//
// Positioned with `top-1/2 -translate-y-1/2` (shrink-wrapped to content),
// NOT `inset-y-0` + `items-center` — the latter sizes this fixed container
// to the FULL page height to center a flex child inside it, and since the
// whole box (not just the visible circle) captures clicks, it silently
// blocked anything underneath it along the entire left edge of every page,
// hero slider arrows included.
export function SocialSidebar() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Touch/click support: a tap toggles `open`; tapping anywhere outside
  // closes it again. Hover and keyboard focus (desktop) are handled purely
  // in CSS via :hover / :focus-within, so this effect only matters once a
  // tap has set `open`.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // CSS also expands the menu on :focus-within, so a closed trigger that
  // still holds keyboard focus (the default right after a click) would
  // keep it visually open — blur it once state actually closes. Done here,
  // not inside the click handler's setState updater, so it runs exactly
  // once per state change instead of however many times React invokes that
  // updater internally.
  useEffect(() => {
    if (!open) triggerRef.current?.blur();
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`social-radial fixed left-0 top-1/2 z-30 hidden sm:block ${open ? 'is-open' : ''}`}
    >
      <div className="social-radial-stage">
        <button
          ref={triggerRef}
          type="button"
          className="social-radial-trigger"
          aria-label="روابط التواصل الاجتماعي"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Share2 className="size-4.5" aria-hidden="true" />
        </button>
        {SOCIAL_LINKS.map(({ id, label, href, icon: Icon }, i) => (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="social-radial-item"
            style={
              {
                '--tx': `${ITEM_POSITIONS[i].dx}px`,
                '--ty': `${ITEM_POSITIONS[i].dy}px`,
                transitionDelay: open ? `${i * 35}ms` : '0ms',
              } as CSSProperties
            }
          >
            <Icon className="size-4" />
          </a>
        ))}
      </div>
    </div>
  );
}
