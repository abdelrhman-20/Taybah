import { useMemo, useState } from 'react';
import { Copy, Search, Trash2 } from 'lucide-react';
import { deleteImageAsset } from '../../shared/assets/imageStore';
import { deleteRemoteImage, mediaPath } from '../../shared/assets/mediaStorage';
import { notifyMediaChanged, useMediaLibrary } from '../../shared/assets/mediaLibrary';
import { imageDeletionUnverifiedReason, imageReferences } from '../../shared/assets/assetRefs';
import { describePersistenceError } from '../../../lib/persistence/errors';
import { AssetImage } from '../../shared/components/AssetImage';
import { ImageUploadField } from '../components/ImageUploadField';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

export function AdminMediaPage() {
  const { items: assets, error: loadError, reload } = useMediaLibrary();
  const [query, setQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [del, setDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (assets ?? []).filter((a) => a.name.toLowerCase().includes(q));
    return [...list].sort((a, b) =>
      sortDesc ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    );
  }, [assets, query, sortDesc]);

  const delTarget = del ? (assets ?? []).find((a) => a.ref === del) : undefined;
  const refs = del ? imageReferences(del) : [];
  const unverified = del ? imageDeletionUnverifiedReason(del) : null;
  const blocked = refs.length > 0 || unverified !== null;

  const copyRef = async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(ref);
      setTimeout(() => setCopied((c) => (c === ref ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  };

  const confirmDelete = async () => {
    if (!del || blocked || !delTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      if (delTarget.origin === 'remote') await deleteRemoteImage(mediaPath(delTarget.ref));
      else await deleteImageAsset(delTarget.ref.slice('local:'.length));
      notifyMediaChanged();
      setDel(null);
    } catch (e) {
      setError(describePersistenceError(e).replace('لم يُحفظ شيء.', 'لم تُحذف الصورة.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader
        title="مكتبة الصور"
        description="الصور المرفوعة تُحفظ على الخادم (Supabase Storage) وتظهر في كل المتصفحات — ارفع مرة واحدة وأعد الاستخدام في أي حقل صورة."
      />

      <div className="mt-5 rounded border border-taupe/70 bg-white p-5">
        <ImageUploadField
          id="media-upload"
          label="رفع صورة جديدة إلى المكتبة"
          value=""
          onChange={() => reload()}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
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
        <button
          type="button"
          onClick={() => setSortDesc((s) => !s)}
          className="rounded border border-espresso/25 px-4 py-2.5 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          {sortDesc ? 'الأحدث أولًا ↓' : 'الأقدم أولًا ↑'}
        </button>
      </div>

      {loadError && (
        <p role="alert" className="mt-3 text-xs text-burgundy">
          تعذّر تحميل صور الخادم ({loadError}) — القائمة أدناه قد تكون ناقصة.{' '}
          <button type="button" onClick={reload} className="font-medium underline underline-offset-4">
            إعادة المحاولة
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-burgundy">
          {error}
        </p>
      )}

      {assets === null ? (
        <p className="mt-8 rounded border border-dashed border-taupe bg-white py-16 text-center text-sm text-espresso/55">
          جارٍ تحميل المكتبة…
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-taupe bg-white py-16 text-center text-sm text-espresso/55">
          {assets.length === 0
            ? 'لا توجد صور بعد — ارفع أول صورة من الأعلى أو من أي حقل صورة.'
            : 'لا نتائج مطابقة للبحث.'}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((a) => (
            <li key={a.ref} className="overflow-hidden rounded border border-taupe/70 bg-white">
              <AssetImage src={a.ref} alt={a.name} className="aspect-[4/3] w-full object-cover" />
              <div className="p-3">
                <p className="truncate text-xs font-medium text-espresso" dir="ltr">
                  {a.name}
                </p>
                <p className="mt-0.5 text-[11px] text-espresso/50">
                  {a.createdAt ? formatDate(a.createdAt) : '—'} · {formatSize(a.size)}
                </p>
                {a.origin === 'local' && (
                  <p className="mt-1 text-[11px] font-medium text-burgundy">
                    محلية في هذا المتصفح فقط — لم تُرحَّل بعد
                  </p>
                )}
                <div className="mt-2.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => copyRef(a.ref)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-espresso/25 px-2 py-1.5 text-[11px] font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    <Copy className="size-3" aria-hidden />
                    {copied === a.ref ? 'نُسخ!' : 'نسخ المرجع'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDel(a.ref)}
                    aria-label={`حذف ${a.name}`}
                    className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={del !== null}
        title={blocked ? 'لا يمكن حذف الصورة' : 'حذف الصورة نهائيًا'}
        body={
          delTarget
            ? blocked
              ? refs.length > 0
                ? `«${delTarget.name}» مستخدمة في: ${refs.join('، ')}. استبدل تلك المراجع أو أزلها أولًا، ثم أعد المحاولة.`
                : `«${delTarget.name}»: ${unverified}`
              : `حذف «${delTarget.name}» نهائيًا ${delTarget.origin === 'remote' ? 'من الخادم' : 'من التخزين المحلي لهذا المتصفح'}؟ لا توجد مراجع إليها — لا يمكن التراجع.`
            : ''
        }
        confirmLabel={blocked ? undefined : deleting ? 'جارٍ الحذف…' : 'حذف نهائي'}
        cancelLabel={blocked ? 'حسنًا' : 'إلغاء'}
        onConfirm={blocked ? undefined : confirmDelete}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}
