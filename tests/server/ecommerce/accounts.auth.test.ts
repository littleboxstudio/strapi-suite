import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from './helpers/fakeDb';
import EcommerceAccountService from '../../../server/src/services/modules/ecommerce/accounts';
import {
  EcommerceAccountError,
  EcommerceAccountsUnavailableError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { emptyCart } from '../../../server/src/services/modules/ecommerce/storefrontSessions';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const CUSTOMER = `${P}customer`;
const ORDER = `${P}order`;
const client = { ip: '203.0.113.7', userAgent: 'UA' };

const setup = () => {
  const db = createFakeDb([CUSTOMER, ORDER], {
    [ORDER]: { customer: [CUSTOMER, 'customer', 'manyToOne'] },
  });
  const passwords = {
    available: vi.fn(() => true),
    hash: vi.fn(async (pw: string) => ({ hash: `H(${pw})`, pepperVersion: 2 })),
    verify: vi.fn(async (stored: any, pw: string) => ({
      ok: !!stored && stored.hash === `H(${pw})`,
      rehash: null as any,
    })),
  };
  const tokens = {
    issue: vi.fn(async () => ({ raw: 'RAW', expiresAt: 'x' })),
    consume: vi.fn(async (): Promise<any> => null),
  };
  const sessions = {
    open: vi.fn(async () => ({ token: 'JWT', expiresAt: '2027-01-01T00:00:00.000Z', sessionId: 9 })),
    revoke: vi.fn(async () => true),
    revokeAll: vi.fn(async () => 0),
  };
  const checkout = { expireAndScrub: vi.fn(async () => undefined) };
  const mailer = {
    sendAccountVerification: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async () => undefined),
    sendPasswordChanged: vi.fn(async () => undefined),
    sendRegistrationAttempt: vi.fn(async () => undefined),
  };
  const services: Record<string, unknown> = {
    EcommercePasswordService: passwords,
    EcommerceCustomerTokenService: tokens,
    EcommerceCustomerSessionService: sessions,
    EcommerceStorefrontSessionService: checkout,
    EcommerceAccountMailer: mailer,
  };
  const strapi = {
    db,
    log: { warn: vi.fn(), error: vi.fn() },
    config: { get: () => ({ uuid: { modules: { ecommerce: { customer: CUSTOMER, order: ORDER } } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'pt', find: async () => [{ code: 'pt' }, { code: 'en' }] }) }
        : { service: (n: string) => services[n] },
  };
  const svc = EcommerceAccountService({ strapi } as never);
  const rows = () => db.tables[CUSTOMER];
  const add = (extra: Record<string, unknown> = {}) =>
    db.query(CUSTOMER).create({
      data: {
        email: 'Ana@Example.pt',
        emailNormalized: 'ana@example.pt',
        firstName: 'Ana',
        lastName: 'Silva',
        phone: null,
        locale: 'pt',
        accountType: 'REGISTERED',
        emailVerified: true,
        passwordHash: 'H(correct-horse)',
        passwordPepperVersion: 1,
        blocked: false,
        cart: emptyCart(),
        ...extra,
      },
    });
  const guest = (cart = emptyCart()) => ({
    id: 55,
    expiresAt: '',
    cart,
    verifiedEmail: null,
    emailVerification: {},
    verificationAttempts: 0,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { db, svc, passwords, tokens, sessions, checkout, mailer, strapi, rows, add, guest, flush };
};

const reg = (over: Record<string, unknown> = {}) => ({
  email: '  Ana@Example.pt ',
  password: 'correct-horse',
  firstName: 'Ana',
  lastName: 'Silva',
  ...over,
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof EcommerceAccountError ? { code: e.code, status: e.status, extra: e.extra } : e;
  }
  return null;
};

describe('register', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('new e-mail: creates a REGISTERED unverified customer and mails the link', async () => {
    await t.svc.register(reg({ phone: '123', locale: 'en' }));
    await t.flush();
    expect(t.rows()).toHaveLength(1);
    expect(t.rows()[0]).toMatchObject({
      email: 'Ana@Example.pt',
      emailNormalized: 'ana@example.pt',
      accountType: 'REGISTERED',
      emailVerified: false,
      passwordHash: 'H(correct-horse)',
      passwordPepperVersion: 2,
      phone: '123',
      locale: 'en',
    });
    expect(t.tokens.issue).toHaveBeenCalledWith(t.rows()[0].id, 'VERIFY_EMAIL', 'Ana@Example.pt');
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledWith('Ana@Example.pt', 'en', {
      firstName: 'Ana',
      raw: 'RAW',
    });
    expect(t.passwords.hash).toHaveBeenCalledTimes(1);
  });

  it('guest e-mail: upgrades the same row and leaves its orders', async () => {
    const g = await t.add({ accountType: 'GUEST', emailVerified: false, passwordHash: 'GUESTHASH', firstName: 'Old' });
    await t.db.query(ORDER).create({ data: { customer: g.id } });
    await t.svc.register(reg({ firstName: 'Ana2' }));
    await t.flush();
    expect(t.rows()).toHaveLength(1);
    expect(t.rows()[0]).toMatchObject({
      id: g.id,
      accountType: 'REGISTERED',
      emailVerified: false,
      passwordHash: 'H(correct-horse)',
      firstName: 'Ana2',
    });
    expect(t.db.tables[ORDER]).toHaveLength(1);
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledTimes(1);
    expect(t.passwords.hash).toHaveBeenCalledTimes(1);
  });

  it('registered unverified: replaces the password and mails again', async () => {
    const u = await t.add({ emailVerified: false, passwordHash: 'old' });
    await t.svc.register(reg());
    await t.flush();
    expect(t.rows()).toHaveLength(1);
    expect(t.rows()[0]).toMatchObject({ id: u.id, passwordHash: 'H(correct-horse)', emailVerified: false });
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledTimes(1);
    expect(t.passwords.hash).toHaveBeenCalledTimes(1);
  });

  it('registered verified: writes nothing and sends the attempt notice', async () => {
    await t.add();
    const before = JSON.stringify(t.rows());
    await t.svc.register(reg({ firstName: 'Evil', password: 'another-password' }));
    await t.flush();
    expect(JSON.stringify(t.rows())).toBe(before);
    expect(t.tokens.issue).not.toHaveBeenCalled();
    expect(t.mailer.sendRegistrationAttempt).toHaveBeenCalledWith('Ana@Example.pt', 'pt', { firstName: 'Ana' });
    expect(t.mailer.sendAccountVerification).not.toHaveBeenCalled();
    expect(t.passwords.hash).toHaveBeenCalledTimes(1);
  });

  it('blocked: writes and sends nothing', async () => {
    await t.add({ blocked: true, emailVerified: false });
    const before = JSON.stringify(t.rows());
    await t.svc.register(reg());
    await t.flush();
    expect(JSON.stringify(t.rows())).toBe(before);
    expect(t.tokens.issue).not.toHaveBeenCalled();
    for (const m of Object.values(t.mailer)) expect(m).not.toHaveBeenCalled();
    expect(t.passwords.hash).toHaveBeenCalledTimes(1);
  });

  it('a failing mail does not fail the call and logs no address', async () => {
    t.mailer.sendAccountVerification.mockRejectedValue(
      Object.assign(new Error('to ana@example.pt'), { name: 'EcommerceEmailError', code: 'EMAIL_NOT_CONFIGURED' })
    );
    await expect(t.svc.register(reg())).resolves.toBeUndefined();
    await t.flush();
    const logged = JSON.stringify(t.strapi.log.warn.mock.calls);
    expect(logged).toContain('EMAIL_NOT_CONFIGURED');
    expect(logged).not.toContain('ana@example.pt');
  });

  it('a concurrent duplicate keeps the oldest row', async () => {
    const realQuery = t.db.query(CUSTOMER);
    const oldest = await t.add({ emailVerified: false, passwordHash: 'old' });
    // The first lookup misses (the oldest appears only after our create).
    let first = true;
    const q = t.strapi.db.query.bind(t.strapi.db);
    t.strapi.db.query = ((uid: string) => {
      const real = q(uid);
      if (uid !== CUSTOMER) return real;
      return {
        ...real,
        findMany: async (p: any) => {
          if (first) {
            first = false;
            return [];
          }
          return real.findMany(p);
        },
      };
    }) as never;
    void realQuery;
    await t.svc.register(reg());
    await t.flush();
    expect(t.rows()).toHaveLength(1);
    expect(t.rows()[0].id).toBe(oldest.id);
    expect(t.rows()[0].passwordHash).toBe('H(correct-horse)');
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledTimes(1);
  });

  it('validates input before hashing', async () => {
    await expect(t.svc.register(reg({ email: 'nope' }))).rejects.toBeInstanceOf(EcommerceValidationError);
    await expect(t.svc.register(reg({ firstName: ' ' }))).rejects.toBeInstanceOf(EcommerceValidationError);
    expect(await code(t.svc.register(reg({ password: 'short' })))).toMatchObject({
      code: 'WEAK_PASSWORD',
      status: 400,
      extra: { reason: 'TOO_SHORT' },
    });
    expect(await code(t.svc.register(reg({ password: 'a'.repeat(1025) })))).toMatchObject({
      extra: { reason: 'TOO_LONG' },
    });
    expect(await code(t.svc.register(reg({ password: 'ana@example.pt' })))).toMatchObject({
      extra: { reason: 'EQUALS_EMAIL' },
    });
    expect(t.passwords.hash).not.toHaveBeenCalled();
    expect(t.rows()).toHaveLength(0);
  });

  it('lets an unavailable pepper propagate', async () => {
    t.passwords.hash.mockRejectedValue(new EcommerceAccountsUnavailableError());
    await expect(t.svc.register(reg())).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
    expect(t.rows()).toHaveLength(0);
  });
});

describe('login', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('opens a session, merges the guest cart and scrubs the guest session', async () => {
    const c = await t.add({
      cart: { ...emptyCart(), lines: [{ variantId: 1, quantity: 2 }] },
    });
    const g = t.guest({ ...emptyCart(), lines: [{ variantId: 1, quantity: 3 }, { variantId: 4, quantity: 1 }] });
    const r = await t.svc.login({ email: ' ANA@example.pt', password: 'correct-horse' }, g, client);
    expect(r).toEqual({
      token: 'JWT',
      expiresAt: '2027-01-01T00:00:00.000Z',
      customer: {
        id: c.id,
        email: 'Ana@Example.pt',
        pendingEmail: null,
        firstName: 'Ana',
        lastName: 'Silva',
        phone: null,
        locale: 'pt',
        createdAt: null,
      },
    });
    expect(JSON.stringify(r)).not.toContain('H(');
    expect(t.sessions.open).toHaveBeenCalledWith(c.id, client);
    expect(t.rows()[0].cart.lines).toEqual([
      { variantId: 1, quantity: 5 },
      { variantId: 4, quantity: 1 },
    ]);
    expect(t.checkout.expireAndScrub).toHaveBeenCalledWith(55);
  });

  it.each([
    ['wrong password', { password: 'wrong-password' }, {}],
    ['unknown e-mail', { email: 'nobody@example.pt' }, {}],
    ['guest account', {}, { accountType: 'GUEST' }],
    ['blocked account', {}, { blocked: true }],
  ])('%s: INVALID_CREDENTIALS with one verify', async (_n, input, extra) => {
    await t.add(extra);
    const e = await code(
      t.svc.login({ email: 'ana@example.pt', password: 'correct-horse', ...input }, t.guest(), client)
    );
    expect(e).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect(t.passwords.verify).toHaveBeenCalledTimes(1);
    expect(t.sessions.open).not.toHaveBeenCalled();
    expect(t.checkout.expireAndScrub).not.toHaveBeenCalled();
  });

  it('a guest or blocked account is verified against nothing', async () => {
    await t.add({ blocked: true });
    await code(t.svc.login({ email: 'ana@example.pt', password: 'correct-horse' }, t.guest(), client));
    expect(t.passwords.verify.mock.calls[0][0]).toBeNull();
  });

  it('right password on an unverified account is EMAIL_NOT_VERIFIED', async () => {
    await t.add({ emailVerified: false });
    expect(await code(t.svc.login({ email: 'ana@example.pt', password: 'correct-horse' }, t.guest(), client))).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
    });
    const wrong = await code(t.svc.login({ email: 'ana@example.pt', password: 'wrong-password' }, t.guest(), client));
    expect(wrong).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('persists a pepper rehash', async () => {
    await t.add();
    t.passwords.verify.mockResolvedValueOnce({ ok: true, rehash: { hash: 'NEW', pepperVersion: 3 } });
    await t.svc.login({ email: 'ana@example.pt', password: 'correct-horse' }, t.guest(), client);
    expect(t.rows()[0]).toMatchObject({ passwordHash: 'NEW', passwordPepperVersion: 3 });
  });

  it('does not run argon for an oversized password or a malformed e-mail', async () => {
    await t.add();
    expect(await code(t.svc.login({ email: 'ana@example.pt', password: 'a'.repeat(2000) }, t.guest(), client))).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(await code(t.svc.login({ email: 5, password: 'x' } as never, t.guest(), client))).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(t.passwords.verify).not.toHaveBeenCalled();
  });

  it('reads a malformed stored cart as empty', async () => {
    await t.add({ cart: { lines: 'nope', promotionCodes: 7 } as never });
    const g = t.guest({ ...emptyCart(), lines: [{ variantId: 4, quantity: 1 }] });
    await t.svc.login({ email: 'ana@example.pt', password: 'correct-horse' }, g, client);
    expect(t.rows()[0].cart.lines).toEqual([{ variantId: 4, quantity: 1 }]);
  });
});

describe('verifyEmail', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('marks the e-mail verified and returns a session', async () => {
    const c = await t.add({ emailVerified: false });
    t.tokens.consume.mockResolvedValueOnce({ customerId: c.id, email: 'Ana@Example.pt' });
    const r = await t.svc.verifyEmail('RAW', t.guest(), client);
    expect(t.tokens.consume).toHaveBeenCalledWith('RAW', 'VERIFY_EMAIL');
    expect(r.token).toBe('JWT');
    expect(t.rows()[0].emailVerified).toBe(true);
    expect(t.rows()[0].emailVerifiedAt).toBeTruthy();
    expect(t.checkout.expireAndScrub).toHaveBeenCalledWith(55);
  });

  it('answers TOKEN_INVALID for a reused token, a changed e-mail and a blocked customer', async () => {
    const c = await t.add({ emailVerified: false });
    expect(await code(t.svc.verifyEmail('RAW', t.guest(), client))).toMatchObject({ code: 'TOKEN_INVALID', status: 400 });
    t.tokens.consume.mockResolvedValueOnce({ customerId: c.id, email: 'old@example.pt' });
    expect(await code(t.svc.verifyEmail('RAW', t.guest(), client))).toMatchObject({ code: 'TOKEN_INVALID' });
    await t.db.query(CUSTOMER).update({ where: { id: c.id }, data: { blocked: true } });
    t.tokens.consume.mockResolvedValueOnce({ customerId: c.id, email: 'Ana@Example.pt' });
    expect(await code(t.svc.verifyEmail('RAW', t.guest(), client))).toMatchObject({ code: 'TOKEN_INVALID' });
    expect(t.rows()[0].emailVerified).toBe(false);
    expect(t.sessions.open).not.toHaveBeenCalled();
  });
});

