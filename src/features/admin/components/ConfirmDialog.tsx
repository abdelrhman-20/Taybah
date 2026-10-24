import { useEffect, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';

// Shared destructive-action confirmation — keeps every delete flow consistent
// and accessible (Escape closes, focus lands on the confirm button).
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'إلغاء',
  danger = true,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  // Shown inside the dialog when the confirmed action failed, so the dialog
  // stays open and the user can retry or cancel.
  error?: string | null;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    confirmRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="absolute inset-0 bg-espresso/50"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded border border-taupe bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              danger ? 'bg-burgundy/10 text-burgundy' : 'bg-gold/10 text-gold'
            }`}
          >
            <TriangleAlert className="size-4.5" aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-lg text-espresso">{title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-espresso/65">{body}</p>
            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-burgundy">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            {cancelLabel}
          </button>
          {confirmLabel && onConfirm && (
            <button
              ref={confirmRef}
              type="button"
              disabled={confirmDisabled}
              onClick={onConfirm}
              className={`rounded px-5 py-2 text-sm font-medium text-white transition focus-visible:outline-2 focus-visible:outline-burgundy disabled:opacity-50 ${
                danger ? 'bg-burgundy hover:bg-burgundy/90' : 'bg-espresso hover:bg-espresso/90'
              }`}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
