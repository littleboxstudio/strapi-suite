import { describe, expect, it, vi } from 'vitest';
import EcommerceAccountService from '../../../server/src/services/modules/ecommerce/accounts';
import {
  actorFromString,
  buildSearchText,
  diffFields,
  EVENTS_PAGE_SIZE,
} from '../../../server/src/services/modules/ecommerce/customerEvents';
import { emptyCart } from '../../../server/src/services/modules/ecommerce/storefrontSessions';
import { setupCommerce, createOrder, customerIdOf, drainEvents, UIDS } from './helpers/commerceSetup';

const storefrontCtx = {
  request: {
    ip: '10.0.0.1',
    headers: {
      'x-storefront-client-ip': '203.0.113.7',
      'x-storefront-client-user-agent': 'Mozilla/5.0 (Macintosh) Chrome/131',
      'user-agent': 'node-fetch',
    },
  },
};
const adminCtx = { request: { ip: '198.51.100.4', headers: { 'user-agent': 'Mozilla/5.0 Firefox/133' } } };

const setup = (ctx: any = storefrontCtx) => {
  const c = setupCommerce();
  (c.strapi as any).requestContext = { get: () => ctx };
  c.tables['admin::user'] = [{ id: 1, firstname: 'Rita', lastname: 'Costa', username: 'rita' }];
  const events = () => c.tables[UIDS.customerEvent] ?? [];
  return { c, events, svc: c.services.EcommerceCustomerEventService };
};

const addCustomer = (c: any, extra: Record<string, unknown> = {}) =>
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
      cart: emptyCart(),
      ...extra,
    },
  });

describe('customer event helpers', () => {
  it('actorFromString: admins by id, storefront is the customer, anything else the system', () => {
    expect(actorFromString('user:7')).toEqual({ type: 'ADMIN', userId: 7 });
    expect(actorFromString('storefront')).toEqual({ type: 'CUSTOMER' });
    expect(actorFromString('system:stripe')).toEqual({ type: 'SYSTEM' });
    expect(actorFromString(undefined)).toEqual({ type: 'SYSTEM' });
  });

  it('diffFields: only fields present and changed, empty as null', () => {
    expect(
      diffFields({ firstName: 'Ana', phone: null, locale: 'en' }, { firstName: 'Ana', phone: '', locale: 'pt' }, [
        'firstName',
        'phone',
        'locale',
        'lastName',
      ])
    ).toEqual([{ field: 'locale', from: 'en', to: 'pt' }]);
  });

  it('buildSearchText: lowercased type, actor, client and detail values', () => {
    expect(
      buildSearchText({
        type: 'ORDER_PLACED',
        actorName: 'Rita Costa',
        ip: '1.2.3.4',
        userAgent: 'UA',
        details: { reference: 1001, changes: [{ field: 'phone', from: null, to: '912' }] },
      })
    ).toBe('order_placed rita costa 1.2.3.4 ua #1001 phone 912');
  });
});

