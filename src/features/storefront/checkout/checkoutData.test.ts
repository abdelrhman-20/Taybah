import { describe, expect, it } from 'vitest';
import { checkoutCountries, deliveryMethods, egyptGovernorates } from './checkoutData';

// checkoutData.ts is static reference data consumed by CheckoutPage's
// country/governorate/delivery-method selects. There's no business logic to
// unit test here (validation itself lives in CheckoutPage's closures, not
// exported), so coverage focuses on the structural invariants the rest of
// the checkout flow actually depends on: unique selectable codes/keys,
// Egypt's governorate list being present and complete (CheckoutPage's
// `isEgypt` branch depends on exactly this), and that nothing here encodes
// any customer-account concept (guest-only checkout, decision #4/#5).

describe('checkoutCountries', () => {
  it('includes Egypt with the exact code CheckoutPage branches on', () => {
    expect(checkoutCountries.some((c) => c.code === 'EG')).toBe(true);
  });

  it('every country has a unique, non-empty code', () => {
    const codes = checkoutCountries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c.trim().length > 0)).toBe(true);
  });

  it('every country has a non-empty Arabic label — the only locale the UI renders', () => {
    expect(checkoutCountries.every((c) => c.label.ar.trim().length > 0)).toBe(true);
  });

  it('includes a non-Egypt fallback option for the free-text governorate path', () => {
    expect(checkoutCountries.some((c) => c.code !== 'EG')).toBe(true);
  });
});

describe('egyptGovernorates', () => {
  it('is non-empty and covers all 27 Egyptian governorates', () => {
    expect(egyptGovernorates.length).toBe(27);
  });

  it('every governorate has both an Arabic and an English label (en stays unused at runtime, Arabic-only UI)', () => {
    expect(egyptGovernorates.every((g) => g.ar.trim().length > 0 && g.en.trim().length > 0)).toBe(
      true,
    );
  });

  it('every governorate has a unique English key — CheckoutPage keys <option value> on it', () => {
    const keys = egyptGovernorates.map((g) => g.en);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('deliveryMethods', () => {
  it('every method has a unique key', () => {
    const keys = deliveryMethods.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every method has both a label and a note in Arabic', () => {
    expect(
      deliveryMethods.every((m) => m.label.ar.trim().length > 0 && m.note.ar.trim().length > 0),
    ).toBe(true);
  });

  it('includes the standard method CheckoutPage defaults to', () => {
    expect(deliveryMethods.some((m) => m.key === 'standard')).toBe(true);
  });
});

describe('no customer-account concepts leak into checkout data (decision #4/#5: guest-only)', () => {
  it('none of the checkout data objects carry an account/customer/profile identifier field', () => {
    const forbidden = ['customerId', 'accountId', 'userId', 'profileId'];
    const haystacks: object[] = [...checkoutCountries, ...egyptGovernorates, ...deliveryMethods];
    for (const obj of haystacks) {
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(obj, key)).toBe(false);
      }
    }
  });
});
