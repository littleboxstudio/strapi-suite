import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { setupCommerce, createOrder, UIDS } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import EcommerceAccountService from '../../../server/src/services/modules/ecommerce/accounts';
import {
  EcommerceAccountError,
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import type { AccountCustomer } from '../../../server/src/services/modules/ecommerce/customerSessions';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const usageKey = (promotionId: number, email: string) => `p${promotionId}:${sha(email)}`;

beforeEach(() => {
  __resetEventHandlersForTests();
});

const setup = () => {
  const c = setupCommerce();
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
    revokeAll: vi.fn(async (..._a: any[]) => 0),
    list: vi.fn(async (..._a: any[]): Promise<any[]> => []),
    reissue: vi.fn(async (): Promise<any> => ({ token: 'NEW-JWT', expiresAt: '2027-01-01T00:00:00.000Z' })),
  };
  const mailer = {
    sendPasswordChanged: vi.fn(async () => undefined),
    sendEmailChangeVerification: vi.fn(async () => undefined),
    sendEmailChanged: vi.fn(async () => undefined),
  };
  Object.assign(c.services, {
    EcommercePasswordService: passwords,
    EcommerceCustomerTokenService: tokens,
    EcommerceCustomerSessionService: sessions,
    EcommerceAccountMailer: mailer,
  });
  const svc = EcommerceAccountService({ strapi: c.strapi });
  const add = (extra: Record<string, unknown> = {}) =>
    c.strapi.db.query(UIDS.customer).create({
      data: {
        email: 'Ana@Example.pt',
        emailNormalized: 'ana@example.pt',
        firstName: 'Ana',
        lastName: 'Silva',
        phone: null,
        locale: 'en',
        accountType: 'REGISTERED',
        emailVerified: true,
        passwordHash: 'H(correct-horse)',
        passwordPepperVersion: 1,
        blocked: false,
        ...extra,
      },
    });
  const account = (row: any): AccountCustomer => ({
    id: row.id,
    email: row.email,
    emailNormalized: row.emailNormalized,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? null,
    locale: row.locale ?? null,
    accountType: row.accountType,
    emailVerified: row.emailVerified,
    blocked: row.blocked,
    passwordChangedAt: null,
    pendingEmail: row.pendingEmail ?? null,
  });
  const row = (id: number) => c.tables[UIDS.customer].find((r) => r.id === id);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  c.tables[UIDS.variant][0].stock = 100;
  return { c, svc, passwords, tokens, sessions, mailer, add, account, row, flush };
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof EcommerceAccountError ? { code: e.code, status: e.status } : e;
  }
  return null;
};

describe('profile', () => {
  it('getProfile returns the public profile, never the hash', async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'new@x.pt', pendingEmailNormalized: 'new@x.pt' });
    const p = await t.svc.getProfile(t.account(r));
    expect(p).toMatchObject({
      id: r.id,
      email: 'Ana@Example.pt',
      pendingEmail: 'new@x.pt',
      firstName: 'Ana',
      lastName: 'Silva',
      phone: null,
      locale: 'en',
    });
    expect(JSON.stringify(p)).not.toContain('H(correct-horse)');
  });

  it('updateProfile changes name, phone and locale; email and blocked are ignored', async () => {
    const t = setup();
    const r = await t.add();
    const p = await t.svc.updateProfile(t.account(r), {
      firstName: ' Rita ',
      lastName: 'Costa',
      phone: '912345678',
      locale: 'pt',
      email: 'evil@x.pt',
      blocked: true,
      emailNormalized: 'evil@x.pt',
      accountType: 'GUEST',
    } as any);
    expect(p).toMatchObject({ firstName: 'Rita', lastName: 'Costa', phone: '912345678', locale: 'pt' });
    expect(t.row(r.id)).toMatchObject({
      email: 'Ana@Example.pt',
      emailNormalized: 'ana@example.pt',
      blocked: false,
      accountType: 'REGISTERED',
      firstName: 'Rita',
    });
  });

  it('updateProfile keeps absent fields and refuses an empty name or unknown locale', async () => {
    const t = setup();
    const r = await t.add({ phone: '1' });
    await t.svc.updateProfile(t.account(r), { lastName: 'Costa' });
    expect(t.row(r.id)).toMatchObject({ firstName: 'Ana', lastName: 'Costa', phone: '1', locale: 'en' });
    await expect(t.svc.updateProfile(t.account(r), { firstName: '  ' })).rejects.toBeInstanceOf(
      EcommerceValidationError
    );
    await expect(t.svc.updateProfile(t.account(r), { locale: 'xx' })).rejects.toBeInstanceOf(
      EcommerceValidationError
    );
    const long: any = await t.svc
      .updateProfile(t.account(r), { firstName: 'x'.repeat(101), lastName: '' })
      .catch((e: unknown) => e);
    expect(long.errors).toEqual([
      { path: 'firstName', code: 'too_long' },
      { path: 'lastName', code: 'required' },
    ]);
  });
});

