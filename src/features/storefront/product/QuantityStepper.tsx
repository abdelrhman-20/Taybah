import { Minus, Plus } from 'lucide-react';
import type { StorefrontLocale } from '../../shared/utils/locale';

const copy = {
  ar: { increase: 'زيادة الكمية', decrease: 'إنقاص الكمية', qty: 'الكمية' },
  en: { increase: 'Increase quantity', decrease: 'Decrease quantity', qty: 'Quantity' },
};

export function QuantityStepper({
  value,
  onChange,
  locale,
}: {
  value: number;
  onChange: (v: number) => void;
  locale: StorefrontLocale;
}) {
  const t = copy[locale];
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-espresso/25 bg-white" role="group" aria-label={t.qty}>
      <button
        type="button"
        aria-label={t.decrease}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className="inline-flex size-11 items-center justify-center text-espresso/70 transition hover:text-burgundy disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-10 text-center text-sm font-semibold text-espresso" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={t.increase}
        onClick={() => onChange(value + 1)}
        className="inline-flex size-11 items-center justify-center text-espresso/70 transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
