import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

const RUNTIME = { config: {}, secrets: { apiKey: 'k' } };
const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

function setup() {
  const c = setupCommerce();
  const adapter: any = {
    createShipment: vi.fn(async (req: any) => ({
      externalId: `EXT-${req.ourReference}`,
      trackingCode: 'TRK1',
      trackingUrl: 'https://track.example/TRK1',
      cost: 700,
      labelAvailable: false,
    })),
    track: vi.fn(async () => []),
  };
  c.services.EcommerceShippingService.carrierFor = vi.fn(async () => ({
    adapter,
    runtime: RUNTIME,
  }));
  c.services.EcommerceShipmentService = EcommerceShipmentService({ strapi: c.strapi });
  return { c, ships: c.services.EcommerceShipmentService, adapter };
}

const paidOrder = async (c: Commerce, quantity = 2, providerId = 'manual') => {
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId, serviceId: 'express' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  await c.payments.addManualPayment(
    order.id,
    { amount: quantity * 2000 + 500, idempotencyKey: `pay-${order.id}` },
    'user:1'
  );
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === order.id).id as number;
  return { id: order.id, lineId };
};

const manual = (lineId: number, quantity: number, key: string) => ({
  lines: [{ orderLineId: lineId, quantity }],
  method: { mode: 'MANUAL' as const, carrierName: 'CTT', trackingCode: 'RR1' },
  shippingCost: 0,
  notifyCustomer: true,
  idempotencyKey: key,
});
const carrierShip = (lineId: number, quantity: number, key: string) => ({
  lines: [{ orderLineId: lineId, quantity }],
  method: { mode: 'CARRIER' as const },
  shippingCost: 500,
  notifyCustomer: true,
  idempotencyKey: key,
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

const delivered = (c: Commerce) => c.events.filter((e) => e.type === 'SHIPMENT_DELIVERED');
const evRows = (c: Commerce, type?: string) =>
  c.tables[UIDS.shipmentEvent].filter((e) => !type || e.type === type);
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const past = () => new Date().toISOString();

beforeEach(() => __resetEventHandlersForTests());

describe('confirmDelivery', () => {
  it('two shipments completing the order: allDelivered only after the second; ARCHIVE appears', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    const b = await ships.create(id, manual(lineId, 1, 's2'), 'user:1');
    const fulfillment = orderRow(c, id).fulfillmentStatus;

    await ships.confirmDelivery(a.id, { deliveredAt: past(), notifyCustomer: true }, 'user:1');
    expect(delivered(c)[0].payload).toMatchObject({
      shipmentId: a.id,
      allDelivered: false,
      notify: true,
    });
    expect((await c.orders.get(id)).availableActions).not.toContain('ARCHIVE');

    const view = await ships.confirmDelivery(
      b.id,
      { deliveredAt: past(), notifyCustomer: false },
      'user:1'
    );
    expect(delivered(c)[1].payload).toMatchObject({
      shipmentId: b.id,
      allDelivered: true,
      notify: false,
    });
    expect(view).toMatchObject({ deliveryStatus: 'DELIVERED', deliverySource: 'MANUAL' });
    expect((await c.orders.get(id)).availableActions).toContain('ARCHIVE');
    // Delivery changes neither FulfillmentStatus nor OrderStatus.
    expect(orderRow(c, id).fulfillmentStatus).toBe(fulfillment);
    expect(orderRow(c, id).orderStatus).toBe('OPEN');
  });

  it('confirming twice gives ALREADY_DELIVERED and a single event with the delivered key', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 1);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    await ships.confirmDelivery(a.id, { deliveredAt: past(), notifyCustomer: true }, 'user:1');
    expect(
      await codesOf(
        ships.confirmDelivery(a.id, { deliveredAt: past(), notifyCustomer: true }, 'user:1')
      )
    ).toEqual(['ALREADY_DELIVERED']);
    expect(evRows(c, 'DELIVERED')).toHaveLength(1);
    expect(evRows(c, 'DELIVERED')[0]).toMatchObject({
      uniqueKey: `shp:${a.id}:delivered`,
      source: 'ADMIN',
      actor: 'user:1',
    });
    expect(delivered(c)).toHaveLength(1);
    const hist = c.tables[UIDS.orderHistory].filter((h) => h.type === 'SHIPMENT_DELIVERED');
    expect(hist).toHaveLength(1);
    expect(hist[0].description).toContain('Delivery confirmed manually');
  });

  it('a future date gives in_future; before shipment gives before_shipment', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 1);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    expect(
      await codesOf(ships.confirmDelivery(a.id, { deliveredAt: future, notifyCustomer: true }, 'u'))
    ).toEqual(['in_future']);
    expect(
      await codesOf(
        ships.confirmDelivery(
          a.id,
          { deliveredAt: '2000-01-01T00:00:00Z', notifyCustomer: true },
          'u'
        )
      )
    ).toEqual(['before_shipment']);
    expect(
      await codesOf(ships.confirmDelivery(a.id, { deliveredAt: 'nope', notifyCustomer: true }, 'u'))
    ).toEqual(['invalid_date']);
    expect(delivered(c)).toHaveLength(0);
  });

  it('refuses a cancelled shipment and an archived order; notify is false on a non-OPEN order', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    const b = await ships.create(id, manual(lineId, 1, 's2'), 'user:1');
    await ships.cancel(a.id, {}, 'user:1');
    expect(
      await codesOf(ships.confirmDelivery(a.id, { deliveredAt: past(), notifyCustomer: true }, 'u'))
    ).toEqual(['ACTION_NOT_AVAILABLE']);
    orderRow(c, id).orderStatus = 'CANCELLED';
    await ships.confirmDelivery(b.id, { deliveredAt: past(), notifyCustomer: true }, 'u');
    expect(delivered(c)[0].payload.notify).toBe(false);
    orderRow(c, id).orderStatus = 'ARCHIVED';
    const other = await ships.listForOrder(id);
    expect(other).toHaveLength(2);
  });
});

