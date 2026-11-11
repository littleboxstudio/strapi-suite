import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { setupCommerce, createOrder, UIDS, type Commerce } from './helpers/commerceSetup';
import {
  EMPTY_CART,
  emptyCart,
} from '../../../server/src/services/modules/ecommerce/storefrontSessions';
import {
  deriveVerificationSecret,
  verificationCodeHash,
} from '../../../server/src/services/modules/ecommerce/domain/storefront/session';
import {
  EcommerceEmailError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';

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
  describe('e-mail verification', () => {
    const KEY = 'test-encryption-key-for-verification';
    const MIN = 60_000;

    const resendOk = () =>
      vi.fn(
        async (..._args: any[]) => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })
      );

    /** The setup's template render mock puts the data as JSON in the HTML. */
    const sent = (fetchMock: ReturnType<typeof resendOk>, i = fetchMock.mock.calls.length - 1) => {
      const init = fetchMock.mock.calls[i][1] as RequestInit;
      const body = JSON.parse(String(init.body));
      return {
        body,
        headers: init.headers as Record<string, string>,
        code: JSON.parse(body.html).verification.code as string,
      };
    };

    const setup = async (opts: { resendActive?: boolean } = { resendActive: true }) => {
      const c = setupCommerce(opts);
      const s = await svc(c).resolve((await svc(c).open(null)).token);
      const fetchMock = resendOk();
      vi.stubGlobal('fetch', fetchMock);
      return { c, s, fetchMock, row: () => sessions(c)[0] };
    };

    const failure = async (p: Promise<unknown>) => {
      const err: any = await p.then(
        () => null,
        (e) => e
      );
      expect(err).toBeInstanceOf(EcommerceValidationError);
      return err.errors[0];
    };
    const INVALID = { path: 'code', code: 'VERIFICATION_CODE_INVALID' };
    const LOCKED = { path: 'code', code: 'VERIFICATION_LOCKED' };
    const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

    beforeEach(() => {
      vi.stubEnv('LTB_ECOMMERCE_ENCRYPTION_KEY', KEY);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('sends one e-mail with the code and stores only its HMAC', async () => {
      const { c, s, fetchMock, row } = await setup();
      const r = await svc(c).requestEmailVerification(s, { email: ' Ana@X.pt ', locale: 'pt' });
      expect(r).toEqual({ expiresAt: new Date(NOW.getTime() + 10 * MIN).toISOString() });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { body, headers, code } = sent(fetchMock);
      expect(code).toMatch(/^\d{6}$/);
      expect(body.to).toEqual(['ana@x.pt']);
      expect(body.html).toContain(code);
      const render = c.services.EcommerceEmailTemplateService.render;
      expect(render).toHaveBeenCalledWith('EMAIL_VERIFICATION', 'pt', {
        customer: { email: 'ana@x.pt' },
        verification: { code, validMinutes: '10' },
      });
      const codeHash = verificationCodeHash(deriveVerificationSecret(KEY), s.id, 'ana@x.pt', code);
      expect(row().emailVerification).toEqual({
        emailNormalized: 'ana@x.pt',
        codeHash,
        expiresAt: r.expiresAt,
      });
      expect(row().verificationAttempts).toBe(0);
      expect(headers['Idempotency-Key']).toBe(`verify:${s.id}:${codeHash}`);
      expect(JSON.stringify(row())).not.toContain(code);
      expect(c.tables[UIDS.notification]).toHaveLength(0);
      const logged = JSON.stringify([
        c.log.warn.mock.calls,
        c.log.error.mock.calls,
        c.log.info.mock.calls,
      ]);
      expect(logged).not.toContain(code);
    });

    it('stores an HMAC with the derived secret, not a plain SHA-256', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      expect(row().emailVerification.codeHash).not.toBe(sha(`${s.id}:ana@x.pt:${code}`));
      vi.stubEnv('LTB_ECOMMERCE_ENCRYPTION_KEY', 'another-key');
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(INVALID);
      expect(row().verifiedEmail ?? null).toBeNull();
    });

    it('rejects an invalid e-mail before anything else', async () => {
      const { c, s, fetchMock, row } = await setup();
      for (const email of ['', 'ana', 'ana@x', 7, null, 'a b@x.pt']) {
        expect(await failure(svc(c).requestEmailVerification(s, { email, locale: 'en' }))).toEqual({
          path: 'email',
          code: 'invalid_email',
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(row().emailVerification).toEqual({});
    });

    it.each([
      ['inactive', false],
      ['not set up', undefined],
    ])('Resend %s → EMAIL_NOT_CONFIGURED and nothing stored', async (_l, resendActive) => {
      const { c, s, fetchMock, row } = await setup({ resendActive });
      const err: any = await svc(c)
        .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EcommerceEmailError);
      expect(err.code).toBe('EMAIL_NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(row().emailVerification).toEqual({});
    });

    it('a failed send → EMAIL_SEND_FAILED and the pending verification is cleared', async () => {
      const { c, s, row } = await setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 500 }))
      );
      const err: any = await svc(c)
        .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EcommerceEmailError);
      expect(err.code).toBe('EMAIL_SEND_FAILED');
      expect(row().emailVerification).toEqual({});
    });

    it('the right code verifies the normalised e-mail', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: ' Ana@X.pt ', locale: 'en' });
      const { code } = sent(fetchMock);
      expect(await svc(c).confirmEmailVerification(s, { email: 'ANA@x.pt ', code })).toEqual({
        verified: true,
      });
      expect(row()).toMatchObject({
        verifiedEmail: 'ana@x.pt',
        emailVerification: {},
        verificationAttempts: 0,
      });
      const again = { ...s, verifiedEmail: row().verifiedEmail };
      expect(svc(c).isEmailVerified(again, ' Ana@X.pt ')).toBe(true);
      // The code is single-use.
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(INVALID);
    });

    it('5 wrong codes lock: the 6th attempt fails even with the right code', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      for (let i = 0; i < 5; i++) {
        expect(
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) })
          )
        ).toEqual(INVALID);
      }
      expect(row().verificationAttempts).toBe(5);
      expect(c.log.warn).not.toHaveBeenCalled();
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(LOCKED);
      expect(row().verifiedEmail ?? null).toBeNull();
      expect(row().verificationAttempts).toBe(5);
      expect(c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] VERIFICATION_LOCKED');
      expect(JSON.stringify(c.log.warn.mock.calls)).not.toMatch(/ana@x\.pt|\d{6}/);
    });

    it('a new code for the same e-mail within the TTL keeps the attempts (and the lock)', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const first = sent(fetchMock).code;
      for (let i = 0; i < 3; i++) {
        await failure(
          svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(first) })
        );
      }
      vi.setSystemTime(new Date(NOW.getTime() + 5 * MIN));
      await svc(c).requestEmailVerification(s, { email: ' ANA@x.pt', locale: 'en' });
      const second = sent(fetchMock).code;
      expect(row().verificationAttempts).toBe(3);
      for (let i = 0; i < 2; i++) {
        expect(
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(second) })
          )
        ).toEqual(INVALID);
      }
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: second }))
      ).toEqual(LOCKED);
      expect(row().verificationAttempts).toBe(5);

      // Asking again for the same e-mail does not unlock either.
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      expect(row().verificationAttempts).toBe(5);
      expect(
        await failure(
          svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: sent(fetchMock).code })
        )
      ).toEqual(LOCKED);

      // Another e-mail starts at 0.
      await svc(c).requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' });
      expect(row().verificationAttempts).toBe(0);
      expect(
        await svc(c).confirmEmailVerification(s, { email: 'rui@x.pt', code: sent(fetchMock).code })
      ).toEqual({ verified: true });
    });

    it('a request after the previous code expired starts at 0', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      for (let i = 0; i < 5; i++) {
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) }));
      }
      vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      expect(row().verificationAttempts).toBe(0);
      expect(
        await svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: sent(fetchMock).code })
      ).toEqual({ verified: true });
    });

    it('parallel wrong confirmations at 4 attempts: one counted, the other locked', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      row().verificationAttempts = 4;
      const results = await Promise.all(
        [0, 1].map((i) =>
          failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) })
          ).then(
            (e) => e.code,
            () => i
          )
        )
      );
      expect([...results].sort()).toEqual(['VERIFICATION_CODE_INVALID', 'VERIFICATION_LOCKED']);
      expect(row().verificationAttempts).toBe(5);
    });

    it('counts the attempt with a conditional update before comparing, and retries on a lost race', async () => {
      const { c, s, fetchMock, row } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      row().verificationAttempts = 3;
      const q = c.strapi.db.query;
      const updates: any[] = [];
      let raced = false;
      c.strapi.db.query = (uid: string) => {
        const inner = q(uid);
        if (uid !== UIDS.checkoutSession) return inner;
        return {
          ...inner,
          updateMany: async (p: any) => {
            updates.push(structuredClone(p));
            if (!raced && 'verificationAttempts' in (p.where ?? {})) {
              raced = true;
              row().verificationAttempts = 4; // a concurrent confirmation won the first round
            }
            return inner.updateMany(p);
          },
        };
      };
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) }))
      ).toEqual(INVALID);
      const counted = updates.filter((u) => 'verificationAttempts' in u.where);
      expect(
        counted.map((u) => [u.where.verificationAttempts, u.data.verificationAttempts])
      ).toEqual([
        [3, 4],
        [4, 5],
      ]);
      expect(counted[0].where.id).toBe(s.id);
      expect(row().verificationAttempts).toBe(5);
    });

    it('expired code, another e-mail, no pending code or a malformed code → VERIFICATION_CODE_INVALID', async () => {
      const { c, s, fetchMock, row } = await setup();
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: '123456' }))
      ).toEqual(INVALID);
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'rui@x.pt', code }))
      ).toEqual(INVALID);
      for (const bad of [null, 123456, '12345', 'abcdef']) {
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: bad }))
        ).toEqual(INVALID);
      }
      vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(INVALID);
      expect(row().verifiedEmail ?? null).toBeNull();
    });
  });
});
