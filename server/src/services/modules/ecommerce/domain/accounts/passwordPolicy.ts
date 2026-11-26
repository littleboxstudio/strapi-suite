export type PasswordPolicyResult = { ok: true } | { ok: false; reason: 'TOO_SHORT' | 'TOO_LONG' | 'EQUALS_EMAIL' };

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** 10-128 code points after NFC, and not equal to the e-mail (case-insensitive). */
export const checkPasswordPolicy = (password: unknown, email: string): PasswordPolicyResult => {
  if (typeof password !== 'string') return { ok: false, reason: 'TOO_SHORT' };
  const normalized = password.normalize('NFC');
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN) return { ok: false, reason: 'TOO_SHORT' };
  if (length > PASSWORD_MAX) return { ok: false, reason: 'TOO_LONG' };
  if (normalized.trim().toLowerCase() === String(email ?? '').trim().toLowerCase()) {
    return { ok: false, reason: 'EQUALS_EMAIL' };
  }
  return { ok: true };
};
