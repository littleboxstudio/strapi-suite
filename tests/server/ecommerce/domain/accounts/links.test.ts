import { describe, expect, it } from 'vitest';
import {
  buildAccountLink,
  maskEmail,
} from '../../../../../server/src/services/modules/ecommerce/domain/accounts/links';

describe('buildAccountLink', () => {
  it('joins without a double slash and encodes the token', () => {
    expect(buildAccountLink('https://shop.pt/', '/account/verify-email', 'a+b')).toBe(
      'https://shop.pt/account/verify-email?token=a%2Bb'
    );
    expect(buildAccountLink('https://shop.pt', 'account/verify-email', 'x_-y')).toBe(
      'https://shop.pt/account/verify-email?token=x_-y'
    );
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('filipe@x.pt')).toBe('f*****@x.pt');
    expect(maskEmail('a@x.pt')).toBe('a*@x.pt');
  });
  it('masks a value without a domain', () => {
    expect(maskEmail('nonsense')).toBe('n*******');
  });
});
