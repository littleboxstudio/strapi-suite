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
  if (credit.status === 'VOID') return { ok: false, code: 'STORE_CREDIT_VOID' };
  if (credit.emailNormalized !== email.trim().toLowerCase()) {
    return { ok: false, code: 'STORE_CREDIT_EMAIL_MISMATCH' };
  }
  if (credit.expiresAt && new Date(credit.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: 'STORE_CREDIT_EXPIRED' };
  }
  if (credit.balance <= 0) return { ok: false, code: 'STORE_CREDIT_EMPTY' };
  return { ok: true };
};
