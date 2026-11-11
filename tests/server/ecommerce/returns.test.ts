import { describe, it, expect, beforeEach } from 'vitest';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

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
  return {
    c,
    ships: c.services.EcommerceShipmentService,
    returns: c.services.EcommerceReturnService,
  };
}

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const stockOf = (c: Commerce) => c.tables[UIDS.variant].find((v) => v.id === 10).stock as number;
const movements = (c: Commerce, type?: string) =>
  c.tables[UIDS.stockMovement].filter((m) => !type || m.type === type);

/** 3 × 2000 + 500 shipping, optionally with an order discount, paid in full. Stock 50 → 47. */
const paidOrder = async (
  c: Commerce,
  opts: {
    quantity?: number;
    orderDiscount?: number;
    lines?: { variantId: number; quantity: number }[];
  } = {}
) => {
  const quantity = opts.quantity ?? 3;
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: opts.lines ?? [{ variantId: 10, quantity }],
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  const row = orderRow(c, order.id);
  if (opts.orderDiscount) {
    row.orderDiscount = opts.orderDiscount;
    row.total -= opts.orderDiscount;
  }
  await c.payments.addManualPayment(
    order.id,
    { amount: row.total, idempotencyKey: `pay-${order.id}` },
    'user:1'
  );
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === order.id).id as number;
  return { id: order.id as number, lineId };
};

const ship = (c: Commerce, id: number, lineId: number, quantity: number, key = 's1') =>
  c.services.EcommerceShipmentService.create(
    id,
    {
      lines: [{ orderLineId: lineId, quantity }],
      method: { mode: 'MANUAL', carrierName: 'CTT' },
      shippingCost: 0,
      notifyCustomer: false,
      idempotencyKey: key,
    },
    'user:1'
  );

