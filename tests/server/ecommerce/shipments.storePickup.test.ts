import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceShippingService from '../../../server/src/services/modules/ecommerce/shipping';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { readStorePickup } from '../../../server/src/services/modules/ecommerce/domain/storePickup';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

/** Store pickup at Ship (store pickup spec 6, ruling 1): no carrier, the store may be swapped. */

const customerAddress = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

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
const STORE_FUNCHAL = {
  ...STORE_LISBOA,
  id: 'st_funchal001',
  name: 'Loja Funchal',
  postalCode: '9000-100',
  city: 'Funchal',
};

const storeConfig = (stores: Record<string, unknown[]> = { PT: [STORE_LISBOA, STORE_PORTO], 'PT-ISL': [STORE_FUNCHAL] }) => ({
  name: { en: 'Store pickup', pt: 'Levantamento em loja' },
  tax: 23,
  rates: { PT: [{ maxWeight: 30, price: 0 }], 'PT-ISL': [{ maxWeight: 30, price: 0 }] },
  stores,
});

function setup(opts: { active?: string[] } = {}) {
  const c = setupCommerce();
  const variant = c.tables[UIDS.variant].find((v) => v.id === 10);
  variant.stock = 50;
  variant.weight = 0.25;
  const state = {
    active: opts.active ?? ['manual', 'store-pickup'],
    storePickup: storeConfig() as any,
  };
  const settings = c.services.EcommerceSettingsService;
  const getStoreSettings = settings.getStoreSettings;
  settings.getStoreSettings = async () => ({ ...(await getStoreSettings()), markets: ['PT', 'PT-ISL'] });
  settings.getActiveProviders = async () => state.active;
  settings.listManualMethods = async () => [
    { id: 1, name: { en: 'Standard' }, rates: {}, tax: 23, active: true },
  ];
  const baseRuntime = settings.getRuntime;
  settings.getRuntime = async (id: string) => {
    if (id === 'store-pickup') return { active: state.active.includes('store-pickup'), config: { storePickup: state.storePickup }, secrets: {} };
    if (id === 'manual') return { active: state.active.includes('manual'), config: {}, secrets: {} };
    return baseRuntime(id);
  };
  settings.getStorePickup = async () => readStorePickup(state.storePickup);
  settings.findStore = vi.fn(async (market: string, id: string) =>
    (readStorePickup(state.storePickup).stores[market] ?? []).find((s) => s.id === id) ?? null
  );
  const real = EcommerceShippingService({ strapi: c.strapi } as any);
  c.services.EcommerceShippingService.carrierFor = vi.fn(real.carrierFor);
  c.services.EcommerceShippingService.adapterFor = real.adapterFor;
  c.services.EcommerceShipmentService = EcommerceShipmentService({ strapi: c.strapi });
  const fetch = vi.fn(async () => {
    throw new Error('no carrier may be called');
  });
  vi.stubGlobal('fetch', fetch);
  return { c, ships: c.services.EcommerceShipmentService, state, fetch, settings };
}

const paidOrder = async (c: Commerce) => {
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt', phone: '912000111' },
      shippingAddress: customerAddress,
      billingAddress: customerAddress,
      locale: 'en',
      lines: [{ variantId: 10, quantity: 2 }],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  await c.payments.addManualPayment(order.id, { amount: 2 * 2000 + 500, idempotencyKey: `pay-${order.id}` }, 'user:1');
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === order.id).id as number;
  return { id: order.id as number, lineId };
};

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

const storeAddress = (s: typeof STORE_LISBOA) => ({
  firstName: 'Ana',
  lastName: 'Silva',
  company: s.name,
  line1: s.address,
  postalCode: s.postalCode,
  city: s.city,
  country: 'PT',
});

/** Turns the order into a Store pickup order at `store` (as the checkout stores it). */
const makeStorePickup = (c: Commerce, id: number, store: typeof STORE_LISBOA = STORE_LISBOA) => {
  const row = orderRow(c, id);
  row.shippingMethod = { providerId: 'store-pickup', serviceId: 'STORE', name: 'Store pickup (as sold)', tax: 23 };
  row.pickupPoint = { ...store, customerAddress };
  row.shippingAddress = storeAddress(store);
};

const ship = (lineId: number, method: Record<string, unknown>, key = 'k1', extra: Record<string, unknown> = {}) => ({
  lines: [{ orderLineId: lineId, quantity: 1 }],
  method,
  notifyCustomer: true,
  idempotencyKey: key,
  ...extra,
});

const codesOf = async (p: Promise<unknown>): Promise<{ path?: string; code: string }[]> => {
  const err: any = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e
  );
  if (err instanceof EcommerceValidationError) return err.errors.map((e: any) => ({ path: e.path, code: e.code }));
  throw err;
};

const storeEntry = (methods: any[]) => methods.find((m) => m.kind === 'STORE_PICKUP');

beforeEach(() => __resetEventHandlersForTests());
afterEach(() => vi.unstubAllGlobals());

