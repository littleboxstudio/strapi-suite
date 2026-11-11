import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceShipmentService, {
  CREATE_SHIPMENT_TIMEOUT_MS,
  CARRIER_CALL_TIMEOUT_MS,
  STUCK_PENDING_SHIPMENT_MS,
} from '../../../server/src/services/modules/ecommerce/shipments';
import { cttExpressoAdapter } from '../../../server/src/services/modules/ecommerce/providers/carriers/cttExpresso';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { MAX_MONEY_CENTS } from '../../../server/src/services/modules/ecommerce/domain/orders';
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
      labelAvailable: true,
    })),
    cancelShipment: vi.fn(async () => undefined),
    getLabel: vi.fn(async () => ({ filename: 'label.pdf', content: Buffer.from('PDF') })),
  };
  c.services.EcommerceShippingService.carrierFor = vi.fn(async (providerId: string) =>
    providerId === 'ctt-expresso'
      ? { adapter: cttExpressoAdapter, runtime: RUNTIME }
      : { adapter, runtime: RUNTIME }
  );
  c.services.EcommerceShipmentService = EcommerceShipmentService({ strapi: c.strapi });
  return { c, ships: c.services.EcommerceShipmentService, adapter };
}

/** A settled order with `quantity` units of variant 10 (2000 each) + 500 shipping. */
const paidOrder = async (c: Commerce, quantity = 2, providerId = 'manual', pay = true) => {
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
  const id = order.id;
  if (pay) {
    await c.payments.addManualPayment(
      id,
      { amount: quantity * 2000 + 500, idempotencyKey: `pay-${id}` },
      'user:1'
    );
  }
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === id).id as number;
  return { id, lineId };
};

const manual = (
  lineId: number,
  quantity: number,
  key: string,
  extra: Record<string, unknown> = {}
) => ({
  lines: [{ orderLineId: lineId, quantity }],
  method: {
    mode: 'MANUAL' as const,
    carrierName: 'CTT',
    trackingCode: 'RR1',
    trackingUrl: 'https://ctt.pt/RR1',
  },
  shippingCost: 0,
  notifyCustomer: true,
  idempotencyKey: key,
  ...extra,
});

