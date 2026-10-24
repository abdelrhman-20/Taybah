import { AssetImage } from '../../shared/components/AssetImage';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { useCart } from '../cart/useCart';
import { attributeValueLabel } from '../catalog/attributeStore';
import { resolveCartLines, useCatalog } from '../catalog/catalogStore';
import { formatPrice } from '../../shared/utils/format';
import { generateId } from '../../shared/utils/id';
import { navHref } from '../layout/navData';
import { checkoutCountries, deliveryMethods, egyptGovernorates } from './checkoutData';
import { buildOrderLines, makeOrderRef, saveOrder, type GuestOrder } from './orderStore';

const copy = {
  ar: {
    home: 'الرئيسية',
    cart: 'السلة',
    title: 'إتمام الطلب',
    empty: 'سلتك فارغة',
    emptyDesc: 'أضف قطعًا قبل إتمام الطلب.',
    browse: 'تصفح المنتجات',
    s1: 'بيانات التواصل',
    s2: 'عنوان التوصيل',
    s3: 'طريقة التوصيل',
    s4: 'مراجعة الطلب',
    name: 'الاسم الكامل',
    phone: 'رقم الهاتف المحمول',
    email: 'البريد الإلكتروني',
    country: 'الدولة',
    governorate: 'المحافظة',
    governorateOther: 'المحافظة / الولاية',
    city: 'المدينة / المنطقة',
    street: 'الشارع بالتفصيل',
    building: 'رقم المبنى',
    apartment: 'الشقة / الدور (اختياري)',
    instructions: 'تعليمات إضافية للتوصيل (اختياري)',
    summary: 'ملخص الطلب',
    subtotal: 'الإجمالي الفرعي',
    shipping: 'الشحن',
    shippingTbd: 'يُحدَّد لاحقًا',
    total: 'الإجمالي',
    placeOrder: 'تأكيد الطلب',
    placingOrder: 'جارٍ إرسال الطلب…',
    reviewNote: 'راجع بياناتك قبل التأكيد — الدفع عند الاستلام.',
    submitError: 'تعذّر إرسال الطلب — تحقق من الاتصال بالإنترنت وحاول مرة أخرى.',
    errName: 'اكتب الاسم الكامل (حرفان على الأقل)',
    errPhone: 'اكتب رقم هاتف صحيحًا (9–15 رقمًا)',
    errEmail: 'اكتب بريدًا إلكترونيًا صحيحًا',
    errRequired: 'هذا الحقل مطلوب',
    blockedTitle: 'لا يمكن إتمام الطلب',
    blockedDesc: 'بعض المنتجات في سلتك أصبحت غير قابلة للشراء — إما لأنها أُخفيت من المتجر أو نفدت من المخزون. أزلها من السلة ثم أعد المحاولة.',
    blockedHidden: 'مخفي — أُزيل من المتجر',
    blockedUnavailable: 'غير متوفر — نفد من المخزون',
    blockedBack: 'العودة إلى السلة',
    items: (n: number) => `${n} قطع`,
  },
  en: {
    home: 'Home',
    cart: 'Cart',
    title: 'Checkout',
    empty: 'Your cart is empty',
    emptyDesc: 'Add pieces before checking out.',
    browse: 'Browse products',
    s1: 'Contact information',
    s2: 'Delivery address',
    s3: 'Delivery method',
    s4: 'Review your order',
    name: 'Full name',
    phone: 'Mobile phone number',
    email: 'Email address',
    country: 'Country',
    governorate: 'Governorate',
    governorateOther: 'Governorate / State',
    city: 'City / Area',
    street: 'Detailed street address',
    building: 'Building number',
    apartment: 'Apartment / Floor (optional)',
    instructions: 'Additional delivery instructions (optional)',
    summary: 'Order summary',
    subtotal: 'Subtotal',
    shipping: 'Shipping',
    shippingTbd: 'To be confirmed',
    total: 'Total',
    placeOrder: 'Place order',
    placingOrder: 'Placing order…',
    reviewNote: 'Review your details before confirming — cash on delivery.',
    submitError: 'Could not place the order — check your connection and try again.',
    errName: 'Enter your full name (2+ characters)',
    errPhone: 'Enter a valid phone number (9–15 digits)',
    errEmail: 'Enter a valid email address',
    errRequired: 'This field is required',
    blockedTitle: 'Checkout is blocked',
    blockedDesc: 'Some cart items are no longer purchasable — they were hidden from the storefront or ran out of stock. Remove them from the cart, then try again.',
    blockedHidden: 'Hidden — removed from the storefront',
    blockedUnavailable: 'Unavailable — out of stock',
    blockedBack: 'Back to cart',
    items: (n: number) => `${n} items`,
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,15}$/;

const inputCls =
  'w-full border border-taupe bg-white px-4 py-3 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy';
const labelCls = 'mb-1.5 block text-sm font-medium text-espresso';
const errCls = 'mt-1.5 text-xs text-burgundy';

interface FormFields {
  name: string;
  phone: string;
  email: string;
  country: string;
  governorate: string;
  city: string;
  street: string;
  building: string;
  apartment: string;
  instructions: string;
  method: string;
}

const initial: FormFields = {
  name: '',
  phone: '',
  email: '',
  country: 'EG',
  governorate: '',
  city: '',
  street: '',
  building: '',
  apartment: '',
  instructions: '',
  method: 'standard',
};

export function CheckoutPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const navigate = useNavigate();
  const cart = useCart();
  const [fields, setFields] = useState<FormFields>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  // Guards against a second submit in the same tick (double click / repeated
  // Enter) — React state alone can lag behind the event.
  const inFlight = useRef(false);
  // The id/ref of the order being placed. Kept across failed attempts so a
  // retry of the SAME order is idempotent (the database rejects the duplicate
  // id and saveOrder reports it as already created) instead of creating a
  // second order and a second confirmation email. Replaced when the order's
  // content changes.
  const identity = useRef<{ fingerprint: string; id: string; ref: string } | null>(null);
  const [submitError, setSubmitError] = useState(false);


  const catalog = useCatalog();
  const lines = resolveCartLines(cart.lines, catalog).filter((x) => x.name !== null);
  const hasBlocked = lines.some((x) => x.block !== null);
  const subtotal = useMemo(() => lines.reduce((n, x) => n + x.unitPrice * x.line.qty, 0), [lines]);

  const set = (key: keyof FormFields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const isEgypt = fields.country === 'EG';
  const governorateLabel = isEgypt ? t.governorate : t.governorateOther;

  const validate = (): Partial<Record<keyof FormFields, string>> => {
    const e: Partial<Record<keyof FormFields, string>> = {};
    if (fields.name.trim().length < 2) e.name = t.errName;
    if (!PHONE_RE.test(fields.phone.replace(/[\s-]/g, ''))) e.phone = t.errPhone;
    if (!EMAIL_RE.test(fields.email.trim())) e.email = t.errEmail;
    if (!fields.governorate.trim()) e.governorate = t.errRequired;
    if (!fields.city.trim()) e.city = t.errRequired;
    if (!fields.street.trim()) e.street = t.errRequired;
    if (!fields.building.trim()) e.building = t.errRequired;
    return e;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const firstKey = Object.keys(next)[0];
      document.getElementById(`co-${firstKey}`)?.focus();
      return;
    }
    // Final guard — revalidate every cart line against live catalog state
    // immediately before creating the order. A hidden or out-of-stock product
    // never reaches an order even if the customer bypassed the disabled CTA.
    if (lines.some((x) => x.block !== null)) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitError(false);
    setSubmitting(true);
    try {
      const orderLines = buildOrderLines(lines);
      const fingerprint = JSON.stringify([fields, orderLines, subtotal]);
      if (identity.current?.fingerprint !== fingerprint) {
        identity.current = { fingerprint, id: generateId(), ref: makeOrderRef() };
      }
      const order: GuestOrder = {
        id: identity.current.id,
        ref: identity.current.ref,
        createdAt: new Date().toISOString(),
        status: 'pending',
        contact: { name: fields.name.trim(), phone: fields.phone.trim(), email: fields.email.trim() },
        address: {
          country: fields.country,
          governorate: fields.governorate,
          city: fields.city.trim(),
          street: fields.street.trim(),
          building: fields.building.trim(),
          apartment: fields.apartment.trim(),
          instructions: fields.instructions.trim(),
        },
        delivery: { method: fields.method },
        lines: orderLines,
        subtotal,
        total: subtotal,
      };
      await saveOrder(order);
      cart.clear();
      navigate(navHref(locale, `/order-confirmation/${order.id}`));
    } catch {
      setSubmitError(true);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  // Mirrors FormField.tsx's pattern: aria-describedby links the input to its
  // own error text (announced once, when focus lands there via the
  // first-invalid-field focus() in submit()) rather than giving every error
  // its own role="alert", which would fire several simultaneous
  // announcements on one failed submit.
  const errId = (key: keyof FormFields) => `co-${key}-error`;
  const invalidProps = (key: keyof FormFields) =>
    errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': errId(key) } : {};
  const errFor = (key: keyof FormFields) =>
    errors[key] ? (
      <p id={errId(key)} className={errCls}>
        {errors[key]}
      </p>
    ) : null;

  const countryLabel = checkoutCountries.find((c) => c.code === fields.country)?.label[locale] ?? fields.country;
  const govLabel = isEgypt
    ? egyptGovernorates.find((g) => g.en === fields.governorate)?.[locale] ?? fields.governorate
    : fields.governorate;
  const methodLabel = deliveryMethods.find((m) => m.key === fields.method)?.label[locale] ?? fields.method;

  if (lines.length === 0) {
    return (
      <Container className="py-8 sm:py-12">
        <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />
        <div className="flex flex-col items-center gap-5 py-20 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-taupe text-espresso/50">
            <ShoppingBag className="size-7" aria-hidden />
          </span>
          <h1 className="font-display text-2xl text-espresso">{t.empty}</h1>
          <p className="max-w-sm text-sm text-espresso/60">{t.emptyDesc}</p>
          <Link
            to={navHref(locale, '/products')}
            className="rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.browse}
          </Link>
        </div>
      </Container>
    );
  }

  if (hasBlocked) {
    return (
      <Container className="py-8 sm:py-12">
        <Breadcrumb
          items={[
            { label: t.home, to: navHref(locale, '/') },
            { label: t.cart, to: navHref(locale, '/cart') },
            { label: t.title },
          ]}
        />
        <div className="flex flex-col items-center gap-5 py-20 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-burgundy/40 bg-burgundy/5 text-burgundy">
            <ShoppingBag className="size-7" aria-hidden />
          </span>
          <h1 className="font-display text-2xl text-espresso">{t.blockedTitle}</h1>
          <p className="max-w-md text-sm leading-relaxed text-espresso/60">{t.blockedDesc}</p>
          <ul className="w-full max-w-md space-y-2 text-start">
            {lines
              .filter((x) => x.block !== null)
              .map((r) => (
                <li
                  key={r.line.key}
                  className="flex items-center justify-between gap-3 border border-burgundy/30 bg-burgundy/5 px-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-espresso">{r.name?.[locale]}</span>
                  <span className="shrink-0 text-xs font-medium text-burgundy">
                    {r.block === 'hidden' ? t.blockedHidden : t.blockedUnavailable}
                  </span>
                </li>
              ))}
          </ul>
          <Link
            to={navHref(locale, '/cart')}
            className="mt-2 rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.blockedBack}
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb
        items={[
          { label: t.home, to: navHref(locale, '/') },
          { label: t.cart, to: navHref(locale, '/cart') },
          { label: t.title },
        ]}
      />
      <h1 className="mt-6 font-display text-3xl text-espresso sm:text-4xl">
        {locale === 'ar' ? (
          <>إتمام <span className="text-burgundy">الطلب</span></>
        ) : (
          <span className="text-burgundy">{t.title}</span>
        )}
      </h1>

      <form onSubmit={submit} noValidate className="mt-10 gap-12 lg:grid lg:grid-cols-[1fr_360px]">
        <div className="space-y-10">
          <section aria-labelledby="co-s1">
            <h2 id="co-s1" className="font-display text-xl text-espresso">
              <span className="me-2 text-gold">1.</span> {t.s1}
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="co-name" className={labelCls}>{t.name}</label>
                <input id="co-name" type="text" autoComplete="name" value={fields.name} onChange={set('name')} className={inputCls} {...invalidProps('name')} />
                {errFor('name')}
              </div>
              <div>
                <label htmlFor="co-phone" className={labelCls}>{t.phone}</label>
                <input id="co-phone" type="tel" dir="ltr" autoComplete="tel" value={fields.phone} onChange={set('phone')} className={inputCls} placeholder="+20 1XX XXX XXXX" {...invalidProps('phone')} />
                {errFor('phone')}
              </div>
              <div>
                <label htmlFor="co-email" className={labelCls}>{t.email}</label>
                <input id="co-email" type="email" dir="ltr" autoComplete="email" value={fields.email} onChange={set('email')} className={inputCls} {...invalidProps('email')} />
                {errFor('email')}
              </div>
            </div>
          </section>

          <section aria-labelledby="co-s2">
            <h2 id="co-s2" className="font-display text-xl text-espresso">
              <span className="me-2 text-gold">2.</span> {t.s2}
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="co-country" className={labelCls}>{t.country}</label>
                <select id="co-country" value={fields.country} onChange={set('country')} className={inputCls}>
                  {checkoutCountries.map((c) => (
                    <option key={c.code} value={c.code}>{c.label[locale]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="co-governorate" className={labelCls}>{governorateLabel}</label>
                {isEgypt ? (
                  <select id="co-governorate" value={fields.governorate} onChange={set('governorate')} className={inputCls} {...invalidProps('governorate')}>
                    <option value="">—</option>
                    {egyptGovernorates.map((g) => (
                      <option key={g.en} value={g.en}>{g[locale]}</option>
                    ))}
                  </select>
                ) : (
                  <input id="co-governorate" type="text" value={fields.governorate} onChange={set('governorate')} className={inputCls} {...invalidProps('governorate')} />
                )}
                {errFor('governorate')}
              </div>
              <div>
                <label htmlFor="co-city" className={labelCls}>{t.city}</label>
                <input id="co-city" type="text" autoComplete="address-level2" value={fields.city} onChange={set('city')} className={inputCls} {...invalidProps('city')} />
                {errFor('city')}
              </div>
              <div>
                <label htmlFor="co-building" className={labelCls}>{t.building}</label>
                <input id="co-building" type="text" value={fields.building} onChange={set('building')} className={inputCls} {...invalidProps('building')} />
                {errFor('building')}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="co-street" className={labelCls}>{t.street}</label>
                <input id="co-street" type="text" autoComplete="street-address" value={fields.street} onChange={set('street')} className={inputCls} {...invalidProps('street')} />
                {errFor('street')}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="co-apartment" className={labelCls}>{t.apartment}</label>
                <input id="co-apartment" type="text" value={fields.apartment} onChange={set('apartment')} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="co-instructions" className={labelCls}>{t.instructions}</label>
                <textarea id="co-instructions" rows={3} value={fields.instructions} onChange={set('instructions')} className={`${inputCls} resize-y`} />
              </div>
            </div>
          </section>

          <section aria-labelledby="co-s3">
            <h2 id="co-s3" className="font-display text-xl text-espresso">
              <span className="me-2 text-gold">3.</span> {t.s3}
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {deliveryMethods.map((m) => {
                const on = fields.method === m.key;
                return (
                  <label
                    key={m.key}
                    className={`flex cursor-pointer items-center gap-3 border px-4 py-3.5 transition ${
                      on ? 'border-burgundy bg-burgundy/5' : 'border-espresso/15 hover:border-espresso/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="delivery-method"
                      className="sr-only"
                      checked={on}
                      onChange={() => setFields((f) => ({ ...f, method: m.key }))}
                    />
                    <span
                      className={`size-4 shrink-0 rounded-full border ${on ? 'border-[5px] border-burgundy' : 'border-espresso/30'}`}
                      aria-hidden
                    />
                    <span>
                      <span className="block text-sm font-medium text-espresso">{m.label[locale]}</span>
                      <span className="block text-xs text-espresso/50">{m.note[locale]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="co-s4" className="border border-espresso/10 bg-white p-6">
            <h2 id="co-s4" className="font-display text-xl text-espresso">
              <span className="me-2 text-gold">4.</span> {t.s4}
            </h2>
            <dl className="mt-4 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="shrink-0 text-espresso/50">{t.name}:</dt><dd>{fields.name || '—'}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-espresso/50">{t.phone}:</dt><dd dir="ltr">{fields.phone || '—'}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-espresso/50">{t.email}:</dt><dd dir="ltr">{fields.email || '—'}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-espresso/50">{t.s2}:</dt><dd>{[countryLabel, govLabel, fields.city, fields.street, fields.building, fields.apartment].filter(Boolean).join('، ') || '—'}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-espresso/50">{t.s3}:</dt><dd>{methodLabel}</dd></div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-espresso/50">{t.reviewNote}</p>
            {/* One summary announcement per failed submit — the per-field
                aria-describedby errors are read when focus lands on the
                first invalid field (see submit()); this is the single
                additional live region, not one per field, to avoid several
                simultaneous screen-reader announcements. */}
            {Object.keys(errors).length > 0 && (
              <p role="status" aria-live="polite" className="mt-3 text-xs font-medium text-burgundy">
                {locale === 'ar'
                  ? 'يوجد أخطاء في البيانات المدخلة — يرجى مراجعتها أعلاه.'
                  : 'There are errors in the form — please review them above.'}
              </p>
            )}
            {submitError && (
              <p role="alert" className="mt-3 text-xs font-medium text-burgundy">
                {t.submitError}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="mt-5 w-full rounded-[27px] bg-burgundy px-8 py-3.5 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:pointer-events-none disabled:opacity-60 sm:w-auto sm:min-w-64"
            >
              {submitting ? t.placingOrder : t.placeOrder}
            </button>
          </section>
        </div>

        <aside className="mt-10 lg:mt-0">
          <div className="border border-espresso/10 bg-white p-6 lg:sticky lg:top-28">
            <h2 className="font-display text-xl text-espresso">{t.summary}</h2>
            <ul className="mt-5 max-h-72 space-y-4 overflow-y-auto">
              {lines.map((r) => {
                const opts = r.options
                  .map(([k, v]) => attributeValueLabel(k, v, locale))
                  .join(' · ');
                return (
                  <li key={r.line.key} className="flex gap-3">
                    <AssetImage src={r.image} alt={r.name?.[locale] ?? ''} className="size-14 shrink-0 object-cover" />
                    <div className="flex-1">
                      <p className="text-xs font-medium leading-5 text-espresso">{r.name?.[locale]}</p>
                      {opts && <p className="mt-0.5 text-[11px] text-espresso/50">{opts}</p>}
                      <p className="mt-0.5 text-[11px] text-espresso/50">×{r.line.qty}</p>
                    </div>
                    <p className="text-xs font-semibold text-espresso">{formatPrice(r.unitPrice * r.line.qty, locale)}</p>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-5 space-y-3 border-t border-espresso/10 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-espresso/60">{t.subtotal}</dt><dd className="font-medium">{formatPrice(subtotal, locale)}</dd></div>
              <div className="flex justify-between"><dt className="text-espresso/60">{t.shipping}</dt><dd className="text-espresso/50">{t.shippingTbd}</dd></div>
              <div className="flex justify-between border-t border-espresso/10 pt-3">
                <dt className="font-medium">{t.total}</dt>
                <dd className="font-display text-lg font-medium">{formatPrice(subtotal, locale)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </form>
    </Container>
  );
}
