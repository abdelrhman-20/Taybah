import { useState, type FormEvent } from 'react';
import { AssetImage } from '../../shared/components/AssetImage';
import { Container } from '../../shared/components/Container';
import type { HomeContent } from './homeStore';

// No subscription backend exists yet (Taybah is frontend-only at this
// phase) — the form must never claim a successful subscription it can't
// actually fulfill. Submitting tells the customer that honestly instead of
// silently doing nothing, which previously looked like a broken button.
const UNAVAILABLE_MESSAGE =
  'الاشتراك في النشرة البريدية غير متاح حاليًا — يرجى المحاولة لاحقًا.';

export function NewsletterSection({ content }: { content: HomeContent['newsletter'] }) {
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section aria-labelledby="newsletter" className="relative isolate overflow-hidden bg-espresso py-7 sm:py-8">
      {content.image && (
        <AssetImage
          src={content.image}
          alt=""
          loading="lazy"
          className="absolute inset-0 -z-20 size-full object-cover"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-espresso/65" aria-hidden="true" />
      <Container className="max-w-3xl text-center text-white">
        {content.eyebrow && <p className="mb-1 text-[13px] font-medium text-gold">{content.eyebrow}</p>}
        <h2 id="newsletter" className="font-display text-2xl leading-snug sm:text-[1.9rem]">
          {content.title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-white/80 sm:text-sm">
          {content.body}
        </p>
        <form
          onSubmit={onSubmit}
          className="mx-auto mt-3 flex max-w-lg overflow-hidden rounded-full bg-white shadow-md focus-within:ring-2 focus-within:ring-gold"
        >
          <label htmlFor="newsletter-email" className="sr-only">
            {content.placeholder}
          </label>
          <input
            id="newsletter-email"
            type="email"
            required
            placeholder={content.placeholder}
            className="min-w-0 flex-1 bg-transparent px-5 py-2.5 text-sm text-espresso placeholder:text-espresso/45 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 bg-burgundy px-6 text-sm font-semibold text-white transition hover:bg-burgundy/90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
          >
            {content.submitLabel}
          </button>
        </form>
        {submitted && (
          <p role="status" aria-live="polite" className="mt-3 text-xs font-medium text-gold">
            {UNAVAILABLE_MESSAGE}
          </p>
        )}
        <p className="mt-2 text-xs text-white/60">{content.privacy}</p>
      </Container>
    </section>
  );
}
