import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Loader2, Mail, MapPin, MessageSquare, Phone, Send, User } from 'lucide-react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { buttonStyles } from '../../shared/components/buttonStyles';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { HOTLINE_NUMBER, STORE_ADDRESS, STORE_EMAIL } from '../layout/storeContact';
import {
  emptyContactFields,
  submitContactMessage,
  validateContact,
  type ContactErrors,
  type ContactFields,
} from './contactForm';

const IMAGES = {
  hero: '/images/home/hero-1.jpg',
  banner: '/images/home/collection-heritage.jpg',
};

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'تواصل معنا',
    intro: 'فريق طيبة جاهز للإجابة عن استفساراتك حول المنتجات والطلبات والمقاسات.',
    infoH: 'بيانات التواصل',
    infoIntro: 'يمكنك التواصل معنا عبر الوسائل التالية:',
    phone: 'الهاتف',
    phoneNote: 'الخط الساخن',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    formH: 'أرسل رسالة لنا',
    formIntro: 'املأ النموذج أدناه وسنقوم بالرد عليك في أقرب وقت ممكن.',
    formNotice: 'استقبال الرسائل عبر هذا النموذج لم يُفعَّل بعد — للتواصل الآن اتصل بنا على الخط الساخن.',
    name: 'الاسم',
    namePh: 'أدخل اسمك الكامل',
    emailF: 'البريد الإلكتروني',
    emailPh: 'أدخل بريدك الإلكتروني',
    phoneF: 'رقم الهاتف (اختياري)',
    phonePh: 'أدخل رقم هاتفك',
    subject: 'الموضوع (اختياري)',
    subjectPh: 'اختر الموضوع',
    subjects: ['استفسار عن منتج', 'استفسار عن طلب', 'المقاسات والألوان', 'الشحن والإرجاع', 'أخرى'],
    message: 'الرسالة',
    messagePh: 'اكتب رسالتك هنا…',
    send: 'إرسال الرسالة',
    sending: 'جارٍ الإرسال…',
    errName: 'اكتب اسمًا من حرفين على الأقل',
    errEmail: 'اكتب بريدًا إلكترونيًا صحيحًا',
    errMessage: 'اكتب رسالة من 10 أحرف على الأقل',
    failH: 'تعذّر إرسال رسالتك',
    failUnavailable: 'خدمة استقبال الرسائل لم تُفعَّل بعد، ولم تُرسل رسالتك. نصّك محفوظ في النموذج — يمكنك الاتصال بنا على الخط الساخن:',
    failNetwork: 'حدث خطأ أثناء الإرسال ولم تُرسل رسالتك. نصّك محفوظ في النموذج — حاول مرة أخرى بعد قليل.',
    call: 'اتصل بنا',
    bannerH: 'يسعدنا تواصلك',
    bannerP: 'إذا كان لديك أي استفسار أو تحتاج إلى مساعدة، فريقنا جاهز لمساعدتك.',
    required: 'حقل مطلوب',
  },
  en: {
    home: 'Home',
    title: 'Contact Us',
    intro: 'The Taybah team is ready to answer your questions about products, orders, and sizing.',
    infoH: 'Contact details',
    infoIntro: 'You can reach us through the following:',
    phone: 'Phone',
    phoneNote: 'Hotline',
    email: 'Email',
    address: 'Address',
    formH: 'Send us a message',
    formIntro: 'Fill in the form below and we will get back to you as soon as possible.',
    formNotice: 'Receiving messages through this form is not enabled yet — please call our hotline.',
    name: 'Name',
    namePh: 'Enter your full name',
    emailF: 'Email',
    emailPh: 'Enter your email',
    phoneF: 'Phone (optional)',
    phonePh: 'Enter your phone number',
    subject: 'Subject (optional)',
    subjectPh: 'Choose a subject',
    subjects: ['Product enquiry', 'Order enquiry', 'Sizes and colors', 'Shipping and returns', 'Other'],
    message: 'Message',
    messagePh: 'Write your message here…',
    send: 'Send message',
    sending: 'Sending…',
    errName: 'Please enter a name of at least 2 characters',
    errEmail: 'Please enter a valid email address',
    errMessage: 'Please enter a message of at least 10 characters',
    failH: 'Your message could not be sent',
    failUnavailable: 'Message receiving is not enabled yet and your message was not sent. Your text is kept in the form — you can call our hotline:',
    failNetwork: 'Something went wrong and your message was not sent. Your text is kept in the form — please try again shortly.',
    call: 'Call us',
    bannerH: 'We’d love to hear from you',
    bannerP: 'If you have a question or need help, our team is ready to assist.',
    required: 'Required',
  },
};

