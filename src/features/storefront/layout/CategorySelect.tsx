import { Check, ChevronDown, ChevronLeft } from 'lucide-react';

export interface CategorySelectOption {
  slug: string;
  label: string;
}

// A custom (non-native) dropdown so the category picker can get a real
// animated panel — native <select> popups can't be styled or animated
// across browsers. `open` is controlled by the caller, which also owns the
// shared hover area covering the "اختر تصنيفًا" label AND this trigger —
// that's why open state and outside-hover handling live one level up (see
// StorefrontHeader's category wrapper) rather than here. Hover-only by
// design: the label and arrow are deliberately non-interactive (no button,
// no click handler) — only the listed items themselves are clickable.
export function CategorySelect({
  value,
  onChange,
  options,
  ariaLabel,
  open,
  onClose,
}: {
  value: string;
  onChange: (slug: string) => void;
  options: CategorySelectOption[];
  // "All categories" (value === 'all') is NOT one of the listed items —
  // there's no "الكل" row sitting alongside the real category items. It's
  // just the control's idle state, with the "اختر تصنيفًا" prompt the
  // caller renders as a separate static label covering that meaning; this
  // trigger shows nothing of its own until a real category is picked.
  ariaLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const selected = options.find((o) => o.slug === value)?.label ?? '';

  const pick = (slug: string) => {
    onChange(slug);
    onClose();
  };

  // flex + justify-between (DOM order: label, then icon) so the icon lands
  // on the item's physical LEFT inside this dir="rtl" panel — in an RTL
  // flex row the first DOM child renders rightmost and the last leftmost.
  const optionCls = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-right text-[13px] transition-colors duration-150 ${
      active
        ? 'border-burgundy/25 bg-burgundy/[0.07] font-medium text-burgundy'
        : 'border-taupe/50 bg-white text-espresso/80 hover:border-burgundy/20 hover:bg-burgundy/[0.05] hover:text-burgundy'
    }`;

  // No `relative` here — the dropdown is positioned against the outer
  // wrapper in StorefrontHeader instead (which also contains the static
  // "اختر تصنيفًا" label), so its right edge lines up with that whole
  // cluster rather than just this chevron-only trigger.
  return (
    <div className="shrink-0" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
      <span className="flex h-full cursor-default items-center gap-1.5 whitespace-nowrap px-4 text-[13px] text-espresso/75">
        {selected && <span className="max-w-32 truncate">{selected}</span>}
        <ChevronDown
          className={`size-3.5 shrink-0 text-espresso/40 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </span>

      <ul
        role="listbox"
        aria-label={ariaLabel}
        dir="rtl"
        className={`absolute top-[calc(100%+10px)] right-0 z-50 flex w-64 origin-top flex-col gap-1.5 rounded-2xl border border-taupe/60 bg-porcelain p-2 shadow-[0_20px_40px_-18px_rgba(41,34,30,0.3)] transition-all duration-200 ease-out ${
          open ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0'
        }`}
      >
        {options.map((o) => (
          <li key={o.slug} role="option" aria-selected={value === o.slug}>
            <button type="button" onClick={() => pick(o.slug)} className={optionCls(value === o.slug)}>
              <span className="truncate">{o.label}</span>
              {value === o.slug ? (
                <Check className="size-3.5 shrink-0 text-burgundy" aria-hidden="true" />
              ) : (
                <ChevronLeft className="size-3.5 shrink-0 text-espresso/30" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
