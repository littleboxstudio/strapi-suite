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
const STORE_PORTO = { ...STORE_LISBOA, id: 'st_porto00001', name: 'Loja Porto', postalCode: '4000-400', city: 'Porto' };
const STORE_FUNCHAL = { ...STORE_LISBOA, id: 'st_funchal001', name: 'Loja Funchal', postalCode: '9000-100', city: 'Funchal' };
const STORES: Record<string, (typeof STORE_LISBOA)[]> = {
  PT: [STORE_LISBOA, STORE_PORTO],
  'PT-ISL': [STORE_FUNCHAL],
};

const storeAddress = (s: typeof STORE_LISBOA) => ({
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '+351910000000',
  company: s.name,
  line1: s.address,
  postalCode: s.postalCode,
  city: s.city,
  country: 'PT',
});

const storeSetup = () => {
  const t = setup();
  const settings = t.c.services.EcommerceSettingsService;
  const getStoreSettings = settings.getStoreSettings;
  settings.getStoreSettings = async () => ({ ...(await getStoreSettings()), markets: ['PT', 'PT-ISL'] });
  const findStore = vi.fn(async (market: string, id: string) => STORES[market]?.find((s) => s.id === id) ?? null);
  settings.findStore = findStore;
  const storeOption = { ...STORE, name: 'Store pickup', price: 0, tax: 23, requiresPickupPoint: true };
  const pickupOption = { ...PICKUP, name: 'DPD Pickup', price: 400, tax: 23, requiresPickupPoint: true };
  const standardOption = { ...STANDARD, name: 'Standard', price: 500, tax: 23 };
  t.c.services.EcommerceShippingService.findOption = vi.fn(
    async (_req: any, providerId: string, serviceId: string) =>
      providerId === 'store-pickup' && serviceId === 'STORE'
        ? storeOption
        : providerId === 'dpd-portugal' && serviceId === 'PICKUP'
          ? pickupOption
          : standardOption
  );
  t.c.services.EcommerceShippingService.quote = vi.fn(async () => ({
    options: [standardOption, pickupOption, storeOption],
    failures: [],
  }));
  return { ...t, findStore };
};

