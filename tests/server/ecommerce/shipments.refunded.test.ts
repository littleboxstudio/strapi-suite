import { describe, it, expect, beforeEach } from 'vitest';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

/**
 * Units an INVOICED refund holds never ship (they come off the unshipped units first): the ship
 * modal, the SHIP action, the shipment validation and the fulfillment status all leave them out.
 */

const actor = 'user:1';
const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

beforeEach(() => __resetEventHandlersForTests());

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

const codesOf = async (p: Promise<unknown>): Promise<string[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors.map((x) => x.code);
    throw e;
  }
  return [];
};

/** `quantity` × 2000 + shipping, paid in full and fully invoiced (invoice 900). */
const invoicedOrder = async (quantity: number) => {
  const c = setupCommerce();
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor, source: 'admin' }
  );
  const id = order.id as number;
  const row = orderRow(c, id);
  await c.payments.addManualPayment(id, { amount: row.total, idempotencyKey: 'pay-1' }, actor);
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === id).id as number;
  const shippingLine = row.shippingLines.lines[0];
  c.services.EcommerceSettingsService.getActiveProviders = async (category: string) =>
    category === 'billing' ? ['moloni'] : [];
  c.tables[UIDS.invoice].push({
    id: 900,
    order: id,
    provider: 'moloni',
    kind: 'INVOICE',
    status: 'ISSUED',
    creditedInvoice: null,
    number: 'FR 2026/900',
    lines: {
      lines: [
        { orderLineId: lineId, kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity, total: quantity * 2000, tax: 23, partial: false, discountShare: 0 },
        { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: row.total - quantity * 2000, tax: 23, partial: false, shippingLineId: shippingLine.id },
      ],
    },
    metadata: null,
  });
  return { c, id, lineId };
};

/** An INVOICED manual-transfer refund of `units` units of the line. */
const refundUnits = async (c: Commerce, id: number, units: number, key = 'ref-1') => {
  const [refund] = await c.refunds.create(
    id,
    {
      method: 'MANUAL_TRANSFER',
      scope: 'INVOICED',
      amount: units * 2000,
      items: [{ invoiceId: 900, index: 0, quantity: units }],
      reason: 'GOODWILL',
      idempotencyKey: key,
    } as any,
    actor
  );
  return refund;
};

const ship = (c: Commerce, id: number, lineId: number, quantity: number, key = 's1') =>
  c.services.EcommerceShipmentService.create(
    id,
    {
      lines: [{ orderLineId: lineId, quantity }],
      method: { mode: 'MANUAL', carrierName: 'CTT' },
      notifyCustomer: false,
      idempotencyKey: key,
    },
    actor
  );

const lineOf = async (c: Commerce, id: number, lineId: number) =>
  (await c.orders.computeOrderState(id)).lines.find((l) => l.id === lineId)!;

describe('Refunded units never ship', () => {
  it('a line of 2 with 1 unshipped unit refunded: 1 pending and shippable, 2 refused, 1 fulfills it', async () => {
    const { c, id, lineId } = await invoicedOrder(2);
    await refundUnits(c, id, 1);
    const state = await c.orders.computeOrderState(id);
    expect(state.lines.find((l) => l.id === lineId)).toMatchObject({
      quantity: 2,
      refundCredited: 1,
      pending: 1,
      shippable: 1,
    });
    expect(state.actions).toContain('SHIP');

    expect(await codesOf(ship(c, id, lineId, 2))).toEqual(['QUANTITY_EXCEEDS_PENDING']);
    expect(c.tables[UIDS.shipment]).toEqual([]);

    await ship(c, id, lineId, 1, 's2');
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    const after = await c.orders.computeOrderState(id);
    expect(after.lines.find((l) => l.id === lineId)).toMatchObject({ pending: 0, shippable: 0 });
    expect(after.actions).not.toContain('SHIP');
  });

  it('a line of 1 fully refunded and unshipped: SHIP is not offered and the order stays unfulfilled', async () => {
    const { c, id, lineId } = await invoicedOrder(1);
    await refundUnits(c, id, 1);
    const state = await c.orders.computeOrderState(id);
    expect(state.lines.find((l) => l.id === lineId)).toMatchObject({ pending: 0, shippable: 0 });
    expect(state.actions).not.toContain('SHIP');
    expect(orderRow(c, id).fulfillmentStatus).toBe('UNFULFILLED');
    expect(await codesOf(ship(c, id, lineId, 1))).toEqual(['QUANTITY_EXCEEDS_PENDING']);
  });

  it('a refund after shipping (Q=1, shipped 1, refunded 1) changes nothing', async () => {
    const { c, id, lineId } = await invoicedOrder(1);
    await ship(c, id, lineId, 1);
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    await refundUnits(c, id, 1);
    expect(await lineOf(c, id, lineId)).toMatchObject({ shipped: 1, refundCredited: 1, pending: 0, shippable: 0 });
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.type === 'FULFILLMENT_STATUS_CHANGED')
    ).toHaveLength(1);
  });

  it('a removed refund restores the units to ship', async () => {
    const { c, id, lineId } = await invoicedOrder(2);
    const refund = await refundUnits(c, id, 1);
    expect(await lineOf(c, id, lineId)).toMatchObject({ pending: 1 });
    await c.refunds.remove(refund.id, actor);
    expect(await lineOf(c, id, lineId)).toMatchObject({ refundCredited: 0, pending: 2, shippable: 2 });
  });

  it('a refund of the unit left after a partial shipment fulfills the order; removing it does not', async () => {
    const { c, id, lineId } = await invoicedOrder(2);
    await ship(c, id, lineId, 1);
    expect(orderRow(c, id).fulfillmentStatus).toBe('PARTIALLY_FULFILLED');
    const refund = await refundUnits(c, id, 1);
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
    expect((await c.orders.computeOrderState(id)).actions).not.toContain('SHIP');
    await c.refunds.remove(refund.id, actor);
    expect(orderRow(c, id).fulfillmentStatus).toBe('PARTIALLY_FULFILLED');
    expect(await lineOf(c, id, lineId)).toMatchObject({ pending: 1 });
  });
});
