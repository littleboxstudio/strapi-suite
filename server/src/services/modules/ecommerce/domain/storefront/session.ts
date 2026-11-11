/**
 * Storefront session tokens and e-mail verification codes (pure, node:crypto only).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** base64url without padding: 43 characters for 32 bytes. */
export const generateSessionToken = (random: (n: number) => Buffer): string =>
  random(SESSION_TOKEN_BYTES).toString('base64url');

export const isWellFormedSessionToken = (raw: unknown): raw is string =>
  typeof raw === 'string' && SESSION_TOKEN_PATTERN.test(raw);

/** Only this hash is stored. */
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const sessionExpiry = (createdAt: Date, ttlHours: number): Date =>
  new Date(createdAt.getTime() + ttlHours * 3_600_000);

export const VERIFICATION_CODE_TTL_MS = 10 * 60_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;
const VERIFICATION_CODE_SPACE = 1_000_000;
const VERIFICATION_SECRET_LABEL = 'storefront-email-verification';

/** 6 digits with leading zeros; `randomInt(max)` must return an integer in [0, max). */
export const generateVerificationCode = (randomInt: (max: number) => number): string => {
  const n = randomInt(VERIFICATION_CODE_SPACE);
  if (!Number.isInteger(n) || n < 0 || n >= VERIFICATION_CODE_SPACE) {
    throw new Error('Invalid random value for a verification code');
  }
  return String(n).padStart(6, '0');
};

/**
 * Server secret for the code hashes, derived from LTB_ECOMMERCE_ENCRYPTION_KEY (the key that
 * encrypts the module credentials). Without a secret, the 10^6 codes of a leaked database
 * could be brute-forced offline.
 */
export const deriveVerificationSecret = (encryptionKey: string): Buffer => {
  if (typeof encryptionKey !== 'string' || encryptionKey === '') {
    throw new Error('Missing encryption key for e-mail verification');
  }
  return createHmac('sha256', encryptionKey).update(VERIFICATION_SECRET_LABEL).digest();
};

export const verificationCodeHash = (
  secret: Buffer,
  sessionId: number,
  emailNormalized: string,
  code: string
): string => createHmac('sha256', secret).update(`${sessionId}:${emailNormalized}:${code}`).digest('hex');

const HEX = /^[0-9a-f]+$/;

/** Constant-time comparison of two lowercase hex hashes; never throws. */
export const verificationCodeMatches = (expectedHex: string, actualHex: string): boolean => {
  if (typeof expectedHex !== 'string' || typeof actualHex !== 'string') return false;
  if (expectedHex.length === 0 || expectedHex.length !== actualHex.length) return false;
  if (expectedHex.length % 2 !== 0 || !HEX.test(expectedHex) || !HEX.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
};
