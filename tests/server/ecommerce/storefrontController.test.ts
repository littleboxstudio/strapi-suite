import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveRefund: vi.fn(),
}));
vi.mock(
  '../../../server/src/services/modules/ecommerce/providers/payments/stripeClient',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createStripeClient: () => stripe,
  })
);

import { setupCommerce, UIDS } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import createController from '../../../server/src/controllers/modules/ecommerce/storefront';
import { handleStorefrontError } from '../../../server/src/controllers/modules/ecommerce/storefrontErrors';
import {
  EcommerceCarrierError,
  EcommerceEmailError,
  EcommerceNotFoundError,
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
const NOW = new Date('2026-11-11T10:00:00.000Z');

const promotion = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Interno-${id}`,
  description: null,
  code: null,
  method: 'AUTOMATIC',
  active: true,
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  priority: 0,
  displayName: {},
  eligibility: { mode: 'ALL' },
  conditions: group(),
  benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  usageLimit: null,
  perCustomerLimit: null,
  perOrderLimit: null,
  redemptions: 0,
  version: 1,
  ...over,
});

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

/** Total 4500: 2 × 2000 + 500 shipping. */
const orderBody = (over: Record<string, unknown> = {}) => ({
  customer: { firstName: 'Ana', lastName: 'Silva', email: 'Ana@Example.pt' },
  shippingAddress: address,
  locale: 'en',
  lines: [{ variantId: 10, quantity: 2 }],
  shippingMethod: { providerId: 'manual', serviceId: '1' },
  expectedTotal: 4500,
  ...over,
});

let sessionSeq = 0;

beforeEach(() => {
  __resetEventHandlersForTests();
  sessionSeq = 0;
  for (const fn of Object.values(stripe)) fn.mockReset();
  stripe.createCheckoutSession.mockImplementation(async (p: any) => {
    sessionSeq += 1;
    return {
      id: `cs_${sessionSeq}`,
      url: `https://checkout.stripe.com/c/pay/cs_${sessionSeq}`,
      status: 'open',
      expiresAt: p.expiresAt,
      paymentIntentId: null,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Req = {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
};

const mkCtx = (req: Req = {}): any => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  const responseHeaders: Record<string, string> = {};
  return {
    request: { headers, header: headers, body: req.body },
    query: req.query ?? {},
    params: req.params ?? {},
    status: 404,
    body: undefined,
    get: (name: string) => headers[name.toLowerCase()] ?? '',
    set: (name: string, value: string) => {
      responseHeaders[name] = value;
    },
    responseHeaders,
  };
};

const setup = (opts: { fixedClock?: boolean } = {}) => {
  if (opts.fixedClock) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  }
  const c = setupCommerce();
  const controller: any = createController({ strapi: c.strapi });
  const sessions = c.services.EcommerceStorefrontSessionService;
  const checkout = c.services.EcommerceStorefrontCheckoutService;
  const catalog = c.services.EcommerceStorefrontCatalogService;
  const call = async (handler: string, req: Req = {}) => {
    const ctx = mkCtx(req);
    await controller[handler](ctx);
    return ctx;
  };
  const open = async () => {
    const { token } = await sessions.open(null);
    return token as string;
  };
  const rowOf = (token: string) =>
    c.tables[UIDS.checkoutSession].find((r) => r.tokenHash === sha(token));
  const verify = (token: string, email: string) => {
    rowOf(token).verifiedEmail = email.trim().toLowerCase();
  };
  const addPromotion = (id: number, over: Record<string, unknown> = {}) => {
    c.tables[UIDS.promotion].push(promotion(id, over));
    return id;
  };
  return { c, controller, sessions, checkout, catalog, call, open, rowOf, verify, addPromotion };
};

const S = (token: string, extra: Record<string, string> = {}) => ({
  'X-Checkout-Session': token,
  ...extra,
});
const errorOf = (ctx: any) => ctx.body?.error;

