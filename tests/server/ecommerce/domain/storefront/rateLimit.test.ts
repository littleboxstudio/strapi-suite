import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createRateLimiter,
  rateKeys,
  STOREFRONT_RATE_RULES,
} from '../../../../../server/src/services/modules/ecommerce/domain/storefront/rateLimit';

const MIN = 60_000;

describe('STOREFRONT_RATE_RULES', () => {
  it('has the brief values', () => {
    expect(STOREFRONT_RATE_RULES).toEqual({
      'session.create': { ip: { limit: 20, windowMs: 60 * MIN } },
      catalog: { ip: { limit: 600, windowMs: MIN } },
      'cart.quote': { session: { limit: 120, windowMs: 10 * MIN }, ip: { limit: 600, windowMs: 10 * MIN } },
      'discount.apply': { session: { limit: 20, windowMs: 10 * MIN }, ip: { limit: 60, windowMs: 60 * MIN } },
      'storeCredit.check': { session: { limit: 10, windowMs: 10 * MIN }, ip: { limit: 30, windowMs: 60 * MIN } },
      'email.send': {
        session: { limit: 3, windowMs: 15 * MIN },
        ip: { limit: 10, windowMs: 60 * MIN },
        email: { limit: 5, windowMs: 60 * MIN },
      },
      'email.confirm': {
        session: { limit: 10, windowMs: 15 * MIN },
        ip: { limit: 30, windowMs: 60 * MIN },
        email: { limit: 5, windowMs: 60 * MIN },
      },
      'order.create': { session: { limit: 5, windowMs: 10 * MIN }, ip: { limit: 20, windowMs: 60 * MIN } },
      'order.read': { session: { limit: 120, windowMs: 10 * MIN } },
    });
  });
});

describe('rateKeys', () => {
  it('has no key without a client IP (catalog)', () => {
    expect(rateKeys('catalog', { sessionId: null, ip: null })).toEqual([]);
  });

  it('keys the client IP when known', () => {
    expect(rateKeys('catalog', { sessionId: 7, ip: '203.0.113.7' })).toEqual([
      { key: 'catalog:ip:203.0.113.7', rule: { limit: 600, windowMs: MIN } },
    ]);
  });

  it('keys session and hashed e-mail, never the e-mail in clear', () => {
    const keys = rateKeys('email.send', { sessionId: 1, ip: null, email: ' Ana@X.pt ' });
    const hash = createHash('sha256').update('ana@x.pt').digest('hex');
    expect(keys.map((k) => k.key)).toEqual(['email.send:s:1', `email.send:e:${hash}`]);
    expect(JSON.stringify(keys)).not.toMatch(/ana@x\.pt/i);
  });

  it('normalises IPv4-mapped IPv6 to IPv4 and keys IPv6 by its /64 prefix', () => {
    const key = (ip: string) => rateKeys('catalog', { sessionId: null, ip })[0].key;
    expect(key('::ffff:203.0.113.7')).toBe('catalog:ip:203.0.113.7');
    expect(key('::FFFF:cb00:7107')).toBe('catalog:ip:203.0.113.7');
    expect(key('2001:db8:1:2:3:4:5:6')).toBe('catalog:ip:2001:db8:1:2::/64');
    expect(key('2001:0DB8:0001:0002::9')).toBe('catalog:ip:2001:db8:1:2::/64');
    expect(key('2001:db8::1')).toBe('catalog:ip:2001:db8:0:0::/64');
    expect(key('::1')).toBe('catalog:ip:0:0:0:0::/64');
    expect(key('2001:db8:1:3::1')).not.toBe(key('2001:db8:1:2::1'));
  });

  it('session.create without a valid client IP uses one shared unknown bucket', () => {
    expect(rateKeys('session.create', { sessionId: null, ip: null })).toEqual([
      { key: 'session.create:ip:unknown', rule: { limit: 20, windowMs: 60 * MIN } },
    ]);
    expect(rateKeys('session.create', { sessionId: null, ip: 'not-an-ip' })[0].key).toBe('session.create:ip:unknown');
    // the other rules keep "no IP → no IP key" (Review Focus 5)
    expect(rateKeys('catalog', { sessionId: null, ip: 'not-an-ip' })).toEqual([]);
    expect(rateKeys('cart.quote', { sessionId: 4, ip: null }).map((k) => k.key)).toEqual(['cart.quote:s:4']);
  });

  it('skips an empty e-mail and dimensions the rule does not define', () => {
    expect(rateKeys('order.read', { sessionId: 3, ip: '203.0.113.7', email: 'a@b.pt' }).map((k) => k.key)).toEqual([
      'order.read:s:3',
    ]);
    expect(rateKeys('email.send', { sessionId: null, ip: null, email: '  ' })).toEqual([]);
  });
});