const carrier = (lineId: number, quantity: number, key: string) => ({
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

const shipmentRows = (c: Commerce) => c.tables[UIDS.shipment];
const shipEvents = (c: Commerce) => c.events.filter((e) => e.type === 'SHIPMENT_CREATED');
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

beforeEach(() => __resetEventHandlersForTests());

describe('EcommerceShipmentService.create (MANUAL)', () => {
  it('Review Focus 1: the same key gives one shipment and one event', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const a = await ships.create(id, manual(lineId, 2, 'ship-1'), 'user:1');
    const again = await ships.create(id, manual(lineId, 2, 'ship-1'), 'user:1');
    expect(again.id).toBe(a.id);
    expect(shipmentRows(c)).toHaveLength(1);
    expect(shipEvents(c)).toHaveLength(1);
  });

  it('Review Focus 1: a double click that loses on the unique key returns the winner', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 4);
    const a = await ships.create(id, manual(lineId, 2, 'ship-1'), 'user:1');
    // The second request read the key before the first committed (both lookups miss).
    const realQuery = c.strapi.db.query;
    let misses = 2;
    c.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.shipment) return q;
      return {
        ...q,
        findOne: async (p: any) => {
          if (misses > 0 && p?.where?.idempotencyKey) {
            misses--;
            return null;
          }
          return q.findOne(p);
        },
      };
    };
    const b = await ships.create(id, manual(lineId, 2, 'ship-1'), 'user:1');
    expect(misses).toBe(0);
    expect(b.id).toBe(a.id);
    expect(shipmentRows(c)).toHaveLength(1);
    expect(shipEvents(c)).toHaveLength(1);
  });

  it('Review Focus 1: different keys over the same units are refused', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    await ships.create(id, manual(lineId, 2, 'tab-a'), 'user:1');
    expect(await codesOf(ships.create(id, manual(lineId, 1, 'tab-b'), 'user:1'))).toContain(
      'QUANTITY_EXCEEDS_PENDING'
    );
    expect(shipmentRows(c)).toHaveLength(1);
    expect(shipEvents(c)).toHaveLength(1);
  });

  it('ships 4 then 6 of 10 units: partial then full', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 10);
    const first = await ships.create(id, manual(lineId, 4, 's1'), 'user:1');
    expect(first).toMatchObject({
      status: 'ACTIVE',
      providerId: 'manual',
      carrierName: 'CTT',
      trackingCode: 'RR1',
      trackingUrl: 'https://ctt.pt/RR1',
      deliveryStatus: 'IN_TRANSIT',
      items: [{ orderLineId: lineId, sku: 'SH-M', name: 'Shirt', option: null, quantity: 4 }],
    });
    expect(first.shippedAt).toBeTruthy();
    expect(first.events).toEqual([expect.objectContaining({ type: 'CREATED', source: 'ADMIN' })]);
    expect(orderRow(c, id).fulfillmentStatus).toBe('PARTIALLY_FULFILLED');
    expect(shipEvents(c)[0].payload).toEqual({
      shipmentId: first.id,
      full: false,
      notify: true,
      pending: [{ orderLineId: lineId, quantity: 6 }],
    });

    const second = await ships.create(id, manual(lineId, 6, 's2'), 'user:1');
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    expect(shipEvents(c)[1].payload).toMatchObject({
      shipmentId: second.id,
      full: true,
      pending: [],
    });
    const history = c.tables[UIDS.orderHistory].filter(
      (h) => h.order === id && h.type === 'SHIPMENT_CREATED'
    );
    expect(history).toHaveLength(2);
    const view = await c.orders.get(id);
    expect(view.shipments.map((s: any) => s.id)).toEqual([first.id, second.id]);
    expect(view.lines[0]).toMatchObject({ shipped: 10, reserved: 10, pending: 0, returnable: 10 });
    expect(view.shipping).toEqual({ remainingCost: 500, deliveryStatus: 'IN_TRANSIT' });
  });

  it('refuses an order that is not settled', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'manual', false);
    expect(await codesOf(ships.create(id, manual(lineId, 1, 'k'), 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    expect(shipmentRows(c)).toHaveLength(0);
  });

  it('creates no stock movement', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const before = c.tables[UIDS.stockMovement].length;
    const stock = c.tables[UIDS.variant].find((v) => v.id === 10).stock;
    await ships.create(id, manual(lineId, 2, 'k'), 'user:1');
    expect(c.tables[UIDS.stockMovement]).toHaveLength(before);
    expect(c.tables[UIDS.variant].find((v) => v.id === 10).stock).toBe(stock);
  });

  it('records the created event with uniqueKey shp:<id>:created', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const s = await ships.create(id, manual(lineId, 1, 'k'), 'user:1');
    expect(c.tables[UIDS.shipmentEvent]).toEqual([
      expect.objectContaining({
        shipment: s.id,
        order: id,
        type: 'CREATED',
        uniqueKey: `shp:${s.id}:created`,
      }),
    ]);
  });

  it('notifyCustomer false is carried on the event; no notification', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    await ships.create(id, manual(lineId, 2, 'k', { notifyCustomer: false }), 'user:1');
    expect(shipEvents(c)[0].payload.notify).toBe(false);
    expect(c.tables[UIDS.notification]).toHaveLength(0);
  });

  it('validates tracking URL, carrier name and shipping cost', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const withMethod = (m: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      ships.create(
        id,
        {
          ...manual(lineId, 1, 'k'),
          method: { mode: 'MANUAL', carrierName: 'CTT', ...m },
          ...extra,
        },
        'user:1'
      );
    expect(await codesOf(withMethod({ trackingUrl: 'javascript:alert(1)' }))).toContain(
      'invalid_url'
    );
    expect(
      await codesOf(withMethod({ trackingUrl: `https://x.example/${'a'.repeat(2000)}` }))
    ).toContain('invalid_url');
    expect((await codesOf(withMethod({ carrierName: '' }))).length).toBeGreaterThan(0);
    expect((await codesOf(withMethod({ carrierName: 'x'.repeat(121) }))).length).toBeGreaterThan(0);
    expect(await codesOf(withMethod({}, { shippingCost: -1 }))).toContain('INVALID_AMOUNT');
    expect(await codesOf(withMethod({}, { shippingCost: MAX_MONEY_CENTS + 1 }))).toContain(
      'INVALID_AMOUNT'
    );
    expect(shipmentRows(c)).toHaveLength(0);
    // The limits themselves are accepted.
    await withMethod({ carrierName: 'x'.repeat(120) }, { shippingCost: MAX_MONEY_CENTS });
    expect(shipmentRows(c)).toHaveLength(1);
  });
});