describe('EcommerceStorefrontController', () => {
  describe('Review Focus 5: rate limiting by client IP', () => {
    it('1000 GET /products without X-Storefront-Client-IP → no 429, even with a different X-Forwarded-For each time', async () => {
      const t = setup({ fixedClock: true });
      const list = vi
        .spyOn(t.catalog, 'listProducts')
        .mockResolvedValue({ results: [], pagination: { page: 1, pageSize: 24, total: 0, pageCount: 0 } });
      for (let i = 0; i < 1000; i++) {
        const ctx = await t.call('listProducts', {
          headers: { 'X-Forwarded-For': `198.51.100.${i % 250}, 10.0.0.${i % 200}` },
        });
        expect(ctx.status).toBe(200);
      }
      expect(list).toHaveBeenCalledTimes(1000);
    });

    it('with X-Storefront-Client-IP: 203.0.113.7 the 601st request in a minute → 429 with Retry-After and RATE_LIMITED', async () => {
      const t = setup({ fixedClock: true });
      vi.spyOn(t.catalog, 'listProducts').mockResolvedValue({
        results: [],
        pagination: { page: 1, pageSize: 24, total: 0, pageCount: 0 },
      });
      const headers = { 'X-Storefront-Client-IP': '203.0.113.7' };
      for (let i = 0; i < 600; i++) {
        expect((await t.call('listProducts', { headers })).status).toBe(200);
      }
      const ctx = await t.call('listProducts', { headers });
      expect(ctx.status).toBe(429);
      expect(ctx.responseHeaders['Retry-After']).toBe('60');
      expect(ctx.body).toEqual({
        data: null,
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message: 'Too many requests',
          details: { code: 'RATE_LIMITED', retryAfter: 60 },
        },
      });
      expect(t.c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] RATE_LIMITED catalog');
      // Another client behind the same BFF is not affected.
      expect(
        (await t.call('listProducts', { headers: { 'X-Storefront-Client-IP': '203.0.113.8' } }))
          .status
      ).toBe(200);
      // The window ends after a minute.
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      expect((await t.call('listProducts', { headers })).status).toBe(200);
    });

    it('X-Forwarded-For: 203.0.113.7 without the own header → no IP limit', async () => {
      const t = setup({ fixedClock: true });
      vi.spyOn(t.catalog, 'listProducts').mockResolvedValue({
        results: [],
        pagination: { page: 1, pageSize: 24, total: 0, pageCount: 0 },
      });
      for (let i = 0; i < 700; i++) {
        const ctx = await t.call('listProducts', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
        expect(ctx.status).toBe(200);
      }
    });

    it('an invalid X-Storefront-Client-IP (a list) is ignored like a missing one', async () => {
      const t = setup({ fixedClock: true });
      vi.spyOn(t.catalog, 'listProducts').mockResolvedValue({
        results: [],
        pagination: { page: 1, pageSize: 24, total: 0, pageCount: 0 },
      });
      const headers = { 'X-Storefront-Client-IP': '203.0.113.7, 203.0.113.9' };
      for (let i = 0; i < 700; i++) {
        expect((await t.call('listProducts', { headers })).status).toBe(200);
      }
    });

    it('F4: POST /checkout/session that only reuses a valid session does not count against session.create', async () => {
      const t = setup({ fixedClock: true });
      const headers = { 'X-Storefront-Client-IP': '203.0.113.7' };
      const first = await t.call('openSession', { headers });
      expect(first.status).toBe(201);
      for (let i = 0; i < 30; i++) {
        const again = await t.call('openSession', { headers: { ...headers, ...S(first.body.token) } });
        expect(again.status).toBe(200);
        expect(again.body.reused).toBe(true);
      }
      // 19 new sessions are still allowed for this IP (20 per hour in all).
      for (let i = 0; i < 19; i++) expect((await t.call('openSession', { headers })).status).toBe(201);
      expect((await t.call('openSession', { headers })).status).toBe(429);
    });

    it('POST /checkout/session without a client IP counts in the shared unknown bucket (20 per hour)', async () => {
      const t = setup({ fixedClock: true });
      for (let i = 0; i < 20; i++) expect((await t.call('openSession')).status).toBe(201);
      const ctx = await t.call('openSession');
      expect(ctx.status).toBe(429);
      expect(errorOf(ctx).details.code).toBe('RATE_LIMITED');
    });
  });

  describe('e-mail rate limits', () => {
    it('6 POST /checkout/email-verification for the same e-mail from different sessions and IPs → the 6th is 429', async () => {
      const t = setup({ fixedClock: true });
      const send = vi
        .spyOn(t.sessions, 'requestEmailVerification')
        .mockResolvedValue({ expiresAt: '2026-11-11T10:10:00.000Z' });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const token = await t.open();
        const ctx = await t.call('requestEmailVerification', {
          headers: S(token, { 'X-Storefront-Client-IP': `203.0.113.${i + 1}` }),
          body: { email: i % 2 ? 'ANA@example.pt ' : 'ana@example.pt', locale: 'en' },
        });
        statuses.push(ctx.status);
      }
      expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
      expect(send).toHaveBeenCalledTimes(5);
      // The log line carries the rule only: never the e-mail nor its hash.
      const logged = JSON.stringify(t.c.log.warn.mock.calls);
      expect(logged).toContain('RATE_LIMITED email.send');
      expect(logged).not.toContain('ana@');
      expect(logged).not.toContain(sha('ana@example.pt'));
    });

    it('the same for confirm (email.confirm per e-mail)', async () => {
      const t = setup({ fixedClock: true });
      const confirm = vi
        .spyOn(t.sessions, 'confirmEmailVerification')
        .mockResolvedValue({ verified: true });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const token = await t.open();
        const ctx = await t.call('confirmEmailVerification', {
          headers: S(token, { 'X-Storefront-Client-IP': `203.0.113.${i + 1}` }),
          body: { email: 'ana@example.pt', code: '123456' },
        });
        statuses.push(ctx.status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
      expect(confirm).toHaveBeenCalledTimes(5);
    });

    it('F2: requests without a valid session never spend the e-mail budget', async () => {
      const t = setup({ fixedClock: true });
      const send = vi
        .spyOn(t.sessions, 'requestEmailVerification')
        .mockResolvedValue({ expiresAt: '2026-11-11T10:10:00.000Z' });
      const body = { email: 'ana@example.pt', locale: 'en' };
      for (let i = 0; i < 20; i++) {
        const headers: Record<string, string> = {
          'X-Storefront-Client-IP': `198.51.100.${i + 1}`,
          ...(i % 2 ? { 'X-Checkout-Session': `bogus-${i}` } : {}),
        };
        const ctx = await t.call('requestEmailVerification', { headers, body });
        expect(ctx.status).toBe(401);
        expect(errorOf(ctx).details.code).toBe('SESSION_INVALID');
      }
      // The customer still has the whole e-mail budget (5 per hour) with real sessions.
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const token = await t.open();
        const ctx = await t.call('requestEmailVerification', {
          headers: S(token, { 'X-Storefront-Client-IP': `203.0.113.${i + 1}` }),
          body,
        });
        statuses.push(ctx.status);
      }
      expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
      expect(send).toHaveBeenCalledTimes(5);
    });

    it('F2: a request refused by its session limit does not count against the e-mail', async () => {
      const t = setup({ fixedClock: true });
      vi.spyOn(t.sessions, 'requestEmailVerification').mockResolvedValue({
        expiresAt: '2026-11-11T10:10:00.000Z',
      });
      const body = { email: 'ana@example.pt', locale: 'en' };
      const token = await t.open();
      const statuses: number[] = [];
      // email.send: 3 per session per 15 min, 5 per e-mail per hour.
      for (let i = 0; i < 10; i++) {
        statuses.push((await t.call('requestEmailVerification', { headers: S(token), body })).status);
      }
      expect(statuses).toEqual([202, 202, 202, 429, 429, 429, 429, 429, 429, 429]);
      // Only 3 e-mail hits were spent: two more sessions still get through, the third does not.
      const more: number[] = [];
      for (let i = 0; i < 3; i++) {
        const other = await t.open();
        more.push((await t.call('requestEmailVerification', { headers: S(other), body })).status);
      }
      expect(more).toEqual([202, 202, 429]);
    });

    it('POST /checkout/email-verification → 202 { expiresAt } with the resolved locale', async () => {
      const t = setup();
      const send = vi
        .spyOn(t.sessions, 'requestEmailVerification')
        .mockResolvedValue({ expiresAt: '2026-11-11T10:10:00.000Z' });
      const token = await t.open();
      const ctx = await t.call('requestEmailVerification', {
        headers: S(token),
        body: { email: 'ana@example.pt' },
      });
      expect(ctx.status).toBe(202);
      expect(ctx.body).toEqual({ expiresAt: '2026-11-11T10:10:00.000Z' });
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: t.rowOf(token).id }), {
        email: 'ana@example.pt',
        locale: 'en',
      });
      const bad = await t.call('requestEmailVerification', {
        headers: S(token),
        body: { email: 'ana@example.pt', locale: 'xx' },
      });
      expect(bad.status).toBe(400);
    });
  });

  describe('sessions', () => {
    it('POST /checkout/session → 201 { token, expiresAt }; with the current token → 200 { token: null, expiresAt, reused: true }', async () => {
      const t = setup();
      const first = await t.call('openSession');
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ token: expect.any(String), expiresAt: expect.any(String) });
      const again = await t.call('openSession', { headers: S(first.body.token) });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ token: null, expiresAt: first.body.expiresAt, reused: true });
    });

    it('an S route without X-Checkout-Session, or with an unknown token → 401 SESSION_INVALID (logged)', async () => {
      const t = setup();
      for (const headers of [{}, S('not-a-token'), S('a'.repeat(43))]) {
        const ctx = await t.call('getCart', { headers });
        expect(ctx.status).toBe(401);
        expect(ctx.body).toEqual({
          data: null,
          error: {
            status: 401,
            name: 'UnauthorizedError',
            message: 'Invalid session',
            details: { code: 'SESSION_INVALID' },
          },
        });
      }
      expect(t.c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] SESSION_INVALID');
    });

    it('an expired session → 401 SESSION_INVALID on status and payment; the order stays OPEN / PENDING', async () => {
      const t = setup();
      const token = await t.open();
      const created = await t.call('createOrder', {
        headers: S(token, { 'Idempotency-Key': 'key-expired-01' }),
        body: orderBody(),
      });
      expect(created.status).toBe(201);
      t.rowOf(token).expiresAt = new Date(Date.now() - 1000);
      for (const handler of ['orderStatus', 'paymentLink']) {
        const ctx = await t.call(handler, {
          headers: S(token),
          params: { publicId: created.body.publicId },
        });
        expect(ctx.status).toBe(401);
        expect(errorOf(ctx).details.code).toBe('SESSION_INVALID');
      }
      expect(t.c.tables[UIDS.order][0]).toMatchObject({ orderStatus: 'OPEN', paymentStatus: 'PENDING' });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('GET /cart → the stored cart', async () => {
      const t = setup();
      const token = await t.open();
      await t.call('quoteCart', {
        headers: S(token),
        body: { lines: [{ variantId: 10, quantity: 1 }], locale: 'pt' },
      });
      const ctx = await t.call('getCart', { headers: S(token) });
      expect(ctx.status).toBe(200);
      expect(ctx.body).toMatchObject({ lines: [{ variantId: 10, quantity: 1 }], locale: 'pt' });
    });
  });

  describe('quotes and discounts', () => {
    it('/cart/quote and /discounts/apply with lines: [] → 200 with an empty quote', async () => {
      const t = setup();
      const token = await t.open();
      const q = await t.call('quoteCart', { headers: S(token), body: { lines: [] } });
      expect(q.status).toBe(200);
      expect(q.body.lines).toEqual([]);
      expect(q.body.totals.total).toBe(0);
      const d = await t.call('applyDiscount', { headers: S(token), body: { lines: [], code: 'VERAO' } });
      expect(d.status).toBe(200);
      expect(d.body).toMatchObject({ applied: false, quote: { lines: [] } });
    });

    it('/cart/quote validates the lines (quantity 0, more than 100 lines)', async () => {
      const t = setup();
      const token = await t.open();
      const zero = await t.call('quoteCart', {
        headers: S(token),
        body: { lines: [{ variantId: 10, quantity: 0 }] },
      });
      expect(zero.status).toBe(400);
      const many = await t.call('quoteCart', {
        headers: S(token),
        body: { lines: Array.from({ length: 101 }, (_, i) => ({ variantId: i + 1, quantity: 1 })) },
      });
      expect(many.status).toBe(400);
    });

    it('unknown fields of the cart never reach the service', async () => {
      const t = setup();
      const token = await t.open();
      const quote = vi.spyOn(t.checkout, 'quote');
      await t.call('quoteCart', {
        headers: S(token),
        body: {
          lines: [{ variantId: 10, quantity: 1, unitPrice: 1 }],
          locale: 'en',
          emailVerified: true,
          discount: 9999,
        },
      });
      const input = quote.mock.calls[0][1] as any;
      expect(input).not.toHaveProperty('emailVerified');
      expect(input).not.toHaveProperty('discount');
      expect(input.lines).toEqual([{ variantId: 10, quantity: 1 }]);
    });

    it('/discounts/apply masks the status of a customer-limited code (NOT_ELIGIBLE)', async () => {
      const t = setup();
      const id = t.addPromotion(1, { method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
      t.c.tables[UIDS.promotionCustomerUsage].push({
        id: 1,
        promotion: id,
        emailNormalized: 'ana@example.pt',
        uses: 1,
        uniqueKey: `p${id}:${sha('ana@example.pt')}`,
      });
      const token = await t.open();
      t.verify(token, 'ana@example.pt');
      const ctx = await t.call('applyDiscount', {
        headers: S(token),
        body: { lines: [{ variantId: 10, quantity: 2 }], email: 'ana@example.pt', code: 'once' },
      });
      expect(ctx.status).toBe(200);
      expect(ctx.body.status).toBe('NOT_ELIGIBLE');
      expect(JSON.stringify(ctx.body)).not.toContain('Interno-');
    });
  });

  describe('POST /orders', () => {
    it('without Idempotency-Key, or with a malformed one → 400 invalid_idempotency_key', async () => {
      const t = setup();
      const token = await t.open();
      for (const key of [undefined, 'short', 'has space key', 'x'.repeat(101), 'bad/char-key']) {
        const ctx = await t.call('createOrder', {
          headers: S(token, key === undefined ? {} : { 'Idempotency-Key': key }),
          body: orderBody(),
        });
        expect(ctx.status).toBe(400);
        expect(errorOf(ctx).details.code).toBe('invalid_idempotency_key');
      }
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
    });

    it('without expectedTotal, with lines: [] or with quantity 0 → 400, nothing created', async () => {
      const t = setup();
      const token = await t.open();
      const place = vi.spyOn(t.checkout, 'placeOrder');
      const bodies = [
        orderBody({ expectedTotal: undefined }),
        orderBody({ lines: [] }),
        orderBody({ lines: [{ variantId: 10, quantity: 0 }] }),
      ];
      for (const [i, body] of bodies.entries()) {
        const ctx = await t.call('createOrder', {
          headers: S(token, { 'Idempotency-Key': `key-invalid-${i}` }),
          body,
        });
        expect(ctx.status).toBe(400);
      }
      expect(place).not.toHaveBeenCalled();
      expect(t.c.tables[UIDS.order]).toHaveLength(0);
    });

    it('a unitPrice (or any unknown field) in the body never reaches the service', async () => {
      const t = setup();
      const token = await t.open();
      const place = vi.spyOn(t.checkout, 'placeOrder');
      const ctx = await t.call('createOrder', {
        headers: S(token, { 'Idempotency-Key': 'key-unknown-01' }),
        body: orderBody({
          lines: [{ variantId: 10, quantity: 2, unitPrice: 1 }],
          unitPrice: 1,
          paymentStatus: 'PAID',
          emailVerified: true,
          total: 1,
        }),
      });
      expect(ctx.status).toBe(201);
      const [, input, key] = place.mock.calls[0] as any[];
      expect(key).toBe('key-unknown-01');
      expect(JSON.stringify(input)).not.toContain('unitPrice');
      expect(input).not.toHaveProperty('paymentStatus');
      expect(input).not.toHaveProperty('emailVerified');
      expect(input).not.toHaveProperty('total');
      expect(input.lines).toEqual([{ variantId: 10, quantity: 2 }]);
      expect(t.c.tables[UIDS.orderLine][0].unitPrice).toBe(2000);
    });

    it('order.create: the 6th creation in the same session within 10 min → 429', async () => {
      const t = setup({ fixedClock: true });
      const token = await t.open();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const ctx = await t.call('createOrder', {
          headers: S(token, { 'Idempotency-Key': `key-limit-${i}0` }),
          body: orderBody({ lines: [] }),
        });
        statuses.push(ctx.status);
      }
      expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
      expect(t.c.log.warn).toHaveBeenCalledWith('[ecommerce:storefront] RATE_LIMITED order.create');
    });

    describe('code masking (preflight C2)', () => {
      const place = async (
        t: ReturnType<typeof setup>,
        token: string,
        code: string,
        key: string
      ) =>
        t.call('createOrder', {
          headers: S(token, { 'Idempotency-Key': key }),
          body: orderBody({ promotionCodes: [code] }),
        });

      it('CUSTOMER_LIMIT_REACHED and EMAIL_NOT_ELIGIBLE → the same 400 PROMOTION_CODE_INVALID NOT_ELIGIBLE on promotionCodes.0', async () => {
        const t = setup();
        const once = t.addPromotion(1, { method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
        t.c.tables[UIDS.promotionCustomerUsage].push({
          id: 1,
          promotion: once,
          emailNormalized: 'ana@example.pt',
          uses: 1,
          uniqueKey: `p${once}:${sha('ana@example.pt')}`,
        });
        t.addPromotion(2, {
          method: 'CODE',
          code: 'VIP',
          eligibility: { mode: 'EMAILS', emails: ['rui@example.pt'] },
        });
        const token = await t.open();
        t.verify(token, 'ana@example.pt');

        const limited = await place(t, token, 'ONCE', 'key-mask-0001');
        const listed = await place(t, token, 'VIP', 'key-mask-0002');
        for (const ctx of [limited, listed]) {
          expect(ctx.status).toBe(400);
          expect(ctx.body).toEqual({
            data: null,
            error: {
              status: 400,
              name: 'BadRequestError',
              message: 'Invalid request',
              details: {
                code: 'PROMOTION_CODE_INVALID',
                errors: [{ path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'NOT_ELIGIBLE' }],
              },
            },
          });
          const raw = JSON.stringify(ctx.body);
          expect(raw).not.toContain('promotions.');
          expect(raw).not.toContain('CUSTOMER_LIMIT_REACHED');
          expect(raw).not.toContain('EMAIL_NOT_ELIGIBLE');
        }
        expect(t.c.tables[UIDS.order]).toHaveLength(0);
      });

      it('a deactivated or scheduled code → NOT_FOUND', async () => {
        const t = setup();
        t.addPromotion(1, { method: 'CODE', code: 'OFF', active: false });
        t.addPromotion(2, { method: 'CODE', code: 'SOON', startsAt: '2099-01-01T00:00:00.000Z' });
        const token = await t.open();
        for (const [code, key] of [
          ['OFF', 'key-mask-0003'],
          ['SOON', 'key-mask-0004'],
        ]) {
          const ctx = await place(t, token, code, key);
          expect(ctx.status).toBe(400);
          expect(errorOf(ctx).details.errors).toEqual([
            { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'NOT_FOUND' },
          ]);
        }
      });

      it('only USAGE_LIMIT_REACHED → 409 PROMOTION_UNAVAILABLE, without the promotion id', async () => {
        const t = setup();
        t.addPromotion(41, { method: 'CODE', code: 'ULTIMO', usageLimit: 1, redemptions: 1 });
        const token = await t.open();
        const ctx = await place(t, token, 'ultimo', 'key-mask-0005');
        expect(ctx.status).toBe(409);
        expect(ctx.body.error).toMatchObject({
          status: 409,
          name: 'ConflictError',
          details: {
            code: 'PROMOTION_UNAVAILABLE',
            errors: [{ path: 'promotionCodes.0', code: 'PROMOTION_UNAVAILABLE', detail: 'USAGE_LIMIT_REACHED' }],
          },
        });
        const raw = JSON.stringify(ctx.body);
        expect(raw).not.toContain('promotions.');
        expect(raw).not.toContain('41');
      });
    });

    describe('fix round 1: refusal reasons', () => {
      const place = (t: ReturnType<typeof setup>, token: string, code: string, key: string) =>
        t.call('createOrder', {
          headers: S(token, { 'Idempotency-Key': key }),
          body: orderBody({ promotionCodes: [code] }),
        });
      const refuse = (t: ReturnType<typeof setup>, promotionId: number, detail: string) =>
        vi.spyOn(t.c.orders, 'create').mockRejectedValue(
          new EcommerceValidationError('Promotion unavailable', [
            { path: `promotions.${promotionId}`, code: 'PROMOTION_UNAVAILABLE', detail },
          ])
        );

      it('F1: no per-customer limit → 409 USAGE_LIMIT_REACHED even when the global counter looks free (race)', async () => {
        const t = setup();
        t.addPromotion(5, { method: 'CODE', code: 'FREE', usageLimit: 10, redemptions: 3 });
        const token = await t.open();
        t.verify(token, 'ana@example.pt');
        refuse(t, 5, 'FREE');
        const ctx = await place(t, token, 'FREE', 'key-fix1-0001');
        expect(ctx.status).toBe(409);
        expect(errorOf(ctx).details.errors).toEqual([
          { path: 'promotionCodes.0', code: 'PROMOTION_UNAVAILABLE', detail: 'USAGE_LIMIT_REACHED' },
        ]);
      });

      it('F1: a per-customer limit but an unverified session → 409 USAGE_LIMIT_REACHED, never NOT_ELIGIBLE', async () => {
        const t = setup();
        t.addPromotion(6, { method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
        const token = await t.open();
        refuse(t, 6, 'ONCE');
        const ctx = await place(t, token, 'ONCE', 'key-fix1-0002');
        expect(ctx.status).toBe(409);
        expect(JSON.stringify(ctx.body)).not.toContain('NOT_ELIGIBLE');
      });

      it('F6: a refused AUTOMATIC promotion whose admin code the customer typed → generic 409 on "promotions", no code echo', async () => {
        const t = setup();
        t.addPromotion(7, { method: 'AUTOMATIC', code: 'ADMIN7', usageLimit: 1, redemptions: 1 });
        const token = await t.open();
        refuse(t, 7, 'ADMIN7');
        const ctx = await place(t, token, 'ADMIN7', 'key-fix1-0003');
        expect(ctx.status).toBe(409);
        expect(errorOf(ctx).details.errors).toEqual([{ path: 'promotions', code: 'PROMOTION_UNAVAILABLE' }]);
      });

      it('F2: a failing lookup is logged (no personal data) and answers 409 USAGE_LIMIT_REACHED', async () => {
        const t = setup();
        t.addPromotion(8, { method: 'CODE', code: 'BROKEN', perCustomerLimit: 1 });
        const token = await t.open();
        t.verify(token, 'ana@example.pt');
        refuse(t, 8, 'BROKEN');
        const realQuery = t.c.strapi.db.query;
        t.c.strapi.db.query = (uid: string) =>
          uid === UIDS.promotion
            ? { findOne: async () => { throw new Error('db down'); } }
            : realQuery(uid);
        const ctx = await place(t, token, 'BROKEN', 'key-fix1-0004');
        t.c.strapi.db.query = realQuery;
        expect(ctx.status).toBe(409);
        expect(t.c.log.warn).toHaveBeenCalledWith(
          '[ecommerce:storefront] promotion refusal lookup failed: db down'
        );
        expect(JSON.stringify(t.c.log.warn.mock.calls)).not.toContain('ana@');
      });
    });
  });

  describe('payment and status', () => {
    it('a happy path: no success response mentions /admin or littlebox-strapi-suite', async () => {
      const t = setup();
      const opened = await t.call('openSession');
      const token = opened.body.token;
      const bodies: unknown[] = [opened.body];
      const ok = async (handler: string, req: Req, status = 200) => {
        const ctx = await t.call(handler, { ...req, headers: S(token, req.headers ?? {}) });
        expect(ctx.status).toBe(status);
        bodies.push(ctx.body);
        return ctx.body;
      };
      await ok('listProducts', {});
      await ok('quoteCart', { body: { lines: [{ variantId: 10, quantity: 2 }], locale: 'en' } });
      await ok('getCart', {});
      const order = await ok(
        'createOrder',
        { headers: { 'Idempotency-Key': 'key-happy-0001' }, body: orderBody() },
        201
      );
      const link = await ok('paymentLink', { params: { publicId: order.publicId } });
      expect(link).toMatchObject({ url: expect.stringContaining('https://checkout.stripe.com/'), amount: 4500 });
      await ok('orderStatus', { params: { publicId: order.publicId } });
      const raw = JSON.stringify(bodies);
      expect(raw).not.toContain('/admin');
      expect(raw).not.toContain('littlebox-strapi-suite');
    });

    it('another session\'s order or an unknown publicId → 404 ORDER_NOT_FOUND, no Stripe link', async () => {
      const t = setup();
      const a = await t.open();
      const order = await t.call('createOrder', {
        headers: S(a, { 'Idempotency-Key': 'key-owner-0001' }),
        body: orderBody(),
      });
      const b = await t.open();
      for (const publicId of [order.body.publicId, '00000000-0000-4000-8000-000000000000']) {
        for (const handler of ['paymentLink', 'orderStatus']) {
          const ctx = await t.call(handler, { headers: S(b), params: { publicId } });
          expect(ctx.status).toBe(404);
          expect(ctx.body).toEqual({
            data: null,
            error: {
              status: 404,
              name: 'NotFoundError',
              message: 'Order not found',
              details: { code: 'ORDER_NOT_FOUND' },
            },
          });
        }
      }
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('a :publicId that is not a UUID → 400', async () => {
      const t = setup();
      const token = await t.open();
      const ctx = await t.call('orderStatus', { headers: S(token), params: { publicId: '12' } });
      expect(ctx.status).toBe(400);
    });

    it('STRIPE_NOT_CONFIGURED → 503; NOTHING_DUE → 409', async () => {
      const t = setup();
      const token = await t.open();
      const publicId = '00000000-0000-4000-8000-000000000001';
      const link = vi.spyOn(t.checkout, 'paymentLink');
      link.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_NOT_CONFIGURED'));
      const a = await t.call('paymentLink', { headers: S(token), params: { publicId } });
      expect(a.status).toBe(503);
      expect(errorOf(a).details).toEqual({ code: 'STRIPE_NOT_CONFIGURED' });
      link.mockRejectedValueOnce(new EcommercePaymentError('NOTHING_DUE'));
      const b = await t.call('paymentLink', { headers: S(token), params: { publicId } });
      expect(b.status).toBe(409);
      expect(errorOf(b).details).toEqual({ code: 'NOTHING_DUE' });
    });
  });

  describe('catalog and store credit', () => {
    it('GET /products/:slug of an unknown product → 404 NOT_FOUND', async () => {
      const t = setup();
      const ctx = await t.call('getProduct', { params: { slug: 'nope' } });
      expect(ctx.status).toBe(404);
      expect(errorOf(ctx).details).toEqual({ code: 'NOT_FOUND' });
    });

    it('GET /products with an unknown locale → 400', async () => {
      const t = setup();
      const ctx = await t.call('listProducts', { query: { locale: 'xx' } });
      expect(ctx.status).toBe(400);
    });

    it('POST /store-credit/check of another e-mail → 400 STORE_CREDIT_NOT_FOUND', async () => {
      const t = setup();
      const customer = await t.c.services.EcommerceCustomerService.findOrCreate({
        firstName: 'X',
        lastName: 'Y',
        email: 'ana@example.pt',
      });
      const issued = await t.c.storeCredits.issue({
        customerId: customer.id,
        amount: 3000,
        actor: 'user:1',
        operationKey: 'issue:ana',
      });
      const token = await t.open();
      const ctx = await t.call('checkStoreCredit', {
        headers: S(token),
        body: { code: issued.code, email: 'rui@example.pt' },
      });
      expect(ctx.status).toBe(400);
      expect(errorOf(ctx).details).toEqual({
        code: 'STORE_CREDIT_NOT_FOUND',
        errors: [{ path: 'code', code: 'STORE_CREDIT_NOT_FOUND' }],
      });
    });
  });
});

describe('handleStorefrontError', () => {
  const run = (err: unknown, opts: Parameters<typeof handleStorefrontError>[2] = { notFound: 'ORDER_NOT_FOUND' }) => {
    const ctx = mkCtx();
    handleStorefrontError(ctx, err, opts);
    return ctx;
  };
  const invalid = (...errors: any[]) => new EcommerceValidationError('x', errors);

  it.each([
    [new EcommercePaymentError('STRIPE_NOT_CONFIGURED'), 503],
    [new EcommercePaymentError('STOREFRONT_URL_MISSING'), 503],
    [new EcommercePaymentError('STRIPE_UNREACHABLE'), 502],
    [new EcommercePaymentError('STRIPE_REQUEST_FAILED'), 502],
    [new EcommercePaymentError('NOTHING_DUE'), 409],
    [new EcommercePaymentError('PAYMENT_PENDING'), 409],
    [new EcommerceEmailError('EMAIL_NOT_CONFIGURED', 'Resend is not active.'), 503],
    [new EcommerceEmailError('EMAIL_SEND_FAILED'), 502],
    [new EcommerceCarrierError('CARRIER_UNREACHABLE'), 502],
  ])('%s → %i with details.code and no provider message', (err, status) => {
    const ctx = run(err);
    expect(ctx.status).toBe(status);
    expect(ctx.body.data).toBeNull();
    expect(ctx.body.error.status).toBe(status);
    expect(ctx.body.error.details).toEqual({ code: (err as any).code });
    expect(JSON.stringify(ctx.body)).not.toContain('Resend');
  });

  it('anything else is rethrown (generic 500 from Strapi)', () => {
    const boom = new Error('db down');
    expect(() => run(boom)).toThrow(boom);
    expect(() => run(new EcommercePaymentError('STRIPE_SESSION_MISMATCH'))).toThrow();
  });

  it('not found → ORDER_NOT_FOUND on order routes, NOT_FOUND on the catalog', () => {
    expect(run(new EcommerceNotFoundError('x')).body.error.details).toEqual({ code: 'ORDER_NOT_FOUND' });
    const c = run(new EcommerceNotFoundError('x'), { notFound: 'NOT_FOUND' });
    expect(c.status).toBe(404);
    expect(c.body.error.details).toEqual({ code: 'NOT_FOUND' });
  });

  it('SESSION_INVALID → 401; VERIFICATION_CODE_INVALID → 400; VERIFICATION_CONFLICT, TOTAL_CHANGED, STORE_CREDIT_INSUFFICIENT and ACTION_NOT_AVAILABLE → 409', () => {
    expect(run(invalid({ path: 'session', code: 'SESSION_INVALID' })).status).toBe(401);
    expect(run(invalid({ path: 'code', code: 'VERIFICATION_CODE_INVALID' })).status).toBe(400);
    for (const code of ['VERIFICATION_CONFLICT', 'TOTAL_CHANGED', 'STORE_CREDIT_INSUFFICIENT', 'ACTION_NOT_AVAILABLE']) {
      const ctx = run(invalid({ path: 'x', code }));
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details.code).toBe(code);
    }
  });

  it('VERIFICATION_LOCKED → 429 with Retry-After up to the locked code expiry', () => {
    const ctx = run(invalid({ path: 'code', code: 'VERIFICATION_LOCKED' }), {
      notFound: 'ORDER_NOT_FOUND',
      lockedRetryAfterSec: 321,
    });
    expect(ctx.status).toBe(429);
    expect(ctx.responseHeaders['Retry-After']).toBe('321');
    expect(ctx.body.error.details).toEqual({ code: 'VERIFICATION_LOCKED', retryAfter: 321 });
  });

  it('STORE_CREDIT_EMAIL_MISMATCH → STORE_CREDIT_NOT_FOUND', () => {
    const ctx = run(invalid({ path: 'storeCreditCode', code: 'STORE_CREDIT_EMAIL_MISMATCH' }));
    expect(JSON.stringify(ctx.body)).not.toContain('MISMATCH');
    expect(ctx.body.error.details.code).toBe('STORE_CREDIT_NOT_FOUND');
  });

  it('a refused automatic promotion (no entered code) → 409 PROMOTION_UNAVAILABLE on "promotions", without its id or admin code', () => {
    const ctx = run(
      invalid({ path: 'promotions.77', code: 'PROMOTION_UNAVAILABLE', detail: 'ADMINCODE', reason: 'CUSTOMER_LIMIT_REACHED' }),
      { notFound: 'ORDER_NOT_FOUND', promotionCodes: ['OTHER'] }
    );
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.errors).toEqual([{ path: 'promotions', code: 'PROMOTION_UNAVAILABLE' }]);
    expect(JSON.stringify(ctx.body)).not.toMatch(/77|ADMINCODE|CUSTOMER_LIMIT/);
  });

  it('raw statuses on PROMOTION_CODE_INVALID are masked (an unknown status → NOT_FOUND)', () => {
    const ctx = run(
      invalid(
        { path: 'promotionCodes.0', code: 'PROMOTION_CODE_INVALID', detail: 'INACTIVE' },
        { path: 'promotionCodes.1', code: 'PROMOTION_CODE_INVALID', detail: 'EXPIRED' },
        { path: 'promotionCodes.2', code: 'PROMOTION_CODE_INVALID', detail: 'WHATEVER' }
      )
    );
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.details.errors.map((e: any) => e.detail)).toEqual(['NOT_FOUND', 'EXPIRED', 'NOT_FOUND']);
  });
});
