import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupCommerce, UIDS } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceAccountError,
  EcommerceNotFoundError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { emptyCart } from '../../../server/src/services/modules/ecommerce/storefrontSessions';
import type { CartOwner } from '../../../server/src/services/modules/ecommerce/storefrontCheckout';
import type { AccountCustomer } from '../../../server/src/services/modules/ecommerce/customerSessions';

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

beforeEach(() => {
  __resetEventHandlersForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const setup = () => {
  const c = setupCommerce();
  const checkout = c.services.EcommerceStorefrontCheckoutService;
  const sessions = c.services.EcommerceStorefrontSessionService;
  const addCustomer = async (extra: Record<string, unknown> = {}) =>
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
        blocked: false,
        cart: emptyCart(),
        ...extra,
      },
    });
  const owner = (row: any): CartOwner => {
    const customer: AccountCustomer = {
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
      pendingEmail: null,
    };
    return { kind: 'customer', customer, sessionId: 77 };
  };
  const row = (id: number) => c.tables[UIDS.customer].find((r) => r.id === id);
  const cart = (over: Record<string, unknown> = {}) => ({
    lines: [{ variantId: 10, quantity: 2 }],
    locale: 'en',
    ...over,
  });
  const orderInput = (over: Record<string, unknown> = {}) => ({
    customer: { firstName: 'Rita', lastName: 'Costa', email: 'other@example.pt', phone: '912345678' },
    shippingAddress: address,
    billingAddress: null,
    locale: 'en',
    lines: [{ variantId: 10, quantity: 2 }],
    shippingMethod: { providerId: 'manual', serviceId: '1' },
    expectedTotal: 4500,
    ...over,
  });
  return { c, checkout, sessions, addCustomer, owner, row, cart, orderInput };
};

