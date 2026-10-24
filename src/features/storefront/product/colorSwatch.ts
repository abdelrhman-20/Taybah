// Colour helpers for the product swatches (kept out of the component file so it
// only exports a component).

// Display colours for recognised names, used only when an option has no hex.
// Keys are lower-cased English keys/names and Arabic names.
const NAME_TO_HEX: Record<string, string> = {
  white: '#FFFFFF', 'أبيض': '#FFFFFF',
  black: '#1F1D1B', 'أسود': '#1F1D1B',
  ivory: '#EFEAE2', 'عاجي': '#EFEAE2',
  cream: '#F2E9D8', 'كريمي': '#F2E9D8',
  beige: '#D8C7AD', 'بيج': '#D8C7AD', sand: '#D8C7AD', 'رملي': '#D8C7AD',
  brown: '#6B4A33', 'بني': '#6B4A33',
  red: '#B3261E', 'أحمر': '#B3261E',
  burgundy: '#681D20', 'عنابي': '#681D20',
  pink: '#E7B7C0', 'وردي': '#E7B7C0',
  orange: '#D9792B', 'برتقالي': '#D9792B',
  terracotta: '#B4643D', 'طيني': '#B4643D',
  yellow: '#E3C34B', 'أصفر': '#E3C34B',
  gold: '#B58A43', 'ذهبي': '#B58A43',
  green: '#4C7A55', 'أخضر': '#4C7A55',
  sage: '#9DA88F', 'أخضر مريمي': '#9DA88F',
  teal: '#2F7F83', 'تركوازي': '#2F7F83',
  blue: '#3D6AA3', 'أزرق': '#3D6AA3',
  navy: '#2E3B4E', 'كحلي': '#2E3B4E',
  purple: '#6B4A86', 'بنفسجي': '#6B4A86',
  gray: '#8A8782', grey: '#8A8782', 'رمادي': '#8A8782',
  charcoal: '#3A3734', 'فحمي': '#3A3734',
  silver: '#C0C0C0', 'فضي': '#C0C0C0',
};

export function swatchColor(o: { key: string; label: string; hex?: string }): string | undefined {
  if (o.hex && /^#[0-9a-f]{3,8}$/i.test(o.hex.trim())) return o.hex.trim();
  return NAME_TO_HEX[o.key.trim().toLowerCase()] ?? NAME_TO_HEX[o.label.trim().toLowerCase()];
}

// Relative luminance of a #rgb / #rrggbb colour (0 dark … 1 white).
export function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Very light colours (ivory, white, cream…) get a stronger outline so they stay
// visible on the cream background.
export const isLightColor = (hex: string) => luminance(hex) > 0.6;
