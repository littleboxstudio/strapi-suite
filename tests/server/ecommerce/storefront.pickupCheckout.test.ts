import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { asGuest, setupCommerce, UIDS } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import createController from '../../../server/src/controllers/modules/ecommerce/storefront';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { applyPickupPoint } from '../../../server/src/services/modules/ecommerce/domain/pickupPoints';

const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });

/** The customer's own address (Porto). */
const customerAddress = {
  firstName: 'Ana',
  lastName: 'Silva',
  nif: '123456789',
  line1: 'Rua do Cliente 5',
  line2: '3º Esq',
  postalCode: '4000-100',
  city: 'Porto',
  country: 'PT',
  phone: '+351910000000',
};

const billing = {
  firstName: 'Empresa',
  lastName: 'Lda',
  nif: '509999999',
  line1: 'Av. Fatura 9',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const POINT = {
  id: 'PT12345',
  name: 'Papelaria Central',
  address: 'Rua do Ponto 10',
  address2: 'Loja B',
  postalCode: '4000-200',
  city: 'Porto',
  country: 'PT' as const,
  openingHours: [{ day: 1, from: '09:00', to: '19:00' }],
};

const PICKUP = { providerId: 'dpd-portugal', serviceId: 'PICKUP' };
const PICKUP_PRICE = 400;
/** 2 × 2000 + 400 pickup shipping. */
const PICKUP_TOTAL = 4400;

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
  usageLimit: 10,
  perCustomerLimit: null,
  perOrderLimit: null,
  redemptions: 0,
  version: 1,
  ...over,
});

beforeEach(() => {
  __resetEventHandlersForTests();
  for (const fn of Object.values(stripe)) fn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const setup = () => {
  const c = setupCommerce();
  const findPoint = vi.fn(async (_postalCode: string, id: string) => (id === POINT.id ? POINT : null));
  c.services.EcommercePickupPointService = { findPoint, search: vi.fn() };
  const findOption = vi.fn(async (_req: any, providerId: string, serviceId: string) =>
    providerId === 'dpd-portugal' && serviceId === 'PICKUP'
      ? { providerId, serviceId, name: 'DPD Pickup', price: PICKUP_PRICE, tax: 23, requiresPickupPoint: true }
      : { providerId, serviceId, name: 'Standard', price: 500, tax: 23 }
  );
  c.services.EcommerceShippingService.findOption = findOption;
  c.services.EcommerceShippingService.quote = vi.fn(async () => ({
    options: [
      { providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, tax: 23 },
      { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup', price: PICKUP_PRICE, tax: 23, requiresPickupPoint: true },
    ],
    failures: [],
  }));
  const sessions = c.services.EcommerceStorefrontSessionService;
  const checkout = c.services.EcommerceStorefrontCheckoutService;
  const open = async () => {
    const { token } = await sessions.open(null);
    return { token: token as string, s: await sessions.resolve(token) };
  };
  const orderInput = (over: Record<string, unknown> = {}) => ({
    customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
    shippingAddress: customerAddress,
    billingAddress: null,
    locale: 'en',
    lines: [{ variantId: 10, quantity: 2 }],
    shippingMethod: PICKUP,
    expectedTotal: PICKUP_TOTAL,
    pickupPointId: POINT.id,
    ...over,
  });
  /** Nothing was written: no order, line, stock movement or promotion usage (Review Focus 3). */
  const expectNothingConsumed = () => {
    expect(c.tables[UIDS.order]).toHaveLength(0);
    expect(c.tables[UIDS.orderLine]).toHaveLength(0);
    expect(c.tables[UIDS.stockMovement]).toHaveLength(0);
    expect(c.tables[UIDS.promotionRedemption]).toHaveLength(0);
    expect(c.tables[UIDS.promotionCustomerUsage]).toHaveLength(0);
    expect(c.tables[UIDS.promotion][0].redemptions).toBe(0);
    expect(c.tables[UIDS.variant][0].stock).toBe(5);
  };
  return { c, findPoint, findOption, checkout, open, orderInput, expectNothingConsumed };
};

const issuesOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof EcommerceValidationError) return err.errors;
    throw err;
  }
  throw new Error('expected a validation error');
};

