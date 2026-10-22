import { useState, type FormEvent } from 'react';
import { Button } from '../../shared/components/Button';
import { Container } from '../../shared/components/Container';
import { OrnamentDivider } from '../../shared/components/OrnamentDivider';
import { emphasizeLastWord } from '../../shared/utils/emphasize';
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
    <section aria-labelledby="newsletter" className="border-t border-taupe/60 py-16 sm:py-24">
      <Container className="max-w-2xl text-center">
        <p className="mb-4 text-[14px] font-semibold tracking-[0.3em] text-burgundy uppercase">
          {content.eyebrow}
        </p>
        <h2 id="newsletter" className="font-display text-3xl text-espresso sm:text-4xl">
          {emphasizeLastWord(content.title)}
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-espresso/65">
          {content.body}
        </p>
        <OrnamentDivider align="center" className="mt-6" />
        <form
          onSubmit={onSubmit}
          className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
        >
          <label htmlFor="newsletter-email" className="sr-only">
            {content.placeholder}
          </label>
          <input
            id="newsletter-email"
            type="email"
            required
            placeholder={content.placeholder}
            className="w-full flex-1 rounded-sm border border-taupe bg-white px-4 py-3 text-sm text-espresso placeholder:text-espresso/40 focus:border-burgundy focus:outline-1 focus:outline-burgundy"
          />
          <Button type="submit" size="lg" className="shrink-0">
            {content.submitLabel}
          </Button>
        </form>
        {submitted && (
          <p role="status" aria-live="polite" className="mt-3 text-xs font-medium text-burgundy">
            {UNAVAILABLE_MESSAGE}
          </p>
        )}
        <p className="mt-4 text-xs text-espresso/45">{content.privacy}</p>
      </Container>
    </section>
  );
}
