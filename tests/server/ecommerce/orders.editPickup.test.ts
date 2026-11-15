import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupCommerce, UIDS } from './helpers/commerceSetup';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';

/** The customer's own address (Porto). */
const customerAddress = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua do Cliente 5',
  postalCode: '4000-100',
  city: 'Porto',
  country: 'PT',
  phone: '+351910000000',
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

const OTHER_POINT = {
  ...POINT,
  id: 'PT99999',
  name: 'Quiosque Norte',
  address: 'Praça Norte 1',
  address2: null,
  postalCode: '4000-300',
};

const pointAddress = (p: typeof POINT | typeof OTHER_POINT) => ({
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '+351910000000',
  company: p.name,
  line1: p.address,
  ...(p.address2 ? { line2: p.address2 } : {}),
  postalCode: p.postalCode,
  city: p.city,
  country: 'PT',
});

const PICKUP = { providerId: 'dpd-portugal', serviceId: 'PICKUP' };
const STANDARD = { providerId: 'manual', serviceId: '1' };

beforeEach(() => {
  __resetEventHandlersForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const setup = () => {
  const c = setupCommerce();
  const points = [POINT, OTHER_POINT];
  const findPoint = vi.fn(async (_postalCode: string, id: string) => points.find((p) => p.id === id) ?? null);
  c.services.EcommercePickupPointService = { findPoint, search: vi.fn() };
  const pickupOption = { ...PICKUP, name: 'DPD Pickup', price: 400, tax: 23, requiresPickupPoint: true };
  const standardOption = { ...STANDARD, name: 'Standard', price: 500, tax: 23 };
  c.services.EcommerceShippingService.findOption = vi.fn(
    async (_req: any, providerId: string, serviceId: string) =>
      providerId === 'dpd-portugal' && serviceId === 'PICKUP' ? pickupOption : standardOption
  );
  c.services.EcommerceShippingService.quote = vi.fn(async () => ({
    options: [standardOption, pickupOption],
    failures: [],
  }));
  c.services.EcommerceShippingService.servedCountries = vi.fn(async () => ['PT']);
  const create = (over: Record<string, unknown> = {}) =>
    c.orders.create(
      {
        customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
        shippingAddress: customerAddress,
        billingAddress: customerAddress,
        locale: 'en',
        lines: [{ variantId: 10, quantity: 2 }],
        shipping: STANDARD,
        ...over,
      },
      { actor: 'user:1', source: 'admin' }
    );
  const row = (id: number) => c.tables[UIDS.order].find((o: any) => o.id === id);
  const history = (id: number, type: string) =>
    c.tables[UIDS.orderHistory].filter((h: any) => h.order === id && h.type === type);
  return { c, findPoint, create, row, history };
};

const issuesOf = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

describe('admin manual order with DPD Pickup', () => {
  it('no pickupPointId → PICKUP_POINT_REQUIRED; nothing is consumed', async () => {
    const t = setup();
    const errors = await issuesOf(t.create({ shipping: PICKUP }));
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(t.findPoint).not.toHaveBeenCalled();
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
    expect(t.c.tables[UIDS.orderLine]).toHaveLength(0);
    expect(t.c.tables[UIDS.stockMovement]).toHaveLength(0);
    expect(t.c.tables[UIDS.variant][0].stock).toBe(5);
  });

  it('with a point: the delivery address is the point, the customer address is kept on the point', async () => {
    const t = setup();
    const created = await t.create({ shipping: PICKUP, pickupPointId: POINT.id, pickupPostalCode: '4000-200' });
    expect(t.findPoint).toHaveBeenCalledWith('4000-200', POINT.id);
    const order = t.row(created.id);
    expect(order.shippingAddress).toEqual(pointAddress(POINT));
    expect(order.pickupPoint).toMatchObject({ id: POINT.id, customerAddress });
  });
});

describe('order editing: changing the shipping method to DPD Pickup', () => {
  it('add a PICKUP charge without a point → PICKUP_POINT_REQUIRED; nothing changes', async () => {
    const t = setup();
    const { id } = await t.create();
    const before = JSON.stringify(t.row(id));
    const errors = await issuesOf(
      t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400 }, 'user:1', 'op-pk-0001')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(JSON.stringify(t.row(id))).toBe(before);
  });

  it('an id the search does not return → PICKUP_POINT_INVALID', async () => {
    const t = setup();
    const { id } = await t.create();
    const errors = await issuesOf(
      t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400, pickupPointId: 'NOPE' } as any, 'user:1', 'op-pk-0002')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.row(id).pickupPoint ?? null).toBeNull();
  });

  it('a failed search → PICKUP_SEARCH_FAILED; nothing changes', async () => {
    const t = setup();
    const { id } = await t.create();
    t.findPoint.mockRejectedValueOnce(new EcommerceCarrierError('PICKUP_SEARCH_FAILED' as any));
    await expect(
      t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400, pickupPointId: POINT.id } as any, 'user:1', 'op-pk-0003')
    ).rejects.toMatchObject({ code: 'PICKUP_SEARCH_FAILED' });
    expect(t.row(id).shippingAddress).toEqual(customerAddress);
  });

  it('add a PICKUP charge with a point: the address is the point, customerAddress kept, history recorded', async () => {
    const t = setup();
    const { id } = await t.create();
    const res = await t.c.editing.addShippingLine(
      id,
      { ...PICKUP, amount: 400, pickupPointId: POINT.id, pickupPostalCode: '4000-200' } as any,
      'user:1',
      'op-pk-0004'
    );
    expect(t.findPoint).toHaveBeenCalledWith('4000-200', POINT.id);
    const order = t.row(id);
    expect(order.shippingMethod).toMatchObject(PICKUP);
    expect(order.shippingAddress).toEqual(pointAddress(POINT));
    expect(order.pickupPoint).toMatchObject({ id: POINT.id, name: POINT.name, customerAddress });
    expect(res.order.pickupPoint).toMatchObject({ id: POINT.id });
    const [h] = t.history(id, 'ADDRESS_CHANGED');
    expect(h.previousValue).toEqual({ shippingAddress: customerAddress, pickupPoint: null });
    expect(h.newValue).toMatchObject({ shippingAddress: pointAddress(POINT), pickupPoint: { id: POINT.id } });
  });

  it('the search defaults to the customer postal code', async () => {
    const t = setup();
    const { id } = await t.create();
    await t.c.editing.addShippingLine(
      id,
      { ...PICKUP, amount: 400, pickupPointId: POINT.id } as any,
      'user:1',
      'op-pk-0005'
    );
    expect(t.findPoint).toHaveBeenCalledWith('4000-100', POINT.id);
  });

  it('edit the checkout charge to PICKUP with a point: the address is the point', async () => {
    const t = setup();
    const { id } = await t.create();
    await t.c.editing.editShippingLine(
      id,
      1,
      { ...PICKUP, amount: 400, pickupPointId: POINT.id } as any,
      'user:1',
      'op-pk-0006'
    );
    const order = t.row(id);
    expect(order.shippingMethod).toMatchObject(PICKUP);
    expect(order.shippingAddress).toEqual(pointAddress(POINT));
    expect(order.pickupPoint.customerAddress).toEqual(customerAddress);
  });

  it('edit the checkout charge to PICKUP without a point → PICKUP_POINT_REQUIRED', async () => {
    const t = setup();
    const { id } = await t.create();
    const errors = await issuesOf(
      t.c.editing.editShippingLine(id, 1, { ...PICKUP, amount: 400 }, 'user:1', 'op-pk-0007')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
  });

  it('a non-pickup method ignores a pickupPointId', async () => {
    const t = setup();
    const { id } = await t.create();
    await t.c.editing.addShippingLine(
      id,
      { ...STANDARD, amount: 100, pickupPointId: POINT.id } as any,
      'user:1',
      'op-pk-0008'
    );
    expect(t.findPoint).not.toHaveBeenCalled();
    expect(t.row(id).shippingAddress).toEqual(customerAddress);
    expect(t.row(id).pickupPoint ?? null).toBeNull();
  });
});

