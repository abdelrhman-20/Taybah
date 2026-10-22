import { Loader2 } from 'lucide-react';

export function LoadingState({ label }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-16 text-espresso/60"
    >
      <Loader2 className="size-6 animate-spin text-burgundy" aria-hidden="true" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}
