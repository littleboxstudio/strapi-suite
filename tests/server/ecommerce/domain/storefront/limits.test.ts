import { describe, it, expect } from 'vitest';
import * as limits from '../../../../../server/src/services/modules/ecommerce/domain/storefront/limits';

describe('storefront limits', () => {
  it('exports the shared bounds', () => {
    expect(limits).toMatchObject({
      MAX_CART_LINES: 100,
      MAX_LINE_QUANTITY: 1000,
      MAX_PROMOTION_CODES: 5,
      MAX_PROMOTION_CODE_LENGTH: 40,
      MAX_CART_GIFT_CHOICES: 10,
      MAX_STOREFRONT_IDEMPOTENCY_KEY_LENGTH: 150,
      MAX_EMAIL_LENGTH: 254,
      MAX_POSTAL_CODE_LENGTH: 20,
      MAX_LOCALE_LENGTH: 35,
      MAX_SHIPPING_ID_LENGTH: 100,
      MAX_STORE_CREDIT_CODE_LENGTH: 64,
    });
  });
});
