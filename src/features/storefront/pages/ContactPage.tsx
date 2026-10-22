import { useState, type FormEvent } from 'react';
import { CheckCircle2, Mail, MapPin, Phone } from 'lucide-react';
import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';

const copy = {
  ar: {
    title: 'تواصل معنا',
    intro: 'فريق طيبة جاهز للإجابة عن أسئلتك حول المنتجات والطلبات والمقاسات.',
    notice:
      'نموذج تجريبي أمامي فقط — الرسائل لا تُرسل ولا تُحفظ حاليًا. سيتم ربط النموذج بخدمة بريد/إشعارات عند تكامل الخادم.',
    infoH: 'بيانات التواصل',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    phoneV: '+20 100 000 0000',
    emailV: 'hello@taybah.example',
    addressV: 'شارع التحرير، القاهرة، مصر',
    formH: 'أرسل رسالة',
    name: 'الاسم',
    emailF: 'البريد الإلكتروني',
    phoneF: 'الهاتف (اختياري)',
    subject: 'الموضوع',
    message: 'الرسالة',
    send: 'إرسال الرسالة',
    successH: 'تم استلام رسالتك',
    successP: 'هذا تأكيد تجريبي — لم تُرسل رسالة فعلية. عند ربط الخادم سيتم إرسال رسالتك لفريق الدعم.',
    again: 'إرسال رسالة أخرى',
    errName: 'اكتب اسمًا من حرفين على الأقل',
    errEmail: 'اكتب بريدًا إلكترونيًا صحيحًا',
    errSubject: 'اكتب موضوع الرسالة',
    errMessage: 'اكتب رسالة من 10 أحرف على الأقل',
  },
  en: {
    title: 'Contact Us',
    intro: 'The Taybah team is ready to answer your questions about products, orders, and sizing.',
    notice:
      'Frontend demo form only — messages are not sent or stored yet. It will connect to an email/notification service when the backend lands.',
    infoH: 'Contact details',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    phoneV: '+20 100 000 0000',
    emailV: 'hello@taybah.example',
    addressV: 'Tahrir Street, Cairo, Egypt',
    formH: 'Send a message',
    name: 'Name',
    emailF: 'Email',
    phoneF: 'Phone (optional)',
    subject: 'Subject',
    message: 'Message',
    send: 'Send message',
    successH: 'Message received',
    successP: 'This is a demo confirmation — no message was actually sent. Once the backend is connected it will reach our support team.',
    again: 'Send another message',
    errName: 'Please enter a name of at least 2 characters',
    errEmail: 'Please enter a valid email address',
    errSubject: 'Please enter a subject',
    errMessage: 'Please enter a message of at least 10 characters',
  },
};

interface Fields {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls =
  'w-full border border-taupe bg-white px-4 py-3 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-sm font-medium text-espresso';

export function ContactPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const [fields, setFields] = useState<Fields>({ name: '', email: '', phone: '', subject: '', message: '' });
  const [errors, setErrors] = useState<Partial<Fields>>({});
  const [sent, setSent] = useState(false);

  const update = (key: keyof Fields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Fields> = {};
    if (fields.name.trim().length < 2) next.name = t.errName;
    if (!EMAIL_RE.test(fields.email.trim())) next.email = t.errEmail;
    if (!fields.subject.trim()) next.subject = t.errSubject;
    if (fields.message.trim().length < 10) next.message = t.errMessage;
    setErrors(next);
    if (Object.keys(next).length === 0) setSent(true);
  };

  const err = (key: keyof Fields) =>
    errors[key] ? <p className="mt-1.5 text-xs text-burgundy">{errors[key]}</p> : null;

  const info = [
    { icon: Phone, label: t.phone, value: t.phoneV, ltr: true },
    { icon: Mail, label: t.email, value: t.emailV, ltr: true },
    { icon: MapPin, label: t.address, value: t.addressV, ltr: false },
  ];

  const titleNode =
    locale === 'ar' ? (
      <><span className="text-burgundy">تواصل</span> معنا</>
    ) : (
      <><span className="text-burgundy">Contact</span> Us</>
    );

  return (
    <PageShell title={t.title} titleNode={titleNode} intro={t.intro} notice={t.notice}>
      <div className="grid gap-12 lg:grid-cols-[340px_1fr]">
        <aside>
          <h2 className="font-display text-xl text-espresso">{t.infoH}</h2>
          <ul className="mt-5 space-y-4">
            {info.map(({ icon: Icon, label, value, ltr }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-espresso/15 text-espresso/60">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs tracking-wide text-espresso/50">{label}</p>
                  <p className="mt-0.5 text-sm text-espresso" dir={ltr ? 'ltr' : undefined}>
                    {value}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section aria-labelledby="contact-form">
          <h2 id="contact-form" className="font-display text-xl text-espresso">{t.formH}</h2>
          {sent ? (
            <div className="mt-5 flex flex-col items-start gap-4 border border-espresso/10 bg-white p-8 text-center sm:items-center sm:text-center">
              <CheckCircle2 className="size-10 text-burgundy" aria-hidden />
              <h3 className="font-display text-2xl text-espresso">{t.successH}</h3>
              <p className="max-w-md text-sm leading-7 text-espresso/60">{t.successP}</p>
              <button
                type="button"
                onClick={() => {
                  setFields({ name: '', email: '', phone: '', subject: '', message: '' });
                  setSent(false);
                }}
                className="rounded-[27px] border border-espresso/25 px-6 py-2.5 text-sm font-medium text-espresso transition hover:border-burgundy hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.again}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-5 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="cf-name" className={labelCls}>{t.name}</label>
                  <input id="cf-name" type="text" required value={fields.name} onChange={update('name')} className={inputCls} />
                  {err('name')}
                </div>
                <div>
                  <label htmlFor="cf-email" className={labelCls}>{t.emailF}</label>
                  <input id="cf-email" type="email" required dir="ltr" value={fields.email} onChange={update('email')} className={inputCls} />
                  {err('email')}
                </div>
                <div>
                  <label htmlFor="cf-phone" className={labelCls}>{t.phoneF}</label>
                  <input id="cf-phone" type="tel" dir="ltr" value={fields.phone} onChange={update('phone')} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="cf-subject" className={labelCls}>{t.subject}</label>
                  <input id="cf-subject" type="text" required value={fields.subject} onChange={update('subject')} className={inputCls} />
                  {err('subject')}
                </div>
              </div>
              <div>
                <label htmlFor="cf-message" className={labelCls}>{t.message}</label>
                <textarea id="cf-message" required rows={6} value={fields.message} onChange={update('message')} className={`${inputCls} resize-y`} />
                {err('message')}
              </div>
              <button
                type="submit"
                className="rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {t.send}
              </button>
            </form>
          )}
        </section>
      </div>
    </PageShell>
  );
}
