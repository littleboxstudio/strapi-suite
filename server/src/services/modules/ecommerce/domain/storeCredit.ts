import { normalizeEmail } from './email';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** XXXX-XXXX-XXXX from 12 random bytes; the alphabet has 32 chars so `% 32` is unbiased. */
export const generateStoreCreditCode = (random: (n: number) => Buffer): string => {
  const bytes = random(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
};

export type StoreCreditUsability =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'STORE_CREDIT_NOT_FOUND'
        | 'STORE_CREDIT_EXPIRED'
        | 'STORE_CREDIT_EMAIL_MISMATCH'
        | 'STORE_CREDIT_EMPTY'
        | 'STORE_CREDIT_VOID';
    };

export const storeCreditUsable = (
  credit: { status: string; balance: number; expiresAt: string | Date | null; emailNormalized: string },
  email: string,
  now: Date
): StoreCreditUsability => {
  // Email first, so a wrong email never reveals the credit's state.
  if (credit.emailNormalized !== normalizeEmail(email)) {
    return { ok: false, code: 'STORE_CREDIT_EMAIL_MISMATCH' };
  }
  if (credit.status === 'VOID') return { ok: false, code: 'STORE_CREDIT_VOID' };
  if (credit.expiresAt && new Date(credit.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: 'STORE_CREDIT_EXPIRED' };
  }
  if (credit.balance <= 0) return { ok: false, code: 'STORE_CREDIT_EMPTY' };
  return { ok: true };
};

/** Public (storefront) callers must not learn that a code exists for another email. */
export const toPublicStoreCreditError = <C extends string>(code: C): C | 'STORE_CREDIT_NOT_FOUND' =>
  code === 'STORE_CREDIT_EMAIL_MISMATCH' ? 'STORE_CREDIT_NOT_FOUND' : code;
