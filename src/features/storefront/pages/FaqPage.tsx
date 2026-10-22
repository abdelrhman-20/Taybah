import { Plus } from 'lucide-react';
import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';

// PLACEHOLDER FAQ CONTENT — reasonable default questions pending final business
// answers (payment provider, shipping model, refund policy are open decisions).

interface FaqItem {
  q: string;
  a: string;
}

const copy = {
  ar: {
    title: 'الأسئلة الشائعة',
    intro: 'إجابات سريعة عن المنتجات والطلب والشحن والإرجاع والعناية.',
    notice: 'محتوى مؤقت — الإجابات النهائية تعتمد على قرارات الشحن والدفع والإرجاع التي لم تُحسم بعد.',
    sections: [
      {
        h: 'المنتجات',
        items: [
          { q: 'كيف أختار مقاس السجادة المناسب لغرفتي؟', a: 'قِس مساحة الأثاث الرئيسية؛ تُعرض المقاسات المتاحة لكل منتج في صفحة المنتج ويمكنك الترشيح بالمقاس في صفحات الأقسام.' },
          { q: 'هل الألوان في الصور مطابقة للمنتج الفعلي؟', a: 'نعمل على تصوير القطع بإضاءة طبيعية، مع ملاحظة أن شاشات العرض قد تختلف قليلًا في إظهار الدرجات.' },
          { q: 'كيف أعتني بالسجاد الصوفي؟', a: 'التنظيف بالمكنسة الكهربائية بشفط منخفض أسبوعيًا، وتجنّب أشعة الشمس المباشرة، وتنظيف البقع فورًا بقماش جاف.' },
        ],
      },
      {
        h: 'الطلبات',
        items: [
          { q: 'هل يمكنني الطلب دون إنشاء حساب؟', a: 'نعم — طيبة تعمل بنموذج الضيوف فقط، فتطلب مباشرة ببيانات التوصيل دون تسجيل.' },
          { q: 'هل يمكن تعديل الطلب بعد تأكيده؟', a: 'تُراجع طلبات التعديل فريقيًا قبل الشحن — التفاصيل النهائية تُحدَّد عند تفعيل الطلبات الفعلية.' },
        ],
      },
      {
        h: 'الدفع',
        items: [
          { q: 'ما وسائل الدفع المتاحة؟', a: 'وسائل الدفع النهائية لم تُحدَّد بعد (قرار مفتوح) — ستشمل البطاقات ووسائل الدفع المحلية المعتادة.' },
          { q: 'هل الدفع آمن؟', a: 'سيتم الدفع عبر مزوّد معتمد؛ لن تُخزَّن بيانات البطاقات على خوادم طيبة.' },
        ],
      },
      {
        h: 'الشحن والإرجاع',
        items: [
          { q: 'كم تستغرق مدة التوصيل؟', a: 'مواعيد التوصيل النهائية تعتمد على قرار نموذج الشحن المفتوح — راجع صفحة الشحن والإرجاع.' },
          { q: 'هل يمكنني إرجاع منتج؟', a: 'سياسة الإرجاع النهائية قيد التحديد — القطع المعقودة يدويًا والمفصلة قد تخضع لشروط خاصة.' },
          { q: 'ماذا لو وصل المنتج تالفًا؟', a: 'ستتوفر قناة واضحة للإبلاغ عن التلف مع صور؛ التفاصيل على صفحة الشحن والإرجاع.' },
        ],
      },
    ] satisfies { h: string; items: FaqItem[] }[],
  },
  en: {
    title: 'FAQ',
    intro: 'Quick answers about products, ordering, payment, shipping, returns, and care.',
    notice: 'Temporary content — final answers depend on the still-open shipping, payment, and return-policy decisions.',
    sections: [
      {
        h: 'Products',
        items: [
          { q: 'How do I pick the right rug size for my room?', a: 'Measure your main furniture footprint; available sizes appear on each product page and you can filter by size on category pages.' },
          { q: 'Are the colors in photos accurate?', a: 'We photograph in natural light, noting screens may render shades slightly differently.' },
          { q: 'How do I care for a wool rug?', a: 'Weekly low-suction vacuuming, avoiding direct sunlight, and blotting spills immediately with a dry cloth.' },
        ],
      },
      {
        h: 'Ordering',
        items: [
          { q: 'Can I order without an account?', a: 'Yes — Taybah is guest-only: you order directly with your delivery details, no registration needed.' },
          { q: 'Can I modify an order after confirming?', a: 'Modification requests are reviewed manually before shipping — final details set when live ordering activates.' },
        ],
      },
      {
        h: 'Payment',
        items: [
          { q: 'Which payment methods are available?', a: 'Final methods are an open decision — they will include cards and common local options.' },
          { q: 'Is payment secure?', a: 'Payment will run through a certified provider; card data is never stored on Taybah servers.' },
        ],
      },
      {
        h: 'Shipping & Returns',
        items: [
          { q: 'How long does delivery take?', a: 'Final timelines depend on the open shipping-model decision — see the Shipping & Returns page.' },
          { q: 'Can I return a product?', a: 'The final return policy is being decided — hand-knotted and tailored pieces may carry special terms.' },
          { q: 'What if an item arrives damaged?', a: 'A clear photo-based reporting channel will be provided; details live on the Shipping & Returns page.' },
        ],
      },
    ] satisfies { h: string; items: FaqItem[] }[],
  },
};

export function FaqPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];

  const titleNode =
    locale === 'ar' ? (
      <><span className="text-burgundy">الأسئلة</span> الشائعة</>
    ) : (
      <span className="text-burgundy">{t.title}</span>
    );

  return (
    <PageShell title={t.title} titleNode={titleNode} intro={t.intro} notice={t.notice}>
      <div className="max-w-3xl space-y-10">
        {t.sections.map((section) => (
          <section key={section.h} aria-labelledby={`faq-${section.h}`}>
            <h2 id={`faq-${section.h}`} className="font-display text-2xl text-espresso">
              {section.h}
            </h2>
            <div className="mt-4 divide-y divide-espresso/10 border-y border-espresso/10">
              {section.items.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-espresso transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <Plus className="size-4 shrink-0 text-espresso/40 transition-transform duration-200 group-open:rotate-45" aria-hidden />
                  </summary>
                  <p className="pb-5 pe-8 text-sm leading-7 text-espresso/65">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