describe('resendVerification', () => {
  it('sends only for a registered, unverified, unblocked account', async () => {
    const t = setup();
    await t.add({ emailVerified: false });
    await t.svc.resendVerification('ana@example.pt');
    await t.svc.resendVerification('nobody@example.pt');
    await t.svc.resendVerification(42);
    await t.flush();
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledTimes(1);
    t.rows()[0].blocked = true;
    await t.svc.resendVerification('ana@example.pt');
    t.rows()[0].blocked = false;
    t.rows()[0].emailVerified = true;
    await t.svc.resendVerification('ana@example.pt');
    t.rows()[0].emailVerified = false;
    t.rows()[0].accountType = 'GUEST';
    await t.svc.resendVerification('ana@example.pt');
    await t.flush();
    expect(t.mailer.sendAccountVerification).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('revokes the session and tolerates an already revoked one', async () => {
    const t = setup();
    await t.svc.logout(3, 9);
    expect(t.sessions.revoke).toHaveBeenCalledWith(3, 9, 'LOGOUT');
    t.sessions.revoke.mockResolvedValueOnce(false as never);
    await expect(t.svc.logout(3, 9)).resolves.toBeUndefined();
  });
});

describe('forgotPassword', () => {
  it('sends for registered accounts (verified or not), never for guest, blocked or unknown', async () => {
    const t = setup();
    const c = await t.add({ emailVerified: false });
    await t.svc.forgotPassword('ANA@example.pt');
    await t.flush();
    expect(t.tokens.issue).toHaveBeenCalledWith(c.id, 'RESET_PASSWORD', 'Ana@Example.pt');
    expect(t.mailer.sendPasswordReset).toHaveBeenCalledWith('Ana@Example.pt', 'pt', { firstName: 'Ana', raw: 'RAW' });
    t.mailer.sendPasswordReset.mockClear();
    await t.svc.forgotPassword('nobody@example.pt');
    t.rows()[0].blocked = true;
    await t.svc.forgotPassword('ana@example.pt');
    t.rows()[0].blocked = false;
    t.rows()[0].accountType = 'GUEST';
    await t.svc.forgotPassword('ana@example.pt');
    await t.svc.forgotPassword(undefined);
    await t.flush();
    expect(t.mailer.sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  it('sets the password, verifies the e-mail, revokes sessions and notifies', async () => {
    const t = setup();
    const c = await t.add({ emailVerified: false, passwordHash: 'old' });
    t.tokens.consume.mockResolvedValueOnce({ customerId: c.id, email: 'Ana@Example.pt' });
    await t.svc.resetPassword({ token: 'RAW', password: 'brand-new-password' });
    await t.flush();
    expect(t.tokens.consume).toHaveBeenCalledWith('RAW', 'RESET_PASSWORD');
    expect(t.rows()[0]).toMatchObject({
      passwordHash: 'H(brand-new-password)',
      passwordPepperVersion: 2,
      emailVerified: true,
    });
    expect(t.rows()[0].passwordChangedAt).toBeTruthy();
    expect(t.rows()[0].emailVerifiedAt).toBeTruthy();
    expect(t.sessions.revokeAll).toHaveBeenCalledWith(c.id, 'PASSWORD_RESET');
    expect(t.mailer.sendPasswordChanged).toHaveBeenCalledWith('Ana@Example.pt', 'pt', { firstName: 'Ana' });
  });

  it('a weak password is WEAK_PASSWORD and the token stays unused', async () => {
    const t = setup();
    await t.add();
    expect(await code(t.svc.resetPassword({ token: 'RAW', password: 'short' }))).toMatchObject({
      code: 'WEAK_PASSWORD',
      extra: { reason: 'TOO_SHORT' },
    });
    expect(t.tokens.consume).not.toHaveBeenCalled();
    expect(t.sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('invalid token, blocked customer: TOKEN_INVALID', async () => {
    const t = setup();
    const c = await t.add({ blocked: true });
    expect(await code(t.svc.resetPassword({ token: 'RAW', password: 'brand-new-password' }))).toMatchObject({
      code: 'TOKEN_INVALID',
      status: 400,
    });
    t.tokens.consume.mockResolvedValueOnce({ customerId: c.id, email: 'Ana@Example.pt' });
    expect(await code(t.svc.resetPassword({ token: 'RAW', password: 'brand-new-password' }))).toMatchObject({
      code: 'TOKEN_INVALID',
    });
    expect(t.rows()[0].passwordHash).toBe('H(correct-horse)');
    expect(t.sessions.revokeAll).not.toHaveBeenCalled();
  });
});
