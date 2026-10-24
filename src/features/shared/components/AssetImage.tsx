import { useState, type ImgHTMLAttributes } from 'react';
import { useImageUrl } from '../assets/imageStore';

// Drop-in <img> replacement for any image that may hold a local asset
// reference (`local:<id>`) or an external URL. While a local asset resolves —
// or if the reference is missing — renders a neutral placeholder block with
// the same layout classes, so nothing breaks visually.
export function AssetImage({
  src,
  alt = '',
  className = '',
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  const url = useImageUrl(src);
  // A URL that fails to load falls back to the same neutral block as a missing
  // image, instead of a broken-image icon. Resets when `src` changes.
  const [failedUrl, setFailedUrl] = useState('');
  if (!url || failedUrl === url) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`block bg-taupe/40 ${className}`}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      {...rest}
      onError={(e) => {
        setFailedUrl(url);
        rest.onError?.(e);
      }}
    />
  );
}
