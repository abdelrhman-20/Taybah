import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Images, RefreshCw, Trash2 } from 'lucide-react';
import { isLocalImageRef } from '../../shared/assets/imageStore';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_MB,
  isMediaRef,
  uploadImage,
  validateImage,
} from '../../shared/assets/mediaStorage';
import { notifyMediaChanged } from '../../shared/assets/mediaLibrary';
import { PersistenceError, describePersistenceError } from '../../../lib/persistence/errors';
import { AssetImage } from '../../shared/components/AssetImage';
import { ImagePickerDialog } from './ImagePickerDialog';

// Reusable Arabic RTL image picker — validates the file, uploads it to
// Supabase Storage (bucket storefront-media), verifies the object landed, and
// only then emits a stable `media:<path>` reference via onChange. Nothing is
// stored in the browser. External URLs and legacy `local:` refs already on
// records keep previewing unchanged. Removing clears the field's reference
// only; the stored file is retained (other entities may reference it) and can
// be deleted from the media library once unreferenced.

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
    setBusy(true);
    try {
      // Type allow-list, size cap and real file-signature check.
      const valid = await validateImage(file, maxSizeMB);
      if (!valid.ok) {
        setLocalError(valid.message);
        return;
      }
      const { ref } = await uploadImage(file);
      notifyMediaChanged();
      onChange(ref);
    } catch (err) {
      setLocalError(
        err instanceof PersistenceError && err.code === 'invalid'
          ? err.detail
          : describePersistenceError(err).replace('لم يُحفظ شيء.', 'لم تُرفع الصورة.'),
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
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
          {busy ? 'جارٍ الرفع…' : value ? 'استبدال' : 'اختيار صورة'}
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
              {isMediaRef(value) ? 'مخزّنة على الخادم' : isLocalImageRef(value) ? 'محلية في هذا المتصفح فقط — لم تُرحَّل' : value.slice(0, 48)}
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
            {busy ? 'جارٍ الرفع…' : 'اختر صورة من جهازك أو أفلتها هنا'}
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
