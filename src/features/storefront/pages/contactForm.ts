// Contact form logic: validation and the submission seam.

export interface ContactFields {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

export const emptyContactFields: ContactFields = { name: '', email: '', phone: '', subject: '', message: '' };

export type ContactErrors = Partial<Record<'name' | 'email' | 'message', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactErrorText {
  name: string;
  email: string;
  message: string;
}

// Required: name (2+ chars), a valid email, and a message (10+ chars).
// Phone and subject are optional.
export function validateContact(f: ContactFields, text: ContactErrorText): ContactErrors {
  const errors: ContactErrors = {};
  if (f.name.trim().length < 2) errors.name = text.name;
  if (!EMAIL_RE.test(f.email.trim())) errors.email = text.email;
  if (f.message.trim().length < 10) errors.message = text.message;
  return errors;
}

export type SubmitResult = { ok: true } | { ok: false; reason: 'unavailable' | 'network' };

// There is no message-delivery backend yet: the only Edge Function in the
// project (send-order-status-email) sends order-status emails, not contact
// messages. This function therefore never reports success — it returns
// `unavailable`, the page shows that honestly and keeps the customer's text.
//
// To go live, replace the body with a call to a real endpoint (for example a
// new Supabase Edge Function that emails the support inbox) and return
// `{ ok: true }` only on a confirmed 2xx, `{ ok: false, reason: 'network' }`
// on failure. Never put service-role or email-provider keys in the browser.
export async function submitContactMessage(_message: ContactFields): Promise<SubmitResult> {
  void _message;
  return { ok: false, reason: 'unavailable' };
}