describe('applyPickupPoint', () => {
  it('builds the point as the delivery address and keeps the customer address on the point', () => {
    const out = applyPickupPoint(customerAddress, POINT);
    expect(out.shippingAddress).toEqual({
      firstName: 'Ana',
      lastName: 'Silva',
      phone: '+351910000000',
      company: 'Papelaria Central',
      line1: 'Rua do Ponto 10',
      line2: 'Loja B',
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
    });
    expect(out.pickupPoint).toEqual({
      id: 'PT12345',
      name: 'Papelaria Central',
      address: 'Rua do Ponto 10',
      address2: 'Loja B',
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
      customerAddress,
    });
  });

  it('omits an empty line2 and phone', () => {
    const { phone: _p, ...noPhone } = customerAddress;
    const out = applyPickupPoint(noPhone, { ...POINT, address2: null });
    expect(out.shippingAddress).not.toHaveProperty('line2');
    expect(out.shippingAddress).not.toHaveProperty('phone');
    expect(out.pickupPoint.address2).toBeNull();
  });
});

describe('storefront checkout with DPD Pickup (spec 5.2)', () => {
  it('no pickupPointId → PICKUP_POINT_REQUIRED; no order, stock or promotion is consumed', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    const { s } = await t.open();
    const errors = await issuesOf(t.checkout.placeOrder(asGuest(s), t.orderInput({ pickupPointId: undefined }), 'key-pk-001'));
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(t.findPoint).not.toHaveBeenCalled();
    t.expectNothingConsumed();
  });

  it('a blank pickupPointId is the same as none', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    const { s } = await t.open();
    const errors = await issuesOf(t.checkout.placeOrder(asGuest(s), t.orderInput({ pickupPointId: '  ' }), 'key-pk-002'));
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    t.expectNothingConsumed();
  });

  it('an id the search does not return → PICKUP_POINT_INVALID; nothing is consumed', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    const { s } = await t.open();
    const errors = await issuesOf(t.checkout.placeOrder(asGuest(s), t.orderInput({ pickupPointId: 'NOPE' }), 'key-pk-003'));
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.findPoint).toHaveBeenCalledWith('4000-100', 'NOPE');
    t.expectNothingConsumed();
  });

  it('a failed search → PICKUP_SEARCH_FAILED; nothing is consumed', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    t.findPoint.mockRejectedValueOnce(new EcommerceCarrierError('PICKUP_SEARCH_FAILED' as any));
    const { s } = await t.open();
    await expect(t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-pk-004')).rejects.toMatchObject({
      code: 'PICKUP_SEARCH_FAILED',
    });
    t.expectNothingConsumed();
  });

  it('an invalid pickup postal code → INVALID_POSTAL_CODE on pickupPostalCode; nothing is consumed', async () => {
    const t = setup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    t.findPoint.mockRejectedValueOnce(
      new EcommerceValidationError('INVALID_POSTAL_CODE', [{ path: 'postalCode', code: 'INVALID_POSTAL_CODE' }])
    );
    const { s } = await t.open();
    const errors = await issuesOf(
      t.checkout.placeOrder(asGuest(s), t.orderInput({ pickupPostalCode: '12' }), 'key-pk-005')
    );
    expect(errors).toEqual([{ path: 'pickupPostalCode', code: 'INVALID_POSTAL_CODE' }]);
    t.expectNothingConsumed();
  });

  it('a valid id: the point is the delivery address, billing is the customer address, pickupPoint stored', async () => {
    const t = setup();
    const { s } = await t.open();
    const placed = await t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-pk-006');
    expect(placed.total).toBe(PICKUP_TOTAL);
    const order = t.c.tables[UIDS.order][0];
    expect(order.shippingAddress).toEqual({
      firstName: 'Ana',
      lastName: 'Silva',
      phone: '+351910000000',
      company: 'Papelaria Central',
      line1: 'Rua do Ponto 10',
      line2: 'Loja B',
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
    });
    expect(order.billingAddress).toMatchObject({ line1: 'Rua do Cliente 5', postalCode: '4000-100', nif: '123456789' });
    expect(order.pickupPoint).toEqual({
      id: 'PT12345',
      name: 'Papelaria Central',
      address: 'Rua do Ponto 10',
      address2: 'Loja B',
      postalCode: '4000-200',
      city: 'Porto',
      country: 'PT',
      customerAddress: expect.objectContaining({ line1: 'Rua do Cliente 5', postalCode: '4000-100' }),
    });
    expect(order.shippingMethod).toMatchObject(PICKUP);
    // The point is searched by the customer's postal code; the shipping price by the point's address.
    expect(t.findPoint).toHaveBeenCalledWith('4000-100', 'PT12345');
    for (const [req] of t.findOption.mock.calls) {
      expect(req).toMatchObject({ country: 'PT', postalCode: '4000-200' });
    }
  });

  it('a sent billingAddress is kept', async () => {
    const t = setup();
    const { s } = await t.open();
    await t.checkout.placeOrder(asGuest(s), t.orderInput({ billingAddress: billing }), 'key-pk-007');
    expect(t.c.tables[UIDS.order][0].billingAddress).toMatchObject({ line1: 'Av. Fatura 9', nif: '509999999' });
  });

  it('pickupPostalCode is the code searched when present', async () => {
    const t = setup();
    const { s } = await t.open();
    await t.checkout.placeOrder(asGuest(s), t.orderInput({ pickupPostalCode: '4000-200' }), 'key-pk-008');
    expect(t.findPoint).toHaveBeenCalledWith('4000-200', 'PT12345');
  });

  it('a non-pickup method ignores pickupPointId', async () => {
    const t = setup();
    const { s } = await t.open();
    await t.checkout.placeOrder(
      asGuest(s),
      t.orderInput({ shippingMethod: { providerId: 'manual', serviceId: '1' }, expectedTotal: 4500 }),
      'key-pk-009'
    );
    const order = t.c.tables[UIDS.order][0];
    expect(t.findPoint).not.toHaveBeenCalled();
    expect(order.pickupPoint ?? null).toBeNull();
    expect(order.shippingAddress).toMatchObject({ line1: 'Rua do Cliente 5' });
  });

  it('a replay returns the stored order without a new search', async () => {
    const t = setup();
    const { s } = await t.open();
    const a = await t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-pk-010');
    t.findPoint.mockRejectedValue(new EcommerceCarrierError('PICKUP_SEARCH_FAILED' as any));
    const b = await t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-pk-010');
    expect(b.publicId).toBe(a.publicId);
    expect(t.findPoint).toHaveBeenCalledTimes(1);
  });

  it('the admin order view has the full pickupPoint; the storefront status has no customer address', async () => {
    const t = setup();
    const { s } = await t.open();
    const placed = await t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-pk-011');
    const view = await t.c.orders.get(t.c.tables[UIDS.order][0].id);
    expect(view.pickupPoint).toMatchObject({ id: 'PT12345', customerAddress: { line1: 'Rua do Cliente 5' } });
    const status = await t.checkout.orderStatus(asGuest(s), placed.publicId);
    const raw = JSON.stringify(status);
    expect(raw).not.toContain('Rua do Cliente 5');
    expect(raw).not.toContain('customerAddress');
  });

  it('an order without a pickup point has pickupPoint null in the admin view', async () => {
    const t = setup();
    const { s } = await t.open();
    await t.checkout.placeOrder(
      asGuest(s),
      t.orderInput({ shippingMethod: { providerId: 'manual', serviceId: '1' }, expectedTotal: 4500 }),
      'key-pk-012'
    );
    const view = await t.c.orders.get(t.c.tables[UIDS.order][0].id);
    expect(view.pickupPoint).toBeNull();
  });

  it('the quote lists PICKUP with requiresPickupPoint', async () => {
    const t = setup();
    const { s } = await t.open();
    const quote = await t.checkout.quote(asGuest(s), {
      lines: [{ variantId: 10, quantity: 2 }],
      locale: 'en',
      destination: { country: 'PT', postalCode: '4000-100' },
    });
    expect(quote.shippingOptions).toEqual([
      { providerId: 'manual', serviceId: '1', name: 'Standard', price: 500, estimatedDays: null },
      {
        providerId: 'dpd-portugal',
        serviceId: 'PICKUP',
        name: 'DPD Pickup',
        price: PICKUP_PRICE,
        estimatedDays: null,
        requiresPickupPoint: true,
      },
    ]);
  });
});

