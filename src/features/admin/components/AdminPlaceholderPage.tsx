import { Construction } from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';

// Honest coming-soon state for admin sections not built in this phase — no fake
// functionality.
export function AdminPlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader title={title} />
      <div className="flex flex-col items-center gap-4 border border-dashed border-taupe bg-white py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border border-taupe text-espresso/50">
          <Construction className="size-6" aria-hidden />
        </span>
        <h3 className="font-display text-xl text-espresso">قريبًا</h3>
        <p className="max-w-sm text-sm leading-relaxed text-espresso/60">
          هذا القسم غير متاح في المرحلة الحالية. سيُبنى في خطوة لاحقة — لا توجد
          وظائف هنا بعد.
        </p>
      </div>
    </div>
  );
}
