// SHIPPING & RETURNS CONTENT — the single source for the page (the component
// only renders it). There is no Admin editor for this page yet: edit here.
//
// Every value below is still a PLACEHOLDER. The earlier page only reserved a
// slot for each topic ("مكان مخصص لـ…") because the shipping model, return
// window, fees and refund process are undecided (OPEN_QUESTIONS #2/#17). The
// wording keeps that meaning, tells the customer the detail is coming, and
// states NO coverage, timing, fee, window or guarantee. When the client
// confirms a policy: replace the `text`, then set `pending: false` (the
// "awaiting confirmation" tag disappears).

export type PolicyIcon = 'zones' | 'timelines' | 'fees' | 'returns';

export interface PolicyItem {
  id: string;
  title: string;
  text: string;
  pending: boolean;
}

export interface PolicySection {
  id: string;
  title: string;
  items: PolicyItem[];
}

export interface SummaryCard {
  id: string;
  icon: PolicyIcon;
  title: string;
  text: string;
  // Id of the policy item the card jumps to.
  target: string;
}

interface Locale {
  title: string;
  intro: string;
  notice: string;
  pendingTag: string;
  summary: SummaryCard[];
  sections: PolicySection[];
  contact: { heading: string; body: string; call: string; contact: string; faq: string };
}

// Local photography already in the project (see public/images/home/CREDITS.md).
export const shippingReturnsImages = {
  hero: '/images/home/hero-3.jpg',
  banner: '/images/home/collection-diwan.jpg',
};

export const shippingReturnsContent: Record<'ar' | 'en', Locale> = {
  ar: {
    title: 'الشحن والإرجاع',
    intro: 'كل ما تحتاج معرفته عن توصيل طلبك وإرجاعه أو استبداله.',
    notice: 'كل التفاصيل التشغيلية أدناه مؤقتة — المدد والرسوم والنوافذ الزمنية تنتظر قرارات نموذج الشحن وسياسة الاسترداد المفتوحة.',
    pendingTag: 'بانتظار التأكيد',
    summary: [
      { id: 'zones', icon: 'zones', title: 'مناطق التوصيل', text: 'التغطية الجغرافية للتوصيل', target: 'zones' },
      { id: 'timelines', icon: 'timelines', title: 'مدة التوصيل', text: 'مواعيد التوصيل المتوقعة', target: 'timelines' },
      { id: 'fees', icon: 'fees', title: 'رسوم الشحن', text: 'هيكل رسوم الشحن', target: 'fees' },
      { id: 'returns', icon: 'returns', title: 'الإرجاع والاستبدال', text: 'شروط الإرجاع والاستبدال', target: 'eligibility' },
    ],
    sections: [
      {
        id: 'shipping',
        title: 'الشحن والتوصيل',
        items: [
          { id: 'zones', title: 'مناطق التوصيل', text: 'ستُوضَّح هنا مناطق التوصيل المتاحة عند اعتماد نموذج الشحن.', pending: true },
          { id: 'timelines', title: 'مدة التوصيل', text: 'ستُوضَّح هنا مواعيد التوصيل المتوقعة لكل منطقة بعد اعتماد قرار الشحن.', pending: true },
          { id: 'fees', title: 'رسوم الشحن', text: 'ستُوضَّح هنا رسوم الشحن وطريقة احتسابها بعد اعتماد قرار الشحن.', pending: true },
          { id: 'tracking', title: 'تتبع الطلب', text: 'ستُوضَّح هنا آلية متابعة الشحنة عند تفعيلها.', pending: true },
        ],
      },
      {
        id: 'returns',
        title: 'الإرجاع والاستبدال',
        items: [
          { id: 'eligibility', title: 'أهلية الإرجاع', text: 'ستُوضَّح هنا مدة الإرجاع المسموحة وحالة القطعة المطلوبة والقطع المستثناة إن وُجدت، مثل القطع المفصّلة حسب الطلب.', pending: true },
          { id: 'exchange', title: 'خطوات الاستبدال', text: 'ستُوضَّح هنا خطوات طلب الاستبدال وإمكانية اختيار مقاس أو لون آخر.', pending: true },
          { id: 'refunds', title: 'استرداد المبلغ', text: 'ستُوضَّح هنا قناة استرداد المبلغ ومدة المعالجة بعد اعتماد وسائل الدفع.', pending: true },
          { id: 'damaged', title: 'القطع التالفة أو غير الصحيحة', text: 'ستُوضَّح هنا طريقة الإبلاغ بالصور عن القطع التالفة أو غير الصحيحة ومهلة الإبلاغ.', pending: true },
        ],
      },
    ],
    contact: {
      heading: 'هل لديك سؤال عن الشحن أو الإرجاع؟',
      body: 'تواصل معنا وسنساعدك في أي استفسار عن طلبك.',
      call: 'اتصل بنا',
      contact: 'تواصل معنا',
      faq: 'الأسئلة الشائعة',
    },
  },
  en: {
    title: 'Shipping & Returns',
    intro: 'Everything you need to know about delivery, returns, and exchanges.',
    notice: 'All operational details below are temporary — timelines, fees, and windows await the open shipping-model and refund-policy decisions.',
    pendingTag: 'Awaiting confirmation',
    summary: [
      { id: 'zones', icon: 'zones', title: 'Delivery zones', text: 'Where we deliver', target: 'zones' },
      { id: 'timelines', icon: 'timelines', title: 'Delivery time', text: 'Expected delivery windows', target: 'timelines' },
      { id: 'fees', icon: 'fees', title: 'Shipping fees', text: 'How shipping is charged', target: 'fees' },
      { id: 'returns', icon: 'returns', title: 'Returns & exchanges', text: 'Return and exchange terms', target: 'eligibility' },
    ],
    sections: [
      {
        id: 'shipping',
        title: 'Shipping & delivery',
        items: [
          { id: 'zones', title: 'Delivery zones', text: 'Available delivery areas will be listed here once the shipping model is set.', pending: true },
          { id: 'timelines', title: 'Delivery timelines', text: 'Expected delivery windows per region will be listed here once the shipping decision is made.', pending: true },
          { id: 'fees', title: 'Shipping fees', text: 'Shipping fees and how they are calculated will be listed here once the shipping decision is made.', pending: true },
          { id: 'tracking', title: 'Order tracking', text: 'How to follow your shipment will be explained here once it is available.', pending: true },
        ],
      },
      {
        id: 'returns',
        title: 'Returns & exchanges',
        items: [
          { id: 'eligibility', title: 'Return eligibility', text: 'The return window, the condition items must be in, and any exclusions (for example made-to-order pieces) will be listed here.', pending: true },
          { id: 'exchange', title: 'Exchange process', text: 'How to request an exchange, including choosing another size or color, will be explained here.', pending: true },
          { id: 'refunds', title: 'Refunds', text: 'The refund channel and processing time will be explained here once payment methods are set.', pending: true },
          { id: 'damaged', title: 'Damaged or incorrect items', text: 'How to report damaged or incorrect items with photos, and the reporting window, will be explained here.', pending: true },
        ],
      },
    ],
    contact: {
      heading: 'Questions about shipping or returns?',
      body: 'Get in touch and we’ll help with any question about your order.',
      call: 'Call us',
      contact: 'Contact us',
      faq: 'FAQ',
    },
  },
};
