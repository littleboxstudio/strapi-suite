import { PLUGIN_ID } from '../config';

const BEARER = 'Bearer ';
const LAST_USED_EVERY_MS = 3_600_000;

/**
 * Stamps `lastUsedAt` like Strapi's own api-token strategy (which does not run on these
 * `auth: false` routes): when never set or at least an hour old. Best effort: never throws.
 */
export const touchLastUsedAt = async (strapi: any, token: { id: unknown; lastUsedAt?: unknown }): Promise<void> => {
  try {
    const last = token.lastUsedAt == null ? NaN : new Date(token.lastUsedAt as string).getTime();
    const now = new Date();
    if (!Number.isNaN(last) && now.getTime() - last < LAST_USED_EVERY_MS) return;
    await strapi.db.query('admin::api-token').update({ where: { id: token.id }, data: { lastUsedAt: now } });
  } catch {
    strapi?.log?.warn?.('[ecommerce] Could not update lastUsedAt of the storefront API token.');
  }
};

/**
 * Storefront API (BFF) authentication: only the Strapi API token generated in the e-commerce
 * settings (`storefrontApiTokenId`) passes. Any other token, including the read-only token the
 * other modules accept, an admin-kind token, an expired one, or no token configured → `false`
 * (403 from Strapi). It never reads `X-Storefront-Client-IP` nor counts anything: rate limiting
 * runs in the controller, after this check.
 */
export default async (policyContext: any, _config: unknown, { strapi }: { strapi: any }) => {
  const header = policyContext?.request?.header?.authorization;
  if (typeof header !== 'string' || !header.startsWith(BEARER)) return false;
  const raw = header.slice(BEARER.length);
  if (!raw) return false;

  const settings = await strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService').getStoreSettings();
  const chosen = settings?.storefrontApiTokenId;
  if (typeof chosen !== 'number' || !Number.isInteger(chosen)) return false;

  // Strapi looks tokens up by the HMAC of the raw value; the raw token is never compared.
  const apiTokens = strapi.service('admin::api-token');
  const token = await apiTokens.getByAccessKey(apiTokens.hash(raw));
  if (!token) return false;
  if (Number(token.id) !== chosen) return false;
  // Admin tokens share getByAccessKey and are refused.
  if (token.kind !== undefined && token.kind !== null && token.kind !== 'content-api') return false;
  if (token.expiresAt !== undefined && token.expiresAt !== null) {
    if (!(new Date(token.expiresAt).getTime() > Date.now())) return false;
  }
  // Not awaited: the request never waits for (nor fails on) this write.
  void touchLastUsedAt(strapi, token);
  return true;
};
