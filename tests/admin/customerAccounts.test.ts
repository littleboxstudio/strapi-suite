import { describe, it, expect } from 'vitest';
import {
  customerBadges,
  validateNewPassword,
} from '../../admin/src/ecommerce/utils/customerAccounts';

describe('customerBadges', () => {
  it('lists the account type, e-mail verification and blocked state', () => {
    expect(
      customerBadges({ accountType: 'REGISTERED', emailVerified: false, blocked: true })
    ).toEqual(['registered', 'emailNotVerified', 'blocked']);
  });
  it('a verified registered customer is not blocked', () => {
    expect(
      customerBadges({ accountType: 'REGISTERED', emailVerified: true, blocked: false })
    ).toEqual(['registered', 'emailVerified']);
  });
  it('a guest has no verification badge', () => {
    expect(
      customerBadges({ accountType: 'GUEST', emailVerified: false, blocked: false })
    ).toEqual(['guest']);
  });
});

describe('validateNewPassword', () => {
  it('too short', () => expect(validateNewPassword('short', 'short')).toBe('TOO_SHORT'));
  it('too long, counted in code points', () => {
    expect(validateNewPassword('a'.repeat(129), 'a'.repeat(129))).toBe('TOO_LONG');
    expect(validateNewPassword('😀'.repeat(128), '😀'.repeat(128))).toBeNull();
  });
  it('mismatch', () => expect(validateNewPassword('longenough1', 'other')).toBe('MISMATCH'));
  it('equals the e-mail, case-insensitive', () => {
    expect(
      validateNewPassword('Foo@Bar.com', 'Foo@Bar.com', ' foo@bar.COM ')
    ).toBe('EQUALS_EMAIL');
  });
  it('accepts a valid matching password', () =>
    expect(validateNewPassword('longenough1', 'longenough1', 'a@b.com')).toBeNull());
});