describe('storefront checkout with a customer owner', () => {
  it("a customer owner's quote saves to customer.cart, priced with the account e-mail", async () => {
    const t = setup();
    const customer = await t.addCustomer();
    const sessionsBefore = t.c.tables[UIDS.checkoutSession].length;
    const spy = vi.spyOn(t.c.orders, 'quote');
    const q = await t.checkout.quote(t.owner(customer), t.cart({ email: 'someone@else.pt' }));
    expect(q.totals.subtotal).toBe(4000);
    expect(t.row(customer.id).cart).toMatchObject({
      lines: [{ variantId: 10, quantity: 2 }],
      email: 'Ana@Example.pt',
      locale: 'en',
    });
    expect(spy.mock.calls[0][0]).toMatchObject({ email: 'Ana@Example.pt', emailVerified: true });
    expect(t.c.tables[UIDS.checkoutSession]).toHaveLength(sessionsBefore);
  });

  it('getCart reads the customer cart; a malformed customer.cart reads as empty (Review Focus 2)', async () => {
    const t = setup();
    const ok = await t.addCustomer({ cart: { ...emptyCart(), lines: [{ variantId: 10, quantity: 1 }] } });
    expect((await t.checkout.getCart(t.owner(ok))).lines).toEqual([{ variantId: 10, quantity: 1 }]);
    for (const bad of [null, [], { lines: 'x' }, { lines: [{ foo: 1 }, { variantId: -1, quantity: 2 }] }]) {
      const c = await t.addCustomer({
        email: `b${Math.random()}@x.pt`,
        emailNormalized: `b${Math.random()}@x.pt`,
        cart: bad,
      });
      const read = await t.checkout.getCart(t.owner(c));
      expect(read.lines).toEqual([]);
      // A quote over the malformed stored cart works and replaces it.
      await t.checkout.quote(t.owner(c), t.cart());
      expect(t.row(c.id).cart.lines).toEqual([{ variantId: 10, quantity: 2 }]);
    }
  });

  it('getCart of a guest owner is the session cart', async () => {
    const t = setup();
    const { token } = await t.sessions.open(null);
    const s = await t.sessions.resolve(token);
    await t.checkout.quote({ kind: 'guest', session: s }, t.cart());
    const again = await t.sessions.resolve(token);
    expect((await t.checkout.getCart({ kind: 'guest', session: again })).lines).toEqual([
      { variantId: 10, quantity: 2 },
    ]);
  });

  it('applyDiscount saves an applied code to customer.cart', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push({
      id: 1,
      name: 'Interno-1',
      description: null,
      code: 'VERAO20',
      method: 'CODE',
      active: true,
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: null,
      priority: 0,
      displayName: { en: 'Summer' },
      eligibility: { mode: 'ALL' },
      conditions: { type: 'GROUP', operator: 'AND', children: [] },
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 20 }] },
      stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
      usageLimit: null,
      perCustomerLimit: null,
      perOrderLimit: null,
      redemptions: 0,
      version: 1,
    });
    const customer = await t.addCustomer();
    const r = await t.checkout.applyDiscount(t.owner(customer), { ...t.cart(), code: 'verao20' });
    expect(r.applied).toBe(true);
    expect(t.row(customer.id).cart.promotionCodes).toEqual(['VERAO20']);
  });

  it('createOrder uses the account e-mail, emailVerified true, the body name and phone, and clears customer.cart', async () => {
    const t = setup();
    const customer = await t.addCustomer();
    await t.checkout.quote(t.owner(customer), t.cart({ destination: { country: 'PT' } }));
    const spy = vi.spyOn(t.c.orders, 'create');
    const placed = await t.checkout.placeOrder(t.owner(customer), t.orderInput(), 'key-cust-0001');
    expect(placed.reference).toMatch(/^#\d+$/);
    expect(spy.mock.calls[0][0]).toMatchObject({
      customer: { firstName: 'Rita', lastName: 'Costa', email: 'Ana@Example.pt', phone: '912345678' },
      emailVerified: true,
      customerId: customer.id,
      idempotencyKey: `sfc:${customer.id}:key-cust-0001`,
    });
    expect(spy.mock.calls[0][1]).toEqual({ actor: 'storefront', source: 'storefront' });
    const order = t.c.tables[UIDS.order][0];
    expect(order.customer).toBe(customer.id);
    expect(order.checkoutSession ?? null).toBeNull();
    // The account is never updated from the body.
    expect(t.row(customer.id)).toMatchObject({ firstName: 'Ana', lastName: 'Silva', phone: null });
    const cleared = t.row(customer.id).cart;
    expect(cleared.lines).toEqual([]);
    expect(cleared.promotionCodes).toEqual([]);
    expect(cleared.destination).toEqual({ country: 'PT' });
  });

  it('the order lands on the account row, never on an e-mail match', async () => {
    const t = setup();
    // An older row with the same normalized e-mail (e.g. legacy duplicate data).
    const older = await t.addCustomer({ accountType: 'GUEST', emailVerified: false });
    const account = await t.addCustomer();
    await t.checkout.placeOrder(t.owner(account), t.orderInput(), 'key-cust-0003');
    expect(older.id).toBeLessThan(account.id);
    expect(t.c.tables[UIDS.order][0].customer).toBe(account.id);
  });

  it('a blocked customer owner → CUSTOMER_BLOCKED, no order', async () => {
    const t = setup();
    const customer = await t.addCustomer();
    const owner = t.owner(customer);
    t.row(customer.id).blocked = true;
    const err: any = await t.checkout.placeOrder(owner, t.orderInput(), 'key-cust-0004').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceAccountError);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'CUSTOMER_BLOCKED', status: 403 });
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });

  it('a replay with the same idempotency key returns the order and leaves customer.cart untouched', async () => {
    const t = setup();
    const customer = await t.addCustomer();
    const first = await t.checkout.placeOrder(t.owner(customer), t.orderInput(), 'key-cust-0005');
    await t.checkout.quote(t.owner(customer), t.cart({ lines: [{ variantId: 10, quantity: 1 }] }));
    const rebuilt = structuredClone(t.row(customer.id).cart);
    const spy = vi.spyOn(t.c.orders, 'create');
    const again = await t.checkout.placeOrder(t.owner(customer), t.orderInput(), 'key-cust-0005');
    expect(again.publicId).toBe(first.publicId);
    expect(await spy.mock.results[0].value).toMatchObject({ replayed: true });
    expect(t.c.tables[UIDS.order]).toHaveLength(1);
    expect(t.row(customer.id).cart).toEqual(rebuilt);
  });

  it('orderStatus and paymentLink only see the customer own orders', async () => {
    const t = setup();
    const ana = await t.addCustomer();
    const rui = await t.addCustomer({ email: 'rui@example.pt', emailNormalized: 'rui@example.pt', firstName: 'Rui' });
    const placed = await t.checkout.placeOrder(t.owner(ana), t.orderInput(), 'key-cust-0002');
    expect((await t.checkout.orderStatus(t.owner(ana), placed.publicId)).publicId).toBe(placed.publicId);
    await expect(t.checkout.orderStatus(t.owner(rui), placed.publicId)).rejects.toBeInstanceOf(
      EcommerceNotFoundError
    );
    await expect(t.checkout.paymentLink(t.owner(rui), placed.publicId)).rejects.toBeInstanceOf(
      EcommerceNotFoundError
    );
  });

  it("a blocked account's e-mail in guest checkout → CUSTOMER_BLOCKED, no order", async () => {
    const t = setup();
    await t.addCustomer({ email: 'foo@bar.com', emailNormalized: 'foo@bar.com', blocked: true });
    const { token } = await t.sessions.open(null);
    const s = await t.sessions.resolve(token);
    const err: any = await t.checkout
      .placeOrder(
        { kind: 'guest', session: s },
        t.orderInput({ customer: { firstName: 'F', lastName: 'B', email: '  Foo@Bar.com ' } }),
        'key-blocked-01'
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceAccountError);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'CUSTOMER_BLOCKED', status: 403 });
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });

  it("a registered account's e-mail in guest checkout without a verified e-mail → EMAIL_VERIFICATION_REQUIRED, no order", async () => {
    const t = setup();
    await t.addCustomer();
    const { token } = await t.sessions.open(null);
    const s = await t.sessions.resolve(token);
    const err: any = await t.checkout
      .placeOrder(
        { kind: 'guest', session: s },
        t.orderInput({ customer: { firstName: 'Eve', lastName: 'X', email: ' ana@EXAMPLE.pt' } }),
        'key-unverified-01'
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceAccountError);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', status: 409 });
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });

  it("a GUEST account's e-mail in guest checkout without a verified e-mail still places the order", async () => {
    const t = setup();
    const g = await t.addCustomer({ accountType: 'GUEST', emailVerified: false });
    const { token } = await t.sessions.open(null);
    const s = await t.sessions.resolve(token);
    await t.checkout.placeOrder(
      { kind: 'guest', session: s },
      t.orderInput({ customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' } }),
      'key-guest-row-01'
    );
    expect(t.c.tables[UIDS.order]).toHaveLength(1);
    expect(t.c.tables[UIDS.order][0].customer).toBe(g.id);
  });

  describe('guest customers created by an order', () => {
    const guestOrder = async (t: ReturnType<typeof setup>, key: string) => {
      const { token } = await t.sessions.open(null);
      const s = await t.sessions.resolve(token);
      return t.checkout.placeOrder(
        { kind: 'guest', session: s },
        t.orderInput({ customer: { firstName: 'Rui', lastName: 'S', email: 'rui@example.pt' } }),
        key
      );
    };

    it('get a GUEST account with the random password hash computed before the transaction', async () => {
      const t = setup();
      const order: string[] = [];
      t.c.services.EcommercePasswordService = {
        available: () => true,
        randomGuestHash: vi.fn(async () => {
          order.push(t.c.strapi.db.inTransaction() ? 'in-trx' : 'before-trx');
          return { hash: 'GUEST', pepperVersion: 4 };
        }),
      };
      await guestOrder(t, 'key-guest-0001');
      expect(order).toEqual(['before-trx']);
      expect(t.c.tables[UIDS.customer][0]).toMatchObject({
        accountType: 'GUEST',
        emailVerified: false,
        passwordHash: 'GUEST',
        passwordPepperVersion: 4,
      });
    });

    it('skip the hash when the password service is unavailable, or when the e-mail already has a customer', async () => {
      const t = setup();
      const randomGuestHash = vi.fn(async () => ({ hash: 'GUEST', pepperVersion: 4 }));
      t.c.services.EcommercePasswordService = { available: () => false, randomGuestHash };
      await guestOrder(t, 'key-guest-0002');
      expect(randomGuestHash).not.toHaveBeenCalled();
      expect(t.c.tables[UIDS.customer][0].passwordHash ?? null).toBeNull();
      t.c.services.EcommercePasswordService = { available: () => true, randomGuestHash };
      await guestOrder(t, 'key-guest-0003');
      expect(randomGuestHash).not.toHaveBeenCalled();
    });

    it('a failing guest hash never fails the order', async () => {
      const t = setup();
      t.c.services.EcommercePasswordService = {
        available: () => true,
        randomGuestHash: vi.fn(async () => {
          throw Object.assign(new Error('queue full'), { code: 'ACCOUNTS_UNAVAILABLE' });
        }),
      };
      const placed = await guestOrder(t, 'key-guest-0004');
      expect(placed.publicId).toBeTruthy();
      expect(t.c.tables[UIDS.customer][0]).toMatchObject({ accountType: 'GUEST' });
      expect(t.c.tables[UIDS.customer][0].passwordHash ?? null).toBeNull();
    });
  });
});