const hotline = HOTLINE_NUMBER.trim();
const email = STORE_EMAIL.trim();
const address = STORE_ADDRESS.trim();

const fieldCls = (invalid: boolean, withIcon = true) =>
  `h-11 w-full rounded-md border bg-white text-sm text-espresso placeholder:text-espresso/40 transition focus:border-burgundy focus:outline-1 focus:outline-burgundy ${
    withIcon ? 'ps-10 pe-3' : 'px-3'
  } ${invalid ? 'border-burgundy' : 'border-taupe'}`;
const labelCls = 'mb-1.5 block text-sm font-semibold text-espresso';

function Field({
  id,
  label,
  error,
  required,
  icon,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="ms-1 text-burgundy" aria-hidden>*</span>}
      </label>
      <div className="relative">
        {children}
        {icon && (
          <span className="pointer-events-none absolute start-3 top-3 text-espresso/40" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-burgundy">
          {error}
        </p>
      )}
    </div>
  );
}

export function ContactPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const [fields, setFields] = useState<ContactFields>(emptyContactFields);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<'unavailable' | 'network' | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const update = (key: keyof ContactFields) => (e: { target: { value: string } }) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // no duplicate submissions while a request is in flight
    const next = validateContact(fields, { name: t.errName, email: t.errEmail, message: t.errMessage });
    setErrors(next);
    setFailure(null);
    const firstInvalid = (['name', 'email', 'message'] as const).find((k) => next[k]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`#cf-${firstInvalid}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitContactMessage(fields);
      if (!result.ok) setFailure(result.reason);
      // On success the form would clear; fields are never cleared on failure.
    } catch {
      setFailure('network');
    } finally {
      setSubmitting(false);
    }
  };

  const aria = (key: 'name' | 'email' | 'message') =>
    ({ 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `cf-${key}-error` : undefined }) as const;

  const info = [
    hotline && {
      icon: Phone,
      label: t.phone,
      value: hotline,
      note: t.phoneNote,
      href: `tel:${hotline}`,
      ltr: true,
    },
    email && { icon: Mail, label: t.email, value: email, href: `mailto:${email}`, ltr: true },
    address && { icon: MapPin, label: t.address, value: address },
  ].filter(Boolean) as {
    icon: typeof Phone;
    label: string;
    value: string;
    note?: string;
    href?: string;
    ltr?: boolean;
  }[];

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto max-w-[1360px]">
        {/* Hero */}
        <section aria-labelledby="contact-title" className="relative isolate overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain">
          <AssetImage src={IMAGES.hero} alt="" className="absolute inset-0 -z-20 size-full object-cover object-[25%_65%]" />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/80 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/90 sm:to-porcelain/0 sm:via-45% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
            <div className="max-w-xl">
              <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />
              <h1 id="contact-title" className="mt-5 font-display text-4xl text-espresso sm:text-5xl">
                {locale === 'ar' ? (
                  <>
                    <span className="text-burgundy">تواصل</span> معنا
                  </>
                ) : (
                  <>
                    <span className="text-burgundy">Contact</span> Us
                  </>
                )}
              </h1>
              <p className="mt-3 max-w-md text-sm leading-7 text-espresso/75 sm:text-base">{t.intro}</p>
              <OrnamentDivider className="mt-5" />
            </div>
          </div>
        </section>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-8">
          {/* Contact details — only values that are really configured */}
          <aside
            aria-labelledby="contact-info"
            className="order-2 rounded-xl border border-taupe/70 bg-white/70 p-6 shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)] lg:order-1"
          >
            <h2 id="contact-info" className="font-display text-2xl text-espresso">
              {t.infoH}
            </h2>
            <p className="mt-1 text-sm text-espresso/60">{t.infoIntro}</p>
            <ul className="mt-5 divide-y divide-espresso/10">
              {info.map(({ icon: Icon, label, value, note, href, ltr }) => (
                <li key={label} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                  <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-porcelain text-burgundy">
                    <Icon className="size-5" strokeWidth={1.5} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-espresso/55">{label}</p>
                    {href ? (
                      <a
                        href={href}
                        dir={ltr ? 'ltr' : undefined}
                        className="block break-all text-start text-lg font-bold text-espresso transition-colors hover:text-burgundy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
                      >
                        {value}
                      </a>
                    ) : (
                      <p className="text-base font-semibold text-espresso">{value}</p>
                    )}
                    {note && <p className="text-xs text-espresso/55">{note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          {/* Message form */}
          <section
            aria-labelledby="contact-form"
            className="order-1 rounded-xl border border-taupe/70 bg-white/70 p-6 shadow-[0_8px_24px_-18px_rgba(41,34,30,0.35)] sm:p-8 lg:order-2"
          >
            <h2 id="contact-form" className="font-display text-2xl text-espresso">
              {t.formH}
            </h2>
            <p className="mt-1 text-sm text-espresso/60">{t.formIntro}</p>
            <p className="mt-4 border-s-2 border-gold bg-taupe/25 px-4 py-3 text-xs leading-6 text-espresso/65">{t.formNotice}</p>

            <form ref={formRef} onSubmit={submit} noValidate aria-busy={submitting} className="mt-5 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="cf-name" label={t.name} required error={errors.name} icon={<User className="size-4" />}>
                  <input id="cf-name" type="text" autoComplete="name" required placeholder={t.namePh} value={fields.name} onChange={update('name')} className={fieldCls(Boolean(errors.name))} {...aria('name')} />
                </Field>
                <Field id="cf-phone" label={t.phoneF} icon={<Phone className="size-4" />}>
                  <input id="cf-phone" type="tel" autoComplete="tel" dir="ltr" placeholder={t.phonePh} value={fields.phone} onChange={update('phone')} className={`${fieldCls(false)} text-start`} />
                </Field>
                <Field id="cf-email" label={t.emailF} required error={errors.email} icon={<Mail className="size-4" />}>
                  <input id="cf-email" type="email" autoComplete="email" required dir="ltr" placeholder={t.emailPh} value={fields.email} onChange={update('email')} className={`${fieldCls(Boolean(errors.email))} text-start`} {...aria('email')} />
                </Field>
                <Field id="cf-subject" label={t.subject}>
                  <select id="cf-subject" value={fields.subject} onChange={update('subject')} className={`${fieldCls(false, false)} appearance-none`}>
                    <option value="">{t.subjectPh}</option>
                    {t.subjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field id="cf-message" label={t.message} required error={errors.message} icon={<MessageSquare className="size-4" />}>
                <textarea id="cf-message" required rows={5} placeholder={t.messagePh} value={fields.message} onChange={update('message')} className={`${fieldCls(Boolean(errors.message))} h-auto resize-y py-3`} {...aria('message')} />
              </Field>

              {failure && (
                <div role="alert" className="flex gap-3 rounded-md border border-burgundy/40 bg-burgundy/5 p-4 text-sm leading-7 text-espresso">
                  <AlertCircle className="mt-1 size-5 shrink-0 text-burgundy" aria-hidden />
                  <div>
                    <p className="font-semibold text-burgundy">{t.failH}</p>
                    <p>{failure === 'unavailable' ? t.failUnavailable : t.failNetwork}</p>
                    {failure === 'unavailable' && hotline && (
                      <a href={`tel:${hotline}`} dir="ltr" className="mt-1 inline-flex items-center gap-2 font-bold text-burgundy underline-offset-4 hover:underline">
                        <Phone className="size-4" aria-hidden />
                        {hotline}
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="flex">
                <button
                  type="submit"
                  disabled={submitting}
                  className={`${buttonStyles('primary', 'md')} w-full rounded-md px-8 sm:w-auto sm:min-w-44`}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}
                  {submitting ? t.sending : t.send}
                </button>
              </div>
            </form>
          </section>
        </div>

        {/* Banner */}
        <section aria-labelledby="contact-banner" className="relative isolate mt-8 overflow-hidden rounded-2xl border border-taupe/60 bg-porcelain">
          <AssetImage src={IMAGES.banner} alt="" loading="lazy" className="absolute inset-0 -z-20 size-full object-cover" />
          <div
            className="absolute inset-0 -z-10 bg-porcelain/85 sm:bg-transparent sm:bg-gradient-to-l sm:from-porcelain sm:via-porcelain/92 sm:to-porcelain/10 sm:via-55% ltr:sm:bg-gradient-to-r"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-5 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
            <div className="max-w-md">
              <h2 id="contact-banner" className="font-display text-2xl text-espresso sm:text-3xl">
                {t.bannerH}
              </h2>
              <p className="mt-1.5 text-sm leading-7 text-espresso/70">{t.bannerP}</p>
            </div>
            {hotline ? (
              <a href={`tel:${hotline}`} className={`${buttonStyles('primary', 'md')} self-start rounded-md sm:self-auto`}>
                <Phone className="size-4" aria-hidden />
                {t.call}
                <span dir="ltr">{hotline}</span>
              </a>
            ) : (
              <a href="#contact-form" className={`${buttonStyles('primary', 'md')} self-start rounded-md sm:self-auto`}>
                <Send className="size-4 rtl:-scale-x-100" aria-hidden />
                {t.send}
              </a>
            )}
          </div>
        </section>
      </div>
    </Container>
  );
}
