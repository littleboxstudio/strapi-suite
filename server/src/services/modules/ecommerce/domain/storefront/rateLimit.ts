/**
 * In-memory fixed-window rate limiting for the storefront API (design 8 and 9.2).
 * Pure: no Strapi imports. Valid only with a single Strapi instance (documented).
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeEmail } from '../email';

export type RateRule = { limit: number; windowMs: number };

export type RateRuleName =
  | 'session.create'
  | 'catalog'
  | 'cart.quote'
  | 'discount.apply'
  | 'storeCredit.check'
  | 'email.send'
  | 'email.confirm'
  | 'order.create'
  | 'order.read';

export type RateRuleSet = { session?: RateRule; ip?: RateRule; email?: RateRule };

const MIN = 60_000;
const r = (limit: number, minutes: number): RateRule => ({ limit, windowMs: minutes * MIN });

export const STOREFRONT_RATE_RULES: Record<RateRuleName, RateRuleSet> = {
  'session.create': { ip: r(20, 60) },
  catalog: { ip: r(600, 1) },
  'cart.quote': { session: r(120, 10), ip: r(600, 10) },
  'discount.apply': { session: r(20, 10), ip: r(60, 60) },
  'storeCredit.check': { session: r(10, 10), ip: r(30, 60) },
  'email.send': { session: r(3, 15), ip: r(10, 60), email: r(5, 60) },
  'email.confirm': { session: r(10, 15), ip: r(30, 60), email: r(5, 60) },
  'order.create': { session: r(5, 10), ip: r(20, 60) },
  'order.read': { session: r(120, 10) },
};

export const DEFAULT_RATE_LIMIT_MAX_KEYS = 50_000;

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

export type RateLimiter = {
  hit(key: string, rule: RateRule): RateLimitResult;
  size(): number;
};

type Window = { count: number; resetAt: number };

const isIpKey = (key: string): boolean => key.includes(':ip:');

/**
 * Fixed window per key; a refused hit does not count. The map holds at most `maxKeys` keys:
 * when full, ended windows are swept first; if still full, the active IP keys with the oldest
 * `resetAt` go, and session / e-mail keys go only when no IP key is left, so a client with many
 * IPs cannot wipe the session and e-mail counters. Both evictions free a small batch (1% of
 * `maxKeys`), so a flood of new keys does not scan and sort the map on every request.
 */
export const createRateLimiter = (
  opts: { now?: () => number; maxKeys?: number } = {}
): RateLimiter => {
  const now = opts.now ?? Date.now;
  const maxKeys = Math.max(1, Math.floor(opts.maxKeys ?? DEFAULT_RATE_LIMIT_MAX_KEYS));
  const batch = Math.max(1, Math.floor(maxKeys / 100));
  const windows = new Map<string, Window>();

  const evictOldest = (keys: string[], count: number) => {
    if (count <= 0 || keys.length === 0) return;
    const sorted = keys
      .map((key) => ({ key, resetAt: windows.get(key)!.resetAt }))
      .sort((a, b) => a.resetAt - b.resetAt);
    for (const { key } of sorted.slice(0, count)) windows.delete(key);
  };

  const makeRoom = (t: number) => {
    if (windows.size < maxKeys) return;
    for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key);
    if (windows.size < maxKeys) return;
    const ipKeys: string[] = [];
    const otherKeys: string[] = [];
    for (const key of windows.keys()) (isIpKey(key) ? ipKeys : otherKeys).push(key);
    evictOldest(ipKeys, Math.max(windows.size - maxKeys + 1, batch));
    if (windows.size < maxKeys) return;
    evictOldest(otherKeys, Math.max(windows.size - maxKeys + 1, batch));
  };

  return {
    hit(key, rule) {
      const t = now();
      let w = windows.get(key);
      if (!w) {
        makeRoom(t);
        w = { count: 0, resetAt: t + rule.windowMs };
        windows.set(key, w);
      } else if (w.resetAt <= t) {
        w.count = 0;
        w.resetAt = t + rule.windowMs;
      }
      if (w.count >= rule.limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
      }
      w.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
    size: () => windows.size,
  };
};

/** IPv6 address as 8 numeric hextets (handles `::` and an embedded dotted IPv4). */
const ipv6Hextets = (ip: string): number[] => {
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (part: string | undefined) =>
    part ? part.split(':').map((h) => parseInt(h, 16)) : [];
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];
};

/**
 * The IP part of a limiter key: IPv4 as is; IPv4-mapped IPv6 as its IPv4; other IPv6 by its
 * /64 prefix (one client usually holds a whole /64). Null for anything that is not an IP.
 */
export const ipRateKeyPart = (ip: string | null): string | null => {
  if (typeof ip !== 'string') return null;
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  const h = ipv6Hextets(ip);
  if (h.length !== 8) return null;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.');
  }
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
};

/** Shared bucket for the rules that must stay limited when the BFF sends no valid client IP. */
const UNKNOWN_IP = 'unknown';
const RULES_WITH_UNKNOWN_IP_BUCKET: ReadonlySet<RateRuleName> = new Set(['session.create']);

const emailKeyPart = (email: string): string =>
  createHash('sha256').update(normalizeEmail(email)).digest('hex');

/**
 * The limiter keys of a rule for the known dimensions: `<rule>:s:<sessionId>`,
 * `<rule>:ip:<ip>` (see ipRateKeyPart) and `<rule>:e:<sha256(normalized e-mail)>` (never the
 * e-mail in clear). Without a valid client IP there is no IP key (the BFF's own IP must never
 * limit the whole store), except for `session.create`, which then counts in one shared
 * `ip:unknown` bucket, so a BFF that forgets the header cannot create unlimited sessions.
 *
 * Never log these keys: the e-mail part is an unsalted SHA-256 that links to a known address
 * (security logs carry only the rule name).
 */
export const rateKeys = (
  rule: RateRuleName,
  ctx: { sessionId: number | null; ip: string | null; email?: string | null }
): { key: string; rule: RateRule }[] => {
  const set = STOREFRONT_RATE_RULES[rule];
  const keys: { key: string; rule: RateRule }[] = [];
  if (set.session && ctx.sessionId !== null) {
    keys.push({ key: `${rule}:s:${ctx.sessionId}`, rule: set.session });
  }
  if (set.ip) {
    const ip = ipRateKeyPart(ctx.ip) ?? (RULES_WITH_UNKNOWN_IP_BUCKET.has(rule) ? UNKNOWN_IP : null);
    if (ip !== null) keys.push({ key: `${rule}:ip:${ip}`, rule: set.ip });
  }
  if (set.email && typeof ctx.email === 'string' && normalizeEmail(ctx.email) !== '') {
    keys.push({ key: `${rule}:e:${emailKeyPart(ctx.email)}`, rule: set.email });
  }
  return keys;
};
