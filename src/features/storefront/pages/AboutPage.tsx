import { AssetImage } from '../../shared/components/AssetImage';
import { Link } from 'react-router';
import { PageShell } from './PageShell';
import { useStorefrontLocale } from '../../shared/hooks/useStorefrontLocale';
import { navHref } from '../layout/navData';
import { placeholderImages } from '../home/homeContent';

const copy = {
  ar: {
    title: 'من نحن',
    intro: 'طيبة متجر متخصص في السجاد والموكيت والستائر والمفروشات وإكسسوارات المنزل.',
    storyH: 'قصتنا',
    story: [
      'بدأت طيبة من فكرة بسيطة: البيت يستحق قطعًا تحمل حكاية. اخترنا السجاد والمفروشات لأنها القطع التي تعيش مع العائلة — تلمسها الأقدام كل صباح وتجمع المجالس كل مساء.',
      'نعمل اليوم على جمع قطع تُنسج بحرفية أصيلة وتُقدَّم بروح معاصرة — من السجاد المعقود يدويًا إلى الستائر الكتانية المفصلة بعناية.',
    ],
    valuesH: 'قيمنا',
    values: [
      { h: 'الأصالة', p: 'نختار خامات وتقنيات تحترم الحرفة وتاريخها.' },
      { h: 'الجودة أولًا', p: 'كل قطعة تمر بفحص للخامة والنسج والتشطيب قبل عرضها.' },
      { h: 'الهدوء البصري', p: 'نفضّل القطع التي تجمّل البيت دون أن تزاحمه.' },
      { h: 'الشفافية', p: 'أسعار واضحة وأوصاف صادقة ومواصفات مكتوبة بدقة.' },
    ],
    diffH: 'ما يميز طيبة',
    diffs: [
      'تشكيلة مختارة بعناية بدلًا من كتالوج لا نهائي.',
      'دعم عربي أولًا — تجربة مصممة من البداية بالعربية وليست ترجمة.',
      'قطع بمقاسات وخامات موثّقة لتختار بثقة.',
    ],
    cta: 'تصفح المنتجات',
    note: 'محتوى تعريفي مؤقت — يُستكمل بقصة العلامة النهائية وأسماء الفريق لاحقًا.',
  },
  en: {
    title: 'About Us',
    intro: 'Taybah is a curated store for rugs, carpets, curtains, furnishings, and home accessories.',
    storyH: 'Our story',
    story: [
      'Taybah began with a simple idea: a home deserves pieces that carry a story. We chose rugs and furnishings because they are the pieces a family lives with — underfoot every morning, gathering everyone every evening.',
      'Today we curate pieces woven with authentic craft and presented with a contemporary spirit — from hand-knotted rugs to carefully tailored linen curtains.',
    ],
    valuesH: 'Our values',
    values: [
      { h: 'Authenticity', p: 'We choose materials and techniques that honor the craft and its history.' },
      { h: 'Quality first', p: 'Every piece passes material, weave, and finish checks before listing.' },
      { h: 'Visual calm', p: 'We favor pieces that beautify a home without crowding it.' },
      { h: 'Transparency', p: 'Clear prices, honest descriptions, precisely written specifications.' },
    ],
    diffH: 'What makes Taybah different',
    diffs: [
      'A curated selection instead of an endless catalog.',
      'Arabic-first support — the experience is designed in Arabic, not translated into it.',
      'Documented sizes and materials so you can choose with confidence.',
    ],
    cta: 'Browse products',
    note: 'Temporary introduction content — replaced by the final brand story and team details later.',
  },
};

export function AboutPage() {
  const locale = useStorefrontLocale();
  const t = copy[locale];

  const titleNode =
    locale === 'ar' ? (
      <>من <span className="text-burgundy">نحن</span></>
    ) : (
      <>About <span className="text-burgundy">Us</span></>
    );

  return (
    <PageShell title={t.title} titleNode={titleNode} intro={t.intro} notice={t.note}>
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <section aria-labelledby="about-story">
          <h2 id="about-story" className="font-display text-2xl text-espresso">{t.storyH}</h2>
          {t.story.map((p, i) => (
            <p key={i} className="mt-4 max-w-xl text-sm leading-7 text-espresso/70">{p}</p>
          ))}
        </section>
        <div className="overflow-hidden bg-taupe/30">
          <AssetImage
            src={placeholderImages.brand}
            alt={t.title}
            loading="lazy"
            className="aspect-[4/5] w-full object-cover lg:aspect-auto lg:h-full"
          />
        </div>
      </div>

      <section aria-labelledby="about-values" className="mt-14">
        <h2 id="about-values" className="font-display text-2xl text-espresso">{t.valuesH}</h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.values.map((v) => (
            <li key={v.h} className="border border-espresso/10 bg-white p-5">
              <h3 className="font-display text-lg text-burgundy">{v.h}</h3>
              <p className="mt-2 text-sm leading-6 text-espresso/65">{v.p}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-diff" className="mt-14">
        <h2 id="about-diff" className="font-display text-2xl text-espresso">{t.diffH}</h2>
        <ul className="mt-5 max-w-2xl space-y-3">
          {t.diffs.map((d) => (
            <li key={d} className="flex gap-3 text-sm leading-7 text-espresso/70">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
              {d}
            </li>
          ))}
        </ul>
        <Link
          to={navHref(locale, '/products')}
          className="mt-8 inline-block rounded-[27px] bg-burgundy px-8 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {t.cta}
        </Link>
      </section>
    </PageShell>
  );
}
