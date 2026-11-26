import { describe, expect, it } from 'vitest';
import { mergeCarts } from '../../../../../server/src/services/modules/ecommerce/domain/accounts/cartMerge';
import { emptyCart, type StoredCart } from '../../../../../server/src/services/modules/ecommerce/storefrontSessions';

const cart = (over: Partial<StoredCart> = {}): StoredCart => ({ ...emptyCart(), ...over });

describe('mergeCarts', () => {
  it('sums the same variant and caps the quantity', () => {
    const account = cart({ lines: [{ variantId: 1, quantity: 6 }, { variantId: 2, quantity: 1 }] });
    const guest = cart({ lines: [{ variantId: 1, quantity: 7 }, { variantId: 3, quantity: 2 }] });
    expect(mergeCarts(account, guest, 10).lines).toEqual([
      { variantId: 1, quantity: 10 },
      { variantId: 2, quantity: 1 },
      { variantId: 3, quantity: 2 },
    ]);
  });

  it('unions the promotion codes keeping order', () => {
    const merged = mergeCarts(cart({ promotionCodes: ['A', 'B'] }), cart({ promotionCodes: ['B', 'C'] }), 10);
    expect(merged.promotionCodes).toEqual(['A', 'B', 'C']);
  });

  it('takes the guest destination, shipping method, gifts and locale when set', () => {
    const account = cart({
      destination: { country: 'PT' },
      shippingMethod: { providerId: 'p', serviceId: 's' },
      giftChoices: { '1': { variantId: 5 } as never },
      locale: 'pt',
    });
    const guest = cart({
      destination: { country: 'ES' },
      shippingMethod: { providerId: 'q', serviceId: 't' },
      giftChoices: { '2': { variantId: 6 } as never },
      locale: 'en',
    });
    const merged = mergeCarts(account, guest, 10);
    expect(merged.destination).toEqual({ country: 'ES' });
    expect(merged.shippingMethod).toEqual({ providerId: 'q', serviceId: 't' });
    expect(merged.giftChoices).toEqual({ '2': { variantId: 6 } });
    expect(merged.locale).toBe('en');
  });

  it('an empty guest cart keeps the account cart; the e-mail is always null', () => {
    const account = cart({
      lines: [{ variantId: 1, quantity: 2 }],
      destination: { country: 'PT' },
      locale: 'pt',
      email: 'a@x.pt',
    });
    const merged = mergeCarts(account, cart({ email: 'g@x.pt' }), 10);
    expect(merged).toEqual({ ...account, email: null });
  });
});