const ret = (
  lineId: number,
  quantity: number,
  restock: boolean,
  extra: Record<string, unknown> = {}
) => ({
  lines: [{ orderLineId: lineId, quantity, restock }],
  reason: 'Damaged',
  idempotencyKey: 'r1',
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
  throw err;
};

beforeEach(() => __resetEventHandlersForTests());

describe('EcommerceReturnService.register', () => {
  it('Review Focus 2: a return without restock is not restocked by a later cancel', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    expect(stockOf(c)).toBe(47);

    await returns.register(id, ret(lineId, 1, false), 'user:1');
    expect(stockOf(c)).toBe(47);
    expect(movements(c, 'RETURN_NO_RESTOCK')).toEqual([
      expect.objectContaining({
        quantity: 1,
        operationKey: expect.stringMatching(/^return:\d+:\d+$/),
      }),
    ]);

    await c.orders.cancel(id, 'user:1');
    const cancel = movements(c, 'CANCEL_RESTOCK');
    expect(cancel).toHaveLength(1);
    expect(cancel[0].quantity).toBe(2);
    expect(stockOf(c)).toBe(49);
  });

  it('a return with restock puts stock back, lowers the total and makes the value refundable', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    const before = orderRow(c, id).total;

    const res = await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(stockOf(c)).toBe(48);
    const m = movements(c, 'RETURN_RESTOCK');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      quantity: 1,
      operationKey: `return:${res.return.id}:${lineId}`,
      order: id,
    });
    expect(res.return).toMatchObject({
      grossValue: 2000,
      discountShare: 0,
      refundableValue: 2000,
      reason: 'Damaged',
      actor: 'user:1',
      items: [
        {
          orderLineId: lineId,
          sku: 'SH-M',
          name: 'Shirt',
          quantity: 1,
          restock: true,
          value: 2000,
        },
      ],
    });
    expect(res.refundable).toBe(2000);
    expect(orderRow(c, id).total).toBe(before - 2000);

    const view = await c.orders.get(id);
    expect(view.summary.excess).toBe(2000);
    expect(view.availableActions).toContain('REFUND');
    expect(view.lines[0]).toMatchObject({ returnedQuantity: 1, returnable: 2 });
    expect(view.returns).toEqual([
      expect.objectContaining({ id: res.return.id, refundableValue: 2000 }),
    ]);
  });

  it('the same idempotency key gives one return and one movement per line', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    const a = await returns.register(id, ret(lineId, 1, true), 'user:1');
    const b = await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(b.return.id).toBe(a.return.id);
    expect(c.tables[UIDS.orderReturn]).toHaveLength(1);
    expect(movements(c, 'RETURN_RESTOCK')).toHaveLength(1);
    expect(c.tables[UIDS.orderLine].find((l) => l.id === lineId).returnedQuantity).toBe(1);
    expect(c.events.filter((e) => e.type === 'RETURN_REGISTERED')).toHaveLength(1);
  });

  it('refuses more than shipped minus returned with QUANTITY_EXCEEDS_RETURNABLE', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 2);
    await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(
      await codesOf(returns.register(id, ret(lineId, 2, true, { idempotencyKey: 'r2' }), 'user:1'))
    ).toEqual(['QUANTITY_EXCEEDS_RETURNABLE']);
    expect(c.tables[UIDS.orderReturn]).toHaveLength(1);
  });

  it('changes neither the shipments nor the FulfillmentStatus', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    const shipments = JSON.parse(JSON.stringify(c.tables[UIDS.shipment]));
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');

    await returns.register(id, ret(lineId, 2, false), 'user:1');
    expect(c.tables[UIDS.shipment]).toEqual(shipments);
    expect(orderRow(c, id).fulfillmentStatus).toBe('FULFILLED');
  });

  it('takes the order discount share out of the stored orderDiscount', async () => {
    const { c, returns } = setup();
    // subtotal 6000, order discount 600, total 5900.
    const { id, lineId } = await paidOrder(c, { orderDiscount: 600 });
    await ship(c, id, lineId, 3);

    const res = await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(res.return).toMatchObject({
      grossValue: 2000,
      discountShare: 200,
      refundableValue: 1800,
    });
    expect(orderRow(c, id)).toMatchObject({
      subtotal: 4000,
      orderDiscount: 400,
      total: 4100,
    });
    expect(res.refundable).toBe(1800);
  });

  it('on a cancelled order records RETURN_NO_RESTOCK even when restock is asked', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    await c.orders.cancel(id, 'user:1');
    expect(stockOf(c)).toBe(50);

    const res = await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(stockOf(c)).toBe(50);
    expect(movements(c, 'RETURN_RESTOCK')).toHaveLength(0);
    expect(movements(c, 'RETURN_NO_RESTOCK')).toHaveLength(1);
    expect(res.return.items[0].restock).toBe(false);
  });

  it('refuses an empty reason or one longer than 200 characters', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    expect(
      await codesOf(returns.register(id, ret(lineId, 1, true, { reason: '  ' }), 'user:1'))
    ).toEqual(['required']);
    expect(
      await codesOf(
        returns.register(id, ret(lineId, 1, true, { reason: 'x'.repeat(201) }), 'user:1')
      )
    ).toEqual(['too_long']);
    expect(c.tables[UIDS.orderReturn]).toHaveLength(0);
    await returns.register(id, ret(lineId, 1, true, { reason: 'x'.repeat(200) }), 'user:1');
    expect(c.tables[UIDS.orderReturn]).toHaveLength(1);
  });

  it('refuses an ARCHIVED order with ACTION_NOT_AVAILABLE', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    orderRow(c, id).orderStatus = 'ARCHIVED';
    expect(await codesOf(returns.register(id, ret(lineId, 1, true), 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    expect(movements(c, 'RETURN_RESTOCK')).toHaveLength(0);
  });

  it('records RETURN_REGISTERED history and emits RETURN_REGISTERED', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    const res = await returns.register(
      id,
      ret(lineId, 2, false, { notes: 'box crushed' }),
      'user:1'
    );

    const h = c.tables[UIDS.orderHistory].filter((r) => r.type === 'RETURN_REGISTERED');
    expect(h).toHaveLength(1);
    expect(h[0].actor).toBe('user:1');
    expect(h[0].newValue).toMatchObject({
      returnId: res.return.id,
      lines: [{ orderLineId: lineId, quantity: 2, restock: false, value: 4000 }],
      refundableValue: 4000,
    });
    const ev = c.events.filter((e) => e.type === 'RETURN_REGISTERED');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      orderId: id,
      payload: { returnId: res.return.id, refundableValue: 4000 },
    });
    expect(res.return.notes).toBe('box crushed');
    expect(await returns.listForOrder(id)).toEqual([res.return]);
  });

  it('a return with restock followed by a cancel never restocks the returned unit twice', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    await returns.register(id, ret(lineId, 1, true), 'user:1');
    expect(stockOf(c)).toBe(48);

    await c.orders.cancel(id, 'user:1');
    const cancel = movements(c, 'CANCEL_RESTOCK');
    expect(cancel).toHaveLength(1);
    expect(cancel[0].quantity).toBe(2);
    expect(stockOf(c)).toBe(50);
  });

  it('a multi-line return: one movement per line, restock per line, discount share across lines', async () => {
    const { c, returns } = setup();
    c.tables[UIDS.variant].push({
      id: 11,
      product: 1,
      sku: 'SH-L',
      price: 1000,
      tax: 23,
      stock: 20,
      active: true,
    });
    // subtotal 3 × 2000 + 2 × 1000 = 8000, order discount 800.
    const { id } = await paidOrder(c, {
      orderDiscount: 800,
      lines: [
        { variantId: 10, quantity: 3 },
        { variantId: 11, quantity: 2 },
      ],
    });
    const lineOf = (variantId: number) =>
      c.tables[UIDS.orderLine].find((l) => l.order === id && l.variantId === variantId).id;
    const a = lineOf(10);
    const b = lineOf(11);
    await c.services.EcommerceShipmentService.create(
      id,
      {
        lines: [
          { orderLineId: a, quantity: 3 },
          { orderLineId: b, quantity: 2 },
        ],
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: 's1',
      },
      'user:1'
    );

    const res = await returns.register(
      id,
      {
        lines: [
          { orderLineId: b, quantity: 2, restock: false },
          { orderLineId: a, quantity: 1, restock: true },
        ],
        reason: 'Wrong size',
        idempotencyKey: 'r1',
      },
      'user:1'
    );
    expect(res.return).toMatchObject({
      grossValue: 4000,
      discountShare: 400,
      refundableValue: 3600,
      items: [
        { orderLineId: b, quantity: 2, restock: false, value: 2000 },
        { orderLineId: a, quantity: 1, restock: true, value: 2000 },
      ],
    });
    const rid = res.return.id;
    expect(
      movements(c)
        .filter((m) => String(m.operationKey).startsWith('return:'))
        .map((m) => [m.type, m.variantId, m.quantity, m.operationKey])
    ).toEqual([
      ['RETURN_NO_RESTOCK', 11, 2, `return:${rid}:${b}`],
      ['RETURN_RESTOCK', 10, 1, `return:${rid}:${a}`],
    ]);
    expect(stockOf(c)).toBe(48);
    expect(c.tables[UIDS.variant].find((v) => v.id === 11).stock).toBe(18);
    expect(orderRow(c, id)).toMatchObject({ subtotal: 4000, orderDiscount: 400 });
  });

  it('a second return with another key reads the returned quantity under the order lock', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    // The second request passes its pre-checks, then waits for the order lock while the first
    // commits. The real lock serializes them; the fake DB does not, so the interleaving is
    // scripted: the first return runs (and commits) before the second's transaction starts.
    const db = c.strapi.db;
    const transaction = db.transaction;
    db.transaction = async (cb: any) => {
      db.transaction = transaction;
      await returns.register(id, ret(lineId, 2, true, { idempotencyKey: 'r1' }), 'user:1');
      return transaction(cb);
    };
    expect(
      await codesOf(returns.register(id, ret(lineId, 2, true, { idempotencyKey: 'r2' }), 'user:1'))
    ).toEqual(['QUANTITY_EXCEEDS_RETURNABLE']);
    expect(c.tables[UIDS.orderReturn]).toHaveLength(1);
    expect(c.tables[UIDS.orderLine].find((l) => l.id === lineId).returnedQuantity).toBe(2);
    expect(movements(c, 'RETURN_RESTOCK')).toHaveLength(1);
  });

  it('refuses non-string notes with invalid', async () => {
    const { c, returns } = setup();
    const { id, lineId } = await paidOrder(c);
    await ship(c, id, lineId, 3);
    expect(
      await codesOf(returns.register(id, ret(lineId, 1, true, { notes: 42 }), 'user:1'))
    ).toEqual(['invalid']);
    expect(c.tables[UIDS.orderReturn]).toHaveLength(0);
  });
});