describe('admin manual order with Store pickup', () => {
  it('creates a store pickup order with a store', async () => {
    const t = storeSetup();
    const created = await t.create({ shipping: STORE, pickupPointId: STORE_LISBOA.id, pickupPostalCode: '9000-100' });
    expect(t.findStore).toHaveBeenCalledWith('PT', STORE_LISBOA.id);
    expect(t.findPoint).not.toHaveBeenCalled();
    const order = t.row(created.id);
    expect(order.shippingMethod).toMatchObject(STORE);
    expect(order.shippingAddress).toEqual(storeAddress(STORE_LISBOA));
    expect(order.pickupPoint).toEqual({ ...STORE_LISBOA, customerAddress });
  });

  it('without a store → PICKUP_POINT_REQUIRED; a store of another market → PICKUP_POINT_INVALID', async () => {
    const t = storeSetup();
    expect(await issuesOf(t.create({ shipping: STORE }))).toEqual([
      { path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' },
    ]);
    expect(await issuesOf(t.create({ shipping: STORE, pickupPointId: STORE_FUNCHAL.id }))).toEqual([
      { path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' },
    ]);
    expect(t.c.tables[UIDS.order]).toHaveLength(0);
  });
});

describe('order editing: Store pickup', () => {
  it('changing to store pickup needs a store', async () => {
    const t = storeSetup();
    const { id } = await t.create();
    const before = JSON.stringify(t.row(id));
    expect(
      await issuesOf(t.c.editing.editShippingLine(id, 1, { ...STORE, amount: 0 }, 'user:1', 'op-st-0001'))
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(JSON.stringify(t.row(id))).toBe(before);
    expect(
      await issuesOf(
        t.c.editing.editShippingLine(id, 1, { ...STORE, amount: 0, pickupPointId: POINT.id } as any, 'user:1', 'op-st-0002')
      )
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.findPoint).not.toHaveBeenCalled();

    await t.c.editing.editShippingLine(
      id,
      1,
      { ...STORE, amount: 0, pickupPointId: STORE_PORTO.id } as any,
      'user:1',
      'op-st-0003'
    );
    expect(t.findStore).toHaveBeenLastCalledWith('PT', STORE_PORTO.id);
    const order = t.row(id);
    expect(order.shippingMethod).toMatchObject(STORE);
    expect(order.shippingAddress).toEqual(storeAddress(STORE_PORTO));
    expect(order.pickupPoint).toEqual({ ...STORE_PORTO, customerAddress });
  });

  it('changing from DPD Pickup to Store pickup needs a new point', async () => {
    const t = storeSetup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    const before = JSON.stringify(t.row(id));
    expect(
      await issuesOf(t.c.editing.addShippingLine(id, { ...STORE, amount: 0 }, 'user:1', 'op-st-0010'))
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(JSON.stringify(t.row(id))).toBe(before);

    await t.c.editing.addShippingLine(
      id,
      { ...STORE, amount: 0, pickupPointId: STORE_LISBOA.id } as any,
      'user:1',
      'op-st-0011'
    );
    // The store is found in the market of the customer's own address, not of the DPD point.
    expect(t.findStore).toHaveBeenLastCalledWith('PT', STORE_LISBOA.id);
    const order = t.row(id);
    expect(order.shippingAddress).toEqual(storeAddress(STORE_LISBOA));
    expect(order.pickupPoint).toEqual({ ...STORE_LISBOA, customerAddress });

    // And back: Store pickup → DPD Pickup needs a DPD point again.
    expect(
      await issuesOf(t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400 }, 'user:1', 'op-st-0012'))
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
  });

  it('another store pickup charge without an id keeps the store', async () => {
    const t = storeSetup();
    const { id } = await t.create({ shipping: STORE, pickupPointId: STORE_LISBOA.id });
    await t.c.editing.addShippingLine(id, { ...STORE, amount: 100 }, 'user:1', 'op-st-0020');
    expect(t.row(id).pickupPoint).toMatchObject({ id: STORE_LISBOA.id, customerAddress });
    expect(t.history(id, 'ADDRESS_CHANGED')).toHaveLength(0);
  });

  it('choosing another store replaces the address; a DPD id is refused', async () => {
    const t = storeSetup();
    const { id } = await t.create({ shipping: STORE, pickupPointId: STORE_LISBOA.id });
    expect(
      await issuesOf(
        t.c.editing.updateShippingAddress(id, { pickupPointId: POINT.id } as any, 'user:1', 'op-st-0030')
      )
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    expect(t.findPoint).not.toHaveBeenCalled();
    await t.c.editing.updateShippingAddress(id, { pickupPointId: STORE_PORTO.id } as any, 'user:1', 'op-st-0031');
    expect(t.row(id).shippingAddress).toEqual(storeAddress(STORE_PORTO));
    expect(t.row(id).pickupPoint).toEqual({ ...STORE_PORTO, customerAddress });
  });

  it("leaving store pickup restores the customer's address", async () => {
    const t = storeSetup();
    const { id } = await t.create({ shipping: STORE, pickupPointId: STORE_LISBOA.id });
    await t.c.editing.editShippingLine(id, 1, { ...STANDARD, amount: 500 }, 'user:1', 'op-st-0040');
    const order = t.row(id);
    expect(order.shippingMethod).toMatchObject(STANDARD);
    expect(order.shippingAddress).toEqual(customerAddress);
    expect(order.pickupPoint).toBeNull();
  });
});

describe('order editing: Store pickup from a DPD point in another market', () => {
  // A DPD point on Madeira (PT-ISL) for a customer in Porto (PT).
  const ISLAND_POINT = { ...POINT, id: 'PT90001', postalCode: '9000-200', city: 'Funchal' };

  const islandSetup = () => {
    const t = storeSetup();
    const quote = vi.fn(async (req: any) => {
      const island = String(req.postalCode ?? '').startsWith('9');
      return {
        options: [
          { ...STANDARD, name: 'Standard', price: island ? 900 : 500, tax: 23 },
          { ...PICKUP, name: 'DPD Pickup', price: island ? 800 : 400, tax: 23, requiresPickupPoint: true },
          {
            ...STORE,
            name: 'Store pickup',
            price: island ? 300 : 0,
            tax: 23,
            requiresPickupPoint: true,
            pickupPoints: island ? [STORE_FUNCHAL] : [STORE_LISBOA, STORE_PORTO],
          },
        ],
        failures: [],
      };
    });
    t.c.services.EcommerceShippingService.quote = quote;
    return { ...t, quote };
  };

  const islandOrder = async (t: ReturnType<typeof islandSetup>) => {
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    const row = t.row(id);
    row.pickupPoint = { ...ISLAND_POINT, customerAddress };
    row.shippingAddress = pointAddress(ISLAND_POINT);
    return id;
  };

  it("lists the stores of the customer's market, the other options at the point", async () => {
    const t = islandSetup();
    const id = await islandOrder(t);
    const { options } = await t.c.editing.shippingOptionsForOrder(id);
    const store = options.find((o: any) => o.providerId === 'store-pickup');
    expect(store).toMatchObject({ price: 0, pickupPoints: [STORE_LISBOA, STORE_PORTO] });
    expect(options.filter((o: any) => o.providerId === 'store-pickup')).toHaveLength(1);
    // DPD and manual keep the quote at the order's delivery address (the point).
    expect(options.find((o: any) => o.providerId === 'dpd-portugal')).toMatchObject({ price: 800 });
    expect(options.find((o: any) => o.providerId === 'manual')).toMatchObject({ price: 900 });
  });

  it('a listed store is accepted, a store of the point market is refused', async () => {
    const t = islandSetup();
    const id = await islandOrder(t);
    expect(
      await issuesOf(
        t.c.editing.addShippingLine(id, { ...STORE, amount: 0, pickupPointId: STORE_FUNCHAL.id } as any, 'user:1', 'op-isl-0001')
      )
    ).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_INVALID' }]);
    await t.c.editing.addShippingLine(
      id,
      { ...STORE, amount: 0, pickupPointId: STORE_LISBOA.id } as any,
      'user:1',
      'op-isl-0002'
    );
    expect(t.findStore).toHaveBeenLastCalledWith('PT', STORE_LISBOA.id);
    expect(t.row(id).pickupPoint).toEqual({ ...STORE_LISBOA, customerAddress });
  });

  it('a pickup order in its customer market is quoted once', async () => {
    const t = islandSetup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    t.quote.mockClear();
    await t.c.editing.shippingOptionsForOrder(id);
    expect(t.quote).toHaveBeenCalledTimes(1);
  });
});

describe('once the order has an active shipment, its shipping address stays', () => {
  /** An ACTIVE shipment of one unit of the order's first line. */
  const shipOne = (t: ReturnType<typeof setup>, orderId: number) => {
    const line = t.c.tables[UIDS.orderLine].find((l: any) => l.order === orderId);
    t.c.tables[UIDS.shipment].push({
      id: t.c.tables[UIDS.shipment].length + 1,
      order: orderId,
      providerId: 'manual',
      carrierName: 'CTT',
      status: 'ACTIVE',
      deliveryStatus: 'IN_TRANSIT',
      items: { lines: [{ orderLineId: line.id, sku: line.sku, name: line.name, option: null, quantity: 1 }] },
      idempotencyKey: `ship-${orderId}-${t.c.tables[UIDS.shipment].length + 1}`,
    });
    t.row(orderId).fulfillmentStatus = 'PARTIALLY_FULFILLED';
  };
  const delivery = (t: ReturnType<typeof setup>, id: number) =>
    JSON.stringify({ a: t.row(id).shippingAddress, p: t.row(id).pickupPoint ?? null });

  it('a DPD Pickup charge keeps its point on the line; the order address and point do not change', async () => {
    const t = setup();
    const { id } = await t.create();
    shipOne(t, id);
    const before = delivery(t, id);
    await t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400, pickupPointId: POINT.id }, 'user:1', 'op-sh-0001');
    expect(delivery(t, id)).toBe(before);
    expect(t.row(id).shippingAddress).toEqual(customerAddress);
    expect(t.history(id, 'ADDRESS_CHANGED')).toHaveLength(0);
    const lines = t.row(id).shippingLines.lines;
    expect(lines[lines.length - 1]).toMatchObject({ ...PICKUP, pickupPoint: { id: POINT.id, name: POINT.name } });
    expect(lines[lines.length - 1].pickupPoint).not.toHaveProperty('customerAddress');
    expect(lines[lines.length - 1].pickupPoint).not.toHaveProperty('openingHours');
    // The admin view names it as the next shipment's point.
    const view = await t.c.orders.get(id);
    expect(view.nextPickupPoint).toMatchObject({ id: POINT.id, customerAddress });
    expect(view.pickupPoint).toBeNull();
  });

  it('without a point and none of the same kind → PICKUP_POINT_REQUIRED', async () => {
    const t = setup();
    const { id } = await t.create();
    shipOne(t, id);
    const errors = await issuesOf(t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400 }, 'user:1', 'op-sh-0002'));
    expect(errors).toEqual([{ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' }]);
  });

  it('a DPD Pickup order: another point goes to the line; the order keeps its point', async () => {
    const t = setup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    shipOne(t, id);
    const before = delivery(t, id);
    await t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400, pickupPointId: OTHER_POINT.id }, 'user:1', 'op-sh-0003');
    expect(delivery(t, id)).toBe(before);
    expect((await t.c.orders.get(id)).nextPickupPoint).toMatchObject({ id: OTHER_POINT.id, customerAddress });
    // No point named: the next one (the line's) is kept on the new line.
    await t.c.editing.addShippingLine(id, { ...PICKUP, amount: 100 }, 'user:1', 'op-sh-0004');
    const lines = t.row(id).shippingLines.lines;
    expect(lines[lines.length - 1].pickupPoint).toMatchObject({ id: OTHER_POINT.id });
  });

  it('a home delivery charge on a DPD Pickup order does not restore the customer address', async () => {
    const t = setup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    shipOne(t, id);
    const before = delivery(t, id);
    await t.c.editing.addShippingLine(id, { ...STANDARD, amount: 500 }, 'user:1', 'op-sh-0005');
    expect(delivery(t, id)).toBe(before);
    expect(t.row(id).shippingAddress).toEqual(pointAddress(POINT));
    expect(t.history(id, 'ADDRESS_CHANGED')).toHaveLength(0);
    expect((await t.c.orders.get(id)).nextPickupPoint).toBeNull();
  });

  it('options are quoted at the customer address, not at the order point', async () => {
    const t = setup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    shipOne(t, id);
    const quote = t.c.services.EcommerceShippingService.quote as any;
    quote.mockClear();
    await t.c.editing.shippingOptionsForOrder(id);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote.mock.calls[0][0]).toMatchObject({ country: 'PT', postalCode: customerAddress.postalCode });
  });
});

