import type { ReactNode } from 'react';
import { PackageOpen } from 'lucide-react';

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-taupe text-espresso/50">
        {icon ?? <PackageOpen className="size-6" aria-hidden="true" />}
      </span>
      <h3 className="font-display text-xl text-espresso">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-espresso/60">{description}</p>
      )}
      {action}
    </div>
  );
}
