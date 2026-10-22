export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-300 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-burgundy text-white shadow-[0_10px_24px_-10px_rgba(104,29,32,0.55)] hover:bg-burgundy/95 hover:shadow-[0_14px_30px_-10px_rgba(104,29,32,0.6)]',
  outline:
    'border border-espresso/25 bg-transparent text-espresso hover:border-espresso hover:bg-espresso/[0.03]',
  ghost: 'text-espresso hover:bg-espresso/5',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'rounded-[27px] px-4 py-2 text-xs tracking-[0.08em]',
  md: 'rounded-[27px] px-6 py-3 text-sm tracking-[0.08em]',
  lg: 'rounded-[27px] px-8 py-4 text-sm tracking-[0.1em]',
};

export function buttonStyles(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}