describe('EcommerceShipmentService.create (CARRIER)', () => {
  it('creates the shipment with the order carrier and an explicit 30 s timeout', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    expect(CREATE_SHIPMENT_TIMEOUT_MS).toBe(30000);
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ ourReference: `LB-SHP-${s.id}`, serviceId: 'express' }),
      RUNTIME,
      { timeoutMs: 30000 }
    );
    expect(s).toMatchObject({
      status: 'ACTIVE',
      providerId: 'acme',
      serviceId: 'express',
      carrierName: 'Standard',
      trackingCode: 'TRK1',
      shippingCost: 700,
      labelAvailable: true,
    });
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    expect(shipEvents(c)[0].payload).toMatchObject({ shipmentId: s.id, full: true });
  });

  it('CTT Expresso: NOT_IMPLEMENTED, shipment FAILED and nothing sent', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'ctt-expresso');
    expect(await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'))).toEqual([
      'NOT_IMPLEMENTED',
    ]);
    expect(shipmentRows(c)).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'NOT_IMPLEMENTED' }),
    ]);
    expect(shipEvents(c)).toHaveLength(0);
    expect(orderRow(c, id).fulfillmentStatus).toBe('UNFULFILLED');
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'SHIPMENT_FAILED')
    ).toHaveLength(1);
  });

  it('adapter without createShipment: NOT_SUPPORTED before any row', async () => {
    const { c, ships, adapter } = setup();
    delete adapter.createShipment;
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    expect(await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'))).toEqual([
      'NOT_SUPPORTED',
    ]);
    expect(shipmentRows(c)).toHaveLength(0);
  });

  it('timeout: PENDING/UNCERTAIN; retry with success: ACTIVE', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(
      new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true)
    );
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    expect(s).toMatchObject({ status: 'PENDING', error: 'UNCERTAIN', retryable: true });
    expect(shipEvents(c)).toHaveLength(0);
    // The units stay reserved meanwhile.
    expect(await codesOf(ships.create(id, carrier(lineId, 1, 'k2'), 'user:1'))).toContain(
      'QUANTITY_EXCEEDS_PENDING'
    );

    const retried = await ships.retry(s.id, 'user:1');
    expect(adapter.createShipment).toHaveBeenLastCalledWith(
      expect.objectContaining({ ourReference: `LB-SHP-${s.id}` }),
      RUNTIME,
      { timeoutMs: 30000 }
    );
    expect(retried).toMatchObject({
      id: s.id,
      status: 'ACTIVE',
      error: null,
      trackingCode: 'TRK1',
    });
    expect(shipEvents(c)).toHaveLength(1);
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
  });

  it('a PENDING shipment without outcome (process died between the transactions) is retryable once stale', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true));
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    const row = shipmentRows(c).find((r) => r.id === s.id);
    // As if the second transaction never ran: PENDING with no error.
    row.error = null;
    row.createdAt = new Date(Date.now() - 30_000).toISOString();
    expect(await codesOf(ships.retry(s.id, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
    // The view says so with the server clock (the admin never compares against its own).
    expect((await ships.listForOrder(id))[0].retryable).toBe(false);

    row.createdAt = new Date(Date.now() - STUCK_PENDING_SHIPMENT_MS - 1000).toISOString();
    expect((await ships.listForOrder(id))[0].retryable).toBe(true);
    const retried = await ships.retry(s.id, 'user:1');
    expect(retried).toMatchObject({ id: s.id, status: 'ACTIVE', error: null });
    expect(adapter.createShipment).toHaveBeenLastCalledWith(
      expect.objectContaining({ ourReference: `LB-SHP-${s.id}` }),
      RUNTIME,
      { timeoutMs: 30000 }
    );
  });

  it('the stale threshold is above the create timeout and its backstop', () => {
    expect(STUCK_PENDING_SHIPMENT_MS).toBeGreaterThanOrEqual(CREATE_SHIPMENT_TIMEOUT_MS + 5000);
  });

  it('retry is refused unless PENDING/UNCERTAIN', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    expect(s.retryable).toBe(false);
    expect(await codesOf(ships.retry(s.id, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
  });

  it('order changed between the two transactions: FAILED with ORDER_CHANGED, never ACTIVE', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockImplementationOnce(async (req: any) => {
      orderRow(c, id).orderStatus = 'CANCELLED';
      return {
        externalId: 'EXT-9',
        trackingCode: 'T',
        trackingUrl: null,
        cost: null,
        labelAvailable: false,
      };
    });
    expect(await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'))).toEqual([
      'ORDER_CHANGED',
    ]);
    expect(shipmentRows(c)).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'ORDER_CHANGED', externalId: 'EXT-9' }),
    ]);
    expect(shipEvents(c)).toHaveLength(0);
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'SHIPMENT_FAILED')
    ).toHaveLength(1);
  });

  it('cancelling an order with a PENDING shipment: SHIPMENT_PENDING', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(
      new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true)
    );
    await ships.create(id, carrier(lineId, 1, 'k'), 'user:1');
    expect(await codesOf(c.orders.cancel(id, 'user:1'))).toEqual(['SHIPMENT_PENDING']);
    expect(orderRow(c, id).orderStatus).toBe('OPEN');
  });
});

