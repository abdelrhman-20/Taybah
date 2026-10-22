import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';

// PLACEHOLDER OPERATIONAL DETAILS — every specific value (timelines, fees,
// windows) is a pending business decision; see OPEN_QUESTIONS #2/#17.

const copy = {
  ar: {
    title: 'الشحن والإرجاع',
    intro: 'كل ما تحتاج معرفته عن توصيل طلبك وإرجاعه أو استبداله.',
    notice:
      'كل التفاصيل التشغيلية أدناه مؤقتة — المدد والرسوم والنوافذ الزمنية تنتظر قرارات نموذج الشحن وسياسة الاسترداد المفتوحة.',
    sections: [
      {
        h: 'الشحن والتوصيل',
        items: [
          { h: 'مناطق التوصيل', p: 'مكان مخصص لتغطية التوصيل (مصر أولًا على الأرجح) — يُحدَّد مع نموذج الشحن.' },
          { h: 'مدة التوصيل', p: 'مكان مخصص لمواعيد التوصيل المتوقعة لكل منطقة — بانتظار قرار الشحن.' },
          { h: 'رسوم الشحن', p: 'مكان مخصص لهيكل الرسوم (ثابت/بالوزن/مجاني فوق حد معين) — بانتظار قرار الشحن.' },
          { h: 'تتبع الطلب', p: 'مكان مخصص لآلية تتبع الشحنة ورابط التتبع عند تفعيلها.' },
        ],
      },
      {
        h: 'الإرجاع والاستبدال',
        items: [
          { h: 'أهلية الإرجاع', p: 'مكان مخصص للنافذة الزمنية وحالة القطعة المطلوبة والقطع المستثناة (كالمفصّل حسب الطلب).' },
          { h: 'خطوات الاستبدال', p: 'مكان مخصص لآلية طلب الاستبدال والمقاسات/الألوان البديلة.' },
          { h: 'استرداد المبلغ', p: 'مكان مخصص لقناة الاسترداد (نفس وسيلة الدفع غالبًا) ومدة المعالجة — يعتمد على مزوّد الدفع.' },
          { h: 'القطع التالفة أو غير الصحيحة', p: 'مكان مخصص لآلية الإبلاغ بالصور ومهلة الإبلاغ وتعويض العميل.' },
        ],
      },
    ],
  },
  en: {
    title: 'Shipping & Returns',
    intro: 'Everything you need to know about delivery, returns, and exchanges.',
    notice:
      'All operational details below are temporary — timelines, fees, and windows await the open shipping-model and refund-policy decisions.',
    sections: [
      {
        h: 'Shipping & delivery',
        items: [
          { h: 'Delivery zones', p: 'Reserved section for coverage (likely Egypt first) — set with the shipping model.' },
          { h: 'Delivery timelines', p: 'Reserved section for expected windows per region — pending the shipping decision.' },
          { h: 'Shipping fees', p: 'Reserved section for the fee structure (flat / by weight / free over threshold) — pending the shipping decision.' },
          { h: 'Order tracking', p: 'Reserved section for shipment tracking and the tracking link once active.' },
        ],
      },
      {
        h: 'Returns & exchanges',
        items: [
          { h: 'Return eligibility', p: 'Reserved section for the return window, required item condition, and exclusions (e.g. made-to-order).' },
          { h: 'Exchange process', p: 'Reserved section for requesting exchanges and alternate sizes/colors.' },
          { h: 'Refunds', p: 'Reserved section for the refund channel (usually original payment method) and processing time — depends on the payment provider.' },
          { h: 'Damaged or incorrect items', p: 'Reserved section for photo-based reporting, the reporting window, and customer remediation.' },
        ],
      },
    ],
  },
};

export function ShippingReturnsPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const titleNode =
    locale === 'ar' ? (
      <><span className="text-burgundy">الشحن</span> والإرجاع</>
    ) : (
      <><span className="text-burgundy">Shipping</span> &amp; Returns</>
    );

  return (
    <PageShell title={t.title} titleNode={titleNode} intro={t.intro} notice={t.notice}>
      <div className="max-w-3xl space-y-12">
        {t.sections.map((section) => (
          <section key={section.h} aria-labelledby={`sr-${section.h}`}>
            <h2 id={`sr-${section.h}`} className="font-display text-2xl text-espresso">
              {section.h}
            </h2>
            <dl className="mt-5 space-y-5">
              {section.items.map((item) => (
                <div key={item.h} className="border-b border-espresso/10 pb-5">
                  <dt className="text-sm font-semibold text-espresso">{item.h}</dt>
                  <dd className="mt-1.5 text-sm leading-7 text-espresso/65">{item.p}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