describe('changePassword', () => {
  it('a wrong current password → INVALID_CREDENTIALS 400, nothing changed', async () => {
    const t = setup();
    const r = await t.add();
    expect(
      await code(
        t.svc.changePassword(t.account(r), 9, { currentPassword: 'wrong-password', newPassword: 'brand-new-pass' })
      )
    ).toEqual({ code: 'INVALID_CREDENTIALS', status: 400 });
    expect(t.row(r.id).passwordHash).toBe('H(correct-horse)');
    expect(t.sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('success: new hash, passwordChangedAt, other sessions revoked, mail, the current session reissued', async () => {
    const t = setup();
    const r = await t.add();
    const out = await t.svc.changePassword(t.account(r), 9, {
      currentPassword: 'correct-horse',
      newPassword: 'brand-new-pass',
    });
    await t.flush();
    expect(out).toEqual({ token: 'NEW-JWT', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(t.row(r.id)).toMatchObject({ passwordHash: 'H(brand-new-pass)', passwordPepperVersion: 2 });
    expect(t.row(r.id).passwordChangedAt).toBeInstanceOf(Date);
    expect(t.sessions.revokeAll).toHaveBeenCalledWith(r.id, 'PASSWORD_CHANGED', 9);
    expect(t.sessions.reissue).toHaveBeenCalledWith(r.id, 9);
    expect(t.mailer.sendPasswordChanged).toHaveBeenCalledWith('Ana@Example.pt', 'en', { firstName: 'Ana' });
  });

  it('a weak new password → WEAK_PASSWORD; a session that cannot be reissued → CUSTOMER_SESSION_INVALID', async () => {
    const t = setup();
    const r = await t.add();
    expect(
      await code(t.svc.changePassword(t.account(r), 9, { currentPassword: 'correct-horse', newPassword: 'short' }))
    ).toEqual({ code: 'WEAK_PASSWORD', status: 400 });
    t.sessions.reissue.mockResolvedValueOnce(null);
    expect(
      await code(
        t.svc.changePassword(t.account(r), 9, { currentPassword: 'correct-horse', newPassword: 'brand-new-pass' })
      )
    ).toEqual({ code: 'CUSTOMER_SESSION_INVALID', status: 401 });
  });
});

describe('e-mail change', () => {
  it("requestEmailChange to a guest customer's e-mail → EMAIL_IN_USE", async () => {
    const t = setup();
    const r = await t.add();
    await t.add({ email: 'guest@x.pt', emailNormalized: 'guest@x.pt', accountType: 'GUEST', passwordHash: null });
    expect(
      await code(t.svc.requestEmailChange(t.account(r), { currentPassword: 'correct-horse', newEmail: ' Guest@X.pt ' }))
    ).toEqual({ code: 'EMAIL_IN_USE', status: 409 });
    expect(t.row(r.id).pendingEmail ?? null).toBeNull();
  });

  it("requestEmailChange to another customer's pending e-mail → EMAIL_IN_USE; a wrong password → INVALID_CREDENTIALS 400", async () => {
    const t = setup();
    const r = await t.add();
    await t.add({ email: 'b@x.pt', emailNormalized: 'b@x.pt', pendingEmail: 'New@x.pt', pendingEmailNormalized: 'new@x.pt' });
    expect(
      await code(t.svc.requestEmailChange(t.account(r), { currentPassword: 'correct-horse', newEmail: 'new@x.pt' }))
    ).toEqual({ code: 'EMAIL_IN_USE', status: 409 });
    expect(
      await code(t.svc.requestEmailChange(t.account(r), { currentPassword: 'nope-nope', newEmail: 'free@x.pt' }))
    ).toEqual({ code: 'INVALID_CREDENTIALS', status: 400 });
  });

  it('requestEmailChange to the current e-mail → validation error same_email, nothing stored', async () => {
    const t = setup();
    const r = await t.add();
    const err: any = await t.svc
      .requestEmailChange(t.account(r), { currentPassword: 'correct-horse', newEmail: ' ANA@example.pt ' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'newEmail', code: 'same_email' }]);
    expect(t.row(r.id).pendingEmail ?? null).toBeNull();
  });

  it('requestEmailChange stores the pending e-mail and mails the link to the new address', async () => {
    const t = setup();
    const r = await t.add();
    await t.svc.requestEmailChange(t.account(r), { currentPassword: 'correct-horse', newEmail: ' New@X.pt ' });
    await t.flush();
    expect(t.row(r.id)).toMatchObject({ pendingEmail: 'New@X.pt', pendingEmailNormalized: 'new@x.pt' });
    expect(t.tokens.issue).toHaveBeenCalledWith(r.id, 'CHANGE_EMAIL', 'New@X.pt');
    expect(t.mailer.sendEmailChangeVerification).toHaveBeenCalledWith('New@X.pt', 'en', {
      firstName: 'Ana',
      newEmail: 'New@X.pt',
      raw: 'RAW',
    });
  });

  it("confirmEmailChange moves the e-mail, store credits and promotion usage, revokes every session, mails the old address", async () => {
    const t = setup();
    const orderId = await createOrder(t.c, 'Ana@Example.pt');
    const id = t.c.tables[UIDS.order].find((o) => o.id === orderId).customer;
    Object.assign(t.row(id), {
      accountType: 'REGISTERED',
      emailVerified: true,
      passwordHash: 'H(correct-horse)',
      pendingEmail: 'New@X.pt',
      pendingEmailNormalized: 'new@x.pt',
    });
    const credit = await t.c.storeCredits.issue({ customerId: id, amount: 1000, actor: 'user:1', operationKey: 'k1' });
    t.c.tables[UIDS.promotion].push({ id: 1, name: 'P', method: 'AUTOMATIC', active: true, redemptions: 1 });
    t.c.tables[UIDS.promotionCustomerUsage].push({
      id: 1,
      promotion: 1,
      emailNormalized: 'ana@example.pt',
      uses: 1,
      uniqueKey: usageKey(1, 'ana@example.pt'),
    });
    t.c.tables[UIDS.promotionRedemption].push({
      id: 1,
      promotion: 1,
      order: orderId,
      customer: id,
      emailNormalized: 'ana@example.pt',
      status: 'RESERVED',
      uniqueKey: `1:${orderId}`,
    });
    t.tokens.consume.mockResolvedValueOnce({ customerId: id, email: 'New@X.pt' });
    const trx = t.c.strapi.db.transaction as any;
    const before = trx.mock.calls.length;

    await t.svc.confirmEmailChange('raw-token');
    await t.flush();

    expect(t.row(id)).toMatchObject({
      email: 'New@X.pt',
      emailNormalized: 'new@x.pt',
      pendingEmail: null,
      pendingEmailNormalized: null,
      emailVerified: true,
    });
    expect(t.row(id).emailVerifiedAt).toBeInstanceOf(Date);
    expect(t.c.tables[UIDS.storeCredit].find((x) => x.id === credit.id).emailNormalized).toBe('new@x.pt');
    expect(t.c.tables[UIDS.promotionCustomerUsage][0]).toMatchObject({
      emailNormalized: 'new@x.pt',
      uniqueKey: usageKey(1, 'new@x.pt'),
      uses: 1,
    });
    expect(t.c.tables[UIDS.promotionRedemption][0].emailNormalized).toBe('new@x.pt');
    expect(trx.mock.calls.length).toBeGreaterThan(before);
    expect(t.sessions.revokeAll).toHaveBeenCalledWith(id, 'EMAIL_CHANGED');
    expect(t.mailer.sendEmailChanged).toHaveBeenCalledWith('Ana@Example.pt', 'en', {
      firstName: 'Ana',
      newEmail: 'New@X.pt',
    });
  });

  it('confirmed from a login session of the same customer: that session is kept', async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'new@x.pt', pendingEmailNormalized: 'new@x.pt' });
    t.sessions.list.mockResolvedValueOnce([{ id: 3, current: false }, { id: 9, current: true }]);
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'new@x.pt' });
    await t.svc.confirmEmailChange('raw', 9);
    expect(t.sessions.list).toHaveBeenCalledWith(r.id, 9);
    expect(t.sessions.revokeAll).toHaveBeenCalledWith(r.id, 'EMAIL_CHANGED', 9);
  });

  it("confirmed from another customer's login session: every session of the token's customer goes", async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'new@x.pt', pendingEmailNormalized: 'new@x.pt' });
    t.sessions.list.mockResolvedValueOnce([{ id: 3, current: false }]); // 77 is not this customer's
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'new@x.pt' });
    await t.svc.confirmEmailChange('raw', 77);
    expect(t.sessions.revokeAll).toHaveBeenCalledWith(r.id, 'EMAIL_CHANGED');
  });

  it('a usage counter already kept for the new e-mail absorbs the old one', async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'new@x.pt', pendingEmailNormalized: 'new@x.pt' });
    t.c.tables[UIDS.promotion].push({ id: 1, name: 'P', method: 'AUTOMATIC', active: true, redemptions: 3 });
    t.c.tables[UIDS.promotionCustomerUsage].push(
      { id: 1, promotion: 1, emailNormalized: 'ana@example.pt', uses: 2, uniqueKey: usageKey(1, 'ana@example.pt') },
      { id: 2, promotion: 1, emailNormalized: 'new@x.pt', uses: 1, uniqueKey: usageKey(1, 'new@x.pt') }
    );
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'new@x.pt' });
    await t.svc.confirmEmailChange('raw');
    expect(t.c.tables[UIDS.promotionCustomerUsage]).toEqual([
      expect.objectContaining({ id: 2, emailNormalized: 'new@x.pt', uses: 3, uniqueKey: usageKey(1, 'new@x.pt') }),
    ]);
  });

  it('a confirm after the e-mail was taken → EMAIL_IN_USE, nothing moved', async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'New@X.pt', pendingEmailNormalized: 'new@x.pt' });
    await t.add({ email: 'new@x.pt', emailNormalized: 'new@x.pt', accountType: 'GUEST' });
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'New@X.pt' });
    const trx = t.c.strapi.db.transaction as any;
    const before = trx.mock.calls.length;
    expect(await code(t.svc.confirmEmailChange('raw-token'))).toEqual({ code: 'EMAIL_IN_USE', status: 409 });
    // Checked inside the transaction that would swap the e-mail.
    expect(trx.mock.calls.length).toBe(before + 1);
    expect(t.row(r.id).emailNormalized).toBe('ana@example.pt');
    expect(t.sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('a bad, replaced or blocked confirm → TOKEN_INVALID', async () => {
    const t = setup();
    const r = await t.add({ pendingEmail: 'Other@X.pt', pendingEmailNormalized: 'other@x.pt' });
    expect(await code(t.svc.confirmEmailChange('nope'))).toEqual({ code: 'TOKEN_INVALID', status: 400 });
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'New@X.pt' });
    expect(await code(t.svc.confirmEmailChange('raw'))).toEqual({ code: 'TOKEN_INVALID', status: 400 });
    t.row(r.id).blocked = true;
    t.tokens.consume.mockResolvedValueOnce({ customerId: r.id, email: 'Other@X.pt' });
    expect(await code(t.svc.confirmEmailChange('raw'))).toEqual({ code: 'TOKEN_INVALID', status: 400 });
  });
});