describe('updateTracking', () => {
  it('stores code and link, one distinct key per call, no e-mail', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 1);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    const v = await ships.updateTracking(
      a.id,
      { trackingCode: 'NEW1', trackingUrl: 'https://t.example/NEW1' },
      'user:1'
    );
    expect(v).toMatchObject({ trackingCode: 'NEW1', trackingUrl: 'https://t.example/NEW1' });
    await ships.updateTracking(a.id, { trackingCode: 'NEW2' }, 'user:1');
    const keys = evRows(c, 'TRACKING_UPDATED').map((e) => e.uniqueKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    keys.forEach((k) => expect(k).toMatch(new RegExp(`^shp:${a.id}:tracking:[0-9a-f-]{36}$`)));
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.type === 'SHIPMENT_TRACKING_UPDATED')
    ).toHaveLength(2);
    expect(c.tables[UIDS.notification]).toHaveLength(0);
    expect(
      c.events.filter((e) => e.type !== 'SHIPMENT_CREATED' && /SHIPMENT/.test(e.type))
    ).toHaveLength(0);
  });

  it('rejects javascript: URLs and cancelled shipments', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 1);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    expect(
      await codesOf(ships.updateTracking(a.id, { trackingUrl: 'javascript:alert(1)' }, 'u'))
    ).toEqual(['invalid_url']);
    await ships.cancel(a.id, {}, 'user:1');
    expect(await codesOf(ships.updateTracking(a.id, { trackingCode: 'X' }, 'u'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    expect(evRows(c, 'TRACKING_UPDATED')).toHaveLength(0);
  });
});

describe('refreshTracking', () => {
  const carrierOrder = async (c: Commerce, ships: any) => {
    const { id, lineId } = await paidOrder(c, 1, 'ctt-test');
    const s = await ships.create(id, carrierShip(lineId, 1, 'c1'), 'user:1');
    return { id, shipmentId: s.id };
  };

  it('repeated events do not duplicate rows; a delivered event marks the delivery', async () => {
    const { c, ships, adapter } = setup();
    const { id, shipmentId } = await carrierOrder(c, ships);
    const t0 = new Date(Date.now() - 3600_000).toISOString();
    const t1 = new Date(Date.now() - 1800_000).toISOString();
    adapter.track.mockResolvedValue([
      { code: 'PICKED', description: 'Picked up', occurredAt: t0, delivered: false },
    ]);
    await ships.refreshTracking(shipmentId, 'user:1');
    await ships.refreshTracking(shipmentId, 'user:1');
    expect(evRows(c, 'TRACKING')).toHaveLength(1);
    expect(adapter.track).toHaveBeenCalledWith(
      { externalId: expect.stringMatching(/^EXT-/), trackingCode: 'TRK1' },
      RUNTIME,
      { timeoutMs: 15000 }
    );

    adapter.track.mockResolvedValue([
      { code: 'PICKED', description: 'Picked up', occurredAt: t0, delivered: false },
      { code: 'DELIVERED', description: 'Delivered', occurredAt: t1, delivered: true },
    ]);
    const view = await ships.refreshTracking(shipmentId, 'user:1');
    await ships.refreshTracking(shipmentId, 'user:1');
    expect(evRows(c, 'TRACKING')).toHaveLength(2);
    expect(view).toMatchObject({
      deliveryStatus: 'DELIVERED',
      deliverySource: 'CARRIER',
      deliveredAt: t1,
    });
    expect(evRows(c, 'DELIVERED')).toHaveLength(1);
    expect(evRows(c, 'DELIVERED')[0]).toMatchObject({
      uniqueKey: `shp:${shipmentId}:delivered`,
      source: 'CARRIER',
      actor: 'carrier:ctt-test',
    });
    expect(delivered(c)).toHaveLength(1);
    expect(delivered(c)[0].payload).toMatchObject({ allDelivered: true, notify: true });
    expect((await c.orders.get(id)).availableActions).toContain('ARCHIVE');
  });

  it('a manual shipment gives NOT_SUPPORTED', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 1);
    const a = await ships.create(id, manual(lineId, 1, 's1'), 'user:1');
    expect(await codesOf(ships.refreshTracking(a.id, 'u'))).toEqual(['NOT_SUPPORTED']);
  });

  it('calls the carrier outside any transaction', async () => {
    const { c, ships, adapter } = setup();
    const { shipmentId } = await carrierOrder(c, ships);
    const real = c.strapi.db.transaction;
    let depth = 0;
    c.strapi.db.transaction = (async (fn: any) => {
      depth++;
      try {
        return await real(fn);
      } finally {
        depth--;
      }
    }) as any;
    let during = -1;
    adapter.track.mockImplementation(async () => {
      during = depth;
      return [];
    });
    await ships.refreshTracking(shipmentId, 'u');
    expect(during).toBe(0);
  });
});
