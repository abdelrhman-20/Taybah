import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';

// STRUCTURED PLACEHOLDER — section skeletons only, pending legal review and the
// open business decisions (payment, shipping, refund policy).

const copy = {
  ar: {
    title: 'الشروط والأحكام',
    intro: 'الشروط المنظمة لاستخدام متجر طيبة وإجراء الطلبات.',
    notice:
      'صفحة هيكلية مؤقتة — ليست مستندًا قانونيًا معتمدًا. الشروط النهائية تُراجع قانونيًا قبل الإطلاق وتعتمد على قرارات الدفع والشحن والإرجاع المفتوحة.',
    sections: [
      { h: 'التعريفات والنطاق', p: 'مكان مخصص لتعريف المتجر والمنتجات ونطاق تطبيق الشروط.' },
      { h: 'استخدام الموقع', p: 'مكان مخصص لقواعد استخدام الموقع — المتجر يعمل بنموذج الضيوف دون حسابات عملاء.' },
      { h: 'المنتجات والأسعار', p: 'مكان مخصص لدقة الأوصاف والصور وأسعار العرض وسياسة تعديل الأسعار والأخطاء.' },
      { h: 'الطلبات والدفع', p: 'مكان مخصص لآلية الطلب وتأكيده ووسائل الدفع المعتمدة وحالات رفض الطلب.' },
      { h: 'الشحن والتسليم', p: 'مكان مخصص لمناطق التوصيل والمدد والرسوم — يعتمد على قرار نموذج الشحن.' },
      { h: 'الإرجاع والاستبدال والاسترداد', p: 'مكان مخصص لشروط الإرجاع والاستبدال وآلية الاسترداد — يعتمد على قرار سياسة الاسترجاع.' },
      { h: 'الملكية الفكرية', p: 'مكان مخصص لحقوق المحتوى والعلامة التجارية والصور.' },
      { h: 'حدود المسؤولية', p: 'مكان مخصص لنطاق مسؤولية المتجر القانونية.' },
      { h: 'القانون الواجب التطبيق', p: 'مكان مخصص للاختصاص القضائي وحل النزاعات.' },
      { h: 'تعديل الشروط', p: 'مكان مخصص لآلية تحديث الشروط وإخطار المستخدمين.' },
    ],
  },
  en: {
    title: 'Terms & Conditions',
    intro: 'The terms governing use of the Taybah store and placing orders.',
    notice:
      'Temporary structural page — not an adopted legal document. Final terms require legal review before launch and depend on the open payment, shipping, and refund decisions.',
    sections: [
      { h: 'Definitions & scope', p: 'Reserved section defining the store, products, and the scope of these terms.' },
      { h: 'Site use', p: 'Reserved section covering acceptable use — the store is guest-only with no customer accounts.' },
      { h: 'Products & pricing', p: 'Reserved section covering description/image accuracy, listed prices, and price-correction policy.' },
      { h: 'Orders & payment', p: 'Reserved section covering ordering, confirmation, accepted payment methods, and order refusal.' },
      { h: 'Shipping & delivery', p: 'Reserved section covering delivery zones, timelines, and fees — pending the shipping-model decision.' },
      { h: 'Returns, exchanges & refunds', p: 'Reserved section covering eligibility, exchange, and refund mechanics — pending the refund-policy decision.' },
      { h: 'Intellectual property', p: 'Reserved section covering content, trademark, and image rights.' },
      { h: 'Limitation of liability', p: 'Reserved section defining the store’s legal liability boundaries.' },
      { h: 'Governing law', p: 'Reserved section covering jurisdiction and dispute resolution.' },
      { h: 'Amendments', p: 'Reserved section covering how terms change and how users are notified.' },
    ],
  },
};

export function TermsPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const titleNode =
    locale === 'ar' ? (
      <><span className="text-burgundy">الشروط</span> والأحكام</>
    ) : (
      <><span className="text-burgundy">Terms</span> &amp; Conditions</>
    );

  return (
    <PageShell title={t.title} titleNode={titleNode} intro={t.intro} notice={t.notice}>
      <div className="max-w-3xl space-y-8">
        {t.sections.map((s, i) => (
          <section key={s.h}>
            <h2 className="font-display text-xl text-espresso">
              {i + 1}. {s.h}
            </h2>
            <p className="mt-2 text-sm leading-7 text-espresso/65">{s.p}</p>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
