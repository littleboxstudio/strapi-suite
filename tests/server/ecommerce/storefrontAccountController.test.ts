import { describe, expect, it, vi } from 'vitest';
import createAccountController from '../../../server/src/controllers/modules/ecommerce/storefrontAccount';
import createStorefrontController from '../../../server/src/controllers/modules/ecommerce/storefront';
import {
  EcommerceAccountError,
  EcommerceAccountsUnavailableError,
  EcommerceNotFoundError,
  EcommerceRateLimitError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';

type Mode = 'GUEST_ONLY' | 'REGISTERED_ONLY' | 'BOTH';
type Req = {
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
};

const PASSWORD = 'S3cret-horse-battery';
const EMAIL = 'Ana@Example.pt';
const UUID = '0b8f7a52-9a8e-4c63-9c1e-3f1f2a6b7c8d';

const CUSTOMER = {
  id: 41,
  email: EMAIL,
  emailNormalized: 'ana@example.pt',
  firstName: 'Ana',
  lastName: 'Silva',
  phone: null,
  locale: 'pt',
  accountType: 'REGISTERED',
  emailVerified: true,
  blocked: false,
  passwordChangedAt: null,
  pendingEmail: null,
};
const GUEST = {
  id: 55,
  expiresAt: '2027-01-01T00:00:00.000Z',
  cart: { lines: [{ variantId: 1, quantity: 1 }] },
  verifiedEmail: null,
  emailVerification: {},
  verificationAttempts: 0,
};
const LOGIN = { token: 'JWT', expiresAt: '2027-01-01T00:00:00.000Z', customer: { id: 41 } };

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
    set: (name: string, value: string) => {
      responseHeaders[name] = value;
    },
    responseHeaders,
  };
};

const setup = (mode: Mode = 'BOTH') => {
  const accounts = {
    register: vi.fn(async (_i: any) => undefined),
    verifyEmail: vi.fn(async (..._a: any[]) => LOGIN),
    resendVerification: vi.fn(async (_e: any) => undefined),
    login: vi.fn(async (..._a: any[]): Promise<any> => LOGIN),
    logout: vi.fn(async (..._a: any[]) => undefined),
    forgotPassword: vi.fn(async (_e: any) => undefined),
    resetPassword: vi.fn(async (_i: any) => undefined),
    getProfile: vi.fn(async (_c: any) => ({ id: 41, email: EMAIL })),
    updateProfile: vi.fn(async (..._a: any[]) => ({ id: 41, email: EMAIL })),
    changePassword: vi.fn(async (..._a: any[]) => ({ token: 'JWT2', expiresAt: '2027-02-01T00:00:00.000Z' })),
    requestEmailChange: vi.fn(async (..._a: any[]) => undefined),
    confirmEmailChange: vi.fn(async (_t: any) => undefined),
    listOrders: vi.fn(async (..._a: any[]) => ({ results: [], pagination: { page: 1 } })),
    getOrder: vi.fn(async (..._a: any[]): Promise<any> => ({ publicId: UUID })),
  };
  const customerSessions = {
    resolve: vi.fn(async (t: string): Promise<any> => (t === 'good' ? { sessionId: 7, customer: CUSTOMER } : null)),
    list: vi.fn(async (..._a: any[]) => [{ id: 7, current: true }]),
    revoke: vi.fn(async (..._a: any[]) => true),
    revokeAll: vi.fn(async (..._a: any[]) => 2),
  };
  const guestSessions = {
    resolve: vi.fn(async (t: string) => (t === 'guest' ? GUEST : null)),
    open: vi.fn(async () => ({ token: 'NEW', expiresAt: 'x', reused: false })),
    requestEmailVerification: vi.fn(async (..._a: any[]): Promise<any> => ({ expiresAt: 'x' })),
    confirmEmailVerification: vi.fn(async (..._a: any[]) => ({ verified: true })),
  };
  const checkout = {
    getCart: vi.fn(async (owner: any) => (owner.kind === 'guest' ? owner.session.cart : { lines: [] })),
    quote: vi.fn(async (..._a: any[]) => ({ quoted: true })),
    applyDiscount: vi.fn(async (..._a: any[]) => ({ applied: true })),
    checkStoreCredit: vi.fn(async (..._a: any[]) => ({ ok: true })),
    placeOrder: vi.fn(async (..._a: any[]): Promise<any> => ({ publicId: UUID })),
    paymentLink: vi.fn(async (..._a: any[]) => ({ url: 'u' })),
    orderStatus: vi.fn(async (..._a: any[]) => ({ publicId: UUID })),
  };
  const catalog = {
    resolveLocale: vi.fn(async () => 'en'),
    listProducts: vi.fn(async () => ({ results: [] })),
  };
  const pickup = { search: vi.fn(async () => []) };
  const settings = { getStoreSettings: vi.fn(async () => ({ customerAccountsMode: mode })) };
  const services: Record<string, unknown> = {
    EcommerceAccountService: accounts,
    EcommerceCustomerSessionService: customerSessions,
    EcommerceStorefrontSessionService: guestSessions,
    EcommerceStorefrontCheckoutService: checkout,
    EcommerceStorefrontCatalogService: catalog,
    EcommercePickupPointService: pickup,
    EcommerceSettingsService: settings,
  };
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const strapi: any = { log, plugin: () => ({ service: (n: string) => services[n] }) };
  const account: any = createAccountController({ strapi });
  const storefront: any = createStorefrontController({ strapi });
  const run = async (c: any, handler: string, req: Req = {}) => {
    const ctx = mkCtx(req);
    await c[handler](ctx);
    return ctx;
  };
  return {
    accounts,
    customerSessions,
    guestSessions,
    checkout,
    catalog,
    settings,
    log,
    acc: (h: string, req?: Req) => run(account, h, req),
    sf: (h: string, req?: Req) => run(storefront, h, req),
  };
};

