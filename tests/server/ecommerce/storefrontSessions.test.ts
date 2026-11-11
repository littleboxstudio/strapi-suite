import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { setupCommerce, createOrder, UIDS, type Commerce } from './helpers/commerceSetup';
import {
  EMPTY_CART,
  emptyCart,
} from '../../../server/src/services/modules/ecommerce/storefrontSessions';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const HOUR = 3_600_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const svc = (c: Commerce) => c.services.EcommerceStorefrontSessionService;
const sessions = (c: Commerce) => c.tables[UIDS.checkoutSession];

/** Inserts an ACTIVE session expired 2 h ago (past the 1 h purge grace) directly. */
const addExpired = async (c: Commerce, i: number, extra: Record<string, unknown> = {}) =>
  c.strapi.db.query(UIDS.checkoutSession).create({
    data: {
      tokenHash: sha(`expired-${i}`),
      status: 'ACTIVE',
      expiresAt: new Date(NOW.getTime() - 2 * HOUR - i),
      cart: { ...emptyCart(), email: `p${i}@example.pt` },
      emailVerification: { codeHash: 'abc' },
      verifiedEmail: `p${i}@example.pt`,
      verificationAttempts: 2,
      ...extra,
    },
  });

describe('EcommerceStorefrontSessionService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('open', () => {
    it('creates a session, returns the token once and stores only its SHA-256', async () => {
      const c = setupCommerce();
      const r = await svc(c).open(null);
      expect(r.reused).toBe(false);
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(r.expiresAt).toBe(new Date(NOW.getTime() + 168 * HOUR).toISOString());
      expect(sessions(c)).toHaveLength(1);
      const row = sessions(c)[0];
      expect(row.tokenHash).toBe(sha(r.token));
      expect(JSON.stringify(row)).not.toContain(r.token);
      expect(row).toMatchObject({
        status: 'ACTIVE',
        cart: EMPTY_CART,
        emailVerification: {},
        verificationAttempts: 0,
      });
      expect(typeof row.cart).toBe('object');
    });

    it('uses checkoutSessionTtlHours from the settings', async () => {
      const c = setupCommerce({ checkoutSessionTtlHours: 2 });
      const r = await svc(c).open(null);
      expect(r.expiresAt).toBe(new Date(NOW.getTime() + 2 * HOUR).toISOString());
    });

    it('reuses a valid current token without creating a row', async () => {
      const c = setupCommerce();
      const first = await svc(c).open(null);
      const again = await svc(c).open(first.token);
      expect(again).toEqual({ token: null, expiresAt: first.expiresAt, reused: true });
      expect(sessions(c)).toHaveLength(1);
    });

    it('does not extend the TTL when reused', async () => {
      const c = setupCommerce();
      const first = await svc(c).open(null);
      vi.setSystemTime(new Date(NOW.getTime() + 10 * HOUR));
      const again = await svc(c).open(first.token);
      expect(again.expiresAt).toBe(first.expiresAt);
    });

    it('creates a new session for a malformed, unknown or expired token', async () => {
      const c = setupCommerce({ checkoutSessionTtlHours: 1 });
      const a = await svc(c).open('lixo');
      expect(a.reused).toBe(false);
      expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const b = await svc(c).open('A'.repeat(43));
      expect(b.reused).toBe(false);
      vi.setSystemTime(new Date(NOW.getTime() + 2 * HOUR));
      const d = await svc(c).open(a.token);
      expect(d.reused).toBe(false);
      expect(d.token).not.toBe(a.token);
    });
  });

  describe('purgeExpired (retention)', () => {
    it('deletes at most 100 expired sessions without orders per open', async () => {
      const c = setupCommerce();
      for (let i = 0; i < 150; i++) await addExpired(c, i);
      await svc(c).open(null);
      expect(sessions(c)).toHaveLength(51);
      expect(sessions(c).filter((s) => s.status === 'ACTIVE' && s.expiresAt < NOW)).toHaveLength(
        50
      );
      await svc(c).open(null);
      expect(sessions(c)).toHaveLength(2);
      expect(sessions(c).every((s) => new Date(s.expiresAt) > NOW)).toBe(true);
    });

    it('returns how many sessions it handled and never takes more than 100', async () => {
      const c = setupCommerce();
      for (let i = 0; i < 120; i++) await addExpired(c, i);
      expect(await svc(c).purgeExpired(500)).toBe(100);
      expect(await svc(c).purgeExpired()).toBe(20);
      expect(await svc(c).purgeExpired()).toBe(0);
    });

    it('scrubs and marks EXPIRED a session with an order, leaving the order untouched', async () => {
      const c = setupCommerce();
      const s = await addExpired(c, 1);
      const orderId = await createOrder(c);
      const order = c.tables[UIDS.order].find((o) => o.id === orderId);
      order.checkoutSession = s.id;
      const before = JSON.stringify(c.tables[UIDS.order]);
      expect(await svc(c).purgeExpired()).toBe(1);
      const row = sessions(c).find((x) => x.id === s.id);
      expect(row).toMatchObject({
        status: 'EXPIRED',
        cart: EMPTY_CART,
        emailVerification: {},
        verifiedEmail: null,
        verificationAttempts: 0,
      });
      expect(JSON.stringify(c.tables[UIDS.order])).toBe(before);
      // Already handled: not taken again.
      expect(await svc(c).purgeExpired()).toBe(0);
    });

    it('leaves sessions expired less than an hour ago (grace period)', async () => {
      const c = setupCommerce();
      await addExpired(c, 0, { expiresAt: new Date(NOW.getTime() - 30 * 60_000) });
      await addExpired(c, 1, { expiresAt: new Date(NOW.getTime() - HOUR) });
      await addExpired(c, 2, { expiresAt: new Date(NOW.getTime() - HOUR - 1) });
      expect(await svc(c).purgeExpired()).toBe(1);
      expect(sessions(c).map((x) => x.tokenHash)).toEqual([sha('expired-0'), sha('expired-1')]);
    });

    it('counts only the rows it actually changed', async () => {
      const c = setupCommerce();
      for (let i = 0; i < 3; i++) await addExpired(c, i);
      const realQuery = c.strapi.db.query;
      c.strapi.db.query = (uid: string) => {
        const q = realQuery(uid);
        if (uid !== UIDS.checkoutSession) return q;
        return {
          ...q,
          // A concurrent purge removes one row between the select and the delete.
          findMany: async (p: any) => {
            const rows = await q.findMany(p);
            c.tables[UIDS.checkoutSession] = c.tables[UIDS.checkoutSession].filter(
              (r) => r.id !== rows[0].id
            );
            return rows;
          },
        };
      };
      expect(await svc(c).purgeExpired()).toBe(2);
    });

    it('does not touch sessions that are still valid', async () => {
      const c = setupCommerce();
      const valid = await svc(c).open(null);
      const row = { ...sessions(c)[0] };
      expect(await svc(c).purgeExpired()).toBe(0);
      expect(sessions(c)[0]).toEqual(row);
      expect((await svc(c).resolve(valid.token))?.id).toBe(row.id);
    });

    it('open still creates the session and logs when the purge fails', async () => {
      const c = setupCommerce();
      const realQuery = c.strapi.db.query;
      c.strapi.db.query = (uid: string) => {
        const q = realQuery(uid);
        if (uid !== UIDS.checkoutSession) return q;
        return {
          ...q,
          findMany: async () => {
            throw new Error('db down');
          },
        };
      };
      const r = await svc(c).open(null);
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessions(c)).toHaveLength(1);
      expect(c.log.error).toHaveBeenCalledTimes(1);
      expect(String(c.log.error.mock.calls[0][0])).toContain('purge');
    });
  });

  describe('resolve', () => {
    it('returns the session for a valid token', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      const s = await svc(c).resolve(token);
      expect(s).toEqual({
        id: sessions(c)[0].id,
        expiresAt: new Date(NOW.getTime() + 168 * HOUR).toISOString(),
        cart: EMPTY_CART,
        verifiedEmail: null,
        emailVerification: {},
        verificationAttempts: 0,
      });
    });

    it('returns null for an expired token without orders and deletes the row', async () => {
      const c = setupCommerce({ checkoutSessionTtlHours: 1 });
      const { token } = await svc(c).open(null);
      vi.setSystemTime(new Date(NOW.getTime() + HOUR));
      expect(await svc(c).resolve(token)).toBeNull();
      expect(sessions(c)).toHaveLength(0);
    });

    it('returns null for an expired token with an order, marks it EXPIRED and scrubs it', async () => {
      const c = setupCommerce({ checkoutSessionTtlHours: 1 });
      const { token } = await svc(c).open(null);
      await svc(c).saveCart(sessions(c)[0].id, {
        ...emptyCart(),
        email: 'a@b.pt',
        lines: [{ variantId: 10, quantity: 1 }],
      });
      sessions(c)[0].verifiedEmail = 'a@b.pt';
      sessions(c)[0].emailVerification = { codeHash: 'x' };
      const orderId = await createOrder(c);
      const order = c.tables[UIDS.order].find((o) => o.id === orderId);
      order.checkoutSession = sessions(c)[0].id;
      const before = JSON.stringify(c.tables[UIDS.order]);
      vi.setSystemTime(new Date(NOW.getTime() + HOUR));
      expect(await svc(c).resolve(token)).toBeNull();
      expect(sessions(c)[0]).toMatchObject({
        status: 'EXPIRED',
        cart: EMPTY_CART,
        emailVerification: {},
        verifiedEmail: null,
      });
      expect(JSON.stringify(c.tables[UIDS.order])).toBe(before);
      // Still null once marked.
      vi.setSystemTime(NOW);
      expect(await svc(c).resolve(token)).toBeNull();
    });

    it('returns null for an unknown token', async () => {
      const c = setupCommerce();
      await svc(c).open(null);
      expect(await svc(c).resolve('B'.repeat(43))).toBeNull();
    });

    it('returns null for a malformed token without querying the database', async () => {
      const c = setupCommerce();
      const spy = vi.fn(c.strapi.db.query);
      c.strapi.db.query = spy;
      for (const t of ['x', '', null, undefined, 42, {}, 'A'.repeat(44), `${'A'.repeat(42)}=`]) {
        expect(await svc(c).resolve(t)).toBeNull();
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it('looks the session up by the token hash only', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      const realQuery = c.strapi.db.query;
      const wheres: any[] = [];
      c.strapi.db.query = (uid: string) => {
        const q = realQuery(uid);
        return {
          ...q,
          findOne: async (p: any) => {
            wheres.push(p.where);
            return q.findOne(p);
          },
        };
      };
      await svc(c).resolve(token);
      expect(wheres).toEqual([{ tokenHash: sha(token) }]);
    });

    it('does not rewrite lastUsedAt twice within a minute', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      await svc(c).resolve(token);
      const first = sessions(c)[0].lastUsedAt;
      expect(new Date(first).getTime()).toBe(NOW.getTime());
      vi.setSystemTime(new Date(NOW.getTime() + 30_000));
      await svc(c).resolve(token);
      expect(sessions(c)[0].lastUsedAt).toBe(first);
      vi.setSystemTime(new Date(NOW.getTime() + 61_000));
      await svc(c).resolve(token);
      expect(new Date(sessions(c)[0].lastUsedAt).getTime()).toBe(NOW.getTime() + 61_000);
    });
  });

  describe('cart', () => {
    it('saveCart does not write to a session past its expiry', async () => {
      const c = setupCommerce({ checkoutSessionTtlHours: 1 });
      const { token } = await svc(c).open(null);
      const s = await svc(c).resolve(token);
      vi.setSystemTime(new Date(NOW.getTime() + HOUR));
      await svc(c).saveCart(s.id, { ...emptyCart(), email: 'late@example.pt' });
      expect(sessions(c)[0].cart).toEqual(emptyCart());
    });

    it('EMPTY_CART is deeply frozen and emptyCart() returns fresh objects', () => {
      expect(Object.isFrozen(EMPTY_CART)).toBe(true);
      expect(Object.isFrozen(EMPTY_CART.lines)).toBe(true);
      expect(Object.isFrozen(EMPTY_CART.promotionCodes)).toBe(true);
      expect(Object.isFrozen(EMPTY_CART.giftChoices)).toBe(true);
      const a = emptyCart();
      expect(a).toEqual(EMPTY_CART);
      expect(a.lines).not.toBe(emptyCart().lines);
      expect(Object.isFrozen(a.lines)).toBe(false);
    });

    it('saveCart stores an object', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      const s = await svc(c).resolve(token);
      const cart = {
        lines: [{ variantId: 10, quantity: 2 }],
        promotionCodes: ['SUMMER'],
        giftChoices: { '3': 11 },
        email: 'ana@example.pt',
        destination: { country: 'PT', postalCode: '1000-001' },
        shippingMethod: { providerId: 'manual', serviceId: '1' },
        locale: 'pt',
      };
      await svc(c).saveCart(s.id, cart);
      expect(sessions(c)[0].cart).toEqual(cart);
      expect(typeof sessions(c)[0].cart).toBe('object');
      expect((await svc(c).resolve(token)).cart).toEqual(cart);
    });

    it('clearCart keeps e-mail, destination and locale', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      const s = await svc(c).resolve(token);
      await svc(c).saveCart(s.id, {
        lines: [{ variantId: 10, quantity: 2 }],
        promotionCodes: ['SUMMER'],
        giftChoices: { '3': 11 },
        email: 'ana@example.pt',
        destination: { country: 'PT' },
        shippingMethod: { providerId: 'manual', serviceId: '1' },
        locale: 'pt',
      });
      await svc(c).clearCart(s.id);
      expect(sessions(c)[0].cart).toEqual({
        ...emptyCart(),
        email: 'ana@example.pt',
        destination: { country: 'PT' },
        locale: 'pt',
      });
    });

    it('resolve normalises a stored cart that is missing fields', async () => {
      const c = setupCommerce();
      const { token } = await svc(c).open(null);
      sessions(c)[0].cart = { lines: [{ variantId: 10, quantity: 1 }] };
      expect((await svc(c).resolve(token)).cart).toEqual({
        ...emptyCart(),
        lines: [{ variantId: 10, quantity: 1 }],
      });
      sessions(c)[0].cart = null;
      expect((await svc(c).resolve(token)).cart).toEqual(EMPTY_CART);
    });
  });

  describe('isEmailVerified', () => {
    it('compares the normalised e-mail', async () => {
      const c = setupCommerce();
      const s = { verifiedEmail: 'ana@example.pt' } as any;
      expect(svc(c).isEmailVerified(s, ' Ana@Example.PT ')).toBe(true);
      expect(svc(c).isEmailVerified(s, 'rui@example.pt')).toBe(false);
      expect(svc(c).isEmailVerified({ verifiedEmail: null } as any, '')).toBe(false);
    });
  });

  describe('findOwnedOrder (Review Focus 2)', () => {
    const setupOrders = async () => {
      const c = setupCommerce();
      const mine = await svc(c).resolve((await svc(c).open(null)).token);
      const other = await svc(c).resolve((await svc(c).open(null)).token);
      const myOrderId = await createOrder(c);
      const otherOrderId = await createOrder(c);
      const myOrder = c.tables[UIDS.order].find((o) => o.id === myOrderId);
      const otherOrder = c.tables[UIDS.order].find((o) => o.id === otherOrderId);
      myOrder.checkoutSession = mine.id;
      otherOrder.checkoutSession = other.id;
      return { c, mine, myOrder, otherOrder };
    };

    it('returns the order of the session', async () => {
      const { c, mine, myOrder } = await setupOrders();
      expect(await svc(c).findOwnedOrder(mine, myOrder.publicId)).toEqual({
        id: myOrder.id,
        publicId: myOrder.publicId,
      });
      expect(c.log.warn).not.toHaveBeenCalled();
    });

    it("returns null and logs ORDER_ACCESS_DENIED for another session's order", async () => {
      const { c, mine, otherOrder } = await setupOrders();
      expect(await svc(c).findOwnedOrder(mine, otherOrder.publicId)).toBeNull();
      expect(c.log.warn).toHaveBeenCalledTimes(1);
      const msg = String(c.log.warn.mock.calls[0][0]);
      expect(msg).toBe('[ecommerce:storefront] ORDER_ACCESS_DENIED');
      expect(JSON.stringify(c.log.warn.mock.calls)).not.toContain(otherOrder.publicId);
    });

    it('accepts an upper-case publicId by lower-casing it before the lookup', async () => {
      const { c, mine, myOrder } = await setupOrders();
      const wheres: any[] = [];
      const realQuery = c.strapi.db.query;
      c.strapi.db.query = (uid: string) => {
        const q = realQuery(uid);
        return {
          ...q,
          findOne: async (p: any) => {
            wheres.push(p.where);
            return q.findOne(p);
          },
        };
      };
      expect(await svc(c).findOwnedOrder(mine, myOrder.publicId.toUpperCase())).toEqual({
        id: myOrder.id,
        publicId: myOrder.publicId,
      });
      expect(wheres[0].publicId).toBe(myOrder.publicId.toLowerCase());
    });

    it('treats an unknown publicId the same way', async () => {
      const { c, mine } = await setupOrders();
      expect(await svc(c).findOwnedOrder(mine, '00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] ORDER_ACCESS_DENIED');
    });

    it('returns null without querying for a publicId that is not a UUID', async () => {
      const { c, mine } = await setupOrders();
      const spy = vi.fn(c.strapi.db.query);
      c.strapi.db.query = spy;
      for (const p of ['1', 'abc', null, 7, {}, "' OR 1=1 --"]) {
        expect(await svc(c).findOwnedOrder(mine, p)).toBeNull();
      }
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
