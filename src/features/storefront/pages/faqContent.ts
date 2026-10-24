// FAQ CONTENT — the single source for the FAQ page (the page component only
// renders it). There is no Admin editor for this yet: to change an answer,
// edit it here. Answers marked `pending: true` are placeholders that still need
// business confirmation (shipping model, return policy, final payment methods)
// and are flagged for the shopper on the page.

export type FaqIcon = 'products' | 'orders' | 'payment' | 'shipping';

export interface FaqItem {
  q: string;
  a: string;
  // Placeholder text awaiting a confirmed store policy.
  pending?: boolean;
}

export interface FaqCategory {
  id: string;
  icon: FaqIcon;
  title: string;
  description: string;
  items: FaqItem[];
}

interface FaqLocale {
  title: string;
  intro: string;
  notice: string;
  pendingTag: string;
  questionsCount: (n: number) => string;
  categories: FaqCategory[];
  support: { heading: string; body: string; call: string; contactLink: string; contactHint: string };
  banner: { heading: string; body: string; call: string; contact: string };
}

// Local photography already in the project (see public/images/home/CREDITS.md).
export const faqImages = {
  hero: '/images/home/hero-2.jpg',
  banner: '/images/home/collection-atelier.jpg',
};

export const faqContent: Record<'ar' | 'en', FaqLocale> = {
  ar: {
    title: 'الأسئلة الشائعة',
    intro: 'إجابات سريعة عن المنتجات والطلب والشحن والإرجاع والعناية.',
    notice: 'بعض الإجابات مؤقتة — تفاصيل الشحن والإرجاع ووسائل الدفع النهائية لم تُحسم بعد، وهي موسومة «بانتظار التأكيد».',
    pendingTag: 'بانتظار التأكيد',
    questionsCount: (n) => (n === 1 ? 'سؤال واحد' : n === 2 ? 'سؤالان' : `${n} أسئلة`),
    categories: [
      {
        id: 'products',
        icon: 'products',
        title: 'المنتجات',
        description: 'معلومات عن السجاد والموكيت والستائر والمفروشات',
        items: [
          {
            q: 'كيف أعرف مقاس المنتج؟',
            a: 'يظهر مقاس كل منتج في صفحته ضمن المواصفات، وعندما يتوفر أكثر من مقاس لمنتج يمكنك اختياره قبل الإضافة إلى السلة. المنتجات التي لم يُحدَّد مقاسها بعد لا تعرض مقاسًا.',
          },
          { q: 'هل الألوان في الصور مطابقة للمنتج الفعلي؟', a: 'نعمل على تصوير القطع بإضاءة طبيعية، مع ملاحظة أن شاشات العرض قد تختلف قليلًا في إظهار الدرجات.' },
          { q: 'كيف أعتني بالسجاد الصوفي؟', a: 'التنظيف بالمكنسة الكهربائية بشفط منخفض أسبوعيًا، وتجنّب أشعة الشمس المباشرة، وتنظيف البقع فورًا بقماش جاف.' },
        ],
      },
      {
        id: 'orders',
        icon: 'orders',
        title: 'الطلبات',
        description: 'كيفية إنشاء الطلب والتعديل عليه',
        items: [
          { q: 'هل يمكنني الطلب دون إنشاء حساب؟', a: 'نعم — طيبة تعمل بنموذج الضيوف فقط، فتطلب مباشرة ببيانات التوصيل دون تسجيل.' },
          { q: 'هل يمكن تعديل الطلب بعد تأكيده؟', a: 'تُراجع طلبات التعديل يدويًا قبل الشحن — التفاصيل النهائية تُحدَّد عند تفعيل الطلبات الفعلية.', pending: true },
        ],
      },
      {
        id: 'payment',
        icon: 'payment',
        title: 'الدفع',
        description: 'طرق الدفع المتاحة',
        items: [
          { q: 'ما وسائل الدفع المتاحة؟', a: 'تعرض صفحة إتمام الطلب حاليًا الدفع عند الاستلام. وسائل الدفع الأخرى لم تُحدَّد بعد.', pending: true },
          { q: 'هل الدفع آمن؟', a: 'ستُوضَّح تفاصيل أمان الدفع عند تفعيل وسائل الدفع الإلكترونية.', pending: true },
        ],
      },
      {
        id: 'shipping',
        icon: 'shipping',
        title: 'الشحن والإرجاع',
        description: 'مواعيد الشحن وسياسة الإرجاع',
        items: [
          { q: 'كم تستغرق مدة التوصيل؟', a: 'مواعيد التوصيل النهائية تعتمد على قرار نموذج الشحن المفتوح — راجع صفحة الشحن والإرجاع.', pending: true },
          { q: 'هل يمكنني إرجاع منتج؟', a: 'سياسة الإرجاع النهائية قيد التحديد — القطع المعقودة يدويًا والمفصلة قد تخضع لشروط خاصة.', pending: true },
          { q: 'ماذا لو وصل المنتج تالفًا؟', a: 'ستتوفر قناة واضحة للإبلاغ عن التلف مع صور؛ التفاصيل على صفحة الشحن والإرجاع.', pending: true },
        ],
      },
    ],
    support: {
      heading: 'لم تجد إجابتك؟',
      body: 'تواصل معنا وسنساعدك في أي استفسار.',
      call: 'اتصل بنا',
      contactLink: 'تواصل معنا',
      contactHint: 'صفحة التواصل وبيانات الفريق',
    },
    banner: {
      heading: 'ما زال لديك سؤال؟',
      body: 'تواصل معنا وسنسعد بالإجابة عن استفساراتك.',
      call: 'اتصل بنا',
      contact: 'تواصل معنا',
    },
  },
  en: {
    title: 'FAQ',
    intro: 'Quick answers about products, ordering, payment, shipping, returns, and care.',
    notice: 'Some answers are provisional — final shipping, returns and payment details are still being decided and are tagged “Awaiting confirmation”.',
    pendingTag: 'Awaiting confirmation',
    questionsCount: (n) => `${n} question${n === 1 ? '' : 's'}`,
    categories: [
      {
        id: 'products',
        icon: 'products',
        title: 'Products',
        description: 'About rugs, carpets, curtains and furnishings',
        items: [
          {
            q: 'How do I find a product’s size?',
            a: 'Each product’s size appears in its specifications, and where a product comes in several sizes you can choose one before adding it to the cart. Products whose size is not set yet show none.',
          },
          { q: 'Are the colors in photos accurate?', a: 'We photograph in natural light, noting screens may render shades slightly differently.' },
          { q: 'How do I care for a wool rug?', a: 'Weekly low-suction vacuuming, avoiding direct sunlight, and blotting spills immediately with a dry cloth.' },
        ],
      },
      {
        id: 'orders',
        icon: 'orders',
        title: 'Ordering',
        description: 'How to order and change an order',
        items: [
          { q: 'Can I order without an account?', a: 'Yes — Taybah is guest-only: you order directly with your delivery details, no registration needed.' },
          { q: 'Can I modify an order after confirming?', a: 'Modification requests are reviewed manually before shipping — final details set when live ordering activates.', pending: true },
        ],
      },
      {
        id: 'payment',
        icon: 'payment',
        title: 'Payment',
        description: 'Available payment methods',
        items: [
          { q: 'Which payment methods are available?', a: 'Checkout currently shows cash on delivery. Other methods are not decided yet.', pending: true },
          { q: 'Is payment secure?', a: 'Payment-security details will be provided when online payment methods are enabled.', pending: true },
        ],
      },
      {
        id: 'shipping',
        icon: 'shipping',
        title: 'Shipping & Returns',
        description: 'Delivery timing and the returns policy',
        items: [
          { q: 'How long does delivery take?', a: 'Final timelines depend on the open shipping-model decision — see the Shipping & Returns page.', pending: true },
          { q: 'Can I return a product?', a: 'The final return policy is being decided — hand-knotted and tailored pieces may carry special terms.', pending: true },
          { q: 'What if an item arrives damaged?', a: 'A clear photo-based reporting channel will be provided; details live on the Shipping & Returns page.', pending: true },
        ],
      },
    ],
    support: {
      heading: 'Didn’t find your answer?',
      body: 'Get in touch and we’ll help with any question.',
      call: 'Call us',
      contactLink: 'Contact us',
      contactHint: 'Contact page and team details',
    },
    banner: {
      heading: 'Still have a question?',
      body: 'Get in touch — we’re happy to answer your questions.',
      call: 'Call us',
      contact: 'Contact us',
    },
  },
};
