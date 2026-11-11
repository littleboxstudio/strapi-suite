import { describe, it, expect } from 'vitest';
import { isValidEmailFormat } from '../../../../server/src/services/modules/ecommerce/domain/email';

describe('isValidEmailFormat', () => {
  it('accepts a plain address', () => expect(isValidEmailFormat('cliente@exemplo.pt')).toBe(true));
  it('rejects malformed values', () => {
    expect(isValidEmailFormat('sem-arroba')).toBe(false);
    expect(isValidEmailFormat('a@b')).toBe(false);
    expect(isValidEmailFormat('')).toBe(false);
  });
});