/** Store pickup (store pickup spec 5): the stores of each market, from the current config. */
const STORE = { providerId: 'store-pickup', serviceId: 'STORE' };
const STORE_LISBOA = {
  id: 'st_lisboa0001',
  name: 'Loja Lisboa',
  address: 'Rua da Loja 1',
  address2: null,
  postalCode: '1000-100',
  city: 'Lisboa',
  country: 'PT',
};
const STORE_FUNCHAL = {
  id: 'st_funchal001',
  name: 'Loja Funchal',
  address: 'Rua do Mar 2',
  address2: null,
  postalCode: '9000-100',
  city: 'Funchal',
  country: 'PT',
};
const STORES: Record<string, (typeof STORE_LISBOA)[]> = { PT: [STORE_LISBOA], 'PT-ISL': [STORE_FUNCHAL] };

const storeSetup = () => {
  const t = setup();
  const settings = t.c.services.EcommerceSettingsService;
  const getStoreSettings = settings.getStoreSettings;
  settings.getStoreSettings = async () => ({ ...(await getStoreSettings()), markets: ['PT', 'PT-ISL'] });
  const findStore = vi.fn(async (market: string, id: string) => STORES[market]?.find((s) => s.id === id) ?? null);
  settings.findStore = findStore;
  t.findOption.mockImplementation(async (_req: any, providerId: string, serviceId: string) =>
    providerId === 'store-pickup' && serviceId === 'STORE'
      ? { providerId, serviceId, name: 'Store pickup', price: 0, tax: 23, requiresPickupPoint: true }
      : providerId === 'dpd-portugal' && serviceId === 'PICKUP'
        ? { providerId, serviceId, name: 'DPD Pickup', price: PICKUP_PRICE, tax: 23, requiresPickupPoint: true }
        : { providerId, serviceId, name: 'Standard', price: 500, tax: 23 }
  );
  const storeInput = (over: Record<string, unknown> = {}) =>
    t.orderInput({ shippingMethod: STORE, expectedTotal: 4000, pickupPointId: STORE_LISBOA.id, ...over });
  return { ...t, findStore, storeInput };
};

