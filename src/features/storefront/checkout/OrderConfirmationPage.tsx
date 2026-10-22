import { AssetImage } from '../../shared/components/AssetImage';
import { Link, useParams } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import { Container } from '../../shared/components/Container';
import { Breadcrumb } from '../../shared/components/Breadcrumb';
import { NotFoundPage } from '../../shared/components/NotFoundPage';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { getOrderById } from './orderStore';
import { checkoutCountries, deliveryMethods, egyptGovernorates } from './checkoutData';
import { attributeValueLabel } from '../catalog/attributeStore';
import { formatPrice } from '../../shared/utils/format';
import { navHref } from '../layout/navData';

const copy = {
  ar: {
    home: 'الرئيسية',
    title: 'تم استلام طلبك',
    ref: 'مرجع الطلب',
    thanks: 'شكرًا لك — استلمنا طلبك وسنتواصل معك لتأكيد التفاصيل. الدفع عند الاستلام.',
    contact: 'بيانات التواصل',
    address: 'عنوان التوصيل',
    delivery: 'طريقة التوصيل',
    items: 'المنتجات',
    subtotal: 'الإجمالي الفرعي',
    total: 'الإجمالي',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    continue: 'متابعة التسوق',
    status: 'الحالة',
    pending: 'قيد المراجعة',
  },
  en: {
    home: 'Home',
    title: 'Order received',
    ref: 'Order reference',
    thanks: 'Thank you — your order is recorded and we will reach out to confirm the details. Cash on delivery.',
    contact: 'Contact details',
    address: 'Delivery address',
    delivery: 'Delivery method',
    items: 'Items',
    subtotal: 'Subtotal',
    total: 'Total',
    phone: 'Phone',
    email: 'Email',
    continue: 'Continue shopping',
    status: 'Status',
    pending: 'Pending review',
  },
};

export function OrderConfirmationPage() {
  const { orderId } = useParams();
  const locale = useStorefrontLocale();
  const t = copy[locale];
  const order = getOrderById(orderId);

  if (!order) return <NotFoundPage />;

  const countryLabel = checkoutCountries.find((c) => c.code === order.address.country)?.label[locale] ?? order.address.country;
  const govLabel =
    order.address.country === 'EG'
      ? egyptGovernorates.find((g) => g.en === order.address.governorate)?.[locale] ?? order.address.governorate
      : order.address.governorate;
  const methodLabel = deliveryMethods.find((m) => m.key === order.delivery.method)?.label[locale] ?? order.delivery.method;
  const addressLine = [
    countryLabel,
    govLabel,
    order.address.city,
    order.address.street,
    order.address.building,
    order.address.apartment,
  ]
    .filter(Boolean)
    .join(locale === 'ar' ? '، ' : ', ');

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumb items={[{ label: t.home, to: navHref(locale, '/') }, { label: t.title }]} />

      <div className="mt-10 flex flex-col items-center text-center">
        <CheckCircle2 className="size-14 text-burgundy" aria-hidden />
        <h1 className="mt-4 font-display text-3xl text-espresso sm:text-4xl">
          {locale === 'ar' ? (
            <>تم استلام <span className="text-burgundy">طلبك</span></>
          ) : (
            <><span className="text-burgundy">Order</span> received</>
          )}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-7 text-espresso/65">{t.thanks}</p>
        <p className="mt-4 bg-taupe/25 px-4 py-2 font-mono text-sm tracking-wider text-espresso" dir="ltr">
          {t.ref}: {order.ref}
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-3xl space-y-10">
        <section aria-labelledby="oc-details" className="grid gap-8 border border-espresso/10 bg-white p-6 sm:grid-cols-2">
          <div>
            <h2 id="oc-details" className="font-display text-lg text-espresso">{t.contact}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex gap-2"><dt className="text-espresso/50">{t.ref}:</dt><dd dir="ltr">{order.ref}</dd></div>
              <div className="flex gap-2"><dt className="text-espresso/50">{t.status}:</dt><dd>{t.pending}</dd></div>
              <div className="flex gap-2"><dt className="text-espresso/50">{t.phone}:</dt><dd dir="ltr">{order.contact.phone}</dd></div>
              <div className="flex gap-2"><dt className="text-espresso/50">{t.email}:</dt><dd dir="ltr">{order.contact.email}</dd></div>
            </dl>
          </div>
          <div>
            <h2 className="font-display text-lg text-espresso">{t.address}</h2>
            <p className="mt-3 text-sm leading-6 text-espresso/70">{addressLine}</p>
            {order.address.instructions && (
              <p className="mt-1 text-xs text-espresso/55">{order.address.instructions}</p>
            )}
            <p className="mt-3 text-sm text-espresso/70">
              <span className="text-espresso/50">{t.delivery}: </span>
              {methodLabel}
            </p>
          </div>
        </section>

        <section aria-labelledby="oc-items">
          <h2 id="oc-items" className="font-display text-lg text-espresso">{t.items}</h2>
          <ul className="mt-4 divide-y divide-espresso/10 border-y border-espresso/10">
            {order.lines.map((line, i) => {
              // Variant lines render the saved snapshot labels (locale-aware);
              // legacy lines keep the live color/size attribute lookup.
              const opts = line.variantId
                ? ((line.options ?? [])
                    .map((o) => `${o.axisLabel[locale]}: ${o.valueLabel[locale]}`)
                    .join(' · ') ||
                    (locale === 'ar' ? line.variantLabel : null))
                : [
                    attributeValueLabel('color', line.color, locale),
                    attributeValueLabel('size', line.size, locale),
                  ]
                    .filter(Boolean)
                    .join(' · ');
              return (
                <li key={`${line.productId}-${line.variantId ?? `${line.color}-${line.size}`}-${i}`} className="flex items-center gap-4 py-4">
                  <AssetImage src={line.image} alt={line.name[locale]} className="size-16 shrink-0 object-cover" />
                  <div className="flex-1">
                    <Link
                      to={navHref(locale, `/products/${line.slug}`)}
                      className="text-sm font-medium text-espresso transition hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                      {line.name[locale]}
                    </Link>
                    {opts && <p className="mt-0.5 text-xs text-espresso/55">{opts}</p>}
                    <p className="mt-0.5 text-xs text-espresso/55">×{line.qty}</p>
                  </div>
                  <p className="text-sm font-semibold text-espresso">
                    {formatPrice(line.price * line.qty, locale)}
                  </p>
                </li>
              );
            })}
          </ul>
          <dl className="mt-5 flex max-w-xs flex-col gap-2 text-sm ms-auto">
            <div className="flex justify-between">
              <dt className="text-espresso/60">{t.subtotal}</dt>
              <dd className="font-medium">{formatPrice(order.subtotal, locale)}</dd>
            </div>
            <div className="flex justify-between border-t border-espresso/10 pt-3">
              <dt className="font-medium">{t.total}</dt>
              <dd className="font-display text-lg font-medium">{formatPrice(order.total, locale)}</dd>
            </div>
          </dl>
        </section>

        <div className="text-center">
          <Link
            to={navHref(locale, '/products')}
            className="inline-block rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.continue}
          </Link>
        </div>
      </div>
    </Container>
  );
}
