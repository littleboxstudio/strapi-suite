import type { StorefrontApiToken } from '../settingsTypes';

/** Where the storefront API is served (relative to the Strapi origin). */
export const storefrontBasePath = '/api/littlebox-strapi-suite/ecommerce/storefront';

export const TTL_MIN_HOURS = 1;
export const TTL_MAX_HOURS = 720;
const SOON_DAYS = 14;

export type TokenWarning = 'FULL_ACCESS' | 'READ_ONLY' | 'EXPIRES_SOON' | 'EXPIRED';

/** Everything wrong with the chosen BFF token (expiry first, then access type). */
export function tokenWarnings(
  token: Pick<StorefrontApiToken, 'type' | 'expiresAt'> | null,
  now: Date
): TokenWarning[] {
  if (!token) return [];
  const list: TokenWarning[] = [];
  if (token.expiresAt) {
    const at = new Date(token.expiresAt).getTime();
    if (!Number.isNaN(at)) {
      if (at <= now.getTime()) list.push('EXPIRED');
      else if (at - now.getTime() < SOON_DAYS * 86400000) list.push('EXPIRES_SOON');
    }
  }
  if (token.type === 'full-access') list.push('FULL_ACCESS');
  if (token.type === 'read-only') list.push('READ_ONLY');
  return list;
}

/** The most serious warning, or null. */
export function tokenWarning(
  token: Pick<StorefrontApiToken, 'type' | 'expiresAt'> | null,
  now: Date
): TokenWarning | null {
  return tokenWarnings(token, now)[0] ?? null;
}

/** The saved token id is not among the tokens the admin can see. */
export function isTokenMissing(tokenId: number | null, tokens: Pick<StorefrontApiToken, 'id'>[]): boolean {
  return tokenId !== null && !tokens.some((t) => t.id === tokenId);
}

/** Whole hours from 1 to 720. */
export function validateTtlHours(raw: string): number | 'invalid_number' {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return 'invalid_number';
  const value = Number(text);
  return value >= TTL_MIN_HOURS && value <= TTL_MAX_HOURS ? value : 'invalid_number';
}