describe('storefront checkout with Store pickup (store pickup spec 5)', () => {
  it('store pickup requires pickupPointId', async () => {
    const t = storeSetup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    const { s } = await t.open();
    const errors = await issuesOf(
      t.checkout.placeOrder(asGuest(s), t.storeInput({ pickupPointId: undefined }), 'key-st-001')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(t.findStore).not.toHaveBeenCalled();
    expect(t.findPoint).not.toHaveBeenCalled();
    t.expectNothingConsumed();
  });

  it("accepts a store of the address's market and stores it as pickupPoint with the customer's address kept", async () => {
    const t = storeSetup();
    const { s } = await t.open();
    // pickupPostalCode is ignored for store pickup.
    const placed = await t.checkout.placeOrder(asGuest(s), t.storeInput({ pickupPostalCode: '9000-100' }), 'key-st-002');
    expect(placed.total).toBe(4000);
    expect(t.findStore).toHaveBeenCalledWith('PT', STORE_LISBOA.id);
    expect(t.findPoint).not.toHaveBeenCalled();
    const order = t.c.tables[UIDS.order][0];
    expect(order.shippingAddress).toEqual({
      firstName: 'Ana',
      lastName: 'Silva',
      phone: '+351910000000',
      company: 'Loja Lisboa',
      line1: 'Rua da Loja 1',
      postalCode: '1000-100',
      city: 'Lisboa',
      country: 'PT',
    });
    expect(order.billingAddress).toMatchObject({ line1: 'Rua do Cliente 5', postalCode: '4000-100' });
    expect(order.pickupPoint).toEqual({
      ...STORE_LISBOA,
      customerAddress: expect.objectContaining({ line1: 'Rua do Cliente 5', postalCode: '4000-100' }),
    });
    expect(order.shippingMethod).toMatchObject(STORE);
  });

  it('refuses a store of another market', async () => {
    const t = storeSetup();
    t.c.tables[UIDS.promotion].push(promotion(1));
    const { s } = await t.open();
    const errors = await issuesOf(
      t.checkout.placeOrder(asGuest(s), t.storeInput({ pickupPointId: STORE_FUNCHAL.id }), 'key-st-003')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.findStore).toHaveBeenCalledWith('PT', STORE_FUNCHAL.id);
    t.expectNothingConsumed();
  });

  it("an island address is in PT-ISL: its market's store is accepted", async () => {
    const t = storeSetup();
    const { s } = await t.open();
    const islandAddress = { ...customerAddress, postalCode: '9000-200', city: 'Funchal' };
    await t.checkout.placeOrder(
      asGuest(s),
      t.storeInput({ shippingAddress: islandAddress, pickupPointId: STORE_FUNCHAL.id }),
      'key-st-004'
    );
    expect(t.findStore).toHaveBeenCalledWith('PT-ISL', STORE_FUNCHAL.id);
    expect(t.c.tables[UIDS.order][0].pickupPoint).toMatchObject({ id: STORE_FUNCHAL.id });
  });

  it('refuses a DPD PUDO id', async () => {
    const t = storeSetup();
    const { s } = await t.open();
    const errors = await issuesOf(
      t.checkout.placeOrder(asGuest(s), t.storeInput({ pickupPointId: POINT.id }), 'key-st-005')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.findPoint).not.toHaveBeenCalled();
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });

  it('DPD pickup still searches DPD', async () => {
    const t = storeSetup();
    const { s } = await t.open();
    await t.checkout.placeOrder(asGuest(s), t.orderInput(), 'key-st-006');
    expect(t.findPoint).toHaveBeenCalledWith('4000-100', POINT.id);
    expect(t.findStore).not.toHaveBeenCalled();
    expect(t.c.tables[UIDS.order][0].pickupPoint).toMatchObject({ id: POINT.id });
  });
});

describe('storefront controller: POST /orders with a pickup point', () => {
  const mkCtx = (req: { headers?: Record<string, string>; body?: unknown }): any => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
    return {
      request: { headers, header: headers, body: req.body },
      query: {},
      params: {},
      status: 404,
      body: undefined,
      get: (name: string) => headers[name.toLowerCase()] ?? '',
      set: () => undefined,
    };
  };

  const call = async (t: ReturnType<typeof setup>, body: unknown, key: string) => {
    const controller: any = createController({ strapi: t.c.strapi });
    const { token } = await t.c.services.EcommerceStorefrontSessionService.open(null);
    const ctx = mkCtx({ headers: { 'X-Checkout-Session': token, 'Idempotency-Key': key }, body });
    await controller.createOrder(ctx);
    return ctx;
  };

  it('passes pickupPointId and pickupPostalCode to the checkout', async () => {
    const t = setup();
    const ctx = await call(t, { ...t.orderInput(), pickupPostalCode: '4000-200' }, 'key-ctl-0001');
    expect(ctx.status).toBe(201);
    expect(t.findPoint).toHaveBeenCalledWith('4000-200', 'PT12345');
  });

  it('no pickupPointId → 400 PICKUP_POINT_REQUIRED', async () => {
    const t = setup();
    const { pickupPointId: _id, ...body } = t.orderInput();
    const ctx = await call(t, body, 'key-ctl-0002');
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.details).toMatchObject({
      code: 'PICKUP_POINT_REQUIRED',
      errors: [{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }],
    });
  });

  it('a failed search → 502 PICKUP_SEARCH_FAILED', async () => {
    const t = setup();
    t.findPoint.mockRejectedValueOnce(new EcommerceCarrierError('PICKUP_SEARCH_FAILED' as any));
    const ctx = await call(t, t.orderInput(), 'key-ctl-0003');
    expect(ctx.status).toBe(502);
    expect(ctx.body.error.details).toEqual({ code: 'PICKUP_SEARCH_FAILED' });
  });

  it.each([
    ['a non-string pickupPointId', { pickupPointId: 12 }, 'pickupPointId', 'invalid'],
    ['a too long pickupPointId', { pickupPointId: 'x'.repeat(65) }, 'pickupPointId', 'too_long'],
    ['a non-string pickupPostalCode', { pickupPostalCode: 4000 }, 'pickupPostalCode', 'invalid'],
  ])('%s → 400', async (_n, over, path, code) => {
    const t = setup();
    const ctx = await call(t, t.orderInput(over), 'key-ctl-0004');
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.details.errors).toEqual([{ path, code }]);
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });
});