describe('shipMethods: Store pickup', () => {
  it("lists STORE_PICKUP with the market's stores and the order's store selected", async () => {
    const { c, ships } = setup();
    const { id } = await paidOrder(c);
    makeStorePickup(c, id, STORE_PORTO);
    const { methods } = await ships.shipMethods(id, 'pt');
    expect(storeEntry(methods)).toEqual({
      providerId: 'store-pickup',
      serviceId: 'STORE',
      name: 'Levantamento em loja',
      kind: 'STORE_PICKUP',
      original: true,
      stores: [STORE_LISBOA, STORE_PORTO],
      selectedStoreId: STORE_PORTO.id,
    });
    // Never a carrier entry for store pickup, and no DPD Pickup for a store.
    expect(methods.filter((m: any) => m.providerId === 'store-pickup')).toHaveLength(1);
    expect(methods.some((m: any) => m.serviceId === 'PICKUP')).toBe(false);
  });

  it('a home delivery order: the stores of its market, none selected', async () => {
    const { c, ships } = setup();
    const { id } = await paidOrder(c);
    const entry = storeEntry((await ships.shipMethods(id, 'en')).methods);
    expect(entry).toMatchObject({ original: false, stores: [STORE_LISBOA, STORE_PORTO], selectedStoreId: null });
  });

  it('a store removed from settings is listed first as the order store', async () => {
    const { c, ships, state } = setup();
    const { id } = await paidOrder(c);
    makeStorePickup(c, id, STORE_LISBOA);
    state.storePickup = storeConfig({ PT: [STORE_PORTO] });
    const entry = storeEntry((await ships.shipMethods(id, 'en')).methods);
    expect(entry.stores).toEqual([STORE_LISBOA, STORE_PORTO]);
    expect(entry.selectedStoreId).toBe(STORE_LISBOA.id);
  });

  it('module off: listed only for a store pickup order, as its original method', async () => {
    const { c, ships } = setup({ active: ['manual'] });
    const { id } = await paidOrder(c);
    expect(storeEntry((await ships.shipMethods(id, 'en')).methods)).toBeUndefined();
    makeStorePickup(c, id);
    const { methods } = await ships.shipMethods(id, 'en');
    expect(methods[0]).toMatchObject({
      providerId: 'store-pickup',
      serviceId: 'STORE',
      name: 'Store pickup (as sold)',
      kind: 'STORE_PICKUP',
      original: true,
      selectedStoreId: STORE_LISBOA.id,
    });
  });
});

