import { describe, expect, it } from 'vitest';
import { maskEmail } from '../../../../../server/src/services/modules/ecommerce/domain/accounts/links';

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('filipe@x.pt')).toBe('f*****@x.pt');
    expect(maskEmail('a@x.pt')).toBe('a*@x.pt');
  });
  it('masks a value without a domain', () => {
    expect(maskEmail('nonsense')).toBe('n*******');
  });
});
