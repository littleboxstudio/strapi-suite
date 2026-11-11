/**
 * Storefront request helpers (pure).
 */
import { isIP } from 'node:net';

/**
 * Set by the BFF, which always overwrites it with the browser's IP. Only this header is
 * trusted for the client IP; other proxy headers are never read (any client can forge them).
 */
export const CLIENT_IP_HEADER = 'x-storefront-client-ip';

/** A single IPv4/IPv6 address, or null (lists, zone ids and anything else). */
export const clientIpFrom = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.includes('%') || value.includes(',')) return null;
  return isIP(value) !== 0 ? value : null;
};

const MAX_SEARCH_TERM = 100;

/** `LIKE` wildcards are not escaped portably, so `%`, `_` and `\` are dropped. */
export const sanitizeSearchTerm = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[%_\\]/g, '').trim().slice(0, MAX_SEARCH_TERM).trim();
};
