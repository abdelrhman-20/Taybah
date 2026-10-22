import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { localImageRef, useImageAssets } from '../../shared/assets/imageStore';
import { AssetImage } from '../../shared/components/AssetImage';

// Shared media-library picker — lets any Admin image field reuse an already
// uploaded asset (emits the existing `local:<id>` reference; never duplicates
// the blob). Search by filename, single selection, confirm/cancel, Escape
// closes, responsive grid.
export function ImagePickerDialog({
  open,
  onSelect,
  onCancel,
}: {
  open: boolean;
  onSelect: (ref: string) => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return <PickerBody onSelect={onSelect} onCancel={onCancel} />;
}

// Inner body remounts on every open — search/selection start fresh.
function PickerBody({
  onSelect,
  onCancel,
}: {
  onSelect: (ref: string) => void;
  onCancel: () => void;
}) {
  const assets = useImageAssets();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const filtered = useMemo(
    () =>
      (assets ?? []).filter((a) =>
        a.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [assets, query],
  );

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="إغلاق مكتبة الصور"
        onClick={onCancel}
        className="absolute inset-0 bg-espresso/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="اختيار صورة من مكتبة الصور"
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded border border-taupe bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg text-espresso">مكتبة الصور</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="إغلاق"
            className="inline-flex size-8 items-center justify-center rounded-full text-espresso/60 transition hover:bg-espresso/5 hover:text-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-espresso/40"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم الملف…"
            aria-label="ابحث باسم الملف"
            className="w-full rounded border border-taupe bg-white py-2.5 ps-10 pe-3 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
        </div>

        <div className="mt-4 min-h-40 flex-1 overflow-y-auto">
          {assets === null ? (
            <p className="py-14 text-center text-sm text-espresso/55">جارٍ تحميل المكتبة…</p>
          ) : filtered.length === 0 ? (
            <p className="py-14 text-center text-sm text-espresso/55">
              {assets.length === 0
                ? 'لا توجد صور في المكتبة بعد — ارفع أول صورة من أي حقل صورة أو من صفحة مكتبة الصور.'
                : 'لا نتائج مطابقة للبحث.'}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((a) => {
                const on = picked === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(a.id)}
                      aria-pressed={on}
                      className={`group block w-full rounded border text-start transition focus-visible:outline-2 focus-visible:outline-burgundy ${
                        on ? 'border-burgundy ring-1 ring-burgundy' : 'border-taupe hover:border-espresso/40'
                      }`}
                    >
                      <AssetImage
                        src={localImageRef(a.id)}
                        alt={a.name}
                        className="aspect-[4/3] w-full rounded-t object-cover"
                      />
                      <span className="block truncate px-2 py-1.5 text-[11px] text-espresso/70" dir="ltr">
                        {a.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-taupe/60 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-espresso/25 px-5 py-2 text-sm font-medium text-espresso transition hover:border-espresso focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!picked}
            onClick={() => picked && onSelect(localImageRef(picked))}
            className="rounded bg-burgundy px-5 py-2 text-sm font-medium text-white transition hover:bg-burgundy/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            اختيار الصورة
          </button>
        </div>
      </div>
    </div>
  );
}
