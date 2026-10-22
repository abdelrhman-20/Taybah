export function OrnamentDivider({
  align = 'start',
  orientation = 'horizontal',
  className = '',
}: {
  align?: 'start' | 'center';
  // 'vertical' is a thin gold rule with the same center sparkle, for
  // standing between two side-by-side blocks (e.g. the header's bilingual
  // brand lockup) instead of under a block of text.
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const sparkle = (
    <svg width="12" height="12" viewBox="0 0 14 14" className="shrink-0 text-gold">
      <path d="M7 0 L9.3 4.7 L14 7 L9.3 9.3 L7 14 L4.7 9.3 L0 7 L4.7 4.7 Z" fill="currentColor" />
    </svg>
  );

  if (orientation === 'vertical') {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`} aria-hidden="true">
        <span className="w-px flex-1 bg-gold/50" />
        {sparkle}
        <span className="w-px flex-1 bg-gold/50" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 ${align === 'center' ? 'justify-center' : ''} ${className}`}
      aria-hidden="true"
    >
      <span className="h-px w-10 bg-gold/50" />
      {sparkle}
      <span className="h-px w-10 bg-gold/50" />
    </div>
  );
}