describe('order editing: a Pickup order', () => {
  const pickupOrder = async (t: ReturnType<typeof setup>) =>
    (await t.create({ shipping: PICKUP, pickupPointId: POINT.id })).id as number;

  it('changing away from PICKUP restores the customer address and clears the point', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    await t.c.editing.editShippingLine(id, 1, { ...STANDARD, amount: 500 }, 'user:1', 'op-pk-0010');
    const order = t.row(id);
    expect(order.shippingMethod).toMatchObject(STANDARD);
    expect(order.shippingAddress).toEqual(customerAddress);
    expect(order.pickupPoint).toBeNull();
    const [h] = t.history(id, 'ADDRESS_CHANGED');
    expect(h.previousValue).toMatchObject({ shippingAddress: pointAddress(POINT), pickupPoint: { id: POINT.id } });
    expect(h.newValue).toMatchObject({ shippingAddress: customerAddress, pickupPoint: null });
  });

  it('adding a charge of another method also restores the customer address', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    await t.c.editing.addShippingLine(id, { ...STANDARD, amount: 100 }, 'user:1', 'op-pk-0011');
    expect(t.row(id).shippingAddress).toEqual(customerAddress);
    expect(t.row(id).pickupPoint).toBeNull();
  });

  it('another PICKUP charge without an id keeps the point', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    await t.c.editing.addShippingLine(id, { ...PICKUP, amount: 100 }, 'user:1', 'op-pk-0012');
    expect(t.row(id).shippingAddress).toEqual(pointAddress(POINT));
    expect(t.row(id).pickupPoint).toMatchObject({ id: POINT.id, customerAddress });
    expect(t.history(id, 'ADDRESS_CHANGED')).toHaveLength(0);
  });

  it('editing the delivery address → PICKUP_ADDRESS_LOCKED', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    const errors = await issuesOf(
      t.c.editing.updateShippingAddress(id, { address: customerAddress }, 'user:1', 'op-pk-0013')
    );
    expect(errors).toEqual([{ path: 'address', code: 'PICKUP_ADDRESS_LOCKED' }]);
    expect(t.row(id).shippingAddress).toEqual(pointAddress(POINT));
  });

  it('choosing another point replaces the address and keeps the customer address', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    await t.c.editing.updateShippingAddress(
      id,
      { pickupPointId: OTHER_POINT.id, pickupPostalCode: '4000-300' } as any,
      'user:1',
      'op-pk-0014'
    );
    expect(t.findPoint).toHaveBeenLastCalledWith('4000-300', OTHER_POINT.id);
    const order = t.row(id);
    expect(order.shippingAddress).toEqual(pointAddress(OTHER_POINT));
    expect(order.pickupPoint).toMatchObject({ id: OTHER_POINT.id, customerAddress });
    const [h] = t.history(id, 'ADDRESS_CHANGED');
    expect(h.previousValue).toMatchObject({ shippingAddress: pointAddress(POINT), pickupPoint: { id: POINT.id } });
    expect(h.newValue).toMatchObject({ shippingAddress: pointAddress(OTHER_POINT), pickupPoint: { id: OTHER_POINT.id } });
  });

  it('choosing another point with an unknown id → PICKUP_POINT_INVALID', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    const errors = await issuesOf(
      t.c.editing.updateShippingAddress(id, { pickupPointId: 'NOPE' } as any, 'user:1', 'op-pk-0015')
    );
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.row(id).pickupPoint).toMatchObject({ id: POINT.id });
  });

  it('choosing the same point again changes nothing', async () => {
    const t = setup();
    const id = await pickupOrder(t);
    await t.c.editing.updateShippingAddress(id, { pickupPointId: POINT.id } as any, 'user:1', 'op-pk-0016');
    expect(t.row(id).shippingAddress).toEqual(pointAddress(POINT));
    expect(t.history(id, 'ADDRESS_CHANGED').filter((h: any) => !h.newValue?.unchanged)).toHaveLength(0);
  });
});