describe('EcommerceShipmentService.cancel', () => {
  it('cancelling the only shipment: back to UNFULFILLED, event shp:<id>:cancelled, no e-mail', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const s = await ships.create(id, manual(lineId, 2, 'k'), 'user:1');
    const eventsBefore = c.events.length;
    const cancelled = await ships.cancel(s.id, { reason: 'Wrong parcel' }, 'user:1');
    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(orderRow(c, id).fulfillmentStatus).toBe('UNFULFILLED');
    expect(c.tables[UIDS.shipmentEvent].map((e) => e.uniqueKey)).toEqual([
      `shp:${s.id}:created`,
      `shp:${s.id}:cancelled`,
    ]);
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'SHIPMENT_CANCELLED')
    ).toHaveLength(1);
    expect(c.events.length).toBe(eventsBefore);
    expect(c.tables[UIDS.notification]).toHaveLength(0);
  });

  it('a shipment with returned units: SHIPMENT_HAS_RETURNS', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const s = await ships.create(id, manual(lineId, 2, 'k'), 'user:1');
    c.tables[UIDS.orderLine].find((l) => l.id === lineId).returnedQuantity = 1;
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['SHIPMENT_HAS_RETURNS']);
    expect(shipmentRows(c)[0].status).toBe('ACTIVE');
  });

  it('PENDING/UNCERTAIN without externalId: SHIPMENT_UNCERTAIN, unchanged', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(
      new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true)
    );
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['SHIPMENT_UNCERTAIN']);
    expect(shipmentRows(c)[0]).toMatchObject({ status: 'PENDING', error: 'UNCERTAIN' });
    expect(adapter.cancelShipment).not.toHaveBeenCalled();
  });

  it('PENDING with externalId: cancelShipment (15 s) and CANCELLED', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(
      new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true)
    );
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    shipmentRows(c)[0].externalId = 'EXT-1';
    const cancelled = await ships.cancel(s.id, {}, 'user:1');
    expect(CARRIER_CALL_TIMEOUT_MS).toBe(15000);
    expect(adapter.cancelShipment).toHaveBeenCalledWith('EXT-1', RUNTIME, { timeoutMs: 15000 });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('ACTIVE carrier shipment: adapter without cancelShipment gives NOT_SUPPORTED, nothing changes', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    delete adapter.cancelShipment;
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['NOT_SUPPORTED']);
    expect(shipmentRows(c)[0].status).toBe('ACTIVE');
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
  });

  it('a delivered shipment cannot be cancelled', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    const s = await ships.create(id, manual(lineId, 2, 'k'), 'user:1');
    shipmentRows(c)[0].deliveryStatus = 'DELIVERED';
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['ALREADY_DELIVERED']);
  });
  it('M3: local rules refuse before the carrier is called', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    c.tables[UIDS.orderLine].find((l) => l.id === lineId).returnedQuantity = 1;
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['SHIPMENT_HAS_RETURNS']);
    shipmentRows(c)[0].deliveryStatus = 'DELIVERED';
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['ALREADY_DELIVERED']);
    expect(adapter.cancelShipment).not.toHaveBeenCalled();
  });

  it('M3: the carrier cancelled but the local state changed meanwhile: history and a clear error', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    adapter.cancelShipment.mockImplementationOnce(async () => {
      shipmentRows(c)[0].deliveryStatus = 'DELIVERED';
    });
    expect(await codesOf(ships.cancel(s.id, {}, 'user:1'))).toEqual(['SHIPMENT_STATE_CHANGED']);
    expect(shipmentRows(c)[0]).toMatchObject({ status: 'ACTIVE', error: 'CARRIER_CANCELLED' });
    const entries = c.tables[UIDS.orderHistory].filter(
      (h) => h.order === id && h.type === 'SHIPMENT_CARRIER_CANCELLED'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].newValue).toMatchObject({
      carrierCancelled: true,
      refusedWith: 'ALREADY_DELIVERED',
    });
  });

  it('M7: get() reads the shipments once', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c);
    await ships.create(id, manual(lineId, 1, 'k'), 'user:1');
    const realQuery = c.strapi.db.query;
    let reads = 0;
    c.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.shipment) return q;
      return {
        ...q,
        findMany: async (p: any) => {
          reads++;
          return q.findMany(p);
        },
      };
    };
    const view = await c.orders.get(id);
    c.strapi.db.query = realQuery;
    expect(view.shipments).toHaveLength(1);
    expect(reads).toBe(1);
  });
});

