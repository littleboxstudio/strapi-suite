export type AccountType = 'GUEST' | 'REGISTERED';

export type CustomerBadge =
  | 'guest'
  | 'registered'
  | 'emailVerified'
  | 'emailNotVerified'
  | 'blocked';

/** The header badges of a customer, in display order. A guest has no e-mail verification badge. */
export function customerBadges(c: {
  accountType?: AccountType;
  emailVerified?: boolean;
  blocked?: boolean;
}): CustomerBadge[] {
  const out: CustomerBadge[] = [];
  if (c.accountType === 'REGISTERED') {
    out.push('registered', c.emailVerified ? 'emailVerified' : 'emailNotVerified');
  } else {
    out.push('guest');
  }
  if (c.blocked) out.push('blocked');
  return out;
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type PasswordIssue = 'TOO_SHORT' | 'TOO_LONG' | 'EQUALS_EMAIL' | 'MISMATCH';

/**
 * The server's password policy (10-128 code points after NFC, not the e-mail) plus the two
 * fields matching. Returns the first failing code, or null.
 */
export function validateNewPassword(
  password: string,
  confirm: string,
  email?: string
): PasswordIssue | null {
  const normalised = password.normalize('NFC');
  const length = Array.from(normalised).length;
  if (length < PASSWORD_MIN) return 'TOO_SHORT';
  if (length > PASSWORD_MAX) return 'TOO_LONG';
  if (email && normalised.toLowerCase() === email.normalize('NFC').trim().toLowerCase()) {
    return 'EQUALS_EMAIL';
  }
  if (password !== confirm) return 'MISMATCH';
  return null;
}
