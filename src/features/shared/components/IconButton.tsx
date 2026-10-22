import type { ButtonHTMLAttributes } from 'react';

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-10 items-center justify-center rounded-full text-espresso transition-colors duration-200 hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