describe('create with STORE_PICKUP', () => {
  it("ships to the order's store without calling a carrier", async () => {
    const { c, ships, fetch } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const before = JSON.stringify({ address: orderRow(c, id).shippingAddress, point: orderRow(c, id).pickupPoint });
    const s = await ships.create(
      id,
      ship(lineId, { mode: 'STORE_PICKUP' }, 'k1', { notifyCustomer: false, parcels: 3 }),
      'user:1'
    );
    expect(s).toMatchObject({
      status: 'ACTIVE',
      providerId: 'store-pickup',
      serviceId: 'STORE',
      carrierName: 'Store pickup (as sold)',
      trackingCode: null,
      trackingUrl: null,
      labelAvailable: false,
      carrierSupport: null,
      store: STORE_LISBOA,
    });
    const row = c.tables[UIDS.shipment].find((r) => r.id === s.id);
    // notifyCustomer and parcels are ignored: the e-mail always goes out (ruling 8).
    expect(row.metadata).toEqual({ notify: true, store: STORE_LISBOA });
    expect(row.shippedAt).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(c.services.EcommerceShippingService.carrierFor).not.toHaveBeenCalled();
    expect(JSON.stringify({ address: orderRow(c, id).shippingAddress, point: orderRow(c, id).pickupPoint })).toBe(before);
    expect(c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'ADDRESS_CHANGED')).toHaveLength(0);

    // The same store named explicitly keeps it too.
    const again = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId: STORE_LISBOA.id }, 'k2'), 'user:1');
    expect(again.store).toEqual(STORE_LISBOA);
    expect(c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'ADDRESS_CHANGED')).toHaveLength(0);
  });

  it('swapping the store updates the order address and pickupPoint and records ADDRESS_CHANGED', async () => {
    const { c, ships, settings } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId: STORE_PORTO.id }), 'user:1');
    expect(settings.findStore).toHaveBeenCalledWith('PT', STORE_PORTO.id);
    expect(s.store).toEqual(STORE_PORTO);
    const order = orderRow(c, id);
    expect(order.shippingAddress).toEqual(storeAddress(STORE_PORTO));
    expect(order.pickupPoint).toEqual({ ...STORE_PORTO, customerAddress });
    // The price never changes (ruling 7).
    expect(order.shippingMethod).toMatchObject({ providerId: 'store-pickup', serviceId: 'STORE' });
    const changes = c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'ADDRESS_CHANGED');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      description: `Shipping address changed: pickup point ${STORE_PORTO.id}`,
      previousValue: {
        shippingAddress: storeAddress(STORE_LISBOA),
        pickupPoint: { id: STORE_LISBOA.id, name: STORE_LISBOA.name },
      },
      newValue: {
        shippingAddress: storeAddress(STORE_PORTO),
        pickupPoint: { id: STORE_PORTO.id, name: STORE_PORTO.name },
      },
      actor: 'user:1',
    });
  });

  it('refuses a store of another market or an unknown id and writes nothing', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const before = JSON.stringify(orderRow(c, id));
    const historyBefore = c.tables[UIDS.orderHistory].length;
    for (const pickupPointId of [STORE_FUNCHAL.id, 'st_unknown000']) {
      expect(await codesOf(ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId }), 'user:1'))).toEqual([
        { path: 'method.pickupPointId', code: 'PICKUP_POINT_INVALID' },
      ]);
    }
    expect(JSON.stringify(orderRow(c, id))).toBe(before);
    expect(c.tables[UIDS.shipment]).toHaveLength(0);
    expect(c.tables[UIDS.orderHistory]).toHaveLength(historyBefore);
  });

  it('refuses a malformed pickupPointId', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    expect(
      await codesOf(ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId: 5 }), 'user:1'))
    ).toEqual([{ path: 'method.pickupPointId', code: 'invalid' }]);
  });

  it("ships to the order's store even after it was removed from settings", async () => {
    const { c, ships, state } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    state.storePickup = storeConfig({ PT: [STORE_PORTO] });
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId: STORE_LISBOA.id }), 'user:1');
    expect(s).toMatchObject({ status: 'ACTIVE', store: STORE_LISBOA });
  });

  it('ships an old store pickup order with the module off', async () => {
    const { c, ships } = setup({ active: ['manual'] });
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP' }), 'user:1');
    expect(s).toMatchObject({ status: 'ACTIVE', providerId: 'store-pickup', store: STORE_LISBOA });
  });

  it('a home delivery order needs a store and keeps its own address', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    expect(await codesOf(ships.create(id, ship(lineId, { mode: 'STORE_PICKUP' }), 'user:1'))).toEqual([
      { path: 'method.pickupPointId', code: 'PICKUP_POINT_REQUIRED' },
    ]);
    const before = JSON.stringify(orderRow(c, id));
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP', pickupPointId: STORE_PORTO.id }, 'k2'), 'user:1');
    expect(s).toMatchObject({ status: 'ACTIVE', carrierName: 'Store pickup', store: STORE_PORTO });
    const after = orderRow(c, id);
    expect(after.shippingAddress).toEqual(JSON.parse(before).shippingAddress);
    expect(after.pickupPoint ?? null).toBeNull();
  });

  it('event payload has storePickup: true and notify true', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP' }, 'k1', { notifyCustomer: false }), 'user:1');
    const events = c.events.filter((e) => e.type === 'SHIPMENT_CREATED');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      shipmentId: s.id,
      full: false,
      notify: true,
      storePickup: true,
      pending: [{ orderLineId: lineId, quantity: 1 }],
    });
  });

  it('a manual shipment payload carries no storePickup flag', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    await ships.create(id, ship(lineId, { mode: 'MANUAL', carrierName: 'Courier' }), 'user:1');
    const [event] = c.events.filter((e) => e.type === 'SHIPMENT_CREATED');
    expect(event.payload).not.toHaveProperty('storePickup');
  });

  it('a CARRIER request naming store-pickup is CARRIER_NOT_CONFIGURED', async () => {
    const { c, ships, fetch } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    expect(
      await codesOf(
        ships.create(id, ship(lineId, { mode: 'CARRIER', providerId: 'store-pickup', serviceId: 'STORE' }), 'user:1')
      )
    ).toEqual([{ path: 'method.providerId', code: 'CARRIER_NOT_CONFIGURED' }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a store pickup shipment afterwards', () => {
  it('tracking update is refused', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP' }), 'user:1');
    const eventsBefore = c.events.length;
    expect(await codesOf(ships.updateTracking(s.id, { trackingCode: 'X1' }, 'user:1'))).toEqual([
      { path: 'trackingCode', code: 'invalid' },
    ]);
    expect(c.events.length).toBe(eventsBefore);
    expect(c.tables[UIDS.shipment].find((r) => r.id === s.id).trackingCode ?? null).toBeNull();
  });

  it('cancels locally, without a carrier', async () => {
    const { c, ships, fetch } = setup();
    const { id, lineId } = await paidOrder(c);
    makeStorePickup(c, id);
    const s = await ships.create(id, ship(lineId, { mode: 'STORE_PICKUP' }), 'user:1');
    const cancelled = await ships.cancel(s.id, { reason: 'wrong store' }, 'user:1');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled).not.toHaveProperty('carrierCancelled');
    expect(fetch).not.toHaveBeenCalled();
  });
});
