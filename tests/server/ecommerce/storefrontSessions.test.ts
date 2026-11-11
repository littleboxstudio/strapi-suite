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
      const row = () => sessions(c)[0];
      /** Attempts used on the pending code: the counter never goes down (column − attemptsBase). */
      const used = () => row().verificationAttempts - row().emailVerification.attemptsBase;
      const setUsed = (n: number) => {
        row().verificationAttempts = row().emailVerification.attemptsBase + n;
      };
      return { c, s, fetchMock, row, used, setUsed };
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
        attemptsBase: row().verificationAttempts,
      });
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
      const counter = row().verificationAttempts;
      expect(row()).toMatchObject({ verifiedEmail: 'ana@x.pt', emailVerification: {} });
      expect(counter).toBeGreaterThan(0); // never reset
      const again = { ...s, verifiedEmail: row().verifiedEmail };
      expect(svc(c).isEmailVerified(again, ' Ana@X.pt ')).toBe(true);
      // The code is single-use.
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(INVALID);
    });

    it('5 wrong codes lock: the 6th attempt fails even with the right code', async () => {
      const { c, s, fetchMock, row, used } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      for (let i = 0; i < 5; i++) {
        expect(
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) })
          )
        ).toEqual(INVALID);
      }
      expect(used()).toBe(5);
      expect(c.log.warn).not.toHaveBeenCalled();
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
      ).toEqual(LOCKED);
      expect(row().verifiedEmail ?? null).toBeNull();
      expect(used()).toBe(5);
      expect(c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] VERIFICATION_LOCKED');
      expect(JSON.stringify(c.log.warn.mock.calls)).not.toMatch(/ana@x\.pt|\d{6}/);
    });

    it('a new code for the same e-mail within the TTL keeps the attempts (and the lock)', async () => {
      const { c, s, fetchMock, used } = await setup();
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
      expect(used()).toBe(3);
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
      expect(used()).toBe(5);

      // Asking again for the same e-mail does not unlock either: it is refused, nothing sent.
      const sends = fetchMock.mock.calls.length;
      expect(
        await failure(svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' }))
      ).toEqual(LOCKED);
      expect(fetchMock.mock.calls.length).toBe(sends);
      expect(used()).toBe(5);
      expect(
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: second }))
      ).toEqual(LOCKED);

      // After the locked code expires, another e-mail starts at 0.
      vi.setSystemTime(new Date(NOW.getTime() + 15 * MIN));
      await svc(c).requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' });
      expect(used()).toBe(0);
      expect(
        await svc(c).confirmEmailVerification(s, { email: 'rui@x.pt', code: sent(fetchMock).code })
      ).toEqual({ verified: true });
    });

    it('a request after the previous code expired starts at 0', async () => {
      const { c, s, fetchMock, used } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      for (let i = 0; i < 5; i++) {
        await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) }));
      }
      vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      expect(used()).toBe(0);
      expect(
        await svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: sent(fetchMock).code })
      ).toEqual({ verified: true });
    });

    it('parallel wrong confirmations at 4 attempts: one counted, the other locked', async () => {
      const { c, s, fetchMock, used, setUsed } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      setUsed(4);
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
      expect(used()).toBe(5);
    });

    it('counts the attempt with a conditional update before comparing, and retries on a lost race', async () => {
      const { c, s, fetchMock, row, used, setUsed } = await setup();
      await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
      const { code } = sent(fetchMock);
      setUsed(3);
      const b = row().emailVerification.attemptsBase;
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
              setUsed(4); // a concurrent confirmation won the first round
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
        [b + 3, b + 4],
        [b + 4, b + 5],
      ]);
      expect(counted[0].where.id).toBe(s.id);
      expect(used()).toBe(5);
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
    describe('fix round 1', () => {
      const failingFetch = () => vi.fn(async (..._a: any[]) => new Response('{}', { status: 500 }));
      const SESSION_INVALID = { path: 'session', code: 'SESSION_INVALID' };

      /** Wraps the checkout-session query's updateMany. */
      const wrapUpdateMany = (c: Commerce, fn: (p: any, inner: any) => Promise<any>) => {
        const q = c.strapi.db.query;
        c.strapi.db.query = (uid: string) => {
          const inner = q(uid);
          if (uid !== UIDS.checkoutSession) return inner;
          return { ...inner, updateMany: (p: any) => fn(p, inner) };
        };
      };

      it('F1: a failed send keeps the previous code and the attempts (no reset on the next request)', async () => {
        const { c, s, fetchMock, row, used } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const first = sent(fetchMock).code;
        for (let i = 0; i < 4; i++) {
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(first) })
          );
        }
        const before = structuredClone(row().emailVerification);
        vi.stubGlobal('fetch', failingFetch());
        const err: any = await svc(c)
          .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
          .catch((e) => e);
        expect(err.code).toBe('EMAIL_SEND_FAILED');
        const { attemptsBase: _b, ...restored } = row().emailVerification;
        const { attemptsBase: _p, ...previous } = before;
        expect(restored).toEqual(previous);
        expect(used()).toBe(4);

        const ok = resendOk();
        vi.stubGlobal('fetch', ok);
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        expect(used()).toBe(4);
        const second = sent(ok).code;
        expect(
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(second) })
          )
        ).toEqual(INVALID);
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: second }))
        ).toEqual(LOCKED);
      });

      it('F1: 5 wrong → failed request → successful request → right code is still LOCKED', async () => {
        const { c, s, fetchMock } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const code = sent(fetchMock).code;
        for (let i = 0; i < 5; i++) {
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) })
          );
        }
        vi.stubGlobal('fetch', failingFetch());
        await svc(c)
          .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
          .catch(() => null);
        vi.stubGlobal('fetch', resendOk());
        await svc(c)
          .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
          .catch(() => null);
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
        ).toEqual(LOCKED);
      });

      it('F1: a failed first request leaves no pending code', async () => {
        const { c, s, row } = await setup();
        vi.stubGlobal('fetch', failingFetch());
        await svc(c)
          .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
          .catch(() => null);
        expect(row().emailVerification).toEqual({});
      });

      it('F2: a failed send does not wipe a code written meanwhile by another request', async () => {
        const { c, s, row } = await setup();
        const other = { emailNormalized: 'rui@x.pt', codeHash: 'ab'.repeat(32), expiresAt: 'x' };
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => {
            row().emailVerification = other; // a concurrent request wrote and sent its own code
            return new Response('{}', { status: 500 });
          })
        );
        await svc(c)
          .requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' })
          .catch(() => null);
        expect(row().emailVerification).toEqual(other);
      });

      it('F3: the success write is conditional on the counted attempt', async () => {
        const { c, s, fetchMock, row } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const { code } = sent(fetchMock);
        const counter = row().verificationAttempts;
        const wheres: any[] = [];
        wrapUpdateMany(c, async (p, inner) => {
          wheres.push(p.where);
          const r = await inner.updateMany(p);
          if (wheres.length === 1) row().verificationAttempts += 1; // a concurrent request wrote
          return r;
        });
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
        ).toEqual(INVALID);
        expect(row().verifiedEmail ?? null).toBeNull();
        expect(wheres[1]).toMatchObject({ id: s.id, verificationAttempts: counter + 1 });
      });

      it('F4: a missing session gives the same SESSION_INVALID in both methods', async () => {
        const { c, s, fetchMock } = await setup();
        sessions(c).splice(0);
        expect(
          await failure(svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' }))
        ).toEqual(SESSION_INVALID);
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: '123456' }))
        ).toEqual(SESSION_INVALID);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('F5: exhausted compare-and-set retries give a transient conflict, not a lock', async () => {
        const { c, s, fetchMock } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const { code } = sent(fetchMock);
        wrapUpdateMany(c, async (p, inner) =>
          'verificationAttempts' in (p.where ?? {}) ? { count: 0 } : inner.updateMany(p)
        );
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
        ).toEqual({ path: 'code', code: 'VERIFICATION_CONFLICT' });
        expect(c.log.warn).not.toHaveBeenCalled();
      });

      it('F6: a request while locked is refused: nothing written or sent, lock not extended', async () => {
        const { c, s, fetchMock, row, used } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const code = sent(fetchMock).code;
        for (let i = 0; i < 5; i++) {
          await failure(
            svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code: wrong(code) })
          );
        }
        const before = structuredClone(row().emailVerification);
        vi.setSystemTime(new Date(NOW.getTime() + 9 * MIN));
        expect(
          await failure(svc(c).requestEmailVerification(s, { email: ' ANA@x.pt', locale: 'en' }))
        ).toEqual(LOCKED);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(row().emailVerification).toEqual(before);
        expect(c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] VERIFICATION_LOCKED');
        // The lock lifts at the original expiry.
        vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        expect(used()).toBe(0);
      });

      it('confirm without an encryption key logs a server warning', async () => {
        const { c, s, fetchMock } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const { code } = sent(fetchMock);
        vi.stubEnv('LTB_ECOMMERCE_ENCRYPTION_KEY', '');
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
        ).toEqual(INVALID);
        expect(c.log.warn).toHaveBeenCalledWith(
          '[ecommerce:storefront] e-mail verification secret missing (LTB_ECOMMERCE_ENCRYPTION_KEY)'
        );
      });
    });
    describe('fix round 2', () => {
      const lockOn = async (c: Commerce, s: any, fetchMock: any, email: string) => {
        await svc(c).requestEmailVerification(s, { email, locale: 'en' });
        const code = sent(fetchMock).code;
        for (let i = 0; i < 5; i++) {
          await failure(svc(c).confirmEmailVerification(s, { email, code: wrong(code) }));
        }
        return code;
      };

      it('R2-1: a locked session is locked for any e-mail until the locked code expires', async () => {
        const { c, s, fetchMock, row, used } = await setup();
        await lockOn(c, s, fetchMock, 'ana@x.pt');
        const before = structuredClone(row());
        vi.setSystemTime(new Date(NOW.getTime() + 9 * MIN));
        for (const email of ['rui@x.pt', 'ana@x.pt']) {
          expect(
            await failure(svc(c).requestEmailVerification(s, { email, locale: 'en' }))
          ).toEqual(LOCKED);
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(row()).toEqual(before);

        vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
        await svc(c).requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' });
        expect(used()).toBe(0);
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        expect(used()).toBe(0);
        expect(
          await svc(c).confirmEmailVerification(s, {
            email: 'ana@x.pt',
            code: sent(fetchMock).code,
          })
        ).toEqual({ verified: true });
      });

      it('R2-2: the counter column never goes down', async () => {
        const { c, s, fetchMock, row } = await setup();
        const seen: number[] = [row().verificationAttempts];
        const note = () => seen.push(row().verificationAttempts);
        await lockOn(c, s, fetchMock, 'ana@x.pt');
        note();
        vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN));
        await svc(c).requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' });
        note();
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response('{}', { status: 500 }))
        );
        await svc(c)
          .requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' })
          .catch(() => null);
        note();
        vi.stubGlobal('fetch', fetchMock);
        await svc(c).requestEmailVerification(s, { email: 'rui@x.pt', locale: 'en' });
        note();
        await svc(c).confirmEmailVerification(s, { email: 'rui@x.pt', code: sent(fetchMock).code });
        note();
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen[seen.length - 1]).toBeGreaterThan(5);
      });

      it('R2-2: a stale request (decided on an old row) re-reads and keeps the attempts', async () => {
        const { c, s, fetchMock, row, used } = await setup();
        // R0 for ana@x.pt is issued and 3 wrong guesses are made while R1 (also ana@x.pt, which
        // read the empty row) is between its read and its write.
        const q = c.strapi.db.query;
        let scripted = false;
        const casWheres: any[] = [];
        c.strapi.db.query = (uid: string) => {
          const inner = q(uid);
          if (uid !== UIDS.checkoutSession) return inner;
          return {
            ...inner,
            updateMany: async (p: any) => {
              if ('verificationAttempts' in (p.where ?? {}))
                casWheres.push(p.where.verificationAttempts);
              if (!scripted) {
                scripted = true;
                const base = row().verificationAttempts + 1;
                row().emailVerification = {
                  emailNormalized: 'ana@x.pt',
                  codeHash: 'ab'.repeat(32),
                  expiresAt: new Date(NOW.getTime() + 10 * MIN).toISOString(),
                  attemptsBase: base,
                };
                row().verificationAttempts = base + 3;
              }
              return inner.updateMany(p);
            },
          };
        };
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        expect(casWheres).toHaveLength(2); // the first write missed and was decided again
        expect(used()).toBe(3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('R2-2: a request whose code reached the limit between read and write is refused', async () => {
        const { c, s, fetchMock, row, setUsed } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        setUsed(4);
        const q = c.strapi.db.query;
        let scripted = false;
        c.strapi.db.query = (uid: string) => {
          const inner = q(uid);
          if (uid !== UIDS.checkoutSession) return inner;
          return {
            ...inner,
            updateMany: async (p: any) => {
              if (!scripted) {
                scripted = true;
                setUsed(5); // the 5th wrong guess lands between the request's read and write
              }
              return inner.updateMany(p);
            },
          };
        };
        const before = structuredClone(row().emailVerification);
        expect(
          await failure(svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' }))
        ).toEqual(LOCKED);
        expect(row().emailVerification).toEqual(before);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('R2-3: a confirm stalled across a request for another e-mail never checks the replaced code', async () => {
        const { c, s, fetchMock, row } = await setup();
        await svc(c).requestEmailVerification(s, { email: 'ana@x.pt', locale: 'en' });
        const { code } = sent(fetchMock);
        const q = c.strapi.db.query;
        let scripted = false;
        c.strapi.db.query = (uid: string) => {
          const inner = q(uid);
          if (uid !== UIDS.checkoutSession) return inner;
          return {
            ...inner,
            updateMany: async (p: any) => {
              if (!scripted) {
                scripted = true;
                // Between the confirm's read and its count: a request for rui@x.pt was written.
                const next = row().verificationAttempts + 1;
                row().emailVerification = {
                  emailNormalized: 'rui@x.pt',
                  codeHash: 'cd'.repeat(32),
                  expiresAt: new Date(NOW.getTime() + 10 * MIN).toISOString(),
                  attemptsBase: next,
                };
                row().verificationAttempts = next;
              }
              return inner.updateMany(p);
            },
          };
        };
        expect(
          await failure(svc(c).confirmEmailVerification(s, { email: 'ana@x.pt', code }))
        ).toEqual(INVALID);
        expect(row().verifiedEmail ?? null).toBeNull();
        expect(row().emailVerification.emailNormalized).toBe('rui@x.pt');
      });
    });
  });
});