const G = { 'X-Checkout-Session': 'guest' };
const C = { 'X-Customer-Token': 'good' };
const BAD = { 'X-Customer-Token': 'expired' };
const IP = { 'X-Storefront-Client-IP': '203.0.113.7' };
const details = (ctx: any) => ctx.body?.error?.details;
const customerOwner = { kind: 'customer', customer: CUSTOMER, sessionId: 7 };
const guestOwner = { kind: 'guest', session: GUEST };

describe('access through the storefront controller', () => {
  it('Review Focus 1: expired login token + valid guest on cart.quote in BOTH → 401 CUSTOMER_SESSION_INVALID', async () => {
    const t = setup('BOTH');
    const ctx = await t.sf('quoteCart', { headers: { ...G, ...BAD }, body: { lines: [] } });
    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({
      data: null,
      error: {
        status: 401,
        name: 'UnauthorizedError',
        message: 'Invalid customer session',
        details: { code: 'CUSTOMER_SESSION_INVALID' },
      },
    });
    expect(t.checkout.quote).not.toHaveBeenCalled();
  });

  it('BOTH: a valid login token wins over the guest session (CartOwner customer)', async () => {
    const t = setup('BOTH');
    const ctx = await t.sf('quoteCart', { headers: { ...G, ...C }, body: { lines: [] } });
    expect(ctx.status).toBe(200);
    expect(t.checkout.quote.mock.calls[0][0]).toEqual(customerOwner);
  });

  it('BOTH: guest session only → guest owner', async () => {
    const t = setup('BOTH');
    expect((await t.sf('quoteCart', { headers: G, body: { lines: [] } })).status).toBe(200);
    expect(t.checkout.quote.mock.calls[0][0]).toEqual(guestOwner);
  });

  it('REGISTERED_ONLY: checkout with a guest session only → 401 LOGIN_REQUIRED', async () => {
    const t = setup('REGISTERED_ONLY');
    const ctx = await t.sf('quoteCart', { headers: G, body: { lines: [] } });
    expect(ctx.status).toBe(401);
    expect(details(ctx)).toEqual({ code: 'LOGIN_REQUIRED' });
    expect(t.checkout.quote).not.toHaveBeenCalled();
  });

  it('REGISTERED_ONLY: order status stays open to a guest session', async () => {
    const t = setup('REGISTERED_ONLY');
    const ctx = await t.sf('orderStatus', { headers: G, params: { publicId: UUID } });
    expect(ctx.status).toBe(200);
    expect(t.checkout.orderStatus).toHaveBeenCalledWith(guestOwner, UUID);
  });

  it('GUEST_ONLY: the login token is not even resolved on checkout; guest rules apply', async () => {
    const t = setup('GUEST_ONLY');
    expect((await t.sf('quoteCart', { headers: { ...G, ...BAD }, body: { lines: [] } })).status).toBe(200);
    expect(t.checkout.quote.mock.calls[0][0]).toEqual(guestOwner);
    const noGuest = await t.sf('quoteCart', { headers: C, body: { lines: [] } });
    expect(details(noGuest)).toEqual({ code: 'SESSION_INVALID' });
    expect(t.customerSessions.resolve).not.toHaveBeenCalled();
  });

  it('no session at all → the existing SESSION_INVALID', async () => {
    const t = setup('BOTH');
    const ctx = await t.sf('quoteCart', { body: { lines: [] } });
    expect(ctx.status).toBe(401);
    expect(details(ctx)).toEqual({ code: 'SESSION_INVALID' });
  });

  it('GET /cart goes through checkout.getCart(owner)', async () => {
    const t = setup('BOTH');
    const guest = await t.sf('getCart', { headers: G });
    expect(guest.body).toEqual(GUEST.cart);
    const customer = await t.sf('getCart', { headers: C });
    expect(customer.body).toEqual({ lines: [] });
    expect(t.checkout.getCart.mock.calls.map((c) => c[0])).toEqual([guestOwner, customerOwner]);
  });

  it('catalog routes never read the session headers', async () => {
    const t = setup('BOTH');
    const ctx = await t.sf('listProducts', { headers: { ...G, ...BAD } });
    expect(ctx.status).toBe(200);
    expect(t.customerSessions.resolve).not.toHaveBeenCalled();
    expect(t.guestSessions.resolve).not.toHaveBeenCalled();
    expect(t.settings.getStoreSettings).not.toHaveBeenCalled();
  });

  it('openSession: an invalid login token → 401; a valid one still opens a guest session', async () => {
    const t = setup('BOTH');
    const bad = await t.sf('openSession', { headers: BAD });
    expect(details(bad)).toEqual({ code: 'CUSTOMER_SESSION_INVALID' });
    expect(t.guestSessions.open).not.toHaveBeenCalled();
    const ok = await t.sf('openSession', { headers: C });
    expect(ok.status).toBe(201);
    expect(t.guestSessions.open).toHaveBeenCalledTimes(1);
  });

  it('pickup points: a login session is enough', async () => {
    const t = setup('REGISTERED_ONLY');
    expect((await t.sf('pickupPoints', { headers: C, query: { postalCode: '1000-001' } })).status).toBe(200);
  });

  it('missing key source while resolving the login token → 503 ACCOUNTS_UNAVAILABLE', async () => {
    const t = setup('BOTH');
    t.customerSessions.resolve.mockRejectedValueOnce(new EcommerceAccountsUnavailableError());
    const ctx = await t.sf('quoteCart', { headers: { ...G, ...C }, body: { lines: [] } });
    expect(ctx.status).toBe(503);
    expect(details(ctx)).toEqual({ code: 'ACCOUNTS_UNAVAILABLE' });
  });

  it('checkout e-mail verification does not apply to a login session → 409 ACTION_NOT_AVAILABLE', async () => {
    const t = setup('BOTH');
    const ctx = await t.sf('requestEmailVerification', { headers: C, body: { email: EMAIL } });
    expect(ctx.status).toBe(409);
    expect(details(ctx).code).toBe('ACTION_NOT_AVAILABLE');
    expect(t.guestSessions.requestEmailVerification).not.toHaveBeenCalled();
  });

  it('M5: refused for a login session before the e-mail key is counted', async () => {
    const t = setup('BOTH');
    // email.send allows 5 per e-mail per hour; 6 refusals with a login session spend none of it.
    for (let i = 0; i < 6; i++) {
      const s = { 'X-Customer-Token': 'good' };
      t.customerSessions.resolve.mockResolvedValueOnce({ sessionId: 100 + i, customer: CUSTOMER });
      expect((await t.sf('requestEmailVerification', { headers: s, body: { email: EMAIL } })).status).toBe(409);
    }
    expect((await t.sf('requestEmailVerification', { headers: G, body: { email: EMAIL } })).status).toBe(202);
  });

  it('CUSTOMER_BLOCKED from the checkout e-mail verification and from createOrder → 403', async () => {
    const t = setup('BOTH');
    t.guestSessions.requestEmailVerification.mockRejectedValueOnce(new EcommerceAccountError('CUSTOMER_BLOCKED', 403));
    const v = await t.sf('requestEmailVerification', { headers: G, body: { email: EMAIL } });
    expect(v.status).toBe(403);
    expect(v.body.error).toMatchObject({ status: 403, name: 'ForbiddenError', details: { code: 'CUSTOMER_BLOCKED' } });
    t.checkout.placeOrder.mockRejectedValueOnce(new EcommerceAccountError('CUSTOMER_BLOCKED', 403));
    const o = await t.sf('createOrder', {
      headers: { ...G, 'Idempotency-Key': 'order-key-1234' },
      body: {
        customer: { firstName: 'Ana', lastName: 'Silva', email: EMAIL },
        shippingAddress: { line1: 'R', city: 'L', postalCode: '1000-001', country: 'PT' },
        lines: [{ variantId: 1, quantity: 1 }],
        shippingMethod: { providerId: 'manual', serviceId: '1' },
        expectedTotal: 100,
      },
    });
    expect(o.status).toBe(403);
    expect(details(o)).toEqual({ code: 'CUSTOMER_BLOCKED' });
  });

  it('store credit with a login session checks against the account e-mail', async () => {
    const t = setup('BOTH');
    await t.sf('checkStoreCredit', { headers: C, body: { code: 'SC-1', email: 'other@x.pt' } });
    expect(t.checkout.checkStoreCredit).toHaveBeenCalledWith({ code: 'SC-1', email: EMAIL });
  });
});

