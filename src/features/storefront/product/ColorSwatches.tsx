import { isLightColor, swatchColor } from './colorSwatch';

export interface SwatchOption {
  key: string;
  label: string;
  // Configured colour value (hex). When missing, a recognised colour NAME is
  // mapped to a display colour (see colorSwatch.ts) — the product data itself is never changed.
  hex?: string;
  disabled?: boolean;
}

// Circular colour swatches. The swatch is the primary indicator; the colour's
// name is a supporting label and the accessible name. With a single option it
// renders as one static, already-selected swatch (nothing to choose).
export function ColorSwatches({
  label,
  options,
  selected,
  onSelect,
  className = '',
  emptyText,
}: {
  label: string;
  options: SwatchOption[];
  selected: string | null;
  // Omit for a fixed single colour.
  onSelect?: (key: string) => void;
  className?: string;
  emptyText?: string;
}) {
  const single = options.length === 1 ? options[0] : null;
  const current = single ?? options.find((o) => o.key === selected) ?? null;

  const face = (o: SwatchOption, on: boolean) => {
    const color = swatchColor(o);
    const light = color ? isLightColor(color) : false;
    return `relative inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition ${
      on
        ? 'border-burgundy ring-2 ring-burgundy ring-offset-2 ring-offset-porcelain'
        : light
          ? 'border-espresso/35 hover:border-espresso/60'
          : 'border-espresso/15 hover:border-espresso/45'
    }`;
  };

  return (
    <div className={className}>
      <p className="mb-2.5 text-base font-semibold text-espresso">
        {label}
        {current && <span className="ms-2 text-sm font-normal text-espresso/60">{current.label}</span>}
      </p>
      <div className="flex flex-wrap gap-3" role={single ? undefined : 'group'} aria-label={single ? undefined : label}>
        {options.map((o) => {
          const color = swatchColor(o);
          const on = single !== null || selected === o.key;
          const inner = color ? (
            <span className="size-full rounded-full" style={{ backgroundColor: color }} aria-hidden />
          ) : (
            // Unknown colour name with no hex: never an invisible circle — fall
            // back to a neutral swatch carrying the name's first letter.
            <span className="flex size-full items-center justify-center rounded-full bg-taupe/50 text-[11px] font-semibold text-espresso/70" aria-hidden>
              {o.label.trim().charAt(0)}
            </span>
          );
          if (!onSelect || single) {
            return (
              <span key={o.key} role="img" aria-label={`${label}: ${o.label}`} title={o.label} className={face(o, on)}>
                {inner}
              </span>
            );
          }
          return (
            <button
              key={o.key}
              type="button"
              disabled={o.disabled}
              onClick={() => onSelect(o.key)}
              aria-pressed={on}
              aria-label={`${label}: ${o.label}`}
              title={o.label}
              className={`${face(o, on)} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy disabled:cursor-not-allowed disabled:opacity-30`}
            >
              {inner}
              {o.disabled && (
                <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px -rotate-45 bg-espresso/60" aria-hidden />
              )}
            </button>
          );
        })}
        {options.length === 0 && emptyText && <p className="text-xs text-espresso/50">{emptyText}</p>}
      </div>
    </div>
  );
}
