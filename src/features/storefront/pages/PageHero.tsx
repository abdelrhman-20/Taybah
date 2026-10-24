import type { ReactNode } from 'react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Breadcrumb, type BreadcrumbItem } from '../../shared/components/Breadcrumb';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';

// Introductory banner for information pages: breadcrumb, heading and intro on
// the start side over a soft porcelain fade, with a local interior photo behind.
export function PageHero({
  id,
  title,
  intro,
  image,
  breadcrumb,
}: {
  id: string;
  title: ReactNode;
  intro: string;
  image: string;
  breadcrumb: BreadcrumbItem[];
}) {
  return (
    <section aria-labelledby={id} className="relative isolate overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain">
      <AssetImage src={image} alt="" className="absolute inset-0 -z-20 size-full object-cover object-[30%_55%]" />
      <div
        className="absolute inset-0 -z-10 bg-porcelain/80 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/90 sm:to-porcelain/0 sm:via-45% ltr:sm:bg-gradient-to-r"
        aria-hidden="true"
      />
      <div className="px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
        <div className="max-w-xl">
          <Breadcrumb items={breadcrumb} />
          <h1 id={id} className="mt-5 font-display text-4xl text-espresso sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-7 text-espresso/75 sm:text-base">{intro}</p>
          <OrnamentDivider className="mt-5" />
        </div>
      </div>
    </section>
  );
}
