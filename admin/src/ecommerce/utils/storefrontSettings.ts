import type { StorefrontApiToken } from '../settingsTypes';

/** Where the storefront API is served (relative to the Strapi origin). */
export const storefrontBasePath = '/api/littlebox-strapi-suite/ecommerce/storefront';

export const TTL_MIN_HOURS = 1;
export const TTL_MAX_HOURS = 720;
const SOON_DAYS = 14;

export type TokenWarning = 'FULL_ACCESS' | 'READ_ONLY' | 'EXPIRES_SOON' | 'EXPIRED';

/** What is wrong with the chosen BFF token, if anything (most serious first). */
export function tokenWarning(
  token: Pick<StorefrontApiToken, 'type' | 'expiresAt'> | null,
  now: Date
): TokenWarning | null {
  if (!token) return null;
  if (token.expiresAt) {
    const at = new Date(token.expiresAt).getTime();
    if (!Number.isNaN(at)) {
      if (at <= now.getTime()) return 'EXPIRED';
      if (at - now.getTime() < SOON_DAYS * 86400000) return 'EXPIRES_SOON';
    }
  }
  if (token.type === 'full-access') return 'FULL_ACCESS';
  if (token.type === 'read-only') return 'READ_ONLY';
  return null;
}

/** Whole hours from 1 to 720. */
export function validateTtlHours(raw: string): number | 'invalid_number' {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return 'invalid_number';
  const value = Number(text);
  return value >= TTL_MIN_HOURS && value <= TTL_MAX_HOURS ? value : 'invalid_number';
}