describe('EcommerceCustomerEventService', () => {
  it('records the storefront client from the BFF headers and the customer name', async () => {
    const { c, svc, events } = setup();
    const customer = await addCustomer(c);
    svc.record(customer.id, 'LOGIN', { actor: { type: 'CUSTOMER' } });
    await drainEvents();
    expect(events()).toEqual([
      expect.objectContaining({
        customerId: customer.id,
        type: 'LOGIN',
        actorType: 'CUSTOMER',
        actorId: customer.id,
        actorName: 'Ana Silva',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131',
      }),
    ]);
  });

  it("records an admin's own request IP and user agent, and the admin's name", async () => {
    const { c, svc, events } = setup(adminCtx);
    const customer = await addCustomer(c);
    svc.record(customer.id, 'UNBLOCKED', { actor: { type: 'ADMIN', userId: 1 } });
    await drainEvents();
    expect(events()[0]).toMatchObject({
      actorType: 'ADMIN',
      actorId: 1,
      actorName: 'Rita Costa',
      ip: '198.51.100.4',
      userAgent: 'Mozilla/5.0 Firefox/133',
    });
  });

  it('a failed write is logged by error name only and never throws', async () => {
    const { c, svc } = setup();
    const realQuery = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.customerEvent) return q;
      return { ...q, create: async () => Promise.reject(new TypeError('secret')) };
    };
    const error = vi.spyOn(c.strapi.log, 'error');
    expect(() => svc.record(1, 'LOGIN', { actor: { type: 'CUSTOMER' } })).not.toThrow();
    await drainEvents();
    expect(error).toHaveBeenCalledWith('[ecommerce:customer-events] EVENT_WRITE_FAILED TypeError');
  });

  it('lists 50 per page newest first, filters by type and searches the details', async () => {
    const { c, svc } = setup();
    const customer = await addCustomer(c);
    const other = await addCustomer(c, { email: 'b@x.pt', emailNormalized: 'b@x.pt' });
    for (let i = 0; i < 55; i++) {
      c.tables[UIDS.customerEvent] = c.tables[UIDS.customerEvent] ?? [];
      await c.strapi.db.query(UIDS.customerEvent).create({
        data: {
          customerId: customer.id,
          type: i % 5 === 0 ? 'LOGIN_FAILED' : 'LOGIN',
          actorType: 'CUSTOMER',
          details: i === 3 ? { changes: [{ field: 'phone', from: null, to: '912345678' }] } : {},
          searchText: i === 3 ? 'profile_updated phone 912345678' : 'login',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        },
      });
    }
    await c.strapi.db.query(UIDS.customerEvent).create({
      data: { customerId: other.id, type: 'LOGIN', actorType: 'CUSTOMER', searchText: 'login' },
    });

    const first = await svc.list(customer.id);
    expect(first.pagination).toEqual({ page: 1, pageSize: EVENTS_PAGE_SIZE, total: 55, pageCount: 2 });
    expect(first.results).toHaveLength(50);
    expect(first.results[0].createdAt).toBe(new Date(Date.UTC(2026, 0, 1, 0, 54)).toISOString());
    expect((await svc.list(customer.id, { page: 2 })).results).toHaveLength(5);
    expect((await svc.list(customer.id, { type: 'LOGIN_FAILED' })).pagination.total).toBe(11);
    expect((await svc.list(customer.id, { type: 'NOPE' })).pagination.total).toBe(55);
    const found = await svc.list(customer.id, { search: '9123' });
    expect(found.results.map((r: any) => r.details.changes?.[0]?.to)).toEqual(['912345678']);
  });
});

