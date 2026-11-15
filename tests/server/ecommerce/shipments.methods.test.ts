import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceShippingService from '../../../server/src/services/modules/ecommerce/shipping';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { readStorePickup } from '../../../server/src/services/modules/ecommerce/domain/storePickup';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

const GUIDE = '09876543210123';
const LABEL_URL = 'https://labels.dpd.test/label.pdf';

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const dpdServices = (over: Record<string, unknown> = {}) => ({
  EXPRESS: { active: true, name: { en: 'DPD Home', pt: 'DPD Casa' }, tax: 23, rates: {} },
  PICKUP: { active: true, name: { en: 'DPD Shop', pt: 'DPD Loja' }, tax: 23, rates: {} },
  ...over,
});

const dpdRuntime = (active: boolean, services: unknown = dpdServices()) => ({
  active,
  config: {
    authEndpoint: 'https://dpd.test/auth',
    expeditionEndpoint: 'https://dpd.test/expedition',
    clientId: 'client-1',
    username: 'user-1',
    accountHome: 'HOME-001',
    accountShop: 'SHOP-002',
    senderName: 'Loja',
    senderAddress: 'Rua 1',
    senderPostalCode: '4000123',
    senderCity: 'Porto',
    senderPhone: '912345678',
    senderEmail: 'loja@example.com',
    services,
  },
  secrets: { clientSecret: 'secret-x', password: 'password-y', pickupKey: 'key-z' },
});

