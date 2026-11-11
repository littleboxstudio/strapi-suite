import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  SESSION_TOKEN_BYTES,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  deriveVerificationSecret,
  generateSessionToken,
  generateVerificationCode,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionExpiry,
  verificationCodeHash,
  verificationCodeMatches,
} from '../../../../../server/src/services/modules/ecommerce/domain/storefront/session';

describe('session tokens', () => {
  it('generates a 43-char base64url token from 32 bytes', () => {
    const sizes: number[] = [];
    const token = generateSessionToken((n) => {
      sizes.push(n);
      return Buffer.alloc(n, 0xab);
    });
    expect(SESSION_TOKEN_BYTES).toBe(32);
    expect(sizes).toEqual([32]);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).toBe(Buffer.alloc(32, 0xab).toString('base64url'));
    expect(isWellFormedSessionToken(token)).toBe(true);
    expect(hashSessionToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('known hash for fixed bytes', () => {
    const token = generateSessionToken((n) => Buffer.alloc(n, 0));
    expect(token).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(hashSessionToken(token)).toBe(createHash('sha256').update('A'.repeat(43)).digest('hex'));
  });

  it('rejects malformed tokens', () => {
    expect(isWellFormedSessionToken('abc')).toBe(false);
    expect(isWellFormedSessionToken('A'.repeat(44))).toBe(false);
    expect(isWellFormedSessionToken('A'.repeat(42) + '=')).toBe(false);
    expect(isWellFormedSessionToken(undefined)).toBe(false);
    expect(isWellFormedSessionToken(['A'.repeat(43)])).toBe(false);
  });

  it('computes the expiry', () => {
    expect(sessionExpiry(new Date('2026-01-01T00:00:00Z'), 48).toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});

describe('verification codes', () => {
  it('constants', () => {
    expect(VERIFICATION_CODE_TTL_MS).toBe(600_000);
    expect(VERIFICATION_MAX_ATTEMPTS).toBe(5);
  });

  it('6 digits with leading zeros', () => {
    const maxes: number[] = [];
    expect(
      generateVerificationCode((max) => {
        maxes.push(max);
        return 42;
      })
    ).toBe('000042');
    expect(maxes).toEqual([1_000_000]);
    expect(generateVerificationCode(() => 999_999)).toBe('999999');
  });

  it('refuses an out-of-range random value', () => {
    expect(() => generateVerificationCode(() => 1_000_000)).toThrow();
    expect(() => generateVerificationCode(() => -1)).toThrow();
  });

  it('derives the secret deterministically per key', () => {
    const a = deriveVerificationSecret('key-a');
    expect(a.equals(deriveVerificationSecret('key-a'))).toBe(true);
    expect(a.equals(deriveVerificationSecret('key-b'))).toBe(false);
    expect(a.equals(createHmac('sha256', 'key-a').update('storefront-email-verification').digest())).toBe(true);
    expect(() => deriveVerificationSecret('')).toThrow();
  });

  it('hashes with the secret (HMAC, not plain SHA-256)', () => {
    const secret = deriveVerificationSecret('key-a');
    const h = verificationCodeHash(secret, 12, 'ana@x.pt', '000042');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verificationCodeHash(secret, 12, 'ana@x.pt', '000042')).toBe(h);
    expect(verificationCodeHash(deriveVerificationSecret('key-b'), 12, 'ana@x.pt', '000042')).not.toBe(h);
    expect(h).not.toBe(createHash('sha256').update('12:ana@x.pt:000042').digest('hex'));
    expect(h).toBe(createHmac('sha256', secret).update('12:ana@x.pt:000042').digest('hex'));
    expect(verificationCodeHash(secret, 13, 'ana@x.pt', '000042')).not.toBe(h);
    expect(verificationCodeHash(secret, 12, 'ana@x.pt', '000043')).not.toBe(h);
  });

  it('compares in constant time without throwing', () => {
    const secret = deriveVerificationSecret('key-a');
    const h = verificationCodeHash(secret, 1, 'a@b.pt', '123456');
    const other = verificationCodeHash(secret, 1, 'a@b.pt', '123457');
    expect(verificationCodeMatches(h, h)).toBe(true);
    expect(verificationCodeMatches(h, h.toUpperCase())).toBe(false);
    expect(verificationCodeMatches(h, other)).toBe(false);
    expect(verificationCodeMatches(h, h.slice(0, 62))).toBe(false);
    expect(verificationCodeMatches(h, '')).toBe(false);
    expect(verificationCodeMatches('', '')).toBe(false);
    expect(verificationCodeMatches(h, 'zz' + h.slice(2))).toBe(false);
  });
});
