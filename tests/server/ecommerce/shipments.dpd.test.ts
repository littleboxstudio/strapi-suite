import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceShippingService from '../../../server/src/services/modules/ecommerce/shipping';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

const LABEL_URL = 'https://labels.dpd.test/private-label-abc.pdf';
const GUIDE = '09876543210123';

const dpdRuntime = (active: boolean, over: Record<string, unknown> = {}) => ({
  active,
  config: {
    authEndpoint: 'https://dpd.test/auth',
    expeditionEndpoint: 'https://dpd.test/expedition',
    clientId: 'client-1',
    username: 'user-1',
    accountHome: 'HOME-001',
    accountShop: 'SHOP-002',
    senderName: 'Loja Teste',
    senderAddress: 'Rua do Remetente 1',
    senderPostalCode: '4000123',
    senderCity: 'Porto',
    senderPhone: '912345678',
    senderEmail: 'loja@example.com',
    services: {},
    ...over,
  },
  secrets: { clientSecret: 'secret-x', password: 'password-y', pickupKey: 'key-z' },
});

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

const json = (status: number, body: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as Response;

type Dpd = { expeditions: any[]; fetch: ReturnType<typeof vi.fn>; expeditionStatus: number };

/** DPD over a stubbed `fetch`: token, expedition (bodies kept) and the label PDF. */
const stubDpd = (): Dpd => {
  const dpd: Dpd = { expeditions: [], fetch: vi.fn(), expeditionStatus: 200 };
  dpd.fetch.mockImplementation(async (url: string, init: any) => {
    if (url === 'https://dpd.test/auth') {
      return json(200, { status_code: 200, result: { access_token: 'tok' } });
    }
    if (url === 'https://dpd.test/expedition') {
      dpd.expeditions.push(JSON.parse(init.body));
      if (dpd.expeditionStatus !== 200) return json(dpd.expeditionStatus, {});
      return json(200, { status_code: 200, result: { num_guia: [GUIDE], pdf_url: LABEL_URL } });
    }
    if (url === LABEL_URL) {
      return {
        status: 200,
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('%PDF-dpd').buffer,
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', dpd.fetch);
  return dpd;
};

function setup(opts: { active?: boolean; runtime?: any } = {}) {
  const c = setupCommerce();
  const variant = c.tables[UIDS.variant].find((v) => v.id === 10);
  variant.stock = 50;
  variant.weight = 0.25; // kilograms
  const state = { runtime: opts.runtime ?? dpdRuntime(opts.active ?? true) };
  const baseRuntime = c.services.EcommerceSettingsService.getRuntime;
  c.services.EcommerceSettingsService.getRuntime = async (id: string) =>
    id === 'dpd-portugal' ? state.runtime : baseRuntime(id);
  const real = EcommerceShippingService({ strapi: c.strapi } as any);
  c.services.EcommerceShippingService.carrierFor = vi.fn(real.carrierFor);
  c.services.EcommerceShippingService.adapterFor = real.adapterFor;
  c.services.EcommerceShipmentService = EcommerceShipmentService({ strapi: c.strapi });
  return { c, ships: c.services.EcommerceShipmentService, state, dpd: stubDpd() };
}

/** A paid DPD Express order with `quantity` units of variant 10. */
const paidDpdOrder = async (c: Commerce, quantity = 3) => {
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt', phone: '912000111' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId: 'dpd-portugal', serviceId: 'EXPRESS' },
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

/** Turns the order into a DPD Pickup order (as the pickup checkout stores it). */
const makePickup = (c: Commerce, orderId: number) => {
  const row = c.tables[UIDS.order].find((o) => o.id === orderId);
  row.shippingMethod = { ...row.shippingMethod, serviceId: 'PICKUP', name: 'DPD Pickup' };
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
  row.shippingAddress = { ...address, line1: 'Rua do Ponto 5', postalCode: '1100-200' };
};

const carrier = (lineId: number, quantity: number, key: string, extra: Record<string, unknown> = {}) => ({
  lines: [{ orderLineId: lineId, quantity }],
  method: { mode: 'CARRIER' as const },
  shippingCost: 500,
  notifyCustomer: true,
  idempotencyKey: key,
  ...extra,
});

const codesOf = async (p: Promise<unknown>): Promise<string[]> => {
  const err: any = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e
  );
  if (err instanceof EcommerceValidationError) return err.errors.map((e: any) => e.code);
  if (err instanceof EcommerceCarrierError) return [err.code];
  throw err;
};

const rows = (c: Commerce) => c.tables[UIDS.shipment];

beforeEach(() => __resetEventHandlersForTests());
afterEach(() => vi.unstubAllGlobals());

describe('DPD shipments', () => {
  it('Express: sub-account home, parcels and the weight of the shipped units; ACTIVE with tracking and a private labelRef', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 3);
    const s = await ships.create(id, carrier(lineId, 2, 'k1', { parcels: 2 }), 'user:1');

    expect(dpd.expeditions).toHaveLength(1);
    const body = dpd.expeditions[0];
    expect(body.sub_account).toEqual({ code: 'HOME-001' });
    expect(body.encomenda_num_volumes).toBe(2);
    // 2 shipped units × 0.25 kg (the 3rd unit is not in this shipment).
    expect(body.encomenda_peso_envio).toBe('0.5');
    expect(body.destinatario_usar_endereco_pickup).toBe(false);
    expect(body.encomenda_referencia).toBe(`LB-SHP-${s.id}`);

    expect(s).toMatchObject({
      status: 'ACTIVE',
      providerId: 'dpd-portugal',
      serviceId: 'EXPRESS',
      trackingCode: GUIDE,
      trackingUrl: `https://tracking.dpd.pt/track-and-trace?reference=${GUIDE}`,
      labelAvailable: true,
    });
    expect(rows(c)[0].labelRef).toBe(LABEL_URL);
    expect(rows(c)[0].metadata).toMatchObject({ parcels: 2 });
    // Never in the admin view.
    expect(s).not.toHaveProperty('labelRef');
    expect(JSON.stringify(s)).not.toContain(LABEL_URL);
    const listed = await ships.listForOrder(id);
    expect(JSON.stringify(listed)).not.toContain(LABEL_URL);
    expect(JSON.stringify(await c.orders.get(id))).not.toContain(LABEL_URL);
  });

  it('parcels default to 1', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    expect(dpd.expeditions[0].encomenda_num_volumes).toBe(1);
    expect(dpd.expeditions[0].encomenda_peso_envio).toBe('0.25');
  });

  it.each([0, 100, 1.5, '2', -1])('parcels %s is refused before any row', async (parcels) => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    expect(await codesOf(ships.create(id, carrier(lineId, 1, 'k1', { parcels }), 'user:1'))).toEqual([
      'invalid',
    ]);
    expect(rows(c)).toHaveLength(0);
    expect(dpd.expeditions).toHaveLength(0);
  });

  it('Pickup: sends the pudo id with the shop sub-account', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    makePickup(c, id);
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    expect(s.status).toBe('ACTIVE');
    const body = dpd.expeditions[0];
    expect(body.sub_account).toEqual({ code: 'SHOP-002' });
    expect(body.destinatario_usar_endereco_pickup).toBe(true);
    expect(body.recipient_pickup_store).toEqual({ number: 'PT10234' });
  });

  it('Review Focus 2: an inactive DPD integration with credentials still ships and prints the label', async () => {
    const { c, ships, dpd } = setup({ active: false });
    const { id, lineId } = await paidDpdOrder(c, 1);
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    expect(s.status).toBe('ACTIVE');
    expect(c.services.EcommerceShippingService.carrierFor).toHaveBeenCalledWith('dpd-portugal', {
      forShipment: true,
    });

    const label = await ships.getLabel(s.id);
    expect(label.content.toString()).toBe('%PDF-dpd');
    expect(label.filename).toBe(`dpd-${GUIDE}.pdf`);
    expect(dpd.fetch).toHaveBeenLastCalledWith(LABEL_URL, expect.anything());
  });

  it('an inactive DPD integration without credentials cannot ship', async () => {
    const { c, ships, state, dpd } = setup({ active: false });
    state.runtime = dpdRuntime(false, { clientId: '' });
    const { id, lineId } = await paidDpdOrder(c, 1);
    expect(await codesOf(ships.create(id, carrier(lineId, 1, 'k1'), 'user:1'))).toEqual([
      'CARRIER_NOT_CONFIGURED',
    ]);
    expect(dpd.fetch).not.toHaveBeenCalled();
  });

  it('cancel marks CANCELLED locally with carrierCancelled: false, even with DPD switched off', async () => {
    const { c, ships, state, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    state.runtime = dpdRuntime(false, { clientId: '' });
    const calls = dpd.fetch.mock.calls.length;

    const cancelled = await ships.cancel(s.id, { reason: 'Wrong box' }, 'user:1');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', carrierCancelled: false });
    expect(dpd.fetch.mock.calls.length).toBe(calls);
    expect(c.tables[UIDS.order].find((o) => o.id === id).fulfillmentStatus).toBe('UNFULFILLED');
  });

  it('a manual shipment cancel carries no carrierCancelled', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    const s = await ships.create(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 1 }],
        method: { mode: 'MANUAL', carrierName: 'Hand' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: 'm1',
      },
      'user:1'
    );
    const cancelled = await ships.cancel(s.id, {}, 'user:1');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled).not.toHaveProperty('carrierCancelled');
  });

  it('an uncertain DPD shipment is never retried (DPD does not deduplicate): CARRIER_RETRY_UNSAFE', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    dpd.expeditionStatus = 502;
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    expect(s).toMatchObject({
      status: 'PENDING',
      error: 'UNCERTAIN',
      retryable: true,
      carrierSupport: { retry: false, cancel: false, tracking: false },
    });
    dpd.expeditionStatus = 200;
    expect(await codesOf(ships.retry(s.id, 'user:1'))).toEqual(['CARRIER_RETRY_UNSAFE']);
    expect(dpd.expeditions).toHaveLength(1);
    expect(rows(c)[0]).toMatchObject({ status: 'PENDING', error: 'UNCERTAIN' });
  });

  it('mark as failed settles an uncertain DPD shipment and frees its units', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    dpd.expeditionStatus = 502;
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    dpd.expeditionStatus = 200;

    const failed = await ships.markFailed(s.id, 'user:1');
    expect(failed).toMatchObject({ status: 'FAILED', error: 'MARKED_FAILED', retryable: false });
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'SHIPMENT_FAILED')
    ).toHaveLength(1);
    // Twice: no longer available.
    expect(await codesOf(ships.markFailed(s.id, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);

    const again = await ships.create(id, carrier(lineId, 1, 'k2'), 'user:1');
    expect(again.status).toBe('ACTIVE');
  });

  it('mark as failed is refused for an ACTIVE shipment', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    const s = await ships.create(id, carrier(lineId, 1, 'k1'), 'user:1');
    expect(await codesOf(ships.markFailed(s.id, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
  });

  it('a DPD refusal is FAILED with its code', async () => {
    const { c, ships, dpd } = setup();
    const { id, lineId } = await paidDpdOrder(c, 1);
    dpd.expeditionStatus = 400;
    expect(await codesOf(ships.create(id, carrier(lineId, 1, 'k1'), 'user:1'))).toEqual([
      'DPD_SHIPMENT_FAILED',
    ]);
    expect(rows(c)[0]).toMatchObject({ status: 'FAILED', error: 'DPD_SHIPMENT_FAILED' });
  });
});
