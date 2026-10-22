import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export function FormField({
  label,
  hint,
  error,
  className = '',
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const inputId = inputProps.id ?? id;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-semibold tracking-wide text-espresso"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded border border-taupe bg-white px-4 py-2.5 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
        {...inputProps}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-burgundy">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-espresso/50">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
