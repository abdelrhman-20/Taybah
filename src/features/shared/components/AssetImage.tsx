import type { ImgHTMLAttributes } from 'react';
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
  if (!url) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`block bg-taupe/40 ${className}`}
      />
    );
  }
  return <img src={url} alt={alt} className={className} {...rest} />;
}