const json = (status: number, body: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as Response;

const stubDpd = () => {
  const expeditions: any[] = [];
  const fetch = vi.fn(async (url: string, init: any) => {
    if (url === 'https://dpd.test/auth') return json(200, { status_code: 200, result: { access_token: 't' } });
    if (url === 'https://dpd.test/expedition') {
      expeditions.push(JSON.parse(init.body));
      return json(200, { status_code: 200, result: { num_guia: [GUIDE], pdf_url: LABEL_URL } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { expeditions, fetch };
};

type Opts = {
  active?: string[];
  dpd?: ReturnType<typeof dpdRuntime> | null;
  manual?: any[];
};

function setup(opts: Opts = {}) {
  const c = setupCommerce();
  const variant = c.tables[UIDS.variant].find((v) => v.id === 10);
  variant.stock = 50;
  variant.weight = 0.25;
  const state = {
    active: opts.active ?? ['manual', 'dpd-portugal', 'ctt-expresso'],
    dpd: opts.dpd === undefined ? dpdRuntime(true) : opts.dpd,
    manual: opts.manual ?? [
      { id: 1, name: { en: 'Standard', pt: 'Normal' }, rates: {}, tax: 23, active: true },
      { id: 2, name: { en: 'Courier' }, rates: {}, tax: 23, active: true },
      { id: 3, name: { en: 'Old one' }, rates: {}, tax: 23, active: false },
    ],
  };
  const settings = c.services.EcommerceSettingsService;
  const baseRuntime = settings.getRuntime;
  settings.getActiveProviders = async () => state.active;
  settings.listManualMethods = async () => state.manual;
  settings.getRuntime = async (id: string) => {
    if (id === 'dpd-portugal') return state.dpd;
    if (id === 'ctt-expresso') {
      return state.active.includes('ctt-expresso') ? { active: true, config: {}, secrets: {} } : null;
    }
    if (id === 'manual') return { active: state.active.includes('manual'), config: {}, secrets: {} };
    return baseRuntime(id);
  };
  const real = EcommerceShippingService({ strapi: c.strapi } as any);
  c.services.EcommerceShippingService.carrierFor = vi.fn(real.carrierFor);
  c.services.EcommerceShippingService.adapterFor = real.adapterFor;
  c.services.EcommerceShipmentService = EcommerceShipmentService({ strapi: c.strapi });
  return { c, ships: c.services.EcommerceShipmentService, state, dpd: stubDpd() };
}

const paidOrder = async (c: Commerce, shipping: { providerId: string; serviceId: string }, quantity = 1) => {
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt', phone: '912000111' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity }],
      shipping,
    },
    { actor: 'user:1', source: 'admin' }
  );
  await c.payments.addManualPayment(
    order.id,
    { amount: quantity * 2000 + 500, idempotencyKey: `pay-${order.id}` },
    'user:1'
  );
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === order.id).id as number;
  return { id: order.id as number, lineId };
};

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

const setMethod = (c: Commerce, id: number, method: Record<string, unknown>) => {
  const row = orderRow(c, id);
  row.shippingMethod = { ...row.shippingMethod, ...method };
};

const makePickup = (c: Commerce, id: number) => {
  const row = orderRow(c, id);
  row.shippingMethod = { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup', tax: 23 };
  row.pickupPoint = {
    id: 'PT10234',
    name: 'Papelaria Central',
    address: 'Rua do Ponto 5',
    address2: null,
    postalCode: '1100-200',
    city: 'Lisboa',
    country: 'PT',
    customerAddress: address,
  };
  row.shippingAddress = { ...address, company: 'Papelaria Central', line1: 'Rua do Ponto 5', postalCode: '1100-200' };
};

/** A Store pickup order: its stored point is one of the shop's stores, not a DPD point. */
const makeStorePickupOrder = (c: Commerce, id: number) => {
  const row = orderRow(c, id);
  row.shippingMethod = { providerId: 'store-pickup', serviceId: 'STORE', name: 'Store pickup', tax: 23 };
  row.pickupPoint = {
    id: 'st_lisboa0001',
    name: 'Loja Lisboa',
    address: 'Rua da Loja 1',
    address2: null,
    postalCode: '1000-100',
    city: 'Lisboa',
    country: 'PT',
    customerAddress: address,
  };
  row.shippingAddress = { ...address, company: 'Loja Lisboa', line1: 'Rua da Loja 1', postalCode: '1000-100' };
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
  if (err instanceof EcommerceCarrierError) return [{ code: err.code }];
  throw err;
};

const keys = (methods: any[]) => methods.map((m) => `${m.providerId}:${m.serviceId ?? ''}`);

beforeEach(() => __resetEventHandlersForTests());
afterEach(() => vi.unstubAllGlobals());

describe('shipMethods', () => {
  it('lists the active manual methods, the active DPD services and CTT, preselecting the order method', async () => {
    const { c, ships } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '2' });
    const { methods } = await ships.shipMethods(id, 'pt');
    expect(methods).toEqual([
      { providerId: 'manual', serviceId: '1', name: 'Normal', kind: 'MANUAL', original: false },
      // No Portuguese name: the default locale.
      { providerId: 'manual', serviceId: '2', name: 'Courier', kind: 'MANUAL', original: true },
      { providerId: 'dpd-portugal', serviceId: 'EXPRESS', name: 'DPD Casa', kind: 'CARRIER', original: false, parcels: true },
      { providerId: 'ctt-expresso', serviceId: null, name: 'CTT Expresso', kind: 'CARRIER', original: false },
    ]);
  });

  it('offers DPD Pickup only for an order with a pickup point', async () => {
    const { c, ships } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    expect(keys((await ships.shipMethods(id)).methods)).not.toContain('dpd-portugal:PICKUP');

    const { id: pickupId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    makePickup(c, pickupId);
    const pickup = (await ships.shipMethods(pickupId, 'en')).methods.find((m: any) => m.serviceId === 'PICKUP');
    expect(pickup).toEqual({
      providerId: 'dpd-portugal',
      serviceId: 'PICKUP',
      name: 'DPD Shop',
      kind: 'CARRIER',
      original: true,
      requiresPickupPoint: true,
      parcels: true,
    });
  });

  it('does not offer DPD Pickup for a Store pickup order (its point is a store)', async () => {
    const { c, ships } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    makeStorePickupOrder(c, id);
    c.services.EcommerceSettingsService.getStorePickup = async () => readStorePickup(undefined);
    const ids = keys((await ships.shipMethods(id)).methods);
    expect(ids).not.toContain('dpd-portugal:PICKUP');
    expect(ids[0]).toBe('store-pickup:STORE');
  });

  it('always includes the original method, even when it was switched off since', async () => {
    const { c, ships, state } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    setMethod(c, id, { serviceId: '3', name: 'Old one (as sold)' });
    state.dpd = dpdRuntime(false);
    state.active = ['manual'];
    const { methods } = await ships.shipMethods(id, 'en');
    expect(methods[0]).toEqual({
      providerId: 'manual',
      serviceId: '3',
      name: 'Old one (as sold)',
      kind: 'MANUAL',
      original: true,
    });
    expect(keys(methods)).toEqual(['manual:3', 'manual:1', 'manual:2']);
  });

  it('keeps an inactive DPD original (and its pickup service without a point) as a carrier method', async () => {
    const { c, ships, state } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    setMethod(c, id, { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup' });
    state.active = ['manual'];
    const { methods } = await ships.shipMethods(id, 'en');
    expect(methods.filter((m: any) => m.original)).toEqual([
      {
        providerId: 'dpd-portugal',
        serviceId: 'PICKUP',
        name: 'DPD Pickup',
        kind: 'CARRIER',
        original: true,
        requiresPickupPoint: true,
        parcels: true,
      },
    ]);
  });

  it('CTT carries the order service when the order is a CTT one; manual methods need the manual integration', async () => {
    const { c, ships, state } = setup();
    const { id } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    setMethod(c, id, { providerId: 'ctt-expresso', serviceId: 'EMS', name: 'CTT 24h' });
    state.active = ['ctt-expresso'];
    const { methods } = await ships.shipMethods(id, 'en');
    expect(methods).toEqual([
      { providerId: 'ctt-expresso', serviceId: 'EMS', name: 'CTT Expresso', kind: 'CARRIER', original: true },
    ]);
  });

  it('an unknown order is not found', async () => {
    const { ships } = setup();
    await expect(ships.shipMethods(999)).rejects.toThrow('Order not found');
  });
});

describe('create with a chosen method', () => {
  it('MANUAL with a serviceId stores the manual method id and name', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'dpd-portugal', serviceId: 'EXPRESS' });
    const s = await ships.create(
      id,
      ship(lineId, { mode: 'MANUAL', providerId: 'manual', serviceId: '2', carrierName: 'Courier', trackingCode: 'T1' }),
      'user:1'
    );
    expect(s).toMatchObject({
      status: 'ACTIVE',
      providerId: 'manual',
      serviceId: '2',
      carrierName: 'Courier',
      trackingCode: 'T1',
    });
  });

  it('MANUAL with another providerId is refused', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    expect(
      await codesOf(ships.create(id, ship(lineId, { mode: 'MANUAL', providerId: 'dpd-portugal', carrierName: 'X' }), 'user:1'))
    ).toEqual([{ path: 'method.providerId', code: 'invalid' }]);
  });

  it('DPD Express chosen on a manual order uses the home sub-account and the DPD service name', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    const s = await ships.create(
      id,
      ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'EXPRESS' }, 'k1', { parcels: 2 }),
      'user:1'
    );
    expect(s).toMatchObject({
      status: 'ACTIVE',
      providerId: 'dpd-portugal',
      serviceId: 'EXPRESS',
      carrierName: 'DPD Home',
      trackingCode: GUIDE,
    });
    expect(dpd.expeditions[0].sub_account).toEqual({ code: 'HOME-001' });
    expect(dpd.expeditions[0].encomenda_num_volumes).toBe(2);
  });

  it('DPD Express chosen on a pickup order ships to the customer address, not the point', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    makePickup(c, id);
    await ships.create(id, ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'EXPRESS' }), 'user:1');
    const body = dpd.expeditions[0];
    expect(body.sub_account).toEqual({ code: 'HOME-001' });
    expect(body.destinatario_usar_endereco_pickup).toBe(false);
    expect(JSON.stringify(body)).toContain('Rua A 1');
    expect(JSON.stringify(body)).not.toContain('PT10234');
  });

  it('the chosen service overrides the order service (DPD Pickup order shipped by Express)', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'dpd-portugal', serviceId: 'EXPRESS' });
    makePickup(c, id);
    const s = await ships.create(
      id,
      ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'EXPRESS' }),
      'user:1'
    );
    expect(s.serviceId).toBe('EXPRESS');
    expect(dpd.expeditions[0].sub_account).toEqual({ code: 'HOME-001' });
  });

  it('DPD Pickup without a pickup point is refused before any row', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    expect(
      await codesOf(
        ships.create(id, ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'PICKUP' }), 'user:1')
      )
    ).toEqual([{ path: 'method.serviceId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(c.tables[UIDS.shipment]).toHaveLength(0);
    expect(dpd.fetch).not.toHaveBeenCalled();
  });

  it('DPD Pickup on a Store pickup order is refused: a store is no DPD point', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    makeStorePickupOrder(c, id);
    expect(
      await codesOf(
        ships.create(id, ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'PICKUP' }), 'user:1')
      )
    ).toEqual([{ path: 'method.serviceId', code: 'PICKUP_POINT_REQUIRED' }]);
    expect(c.tables[UIDS.shipment]).toHaveLength(0);
    expect(dpd.fetch).not.toHaveBeenCalled();
  });

  it('an unknown DPD service is refused', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    expect(
      await codesOf(
        ships.create(id, ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'X' }), 'user:1')
      )
    ).toEqual([{ path: 'method.serviceId', code: 'invalid' }]);
  });

  it.each([
    ['an inactive carrier', 'dpd-portugal'],
    ['manual', 'manual'],
    ['an unknown provider', 'nope'],
  ])('%s that is not the order carrier is CARRIER_NOT_CONFIGURED on method.providerId', async (_n, providerId) => {
    const { c, ships, state } = setup();
    state.dpd = dpdRuntime(false);
    state.active = ['manual'];
    const { id, lineId } = await paidOrder(c, { providerId: 'manual', serviceId: '1' });
    expect(
      await codesOf(ships.create(id, ship(lineId, { mode: 'CARRIER', providerId, serviceId: 'EXPRESS' }), 'user:1'))
    ).toEqual([{ path: 'method.providerId', code: 'CARRIER_NOT_CONFIGURED' }]);
    expect(c.tables[UIDS.shipment]).toHaveLength(0);
  });

  it('the order carrier switched off since still ships (spec 7), by providerId too', async () => {
    const { c, ships, state, dpd } = setup();
    state.dpd = dpdRuntime(false);
    state.active = ['manual'];
    const { id, lineId } = await paidOrder(c, { providerId: 'dpd-portugal', serviceId: 'EXPRESS' });
    const s = await ships.create(
      id,
      ship(lineId, { mode: 'CARRIER', providerId: 'dpd-portugal', serviceId: 'EXPRESS' }),
      'user:1'
    );
    expect(s.status).toBe('ACTIVE');
    expect(dpd.expeditions).toHaveLength(1);
  });

  it('a bare CARRIER method still ships with the order method', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, { providerId: 'dpd-portugal', serviceId: 'EXPRESS' });
    const s = await ships.create(id, ship(lineId, { mode: 'CARRIER' }), 'user:1');
    expect(s).toMatchObject({ providerId: 'dpd-portugal', serviceId: 'EXPRESS', status: 'ACTIVE' });
  });
});
