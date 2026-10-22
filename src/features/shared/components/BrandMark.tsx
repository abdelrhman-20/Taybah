import logoSrc from '../../../assets/taybah-logo.png';

// The real Taybah calligraphy logo — transparent background, so this one
// asset works on both the light header/mobile-nav and the dark footer.
export function BrandMark({ className = '' }: { className?: string }) {
  return <img src={logoSrc} alt="طيبة — للسجاد والمفروشات والستائر" className={className} />;
}
