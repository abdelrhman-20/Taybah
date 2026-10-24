import { describe, expect, it } from 'vitest';
import { emptyContactFields, submitContactMessage, validateContact } from './contactForm';

const text = { name: 'اسم', email: 'بريد', message: 'رسالة' };
const valid = { ...emptyContactFields, name: 'منى', email: 'mona@example.com', message: 'أريد معرفة مقاسات هذه السجادة' };

describe('validateContact', () => {
  it('requires a name, a valid email and a message — phone and subject stay optional', () => {
    expect(validateContact(valid, text)).toEqual({});
    expect(validateContact(emptyContactFields, text)).toEqual({ name: 'اسم', email: 'بريد', message: 'رسالة' });
  });

  it('rejects malformed emails', () => {
    for (const bad of ['abc', 'a@b', 'a b@c.com', '@x.com', 'a@.com ']) {
      expect(validateContact({ ...valid, email: bad }, text).email, bad).toBe('بريد');
    }
    expect(validateContact({ ...valid, email: ' mona@example.com ' }, text).email).toBeUndefined();
  });

  it('enforces minimum lengths after trimming', () => {
    expect(validateContact({ ...valid, name: ' م ' }, text).name).toBe('اسم');
    expect(validateContact({ ...valid, message: '         x ' }, text).message).toBe('رسالة');
  });
});

describe('submitContactMessage', () => {
  it('never reports success while no delivery backend exists', async () => {
    const result = await submitContactMessage(valid);
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });
});