describe('orders', () => {
  it('listOrders: own orders only, newest first, in the storefront order shape', async () => {
    const t = setup();
    const o1 = await createOrder(t.c, 'Ana@Example.pt');
    const o2 = await createOrder(t.c, 'Ana@Example.pt');
    await createOrder(t.c, 'rui@example.pt');
    const id = t.c.tables[UIDS.order].find((o) => o.id === o1).customer;
    t.c.tables[UIDS.order].find((o) => o.id === o2).createdAt = '2099-01-01T00:00:00.000Z';
    const list = await t.svc.listOrders(t.account(t.row(id)), { page: 1, pageSize: 10 });
    expect(list.pagination).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(list.results.map((r: any) => r.publicId)).toEqual([
      t.c.tables[UIDS.order].find((o) => o.id === o2).publicId,
      t.c.tables[UIDS.order].find((o) => o.id === o1).publicId,
    ]);
    expect(list.results[0]).toMatchObject({ total: 4500, createdAt: '2099-01-01T00:00:00.000Z', currency: 'EUR' });
    expect(list.results[0].lines).toHaveLength(1);
  });

  it("getOrder: own order → the storefront view; another customer's publicId → EcommerceNotFoundError", async () => {
    const t = setup();
    const mine = await createOrder(t.c, 'Ana@Example.pt');
    const theirs = await createOrder(t.c, 'rui@example.pt');
    const me = t.row(t.c.tables[UIDS.order].find((o) => o.id === mine).customer);
    const pub = (id: number) => t.c.tables[UIDS.order].find((o) => o.id === id).publicId;
    expect((await t.svc.getOrder(t.account(me), pub(mine))).publicId).toBe(pub(mine));
    await expect(t.svc.getOrder(t.account(me), pub(theirs))).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(t.svc.getOrder(t.account(me), 'not-a-uuid')).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });
});