describe('the next point after shipments: recalculation, cancellation, kinds', () => {
  const shipOne = (t: ReturnType<typeof setup>, orderId: number) => {
    const line = t.c.tables[UIDS.orderLine].find((l: any) => l.order === orderId);
    t.c.tables[UIDS.shipment].push({
      id: t.c.tables[UIDS.shipment].length + 1,
      order: orderId,
      providerId: 'manual',
      carrierName: 'CTT',
      status: 'ACTIVE',
      deliveryStatus: 'IN_TRANSIT',
      items: { lines: [{ orderLineId: line.id, sku: line.sku, name: line.name, option: null, quantity: 1 }] },
      idempotencyKey: `ship-${orderId}-${t.c.tables[UIDS.shipment].length + 1}`,
    });
    t.row(orderId).fulfillmentStatus = 'PARTIALLY_FULFILLED';
  };

  it('after the shipment is cancelled, choosing another point on the order clears the line points', async () => {
    const t = setup();
    const { id } = await t.create({ shipping: PICKUP, pickupPointId: POINT.id });
    shipOne(t, id);
    await t.c.editing.addShippingLine(id, { ...PICKUP, amount: 400, pickupPointId: OTHER_POINT.id }, 'user:1', 'op-nx-0003');
    t.c.tables[UIDS.shipment][0].status = 'CANCELLED';
    await t.c.editing.updateShippingAddress(id, { pickupPointId: POINT.id } as any, 'user:1', 'op-nx-0004');
    expect(t.row(id).shippingLines.lines.some((l: any) => l.pickupPoint)).toBe(false);
    expect((await t.c.orders.get(id)).nextPickupPoint).toMatchObject({ id: POINT.id });
  });
});

describe('shipping options for a new charge', () => {
  it('say whether the quotes are of the units not yet shipped, and what was charged', async () => {
    const t = setup();
    const { id } = await t.create();
    const fresh = await t.c.editing.shippingOptionsForOrder(id);
    expect(fresh).toMatchObject({ pendingOnly: true, charged: 500 });
    const line = t.c.tables[UIDS.orderLine].find((l: any) => l.order === id);
    t.c.tables[UIDS.shipment].push({
      id: 1,
      order: id,
      providerId: 'manual',
      carrierName: 'CTT',
      status: 'ACTIVE',
      deliveryStatus: 'IN_TRANSIT',
      items: { lines: [{ orderLineId: line.id, sku: line.sku, name: line.name, option: null, quantity: line.quantity }] },
      idempotencyKey: 'ship-all',
    });
    expect(await t.c.editing.shippingOptionsForOrder(id)).toMatchObject({ pendingOnly: false, charged: 500 });
  });
});
