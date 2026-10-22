import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { OrnamentDivider } from './OrnamentDivider';

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="max-w-xl">
        {eyebrow && (
          <p className="mb-3 text-[11px] font-semibold tracking-[0.25em] text-burgundy uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-3xl leading-tight text-espresso sm:text-4xl">
          {title}
        </h2>
        {description && (
          <p className="mt-3 text-sm leading-relaxed text-espresso/70">{description}</p>
        )}
        <OrnamentDivider className="mt-5 justify-start" />
      </div>
      {action && (
        <Link
          to={action.to}
          className="group inline-flex items-center gap-2 text-sm font-medium text-espresso transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burgundy"
        >
          {action.label}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