describe('account routes: access', () => {
  it('Review Focus 5: GUEST_ONLY GET /account/me with a valid token → 403, the token is never resolved', async () => {
    const t = setup('GUEST_ONLY');
    const ctx = await t.acc('me', { headers: C });
    expect(ctx.status).toBe(403);
    expect(ctx.body.error).toEqual({
      status: 403,
      name: 'ForbiddenError',
      message: 'Customer accounts are disabled',
      details: { code: 'ACCOUNTS_DISABLED' },
    });
    expect(t.customerSessions.resolve).not.toHaveBeenCalled();
    expect(t.customerSessions.revoke).not.toHaveBeenCalled();
    expect(t.customerSessions.revokeAll).not.toHaveBeenCalled();
    expect(t.accounts.getProfile).not.toHaveBeenCalled();
  });

  it('GUEST_ONLY: public account routes → 403 too', async () => {
    const t = setup('GUEST_ONLY');
    for (const h of ['register', 'login', 'forgotPassword', 'resetPassword', 'verifyEmail', 'confirmEmailChange']) {
      const ctx = await t.acc(h, { headers: G, body: {} });
      expect(ctx.status).toBe(403);
      expect(details(ctx)).toEqual({ code: 'ACCOUNTS_DISABLED' });
    }
  });

  it('private routes: no token → 401 LOGIN_REQUIRED; a bad token → 401 CUSTOMER_SESSION_INVALID', async () => {
    const t = setup('REGISTERED_ONLY');
    expect(details(await t.acc('me', { headers: G }))).toEqual({ code: 'LOGIN_REQUIRED' });
    expect(details(await t.acc('me', { headers: BAD }))).toEqual({ code: 'CUSTOMER_SESSION_INVALID' });
    expect(t.accounts.getProfile).not.toHaveBeenCalled();
  });

  it('an invalid login token also blocks the public account routes', async () => {
    const t = setup('BOTH');
    const ctx = await t.acc('login', { headers: { ...G, ...BAD }, body: { email: EMAIL, password: PASSWORD } });
    expect(details(ctx)).toEqual({ code: 'CUSTOMER_SESSION_INVALID' });
    expect(t.accounts.login).not.toHaveBeenCalled();
  });
});

