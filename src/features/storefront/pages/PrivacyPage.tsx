import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';

// STRUCTURED PLACEHOLDER — section skeletons only. Nothing here is legal text;
// the final policy requires legal review before the store goes live.

const copy = {
  ar: {
    title: 'سياسة الخصوصية',
    intro: 'كيف تجمع طيبة بياناتك وتستخدمها وتحميها.',
    notice:
      'صفحة هيكلية مؤقتة — ليست مستندًا قانونيًا. سيُعتمد نص السياسة بعد المراجعة القانونية وتحديد مزوّدي الدفع والشحن والبريد.',
    sections: [
      { h: 'البيانات التي نجمعها', p: 'مكان مخصص لشرح بيانات الطلبات (الاسم والهاتف والعنوان) والسلة والمفضلة وملفات الارتباط وبيانات الاستخدام — لا حسابات عملاء في المتجر.' },
      { h: 'كيف نستخدم بياناتك', p: 'مكان مخصص لشرح استخدام البيانات في تشغيل المتجر ومعالجة الطلبات وتحسين التجربة.' },
      { h: 'مشاركة البيانات مع الأطراف الخارجية', p: 'مكان مخصص لذكر مزوّدي الدفع والشحن والتحليلات الذين قد تصلهم بيانات محدودة.' },
      { h: 'حفظ البيانات وحذفها', p: 'مكان مخصص لفترات الاحتفاظ وحقك في طلب حذف بيانات الطلب.' },
      { h: 'حقوقك', p: 'مكان مخصص لحقوق الوصول والتصحيح والحذف وسحب الموافقة على الرسائل التسويقية.' },
      { h: 'أمان البيانات', p: 'مكان مخصص لوصف ضوابط الحماية والتخزين (Supabase, RLS) عند تفعيلها.' },
      { h: 'ملفات الارتباط', p: 'مكان مخصص لسياسة الكوكيز والتخزين المحلي المستخدم للسلة والمفضلة واللغة.' },
      { h: 'التعديلات والتواصل', p: 'مكان مخصص لآلية تحديث السياسة وقناة الاستفسار عن الخصوصية.' },
    ],
  },
  en: {
    title: 'Privacy Policy',
    intro: 'How Taybah collects, uses, and protects your data.',
    notice:
      'Temporary structural page — not a legal document. The final policy will be adopted after legal review and after payment, shipping, and email providers are selected.',
    sections: [
      { h: 'Data we collect', p: 'Reserved section describing order (name, phone, address), cart, wishlist, cookie, and usage data — the store has no customer accounts.' },
      { h: 'How we use your data', p: 'Reserved section describing use for store operation, order processing, and experience improvement.' },
      { h: 'Sharing with third parties', p: 'Reserved section listing payment, shipping, and analytics providers receiving limited data.' },
      { h: 'Retention and deletion', p: 'Reserved section covering retention periods and your right to request order-data deletion.' },
      { h: 'Your rights', p: 'Reserved section covering access, correction, deletion, and marketing-consent withdrawal.' },
      { h: 'Data security', p: 'Reserved section describing storage and protection controls (Supabase, RLS) once active.' },
      { h: 'Cookies', p: 'Reserved section covering cookies and the local storage used for cart, wishlist, and language.' },
      { h: 'Changes & contact', p: 'Reserved section covering policy updates and the privacy inquiry channel.' },
    ],
  },
};

export function PrivacyPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const titleNode =
    locale === 'ar' ? (
      <>سياسة <span className="text-burgundy">الخصوصية</span></>
    ) : (
      <><span className="text-burgundy">Privacy</span> Policy</>
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
