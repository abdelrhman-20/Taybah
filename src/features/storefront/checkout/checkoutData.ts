import type { Localized } from '../catalog/catalogData';

// Checkout option data — guest-only flow. Countries are placeholder choices
// pending the shipping-model decision; governorate list applies to Egypt and
// falls back to a free-text field for other countries.

export const checkoutCountries: { code: string; label: Localized }[] = [
  { code: 'EG', label: { ar: 'مصر', en: 'Egypt' } },
  { code: 'SA', label: { ar: 'السعودية', en: 'Saudi Arabia' } },
  { code: 'AE', label: { ar: 'الإمارات', en: 'United Arab Emirates' } },
  { code: 'KW', label: { ar: 'الكويت', en: 'Kuwait' } },
  { code: 'OTHER', label: { ar: 'دولة أخرى', en: 'Other country' } },
];

export const egyptGovernorates: Localized[] = [
  { ar: 'القاهرة', en: 'Cairo' },
  { ar: 'الجيزة', en: 'Giza' },
  { ar: 'الإسكندرية', en: 'Alexandria' },
  { ar: 'الدقهلية', en: 'Dakahlia' },
  { ar: 'البحر الأحمر', en: 'Red Sea' },
  { ar: 'البحيرة', en: 'Beheira' },
  { ar: 'الفيوم', en: 'Fayoum' },
  { ar: 'الغربية', en: 'Gharbia' },
  { ar: 'الإسماعيلية', en: 'Ismailia' },
  { ar: 'المنوفية', en: 'Monufia' },
  { ar: 'المنيا', en: 'Minya' },
  { ar: 'القليوبية', en: 'Qalyubia' },
  { ar: 'الوادي الجديد', en: 'New Valley' },
  { ar: 'السويس', en: 'Suez' },
  { ar: 'أسوان', en: 'Aswan' },
  { ar: 'أسيوط', en: 'Asyut' },
  { ar: 'بني سويف', en: 'Beni Suef' },
  { ar: 'بورسعيد', en: 'Port Said' },
  { ar: 'دمياط', en: 'Damietta' },
  { ar: 'الشرقية', en: 'Sharqia' },
  { ar: 'جنوب سيناء', en: 'South Sinai' },
  { ar: 'كفر الشيخ', en: 'Kafr El Sheikh' },
  { ar: 'مطروح', en: 'Matrouh' },
  { ar: 'الأقصر', en: 'Luxor' },
  { ar: 'قنا', en: 'Qena' },
  { ar: 'شمال سيناء', en: 'North Sinai' },
  { ar: 'سوهاج', en: 'Sohag' },
];

// Placeholder delivery methods — fees unresolved (shipping decision pending).
export const deliveryMethods: { key: string; label: Localized; note: Localized }[] = [
  {
    key: 'standard',
    label: { ar: 'توصيل عادي', en: 'Standard delivery' },
    note: { ar: 'الرسوم والمدة تُحدَّد لاحقًا', en: 'Fee & timing to be confirmed' },
  },
  {
    key: 'express',
    label: { ar: 'توصيل سريع', en: 'Express delivery' },
    note: { ar: 'الرسوم والمدة تُحدَّد لاحقًا', en: 'Fee & timing to be confirmed' },
  },
];
