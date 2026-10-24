// ABOUT PAGE CONTENT — the single source for the page (the component only
// renders it). There is no Admin editor for this page yet: edit here.
//
// All copy is the page's existing text, kept word for word (only reorganized
// into the new layout). It is still TEMPORARY brand copy — see `note`. The page
// deliberately shows NO statistics (customer counts, years, product totals):
// none are recorded anywhere in the project, so none are invented.

export type ValueIcon = 'authenticity' | 'quality' | 'calm' | 'transparency';
export type DiffIcon = 'curated' | 'arabic' | 'documented';

interface Locale {
  title: string;
  intro: string;
  note: string;
  valuesH: string;
  values: { id: ValueIcon; h: string; p: string }[];
  storyH: string;
  story: string[];
  browse: string;
  diffH: string;
  diffs: { id: DiffIcon; text: string }[];
  cta: { heading: string; body: string; button: string };
}

// Local photography already in the project (see public/images/home/CREDITS.md).
export const aboutImages = {
  hero: '/images/home/story-weaving.jpg',
  story: '/images/home/collection-heritage.jpg',
  banner: '/images/home/hero-2.jpg',
};

export const aboutContent: Record<'ar' | 'en', Locale> = {
  ar: {
    title: 'من نحن',
    intro: 'طيبة متجر متخصص في السجاد والموكيت والستائر والمفروشات وإكسسوارات المنزل.',
    note: 'محتوى تعريفي مؤقت — يُستكمل بقصة العلامة النهائية وأسماء الفريق لاحقًا.',
    valuesH: 'قيمنا',
    values: [
      { id: 'authenticity', h: 'الأصالة', p: 'نختار خامات وتقنيات تحترم الحرفة وتاريخها.' },
      { id: 'quality', h: 'الجودة أولًا', p: 'كل قطعة تمر بفحص للخامة والنسج والتشطيب قبل عرضها.' },
      { id: 'calm', h: 'الهدوء البصري', p: 'نفضّل القطع التي تجمّل البيت دون أن تزاحمه.' },
      { id: 'transparency', h: 'الشفافية', p: 'أسعار واضحة وأوصاف صادقة ومواصفات مكتوبة بدقة.' },
    ],
    storyH: 'قصتنا',
    story: [
      'بدأت طيبة من فكرة بسيطة: البيت يستحق قطعًا تحمل حكاية. اخترنا السجاد والمفروشات لأنها القطع التي تعيش مع العائلة — تلمسها الأقدام كل صباح وتجمع المجالس كل مساء.',
      'نعمل اليوم على جمع قطع تُنسج بحرفية أصيلة وتُقدَّم بروح معاصرة — من السجاد المعقود يدويًا إلى الستائر الكتانية المفصلة بعناية.',
    ],
    browse: 'تصفح المنتجات',
    diffH: 'ما يميز طيبة',
    diffs: [
      { id: 'curated', text: 'تشكيلة مختارة بعناية بدلًا من كتالوج لا نهائي.' },
      { id: 'arabic', text: 'دعم عربي أولًا — تجربة مصممة من البداية بالعربية وليست ترجمة.' },
      { id: 'documented', text: 'قطع بمقاسات وخامات موثّقة لتختار بثقة.' },
    ],
    cta: {
      heading: 'نرحب بتواصلك معنا',
      body: 'إذا كان لديك أي استفسار أو تحتاج إلى مساعدة، فريقنا جاهز لمساعدتك.',
      button: 'تواصل معنا',
    },
  },
  en: {
    title: 'About Us',
    intro: 'Taybah is a curated store for rugs, carpets, curtains, furnishings, and home accessories.',
    note: 'Temporary introduction content — replaced by the final brand story and team details later.',
    valuesH: 'Our values',
    values: [
      { id: 'authenticity', h: 'Authenticity', p: 'We choose materials and techniques that honor the craft and its history.' },
      { id: 'quality', h: 'Quality first', p: 'Every piece passes material, weave, and finish checks before listing.' },
      { id: 'calm', h: 'Visual calm', p: 'We favor pieces that beautify a home without crowding it.' },
      { id: 'transparency', h: 'Transparency', p: 'Clear prices, honest descriptions, precisely written specifications.' },
    ],
    storyH: 'Our story',
    story: [
      'Taybah began with a simple idea: a home deserves pieces that carry a story. We chose rugs and furnishings because they are the pieces a family lives with — underfoot every morning, gathering everyone every evening.',
      'Today we curate pieces woven with authentic craft and presented with a contemporary spirit — from hand-knotted rugs to carefully tailored linen curtains.',
    ],
    browse: 'Browse products',
    diffH: 'What makes Taybah different',
    diffs: [
      { id: 'curated', text: 'A curated selection instead of an endless catalog.' },
      { id: 'arabic', text: 'Arabic-first support — the experience is designed in Arabic, not translated into it.' },
      { id: 'documented', text: 'Documented sizes and materials so you can choose with confidence.' },
    ],
    cta: {
      heading: 'We’d love to hear from you',
      body: 'If you have a question or need help, our team is ready to assist.',
      button: 'Contact us',
    },
  },
};