describe('createRateLimiter', () => {
  it('catalog per IP: 600 allowed, the 601st refused until the window ends (Review Focus 5)', () => {
    let t = 1_000_000;
    const limiter = createRateLimiter({ now: () => t });
    const [{ key, rule }] = rateKeys('catalog', { sessionId: null, ip: '203.0.113.7' });
    for (let i = 0; i < 600; i++) expect(limiter.hit(key, rule).allowed).toBe(true);
    const refused = limiter.hit(key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.retryAfterSec).toBe(60);
    t += 59_500;
    expect(limiter.hit(key, rule)).toEqual({ allowed: false, retryAfterSec: 1 });
    t += 500;
    expect(limiter.hit(key, rule).allowed).toBe(true);
  });

  it('refused hits do not count', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t });
    const rule = { limit: 2, windowMs: 10_000 };
    limiter.hit('k:s:1', rule);
    limiter.hit('k:s:1', rule);
    for (let i = 0; i < 50; i++) expect(limiter.hit('k:s:1', rule).allowed).toBe(false);
    t = 10_000;
    expect(limiter.hit('k:s:1', rule).allowed).toBe(true);
    expect(limiter.hit('k:s:1', rule).allowed).toBe(true);
    expect(limiter.hit('k:s:1', rule).allowed).toBe(false);
  });

  it('email.send per e-mail refuses the 6th in 60 min across sessions', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t });
    const results: boolean[] = [];
    for (let s = 1; s <= 6; s++) {
      const keys = rateKeys('email.send', { sessionId: s, ip: null, email: 'ana@x.pt' });
      const emailKey = keys.find((k) => k.key.includes(':e:'))!;
      results.push(limiter.hit(emailKey.key, emailKey.rule).allowed);
      t += 5 * MIN;
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('stays within maxKeys', () => {
    const limiter = createRateLimiter({ now: () => 0, maxKeys: 3 });
    const rule = { limit: 5, windowMs: 1000 };
    for (const k of ['a:ip:1', 'a:ip:2', 'a:ip:3', 'a:ip:4']) limiter.hit(k, rule);
    expect(limiter.size()).toBeLessThanOrEqual(3);
  });

  it('evicts ended windows first', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, maxKeys: 3 });
    limiter.hit('a:ip:short', { limit: 1, windowMs: 1000 });
    t = 100;
    limiter.hit('a:ip:old', { limit: 1, windowMs: 5000 });
    limiter.hit('a:ip:new', { limit: 1, windowMs: 6000 });
    t = 2000; // 'short' has ended
    limiter.hit('a:ip:extra', { limit: 1, windowMs: 6000 });
    expect(limiter.size()).toBe(3);
    // 'old' survived: still refused
    expect(limiter.hit('a:ip:old', { limit: 1, windowMs: 5000 }).allowed).toBe(false);
    expect(limiter.hit('a:ip:new', { limit: 1, windowMs: 6000 }).allowed).toBe(false);
  });

  it('then evicts the active IP key with the oldest resetAt; session and e-mail keys survive', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, maxKeys: 3 });
    const one = (windowMs: number) => ({ limit: 1, windowMs });
    limiter.hit('r:s:1', one(1000)); // oldest resetAt of all, but a session key
    limiter.hit('r:e:abc', one(1500)); // e-mail key
    limiter.hit('r:ip:1', one(5000));
    t = 10;
    limiter.hit('r:ip:2', one(5000)); // evicts r:ip:1 (only IP key)
    expect(limiter.size()).toBe(3);
    t = 20;
    limiter.hit('r:ip:3', one(5000)); // evicts r:ip:2
    expect(limiter.hit('r:s:1', one(1000)).allowed).toBe(false);
    expect(limiter.hit('r:e:abc', one(1500)).allowed).toBe(false);
    expect(limiter.hit('r:ip:3', one(5000)).allowed).toBe(false);
    expect(limiter.size()).toBe(3);
  });

  it('evicts the oldest IP key first among several', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, maxKeys: 3 });
    const one = (windowMs: number) => ({ limit: 1, windowMs });
    limiter.hit('r:ip:late', one(9000));
    limiter.hit('r:ip:early', one(2000));
    limiter.hit('r:s:1', one(1000));
    t = 1;
    limiter.hit('r:ip:new', one(9000)); // evicts r:ip:early
    expect(limiter.hit('r:ip:late', one(9000)).allowed).toBe(false);
    expect(limiter.hit('r:s:1', one(1000)).allowed).toBe(false);
    expect(limiter.size()).toBe(3);
  });

  it('evicts session / e-mail keys in a batch too (no sort per insertion)', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, maxKeys: 1000 });
    const one = { limit: 1, windowMs: 10_000 };
    for (let i = 0; i < 1000; i++) limiter.hit(`r:s:${i}`, one);
    expect(limiter.size()).toBe(1000);
    t = 1;
    limiter.hit('r:s:new0', one);
    // 1% batch (10 keys) freed at once, then the next 9 new keys need no eviction
    expect(limiter.size()).toBe(991);
    for (let i = 1; i < 10; i++) limiter.hit(`r:s:new${i}`, one);
    expect(limiter.size()).toBe(1000);
    // the oldest went first
    expect(limiter.hit('r:s:0', one).allowed).toBe(true);
    expect(limiter.hit('r:s:999', one).allowed).toBe(false);
  });

  it('evicts session / e-mail keys only when no IP key is left', () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, maxKeys: 2 });
    const one = (windowMs: number) => ({ limit: 1, windowMs });
    limiter.hit('r:e:x', one(3000));
    limiter.hit('r:s:1', one(2000));
    t = 1;
    limiter.hit('r:s:2', one(5000)); // evicts r:s:1 (oldest resetAt)
    expect(limiter.size()).toBe(2);
    expect(limiter.hit('r:e:x', one(3000)).allowed).toBe(false);
    expect(limiter.hit('r:s:2', one(5000)).allowed).toBe(false);
  });
});