describe('account routes: handlers', () => {
  it('register and password reset need a guest session', async () => {
    const t = setup();
    const reg = await t.acc('register', { body: { email: EMAIL, password: PASSWORD, firstName: 'A', lastName: 'B' } });
    expect([reg.status, details(reg)]).toEqual([401, { code: 'SESSION_INVALID' }]);
    const loginOnly = await t.acc('register', {
      headers: C,
      body: { email: EMAIL, password: PASSWORD, firstName: 'A', lastName: 'B' },
    });
    expect(details(loginOnly)).toEqual({ code: 'SESSION_INVALID' });
    const reset = await t.acc('resetPassword', { body: { token: 't', password: PASSWORD } });
    expect([reset.status, details(reset)]).toEqual([401, { code: 'SESSION_INVALID' }]);
    expect(t.accounts.register).not.toHaveBeenCalled();
    expect(t.accounts.resetPassword).not.toHaveBeenCalled();
  });

  it('register: rebuilds the body from known fields and answers 202 VERIFICATION_SENT', async () => {
    const t = setup();
    const ctx = await t.acc('register', {
      headers: G,
      body: {
        email: EMAIL,
        password: PASSWORD,
        firstName: 'Ana',
        lastName: 'Silva',
        phone: '912',
        locale: 'en',
        emailVerified: true,
        accountType: 'REGISTERED',
        blocked: false,
      },
    });
    expect(ctx.status).toBe(202);
    expect(ctx.body).toEqual({ status: 'VERIFICATION_SENT' });
    expect(t.accounts.register).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      firstName: 'Ana',
      lastName: 'Silva',
      phone: '912',
      locale: 'en',
    });
  });

  it('register: an existing verified e-mail answers exactly like a new one', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD, firstName: 'Ana', lastName: 'Silva' };
    const a = await t.acc('register', { headers: G, body });
    const b = await t.acc('register', { headers: G, body }); // the service is silent on an existing account
    expect([b.status, b.body, b.responseHeaders]).toEqual([a.status, a.body, a.responseHeaders]);
  });

  it('register: wrong types → 400 before the service', async () => {
    const t = setup();
    for (const body of [
      { email: 5, password: PASSWORD, firstName: 'A', lastName: 'B' },
      { email: EMAIL, password: 123, firstName: 'A', lastName: 'B' },
      { email: EMAIL, password: PASSWORD, firstName: ['A'], lastName: 'B' },
      'not-an-object',
    ]) {
      const ctx = await t.acc('register', { headers: G, body });
      expect(ctx.status).toBe(400);
    }
    expect(t.accounts.register).not.toHaveBeenCalled();
  });

  it('register: 5 per hour per e-mail', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD, firstName: 'Ana', lastName: 'Silva' };
    for (let i = 0; i < 5; i++) expect((await t.acc('register', { headers: G, body })).status).toBe(202);
    const ctx = await t.acc('register', { headers: G, body: { ...body, email: ' ana@EXAMPLE.pt ' } });
    expect(ctx.status).toBe(429);
    expect(details(ctx).code).toBe('RATE_LIMITED');
    expect(ctx.responseHeaders['Retry-After']).toBeDefined();
  });

  it('verifyEmail: needs a guest session, then passes token, session and client info', async () => {
    const t = setup();
    expect(details(await t.acc('verifyEmail', { body: { token: 'tok' } }))).toEqual({ code: 'SESSION_INVALID' });
    const ctx = await t.acc('verifyEmail', {
      headers: { ...G, ...IP, 'X-Storefront-Client-User-Agent': 'UA/1' },
      body: { token: 'tok', extra: 1 },
    });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(LOGIN);
    expect(t.accounts.verifyEmail).toHaveBeenCalledWith('tok', GUEST, { ip: '203.0.113.7', userAgent: 'UA/1' });
  });

  it('login: needs a guest session; rebuilds { email, password }', async () => {
    const t = setup();
    expect(details(await t.acc('login', { body: { email: EMAIL, password: PASSWORD } }))).toEqual({
      code: 'SESSION_INVALID',
    });
    const ctx = await t.acc('login', { headers: G, body: { email: EMAIL, password: PASSWORD, admin: true } });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual(LOGIN);
    expect(t.accounts.login).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD }, GUEST, {
      ip: null,
      userAgent: null,
    });
  });

  it('login: the e-mail key counts failures only (5 per 15 min)', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD };
    let n = 0;
    const H = () => ({ ...G, 'X-Storefront-Client-IP': `198.51.100.${++n}` }); // one IP each: only the e-mail key matters
    // Successes never spend the e-mail budget.
    for (let i = 0; i < 8; i++) expect((await t.acc('login', { headers: H(), body })).status).toBe(200);
    t.accounts.login.mockRejectedValue(new EcommerceAccountError('INVALID_CREDENTIALS', 401));
    for (let i = 0; i < 5; i++) {
      const ctx = await t.acc('login', { headers: H(), body });
      expect(ctx.status).toBe(401);
      expect(details(ctx)).toEqual({ code: 'INVALID_CREDENTIALS' });
    }
    t.accounts.login.mockResolvedValue(LOGIN);
    const ctx = await t.acc('login', { headers: H(), body: { ...body, email: 'ana@example.PT' } });
    expect(ctx.status).toBe(429);
    expect(t.accounts.login).toHaveBeenCalledTimes(13);
    // Another e-mail is not affected.
    expect((await t.acc('login', { headers: H(), body: { ...body, email: 'bea@example.pt' } })).status).toBe(200);
  });

  it('login: 10 per minute per IP', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD };
    for (let i = 0; i < 10; i++) expect((await t.acc('login', { headers: { ...G, ...IP }, body })).status).toBe(200);
    expect((await t.acc('login', { headers: { ...G, ...IP }, body })).status).toBe(429);
  });

  it('login without X-Storefront-Client-IP: one shared bucket, still 10 per minute', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD };
    for (let i = 0; i < 10; i++) expect((await t.acc('login', { headers: G, body })).status).toBe(200);
    expect((await t.acc('login', { headers: G, body })).status).toBe(429);
  });

  it('login: EMAIL_NOT_VERIFIED → 403, ACCOUNTS_UNAVAILABLE → 503, hash queue full → 429 Retry-After', async () => {
    const t = setup();
    const body = { email: EMAIL, password: PASSWORD };
    t.accounts.login.mockRejectedValueOnce(new EcommerceAccountError('EMAIL_NOT_VERIFIED', 403));
    expect(details(await t.acc('login', { headers: G, body }))).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    t.accounts.login.mockRejectedValueOnce(new EcommerceAccountsUnavailableError());
    const u = await t.acc('login', { headers: G, body });
    expect([u.status, details(u)]).toEqual([503, { code: 'ACCOUNTS_UNAVAILABLE' }]);
    t.accounts.login.mockRejectedValueOnce(new EcommerceRateLimitError(7));
    const q = await t.acc('login', { headers: G, body });
    expect([q.status, details(q), q.responseHeaders['Retry-After']]).toEqual([
      429,
      { code: 'RATE_LIMITED', retryAfter: 7 },
      '7',
    ]);
  });

  it('resend and forgot answer 202 { status: ACCEPTED } with only the e-mail passed on', async () => {
    const t = setup();
    const resend = await t.acc('resendVerification', { body: { email: EMAIL, x: 1 } });
    expect([resend.status, resend.body]).toEqual([202, { status: 'ACCEPTED' }]);
    expect(t.accounts.resendVerification).toHaveBeenCalledWith(EMAIL);
    const forgot = await t.acc('forgotPassword', { body: { email: EMAIL } });
    expect([forgot.status, forgot.body]).toEqual([202, { status: 'ACCEPTED' }]);
    expect(t.accounts.forgotPassword).toHaveBeenCalledWith(EMAIL);
  });

  it('resend/forgot share 3 per hour per e-mail', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) expect((await t.acc('forgotPassword', { body: { email: EMAIL } })).status).toBe(202);
    expect((await t.acc('resendVerification', { body: { email: EMAIL } })).status).toBe(429);
  });

  it('resetPassword: 204; WEAK_PASSWORD carries the reason', async () => {
    const t = setup();
    const ok = await t.acc('resetPassword', { headers: G, body: { token: 'tok', password: PASSWORD, other: 1 } });
    expect(ok.status).toBe(204);
    expect(t.accounts.resetPassword).toHaveBeenCalledWith({ token: 'tok', password: PASSWORD });
    t.accounts.resetPassword.mockRejectedValueOnce(
      new EcommerceAccountError('WEAK_PASSWORD', 400, { reason: 'TOO_SHORT', leak: 'no' })
    );
    const weak = await t.acc('resetPassword', { headers: G, body: { token: 'tok', password: 'short' } });
    expect(weak.status).toBe(400);
    expect(details(weak)).toEqual({ code: 'WEAK_PASSWORD', reason: 'TOO_SHORT' });
    t.accounts.resetPassword.mockRejectedValueOnce(new EcommerceAccountError('TOKEN_INVALID', 400));
    expect(details(await t.acc('resetPassword', { headers: G, body: { token: 'x', password: PASSWORD } }))).toEqual({
      code: 'TOKEN_INVALID',
    });
  });

  it('token routes: 20 per hour per IP', async () => {
    const t = setup();
    for (let i = 0; i < 20; i++) {
      expect((await t.acc('resetPassword', { headers: { ...G, ...IP }, body: { token: 't', password: PASSWORD } })).status).toBe(
        204
      );
    }
    expect((await t.acc('resetPassword', { headers: { ...G, ...IP }, body: { token: 't', password: PASSWORD } })).status).toBe(
      429
    );
  });

  it('logout: 204, the current session of the current customer', async () => {
    const t = setup();
    expect((await t.acc('logout', { headers: C })).status).toBe(204);
    expect(t.accounts.logout).toHaveBeenCalledWith(41, 7);
  });

  it('me / updateMe: the profile, with only the known fields passed on', async () => {
    const t = setup();
    const me = await t.acc('me', { headers: C });
    expect([me.status, me.body]).toEqual([200, { id: 41, email: EMAIL }]);
    expect(t.accounts.getProfile).toHaveBeenCalledWith(CUSTOMER);
    const up = await t.acc('updateMe', {
      headers: C,
      body: { firstName: 'Bea', phone: null, email: 'evil@x.pt', blocked: false, id: 1 },
    });
    expect(up.status).toBe(200);
    expect(t.accounts.updateProfile).toHaveBeenCalledWith(CUSTOMER, { firstName: 'Bea', phone: null });
    expect((await t.acc('updateMe', { headers: C, body: { firstName: 5 } })).status).toBe(400);
    expect(t.accounts.updateProfile).toHaveBeenCalledTimes(1);
  });

  it('changePassword: 200 { token, expiresAt } for the current session; wrong current → 400', async () => {
    const t = setup();
    const ctx = await t.acc('changePassword', {
      headers: C,
      body: { currentPassword: PASSWORD, newPassword: 'new-password-123', x: 1 },
    });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ token: 'JWT2', expiresAt: '2027-02-01T00:00:00.000Z' });
    expect(t.accounts.changePassword).toHaveBeenCalledWith(CUSTOMER, 7, {
      currentPassword: PASSWORD,
      newPassword: 'new-password-123',
    });
    t.accounts.changePassword.mockRejectedValueOnce(new EcommerceAccountError('INVALID_CREDENTIALS', 400));
    const wrong = await t.acc('changePassword', { headers: C, body: { currentPassword: 'x', newPassword: 'y' } });
    expect([wrong.status, details(wrong)]).toEqual([400, { code: 'INVALID_CREDENTIALS' }]);
  });

  it('password and e-mail change share 5 per 15 min per login session', async () => {
    const t = setup();
    const body = { currentPassword: PASSWORD, newPassword: 'new-password-123', newEmail: 'b@x.pt' };
    for (let i = 0; i < 3; i++) expect((await t.acc('changePassword', { headers: C, body })).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await t.acc('requestEmailChange', { headers: C, body })).status).toBe(204);
    expect((await t.acc('requestEmailChange', { headers: C, body })).status).toBe(429);
  });

  it('requestEmailChange: 204; EMAIL_IN_USE → 409', async () => {
    const t = setup();
    expect(
      (await t.acc('requestEmailChange', { headers: C, body: { currentPassword: PASSWORD, newEmail: 'b@x.pt' } }))
        .status
    ).toBe(204);
    expect(t.accounts.requestEmailChange).toHaveBeenCalledWith(CUSTOMER, {
      currentPassword: PASSWORD,
      newEmail: 'b@x.pt',
    });
    t.accounts.requestEmailChange.mockRejectedValueOnce(new EcommerceAccountError('EMAIL_IN_USE', 409));
    const ctx = await t.acc('requestEmailChange', { headers: C, body: { currentPassword: PASSWORD, newEmail: 'c@x.pt' } });
    expect([ctx.status, details(ctx)]).toEqual([409, { code: 'EMAIL_IN_USE' }]);
  });

  it('orders / order: paging passed on; a bad publicId → 400; not the customer’s → 404', async () => {
    const t = setup();
    expect((await t.acc('orders', { headers: C, query: { page: '2', pageSize: '5' } })).status).toBe(200);
    expect(t.accounts.listOrders).toHaveBeenCalledWith(CUSTOMER, { page: '2', pageSize: '5' });
    expect((await t.acc('order', { headers: C, params: { publicId: 'nope' } })).status).toBe(400);
    t.accounts.getOrder.mockRejectedValueOnce(new EcommerceNotFoundError('Order not found'));
    const nf = await t.acc('order', { headers: C, params: { publicId: UUID } });
    expect([nf.status, details(nf)]).toEqual([404, { code: 'ORDER_NOT_FOUND' }]);
    expect((await t.acc('order', { headers: C, params: { publicId: UUID } })).body).toEqual({ publicId: UUID });
  });

  it('sessions: the customer’s list, marked against the current session', async () => {
    const t = setup();
    const ctx = await t.acc('sessions', { headers: C });
    expect(ctx.body).toEqual({ sessions: [{ id: 7, current: true }] });
    expect(t.customerSessions.list).toHaveBeenCalledWith(41, 7);
  });

  it('DELETE /account/sessions/:id of another customer → 404; own → 204; bad id → 400', async () => {
    const t = setup();
    t.customerSessions.revoke.mockResolvedValueOnce(false);
    const other = await t.acc('revokeSession', { headers: C, params: { id: '99' } });
    expect([other.status, details(other)]).toEqual([404, { code: 'NOT_FOUND' }]);
    expect(t.customerSessions.revoke).toHaveBeenCalledWith(41, 99, 'REVOKED_BY_CUSTOMER');
    expect((await t.acc('revokeSession', { headers: C, params: { id: '12' } })).status).toBe(204);
    for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
      expect((await t.acc('revokeSession', { headers: C, params: { id } })).status).toBe(400);
    }
    expect(t.customerSessions.revoke).toHaveBeenCalledTimes(2);
  });

  it('revokeOtherSessions: 204, keeps the current one', async () => {
    const t = setup();
    expect((await t.acc('revokeOtherSessions', { headers: C })).status).toBe(204);
    expect(t.customerSessions.revokeAll).toHaveBeenCalledWith(41, 'REVOKED_BY_CUSTOMER', 7);
  });

  it('confirmEmailChange: needs a guest or login session; 204; a login session is offered to be kept', async () => {
    const t = setup();
    expect(details(await t.acc('confirmEmailChange', { body: { token: 't' } }))).toEqual({ code: 'SESSION_INVALID' });
    expect((await t.acc('confirmEmailChange', { headers: G, body: { token: 't' } })).status).toBe(204);
    expect((await t.acc('confirmEmailChange', { headers: C, body: { token: 't' } })).status).toBe(204);
    expect(t.accounts.confirmEmailChange.mock.calls).toEqual([['t'], ['t', 7]]);
  });

  it('a validation error from a service keeps the storefront error shape', async () => {
    const t = setup();
    t.accounts.register.mockRejectedValueOnce(
      new EcommerceValidationError('Invalid registration', [{ path: 'email', code: 'invalid_email' }])
    );
    const ctx = await t.acc('register', {
      headers: G,
      body: { email: 'x', password: PASSWORD, firstName: 'A', lastName: 'B' },
    });
    expect(ctx.status).toBe(400);
    expect(details(ctx)).toEqual({ code: 'invalid_email', errors: [{ path: 'email', code: 'invalid_email' }] });
  });

  it('request bodies never reach a log call', async () => {
    const t = setup();
    const body = {
      email: EMAIL,
      password: PASSWORD,
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
      newEmail: EMAIL,
      token: 'raw-token-value',
      firstName: 'Ana',
      lastName: 'Silva',
    };
    t.accounts.login.mockRejectedValue(new EcommerceAccountError('INVALID_CREDENTIALS', 401));
    t.accounts.register.mockRejectedValue(new EcommerceAccountError('WEAK_PASSWORD', 400, { reason: 'EQUALS_EMAIL' }));
    t.accounts.resetPassword.mockRejectedValue(new EcommerceAccountError('TOKEN_INVALID', 400));
    t.accounts.changePassword.mockRejectedValue(new EcommerceAccountError('INVALID_CREDENTIALS', 400));
    for (let i = 0; i < 7; i++) {
      for (const h of ['register', 'login', 'resetPassword', 'forgotPassword', 'resendVerification', 'verifyEmail']) {
        await t.acc(h, { headers: { ...G, ...IP }, body });
      }
      for (const h of ['changePassword', 'requestEmailChange', 'updateMe', 'confirmEmailChange']) {
        await t.acc(h, { headers: { ...C, ...IP }, body });
      }
    }
    const logged = JSON.stringify([t.log.warn.mock.calls, t.log.error.mock.calls, t.log.info.mock.calls, t.log.debug.mock.calls]);
    expect(t.log.warn).toHaveBeenCalled(); // rate limits were hit and logged
    for (const secret of [PASSWORD, EMAIL, EMAIL.toLowerCase(), 'raw-token-value', 'Silva']) {
      expect(logged).not.toContain(secret);
    }
  });
});
