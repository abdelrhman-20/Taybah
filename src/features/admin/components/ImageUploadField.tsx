import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Images, RefreshCw, Trash2 } from 'lucide-react';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_MB,
  isLocalImageRef,
  localImageRef,
  saveImageBlob,
} from '../../shared/assets/imageStore';
import { AssetImage } from '../../shared/components/AssetImage';
import { ImagePickerDialog } from './ImagePickerDialog';

// Reusable Arabic RTL image picker — stores the selected file as a Blob in
// IndexedDB and emits a `local:<id>` reference via onChange. External URLs
// already stored on records keep previewing unchanged. Removing clears the
// field's reference only; the blob is retained in IndexedDB deliberately
// (other entities may still reference the same asset — safe-cleanup policy).

async function sniffMagicBytes(file: File): Promise<'jpeg' | 'png' | 'webp' | null> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...buf.slice(8, 12)) === 'WEBP'
  )
    return 'webp';
  return null;
}

const MAGIC_TO_MIME: Record<NonNullable<Awaited<ReturnType<typeof sniffMagicBytes>>>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function ImageUploadField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required = false,
  maxSizeMB = MAX_IMAGE_MB,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (ref: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  maxSizeMB?: number;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const shownError = error ?? localError;

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setLocalError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      setLocalError('صيغة غير مدعومة — اختر صورة JPEG أو PNG أو WebP.');
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      setLocalError(`حجم الصورة يتجاوز ${maxSizeMB} ميجابايت — اختر ملفًا أصغر.`);
      return;
    }
    setBusy(true);
    try {
      // Verify the real file signature — MIME/extension alone can lie.
      const magic = await sniffMagicBytes(file);
      if (!magic || MAGIC_TO_MIME[magic] !== file.type) {
        setLocalError('محتوى الملف لا يطابق نوعه — اختر صورة صالحة.');
        return;
      }
      const assetId = await saveImageBlob(file, { name: file.name });
      onChange(localImageRef(assetId));
    } catch (err) {
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
      setLocalError(
        quota
          ? 'مساحة التخزين المحلي ممتلئة — احذف بعض الصور من مكتبة الوسائط ثم حاول مرة أخرى.'
          : 'تعذر حفظ الصورة محليًا — حاول مرة أخرى.',
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const hiddenInput = (
    <input
      ref={inputRef}
      id={id}
      type="file"
      accept={ACCEPTED_IMAGE_TYPES.join(',')}
      className="sr-only"
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {hiddenInput}
        <AssetImage
          src={value}
          alt=""
          className="size-10 shrink-0 rounded border border-taupe/70 object-cover"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          {busy ? 'جارٍ المعالجة…' : value ? 'استبدال' : 'اختيار صورة'}
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label="اختيار من مكتبة الصور"
          title="اختيار من مكتبة الصور"
          className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-espresso/5 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Images className="size-4" aria-hidden />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="إزالة الصورة"
            className="inline-flex size-8 items-center justify-center rounded-full text-espresso/50 transition hover:bg-burgundy/10 hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
        {shownError && (
          <p role="status" aria-live="polite" className="text-xs text-burgundy">
            {shownError}
          </p>
        )}
        <ImagePickerDialog
          open={pickerOpen}
          onSelect={(ref) => {
            onChange(ref);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-espresso">
        {label} {required ? '*' : ''}
      </span>
      {hiddenInput}
      {value ? (
        <div className="rounded border border-taupe/70 bg-white p-3">
          <AssetImage
            src={value}
            alt="معاينة الصورة"
            className="h-40 w-full max-w-xs rounded object-cover"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <RefreshCw className="size-3.5" aria-hidden /> استبدال الصورة
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-espresso/25 px-3 py-1.5 text-xs font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Images className="size-3.5" aria-hidden /> اختيار من المكتبة
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex items-center gap-1.5 rounded border border-burgundy/30 px-3 py-1.5 text-xs font-medium text-burgundy transition hover:bg-burgundy/10 focus-visible:outline-2 focus-visible:outline-burgundy"
            >
              <Trash2 className="size-3.5" aria-hidden /> إزالة الصورة
            </button>
            <span className="font-mono text-[10px] text-espresso/40" dir="ltr">
              {isLocalImageRef(value) ? 'محلي — IndexedDB' : value.slice(0, 48)}
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`flex w-full flex-col items-center gap-2 rounded border border-dashed px-4 py-8 text-center transition focus-visible:outline-2 focus-visible:outline-burgundy disabled:opacity-60 ${
            dragging ? 'border-burgundy bg-burgundy/5' : 'border-taupe bg-white hover:border-burgundy/60'
          }`}
        >
          <ImagePlus className="size-6 text-espresso/40" aria-hidden />
          <span className="text-sm font-medium text-espresso/70">
            {busy ? 'جارٍ المعالجة…' : 'اختر صورة من جهازك أو أفلتها هنا'}
          </span>
          <span className="text-[11px] text-espresso/45">
            JPEG · PNG · WebP — حتى {maxSizeMB} ميجابايت
          </span>
        </button>
      )}
      {!value && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-2 focus-visible:outline-burgundy"
        >
          <Images className="size-3.5" aria-hidden /> أو اختر من مكتبة الصور
        </button>
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-espresso/50">
          {hint}
        </p>
      )}
      {shownError && (
        <p role="status" aria-live="polite" className="mt-1.5 text-xs text-burgundy">
          {shownError}
        </p>
      )}
      <ImagePickerDialog
        open={pickerOpen}
        onSelect={(ref) => {
          onChange(ref);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  );
}