describe('EcommerceShipmentService carrier edge cases (fix round 1)', () => {
  it('M2: a success without externalId stays PENDING/UNCERTAIN, never ACTIVE', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockResolvedValueOnce({
      externalId: '',
      trackingCode: 'T',
      trackingUrl: null,
      cost: null,
      labelAvailable: true,
    });
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    expect(s).toMatchObject({ status: 'PENDING', error: 'UNCERTAIN' });
    expect(shipEvents(c)).toHaveLength(0);
    expect(orderRow(c, id).fulfillmentStatus).toBe('UNFULFILLED');
  });

  it('M4: a failure before contacting the carrier is FAILED, not UNCERTAIN', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const realQuery = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.variant) return q;
      return {
        ...q,
        findMany: async () => {
          throw new Error('db down');
        },
      };
    };
    expect(await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'))).toEqual([
      'CARRIER_REQUEST_FAILED',
    ]);
    c.strapi.db.query = realQuery;
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(shipmentRows(c)).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'CARRIER_REQUEST_FAILED' }),
    ]);
  });

  it('R1: a retry whose request cannot be built keeps the shipment PENDING/UNCERTAIN', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockRejectedValueOnce(
      new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', true)
    );
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    const realQuery = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.variant) return q;
      return {
        ...q,
        findMany: async () => {
          throw new Error('db down');
        },
      };
    };
    expect(await codesOf(ships.retry(s.id, 'user:1'))).toEqual(['CARRIER_REQUEST_FAILED']);
    c.strapi.db.query = realQuery;
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(shipmentRows(c)[0]).toMatchObject({ status: 'PENDING', error: 'UNCERTAIN' });
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.order === id && h.type === 'SHIPMENT_FAILED')
    ).toHaveLength(0);
  });

  it('M5: tx2 finding the row FAILED keeps the returned externalId and raises SHIPMENT_STATE_CHANGED', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockImplementationOnce(async () => {
      shipmentRows(c)[0].status = 'FAILED';
      return {
        externalId: 'EXT-7',
        trackingCode: null,
        trackingUrl: null,
        cost: null,
        labelAvailable: false,
      };
    });
    expect(await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'))).toEqual([
      'SHIPMENT_STATE_CHANGED',
    ]);
    expect(shipmentRows(c)[0]).toMatchObject({ status: 'FAILED', externalId: 'EXT-7' });
    expect(shipEvents(c)).toHaveLength(0);
  });

  it('a FAILED/ORDER_CHANGED shipment the carrier created is cancelled at the carrier', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    adapter.createShipment.mockImplementationOnce(async () => {
      orderRow(c, id).orderStatus = 'CANCELLED';
      return {
        externalId: 'EXT-9',
        trackingCode: null,
        trackingUrl: null,
        cost: null,
        labelAvailable: false,
      };
    });
    await codesOf(ships.create(id, carrier(lineId, 2, 'k'), 'user:1'));
    const s = shipmentRows(c)[0];
    expect(s).toMatchObject({ status: 'FAILED', error: 'ORDER_CHANGED', externalId: 'EXT-9' });
    const cancelled = await ships.cancel(s.id, {}, 'user:1');
    expect(adapter.cancelShipment).toHaveBeenCalledWith('EXT-9', RUNTIME, { timeoutMs: 15000 });
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('EcommerceShipmentService.getLabel', () => {
  it('returns the carrier label of an ACTIVE shipment with a label', async () => {
    const { c, ships, adapter } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 2, 'k'), 'user:1');
    const label = await ships.getLabel(s.id);
    expect(label.filename).toBe('label.pdf');
    expect(label.content.toString()).toBe('PDF');
    expect(adapter.getLabel).toHaveBeenCalledWith(`EXT-LB-SHP-${s.id}`, RUNTIME, {
      timeoutMs: 15000,
    });
  });

  it('refuses without labelAvailable or when not ACTIVE', async () => {
    const { c, ships } = setup();
    const { id, lineId } = await paidOrder(c, 2, 'acme');
    const s = await ships.create(id, carrier(lineId, 1, 'k'), 'user:1');
    shipmentRows(c)[0].labelAvailable = false;
    expect(await codesOf(ships.getLabel(s.id))).toEqual(['LABEL_NOT_AVAILABLE']);
    shipmentRows(c)[0].labelAvailable = true;
    shipmentRows(c)[0].status = 'CANCELLED';
    expect(await codesOf(ships.getLabel(s.id))).toEqual(['LABEL_NOT_AVAILABLE']);
  });
});