describe('events from the backoffice', () => {
  it('admin edits: old and new values, block with its note, unblock, password set', async () => {
    const { c, events } = setup(adminCtx);
    const customer = await addCustomer(c);
    const customers = c.services.EcommerceCustomerService;
    c.services.EcommerceCustomerSessionService = { revokeAll: async () => 0 };
    await customers.update(
      customer.id,
      { firstName: 'Ana', lastName: 'Sousa', email: 'Ana@Example.pt', phone: '912000000' },
      'user:1'
    );
    await customers.block(customer.id, { note: 'fraude' }, { userId: 1 });
    await customers.unblock(customer.id, { userId: 1 });
    c.services.EcommercePasswordService = {
      available: () => true,
      hash: async () => ({ hash: 'H', pepperVersion: 1 }),
    };
    c.services.EcommerceAccountMailer = { sendPasswordChanged: async () => undefined };
    await customers.setPassword(customer.id, { password: 'a-long-new-password' }, { userId: 1 });
    await drainEvents();
    const rows = events().filter((e: any) => e.customerId === customer.id);
    expect(rows.map((e: any) => e.type)).toEqual(['PROFILE_UPDATED', 'BLOCKED', 'UNBLOCKED', 'PASSWORD_CHANGED']);
    expect(rows[0].details.changes).toEqual([
      { field: 'lastName', from: 'Silva', to: 'Sousa' },
      { field: 'phone', from: null, to: '912000000' },
    ]);
    expect(rows[1].details).toEqual({ note: 'fraude' });
    expect(rows.every((e: any) => e.actorType === 'ADMIN' && e.actorName === 'Rita Costa')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('a-long-new-password');
  });

  it('an order created in the backoffice is ORDER_PLACED by that admin', async () => {
    const { c, events } = setup(adminCtx);
    const orderId = await createOrder(c);
    const placed = events().filter((e: any) => e.type === 'ORDER_PLACED');
    expect(placed).toHaveLength(1);
    const order = c.tables[UIDS.order].find((o: any) => o.id === orderId);
    expect(placed[0]).toMatchObject({
      customerId: customerIdOf(c, orderId),
      actorType: 'ADMIN',
      details: { orderId, reference: order.reference },
    });
  });

  it('an idempotent replay logs no second ORDER_PLACED', async () => {
    const { c, events } = setup();
    const input = {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: { firstName: 'Ana', lastName: 'Silva', line1: 'Rua 1', postalCode: '1000-001', city: 'Lisboa', country: 'PT' },
      billingAddress: { firstName: 'Ana', lastName: 'Silva', line1: 'Rua 1', postalCode: '1000-001', city: 'Lisboa', country: 'PT' },
      locale: 'en',
      lines: [{ variantId: 10, quantity: 1 }],
      shipping: { providerId: 'manual', serviceId: '1' },
      idempotencyKey: 'same-key',
    };
    // The storefront actor (its own validation is the checkout's, tested elsewhere).
    await c.orders.create(input, { actor: 'storefront', source: 'admin' });
    await c.orders.create(input, { actor: 'storefront', source: 'admin' });
    await drainEvents();
    const placed = events().filter((e: any) => e.type === 'ORDER_PLACED');
    expect(placed).toHaveLength(1);
    // A guest checkout: nobody proved who it was, so no name.
    expect(placed[0]).toMatchObject({ actorType: 'ANONYMOUS', actorId: null, actorName: null, ip: '203.0.113.7' });
  });
});

describe('events from the customer account', () => {
  const accountSetup = () => {
    const base = setup();
    const { c } = base;
    Object.assign(c.services, {
      EcommercePasswordService: {
        available: () => true,
        hash: async (pw: string) => ({ hash: `H(${pw})`, pepperVersion: 1 }),
        verify: async (stored: any, pw: string) => ({ ok: !!stored && stored.hash === `H(${pw})`, rehash: null }),
      },
      EcommerceCustomerTokenService: {
        issue: async () => ({ raw: 'RAW', expiresAt: 'x' }),
        consume: async (): Promise<any> => null,
      },
      EcommerceCustomerSessionService: {
        open: async () => ({ token: 'JWT', expiresAt: 'x', sessionId: 9 }),
        revoke: async () => true,
        revokeAll: async () => 0,
        list: async () => [],
        reissue: async () => ({ token: 'NEW', expiresAt: 'x' }),
      },
      EcommerceStorefrontSessionService: { expireAndScrub: async () => undefined },
      EcommerceAccountMailer: new Proxy({}, { get: () => async () => undefined }),
    });
    const svc = EcommerceAccountService({ strapi: c.strapi });
    const guest = { id: 55, expiresAt: '', cart: emptyCart(), verifiedEmail: null, emailVerification: {}, verificationAttempts: 0 };
    const client = { ip: '203.0.113.7', userAgent: 'UA' };
    const types = (id: number) => base.events().filter((e: any) => e.customerId === id).map((e: any) => e.type);
    return { ...base, svc, guest, client, types };
  };

  it('login, the failures with their reason, and logout', async () => {
    const { c, svc, guest, client, events, types } = accountSetup();
    const ana = await addCustomer(c);
    const login = (password: string) => svc.login({ email: 'ana@example.pt', password }, guest, client);
    await login('correct-horse');
    await expect(login('wrong')).rejects.toBeTruthy();
    await c.strapi.db.query(UIDS.customer).update({ where: { id: ana.id }, data: { emailVerified: false } });
    await expect(login('correct-horse')).rejects.toBeTruthy();
    await c.strapi.db.query(UIDS.customer).update({ where: { id: ana.id }, data: { blocked: true } });
    await expect(login('correct-horse')).rejects.toBeTruthy();
    await c.strapi.db.query(UIDS.customer).update({ where: { id: ana.id }, data: { blocked: false, accountType: 'GUEST' } });
    await expect(login('correct-horse')).rejects.toBeTruthy();
    // An e-mail without a customer has nothing to attach the attempt to.
    await expect(svc.login({ email: 'nobody@x.pt', password: 'x' }, guest, client)).rejects.toBeTruthy();
    await svc.logout(ana.id, 9);
    await drainEvents();
    expect(types(ana.id)).toEqual(['LOGIN', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGOUT']);
    expect(
      events()
        .filter((e: any) => e.type === 'LOGIN_FAILED')
        .map((e: any) => e.details.reason)
    ).toEqual(['INVALID_PASSWORD', 'EMAIL_NOT_VERIFIED', 'BLOCKED', 'NOT_REGISTERED']);
    expect(events()).toHaveLength(6);
    // Attempts are never shown under the customer's name; login and logout are.
    for (const e of events()) {
      if (e.type === 'LOGIN_FAILED') expect(e).toMatchObject({ actorType: 'ANONYMOUS', actorId: null, actorName: null });
      else expect(e).toMatchObject({ actorType: 'CUSTOMER', actorName: 'Ana Silva' });
    }
  });

  it('profile changes keep old and new values; password and e-mail changes never hold a password', async () => {
    const { c, svc, types, events } = accountSetup();
    const ana = await addCustomer(c);
    const me: any = { id: ana.id };
    await svc.updateProfile(me, { firstName: 'Ana', phone: '912345678', locale: 'pt' });
    await svc.updateProfile(me, { firstName: 'Ana' }); // nothing changed: no event
    await svc.changePassword(me, 9, { currentPassword: 'correct-horse', newPassword: 'another-long-pass' });
    await svc.requestEmailChange(me, { currentPassword: 'another-long-pass', newEmail: 'new@x.pt' });
    c.services.EcommerceCustomerTokenService.consume = async () => ({ customerId: ana.id, email: 'new@x.pt' });
    c.services.EcommerceStoreCreditService = { rekeyCustomerEmail: async () => undefined };
    c.services.EcommercePromotionService = { rekeyCustomerEmail: async () => undefined };
    await svc.confirmEmailChange('RAW');
    await drainEvents();
    expect(types(ana.id)).toEqual(['PROFILE_UPDATED', 'PASSWORD_CHANGED', 'EMAIL_CHANGE_REQUESTED', 'EMAIL_CHANGED']);
    const rows = events();
    expect(rows[0].details.changes).toEqual([
      { field: 'phone', from: null, to: '912345678' },
      { field: 'locale', from: 'en', to: 'pt' },
    ]);
    expect(rows[2].details).toEqual({ newEmail: 'new@x.pt' });
    expect(rows[3].details.changes).toEqual([{ field: 'email', from: 'Ana@Example.pt', to: 'new@x.pt' }]);
    expect(JSON.stringify(rows)).not.toMatch(/correct-horse|another-long-pass/);
  });

  it('registration, verification, reset request and reset', async () => {
    const { c, svc, guest, client, types } = accountSetup();
    await svc.register({ email: 'new@x.pt', password: 'a-long-password', firstName: 'Rui', lastName: 'Lopes' });
    const rui = c.tables[UIDS.customer].find((r: any) => r.emailNormalized === 'new@x.pt');
    c.services.EcommerceCustomerTokenService.consume = async () => ({ customerId: rui.id, email: 'new@x.pt' });
    await svc.verifyEmail('RAW', guest, client);
    await svc.forgotPassword('new@x.pt');
    await svc.resetPassword({ token: 'RAW', password: 'yet-another-pass' });
    await drainEvents();
    expect(types(rui.id)).toEqual([
      'ACCOUNT_REGISTERED',
      'EMAIL_VERIFIED',
      'LOGIN',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET',
    ]);
  });

  it('registering over an unverified account logs the replaced values and that the password changed', async () => {
    const { c, svc, events } = accountSetup();
    const ana = await addCustomer(c, { emailVerified: false, emailVerifiedAt: null, phone: '911111111' });
    await svc.register({ email: 'ana@example.pt', password: 'a-long-password', firstName: 'Anna', lastName: 'Silva' });
    await drainEvents();
    const rows = events().filter((e: any) => e.customerId === ana.id);
    expect(rows.map((e: any) => e.type)).toEqual(['ACCOUNT_REGISTERED', 'PASSWORD_CHANGED']);
    expect(rows[0]).toMatchObject({ actorType: 'ANONYMOUS', actorName: null });
    expect(rows[0].details.changes).toEqual([
      { field: 'firstName', from: 'Ana', to: 'Anna' },
      { field: 'phone', from: '911111111', to: null },
    ]);
    expect(JSON.stringify(rows)).not.toContain('a-long-password');
  });

  it('registering over a guest record logs no password change (its random one was never known)', async () => {
    const { c, svc, events } = accountSetup();
    const guest = await addCustomer(c, { accountType: 'GUEST', emailVerified: false, passwordHash: 'H(random)' });
    await svc.register({ email: 'ana@example.pt', password: 'a-long-password', firstName: 'Ana', lastName: 'Silva' });
    await drainEvents();
    expect(events().filter((e: any) => e.customerId === guest.id).map((e: any) => e.type)).toEqual([
      'ACCOUNT_REGISTERED',
    ]);
  });
});
