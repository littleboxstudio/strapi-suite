import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from '../../../../../server/src/services/modules/ecommerce/domain/accounts/passwordPolicy';

describe('checkPasswordPolicy', () => {
  it('enforces length bounds', () => {
    expect(checkPasswordPolicy('a'.repeat(9), 'x@y.com')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(checkPasswordPolicy('a'.repeat(10), 'x@y.com')).toEqual({ ok: true });
    expect(checkPasswordPolicy('a'.repeat(128), 'x@y.com')).toEqual({ ok: true });
    expect(checkPasswordPolicy('a'.repeat(129), 'x@y.com')).toEqual({ ok: false, reason: 'TOO_LONG' });
  });
  it('treats non-strings as too short', () => {
    expect(checkPasswordPolicy(undefined, 'x@y.com')).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });
  it('counts composed and decomposed characters equally after NFC', () => {
    const composed = 'é'.repeat(10);
    const decomposed = 'é'.repeat(10);
    expect(checkPasswordPolicy(composed, 'x@y.com')).toEqual({ ok: true });
    expect(checkPasswordPolicy(decomposed, 'x@y.com')).toEqual({ ok: true });
    expect(checkPasswordPolicy('é'.repeat(9), 'x@y.com')).toEqual({ ok: false, reason: 'TOO_SHORT' });
  });
  it('rejects the e-mail in any case', () => {
    expect(checkPasswordPolicy('Foo@Bar.com', 'foo@bar.COM')).toEqual({ ok: false, reason: 'EQUALS_EMAIL' });
  });
  it('compares the e-mail after NFC too', () => {
    expect(checkPasswordPolicy('caf\u00e9@x.com', 'cafe\u0301@x.com')).toEqual({ ok: false, reason: 'EQUALS_EMAIL' });
  });
});
