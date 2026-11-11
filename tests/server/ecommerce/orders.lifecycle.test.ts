import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceReturnService from '../../../server/src/services/modules/ecommerce/returns';
import EcommerceInvoiceService from '../../../server/src/services/modules/ecommerce/invoices';
import EcommerceStoreCreditService from '../../../server/src/services/modules/ecommerce/storeCredits';
import EcommerceRefundService from '../../../server/src/services/modules/ecommerce/refunds';
import EcommercePaymentService from '../../../server/src/services/modules/ecommerce/payments';
import EcommerceOrderHistoryService from '../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import {
  createEventBus,
  __resetEventHandlersForTests,
} from '../../../server/src/services/modules/ecommerce/events';
import { computeCoverage } from '../../../server/src/services/modules/ecommerce/domain/orders';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  variantTranslation: `${P}variant-translation`,
  image: `${P}image`,
  customer: `${P}customer`,
  order: `${P}order`,
  orderLine: `${P}order-line`,
  payment: `${P}payment`,
  stockMovement: `${P}stock-movement`,
  orderHistory: `${P}order-history`,
  refund: `${P}refund`,
  notification: `${P}notification`,
  storeCredit: `${P}store-credit`,
  storeCreditMovement: `${P}store-credit-movement`,
  stripeSession: `${P}stripe-session`,
  shipment: `${P}shipment`,
  shipmentEvent: `${P}shipment-event`,
  orderReturn: `${P}order-return`,
  invoice: `${P}invoice`,
  invoiceAllocation: `${P}invoice-allocation`,
};

const RELATIONS: FakeRelations = {
  [UIDS.product]: {
    translations: [UIDS.productTranslation, 'product'],
    variants: [UIDS.variant, 'product'],
    images: [UIDS.image, 'product'],
  },
  [UIDS.variant]: {
    translations: [UIDS.variantTranslation, 'variant'],
    images: [UIDS.image, 'variant'],
  },
  [UIDS.customer]: { orders: [UIDS.order, 'customer'] },
  [UIDS.order]: {
    lines: [UIDS.orderLine, 'order'],
    payments: [UIDS.payment, 'order'],
    history: [UIDS.orderHistory, 'order'],
    customer: [UIDS.customer, 'customer', 'manyToOne'],
  },
  [UIDS.payment]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.shipment]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.orderReturn]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.invoice]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    creditedInvoice: [UIDS.invoice, 'creditedInvoice', 'manyToOne'],
  },
  [UIDS.invoiceAllocation]: {
    invoice: [UIDS.invoice, 'invoice', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
  },
  [UIDS.shipmentEvent]: {
    shipment: [UIDS.shipment, 'shipment', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
  },
};

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.stockMovement, UIDS.order, UIDS.payment],
  });
  let depth = 0;
  const transaction = vi.fn(async (cb: any) => {
    depth++;
    try {
      return await db.transaction(cb);
    } finally {
      depth--;
    }
  });
  const services: Record<string, any> = {};
  const bus = createEventBus(() => undefined);
  // Simulates a concurrent request: the next idempotencyKey lookup on payments misses.
  let missPaymentLookups = 0;
  // Simulates a concurrent transition that committed first: the next conditional order
  // update matches no row.
  let loseOrderUpdates = 0;
  /** Every write, in order, as `<uid suffix>.<method>` with its arguments. */
  const writes: { op: string; args: any }[] = [];
  const logged = (uid: string, q: any) => {
    const out = { ...q };
    for (const m of ['create', 'update', 'updateMany', 'delete', 'deleteMany']) {
      out[m] = async (args: any) => {
        writes.push({ op: `${uid.slice(P.length)}.${m}`, args });
        return q[m](args);
      };
    }
    return out;
  };
  const query = (uid: string) => {
    const q = logged(uid, db.query(uid));
    if (uid === UIDS.order) {
      return {
        ...q,
        updateMany: async (p: any) => {
          // Only the conditional status updates race; the row lock (by id alone) does not.
          if (loseOrderUpdates > 0 && p?.where?.orderStatus) {
            loseOrderUpdates--;
            return { count: 0 };
          }
          return q.updateMany(p);
        },
      };
    }
    if (uid !== UIDS.payment) return q;
    return {
      ...q,
      findOne: async (p: any) => {
        if (missPaymentLookups > 0 && p?.where?.idempotencyKey) {
          missPaymentLookups--;
          return null;
        }
        return q.findOne(p);
      },
    };
  };
  const strapi: any = {
    db: { query, transaction, connection: db.connection, getConnection: db.connection, metadata: db.metadata },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : { service: (name: string) => services[name] },
  };
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  services.EcommerceOrderHistoryService = EcommerceOrderHistoryService({ strapi });
  services.EcommerceShippingService = {
    findOption: async (_req: any, providerId: string, serviceId: string) => ({
      providerId,
      serviceId,
      name: 'Standard',
      price: 500,
      tax: 23,
    }),
  };
  services.EcommerceSettingsService = {
    getActiveProviders: async () => [],
    getStoreSettings: async () => ({ shippingCountries: ['PT'] }),
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  const orders = EcommerceOrderService({ strapi });
  services.EcommerceOrderService = orders;
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceReturnService = EcommerceReturnService({ strapi });
  services.EcommerceInvoiceService = EcommerceInvoiceService({ strapi });
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  const payments = EcommercePaymentService({ strapi });
  services.EcommercePaymentService = payments;

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push({ id: 1, product: 1, locale: 'en', name: 'Shirt' });
  t[UIDS.variant].push(
    { id: 10, product: 1, sku: 'SH-M', price: 2000, tax: 23, stock: 5, active: true },
    { id: 11, product: 1, sku: 'SH-L', price: 2500, tax: 23, stock: 1, active: true }
  );
  return {
    orders,
    payments,
    tables: t,
    bus,
    writes,
    depth: () => depth,
    missNextPaymentLookup: () => {
      missPaymentLookups = 1;
    },
    loseNextOrderUpdate: () => {
      loseOrderUpdates = 1;
    },
  };
}

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

/** Total 7000: 2 × 2000 + 1 × 2500 + 500 shipping. */
const createOrder = (orders: any) =>
  orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [
        { variantId: 10, quantity: 2 },
        { variantId: 11, quantity: 1 },
      ],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor: 'user:1', source: 'admin' }
  );

const stockOf = (tables: Record<string, any[]>, id: number) =>
  tables[UIDS.variant].find((v) => v.id === id).stock;

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

const ACTION_NOT_AVAILABLE = [{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }];

beforeEach(() => __resetEventHandlersForTests());

describe('computeCoverage (value-based, design 4.4)', () => {
  const line = (id: number, quantity: number, unitPrice: number, extra = {}) => ({
    id,
    unitPrice,
    unitDiscount: 0,
    quantity,
    returnedQuantity: 0,
    tax: 23,
    ...extra,
  });
  // The test order: 2 × 2000 + 1 × 2500 + 500 shipping = 7000.
  const base = (
    extra: Partial<{ lines: any[]; shippingTotal: number; orderDiscount: number }> = {}
  ) => ({
    lines: [line(1, 2, 2000), line(2, 1, 2500)],
    orderDiscount: 0,
    shippingTotal: 500,
    shippingTax: 23,
    ...extra,
  });
  // After a modification: +1 line of 1500 and shipping 500 → 900.
  const modified = () =>
    base({ lines: [line(1, 2, 2000), line(2, 1, 2500), line(3, 1, 1500)], shippingTotal: 900 });
  const sum = (c: any) => c.lines.reduce((s: number, l: any) => s + l.value, 0) + c.shipping.value;

  it('pays 3500 then 3500: each payment covers half of every item', () => {
    const first = computeCoverage(base(), [], 3500);
    expect(first).toEqual({
      lines: [
        { orderLineId: 1, value: 2000, unitPrice: 2000, unitDiscount: 0, tax: 23 },
        { orderLineId: 2, value: 1250, unitPrice: 2500, unitDiscount: 0, tax: 23 },
      ],
      shipping: { value: 250, tax: 23 },
      amount: 3500,
      coveredValue: 3500,
    });
    const second = computeCoverage(base(), [{ coverage: first }], 3500);
    expect(second).toEqual(first);
    expect(sum(first)).toBe(3500);
    expect(sum(second)).toBe(3500);
  });

  it('pays 7000, modification (+1500 line, +400 shipping), pays 1900: covers only the new items', () => {
    const first = computeCoverage(base(), [], 7000);
    expect(first.coveredValue).toBe(7000);
    const second = computeCoverage(modified(), [{ coverage: first }], 1900);
    expect(second).toEqual({
      lines: [{ orderLineId: 3, value: 1500, unitPrice: 1500, unitDiscount: 0, tax: 23 }],
      shipping: { value: 400, tax: 23 },
      amount: 1900,
      coveredValue: 1900,
    });
  });

  it('pays 3500, modification (+1500, +400), pays 5400: covers the remaining half and the new items', () => {
    const first = computeCoverage(base(), [], 3500);
    const second = computeCoverage(modified(), [{ coverage: first }], 5400);
    expect(second).toEqual({
      lines: [
        { orderLineId: 1, value: 2000, unitPrice: 2000, unitDiscount: 0, tax: 23 },
        { orderLineId: 2, value: 1250, unitPrice: 2500, unitDiscount: 0, tax: 23 },
        { orderLineId: 3, value: 1500, unitPrice: 1500, unitDiscount: 0, tax: 23 },
      ],
      shipping: { value: 650, tax: 23 },
      amount: 5400,
      coveredValue: 5400,
    });
  });

  it('overpaying 8000 on 7000 covers 7000; the excess stays uncovered', () => {
    const c = computeCoverage(base(), [], 8000);
    expect(c.coveredValue).toBe(7000);
    expect(c.amount).toBe(8000);
    expect(sum(c)).toBe(7000);
    expect(c.shipping.value).toBe(500);
  });

  it('spreads the order discount by net value so lines + shipping equal the total exactly', () => {
    // Discount 1000 over 4000/2500: 615.38 → 615, 384.62 → 385 (largest remainder).
    const c = computeCoverage(base({ orderDiscount: 1000 }), [], 6000);
    expect(c.lines.map((l) => l.value)).toEqual([3385, 2115]);
    expect(c.shipping.value).toBe(500);
    expect(c.coveredValue).toBe(6000);
    // A later payment has nothing left to cover.
    expect(computeCoverage(base({ orderDiscount: 1000 }), [{ coverage: c }], 100)).toMatchObject({
      lines: [],
      shipping: { value: 0 },
      coveredValue: 0,
    });
  });

  it('breaks ties by line position, shipping last; ignores returns and malformed coverages', () => {
    const order = base({
      lines: [line(1, 1, 100), line(2, 1, 100), line(9, 1, 700, { returnedQuantity: 1 })],
      shippingTotal: 100,
    });
    const junk = [{ coverage: null }, { coverage: { garbage: true } }, {}];
    expect(computeCoverage(order, junk, 1).lines).toEqual([
      { orderLineId: 1, value: 1, unitPrice: 100, unitDiscount: 0, tax: 23 },
    ]);
    const two = computeCoverage(order, junk, 2);
    expect(two.lines.map((l) => [l.orderLineId, l.value])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(two.shipping.value).toBe(0);
  });
});

describe('EcommercePaymentService.addManualPayment', () => {
  it('a full payment makes the order PAID and SHIP available, with coverage, history and an event', async () => {
    const { orders, payments, tables, bus, depth } = setup();
    const { id } = await createOrder(orders);
    const events: any[] = [];
    bus.subscribe('PAYMENT_COMPLETED', async (e) => {
      events.push({ ...e, depth: depth() });
    });

    const view = await payments.addManualPayment(
      id,
      { amount: 7000, reference: 'TRF-1', methodLabel: 'Bank transfer', idempotencyKey: 'k1' },
      'user:1'
    );
    expect(view).toMatchObject({
      id: expect.any(Number),
      method: 'MANUAL',
      status: 'COMPLETED',
      amount: 7000,
      reference: 'TRF-1',
      externalId: null,
      completedAt: expect.any(String),
      methodLabel: 'Bank transfer',
    });

    const row = tables[UIDS.payment][0];
    expect(row).toMatchObject({
      order: id,
      method: 'MANUAL',
      status: 'COMPLETED',
      amount: 7000,
      currency: 'EUR',
      actor: 'user:1',
      idempotencyKey: 'k1',
      metadata: { methodLabel: 'Bank transfer' },
    });
    const [l1, l2] = tables[UIDS.orderLine];
    expect(row.coverage).toEqual({
      lines: [
        { orderLineId: l1.id, value: 4000, unitPrice: 2000, unitDiscount: 0, tax: 23 },
        { orderLineId: l2.id, value: 2500, unitPrice: 2500, unitDiscount: 0, tax: 23 },
      ],
      shipping: { value: 500, tax: 23 },
      amount: 7000,
      coveredValue: 7000,
    });

    const order = await orders.get(id);
    expect(order.paymentStatus).toBe('PAID');
    expect(order.availableActions).toContain('SHIP');
    expect(order.availableActions).not.toContain('ADD_PAYMENT');
    expect(order.summary).toMatchObject({ paid: 7000, due: 0, excess: 0 });
    expect(order.payments[0]).toMatchObject({ methodLabel: 'Bank transfer' });

    const types = tables[UIDS.orderHistory].map((h) => h.type);
    expect(types).toEqual([
      'ORDER_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_COMPLETED',
      'PAYMENT_STATUS_CHANGED',
    ]);
    const opIds = new Set(tables[UIDS.orderHistory].slice(1).map((h) => h.operationId));
    expect(opIds.size).toBe(1);
    expect([...opIds][0]).toEqual(expect.any(String));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'PAYMENT_COMPLETED',
      orderId: id,
      depth: 0,
      payload: { paymentId: view.id, amount: 7000, method: 'MANUAL' },
    });
  });

  it('a partial payment makes the order PARTIALLY_PAID and ADD_PAYMENT stays available', async () => {
    const { orders, payments } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 3000, idempotencyKey: 'k1' }, 'user:1');
    const order = await orders.get(id);
    expect(order.paymentStatus).toBe('PARTIALLY_PAID');
    expect(order.summary).toMatchObject({ paid: 3000, due: 4000 });
    expect(order.availableActions).toContain('ADD_PAYMENT');
    expect(order.availableActions).not.toContain('SHIP');
  });

  it('two payments of 3500 on the 7000 order each cover half of every item', async () => {
    const { orders, payments, tables } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 3500, idempotencyKey: 'a' }, 'user:1');
    await payments.addManualPayment(id, { amount: 3500, idempotencyKey: 'b' }, 'user:1');
    const [a, b] = tables[UIDS.payment].map((p) => p.coverage);
    expect(a.lines.map((l: any) => l.value)).toEqual([2000, 1250]);
    expect(a.shipping.value).toBe(250);
    expect(b).toEqual(a);
    expect((await orders.get(id)).paymentStatus).toBe('PAID');
  });

  it('accepts a string orderId (route param) for replays and new payments', async () => {
    const { orders, payments, tables } = setup();
    const { id } = await createOrder(orders);
    const a = await payments.addManualPayment(
      String(id) as any,
      { amount: 1000, idempotencyKey: 's' },
      'user:1'
    );
    const b = await payments.addManualPayment(
      String(id) as any,
      { amount: 1000, idempotencyKey: 's' },
      'user:1'
    );
    expect(b).toEqual(a);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.payment][0].order).toBe(id);
  });

  it('Review Focus 3: the same idempotencyKey twice (double click) keeps a single payment', async () => {
    const { orders, payments, tables, bus } = setup();
    const { id } = await createOrder(orders);
    const events: any[] = [];
    bus.subscribe('PAYMENT_COMPLETED', async (e) => {
      events.push(e);
    });
    const input = { amount: 7000, reference: 'TRF-1', idempotencyKey: 'dbl' };
    const a = await payments.addManualPayment(id, input, 'user:1');
    // The order is now PAID (ADD_PAYMENT gone): the replay must still return the payment.
    const b = await payments.addManualPayment(id, input, 'user:1');
    expect(b).toEqual(a);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_CREATED')).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('returns the existing payment when a concurrent duplicate wins the unique key', async () => {
    const { orders, payments, tables, missNextPaymentLookup } = setup();
    const { id } = await createOrder(orders);
    const first = await payments.addManualPayment(
      id,
      { amount: 1000, idempotencyKey: 'race' },
      'user:1'
    );
    // The pre-check misses the row (the other request had not committed yet): the insert
    // hits the unique index and the stored payment is returned, with nothing else written.
    missNextPaymentLookup();
    const again = await payments.addManualPayment(
      id,
      { amount: 1000, idempotencyKey: 'race' },
      'user:1'
    );
    expect(again.id).toBe(first.id);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_CREATED')).toHaveLength(1);
  });

  it('rejects an idempotencyKey already used on another order', async () => {
    const { orders, payments, tables } = setup();
    const a = await createOrder(orders);
    tables[UIDS.variant].forEach((v) => (v.stock = 10));
    const b = await createOrder(orders);
    await payments.addManualPayment(a.id, { amount: 100, idempotencyKey: 'shared' }, 'user:1');
    expect(
      await issues(
        payments.addManualPayment(b.id, { amount: 100, idempotencyKey: 'shared' }, 'user:1')
      )
    ).toEqual([{ path: 'idempotencyKey', code: 'IDEMPOTENCY_KEY_CONFLICT' }]);
    expect(tables[UIDS.payment]).toHaveLength(1);
  });

  it('validates amount and idempotencyKey', async () => {
    const { orders, payments, tables } = setup();
    const { id } = await createOrder(orders);
    for (const amount of [0, -5, 10.5, Number.NaN, '100' as any, 1_000_000_001]) {
      expect(
        await issues(payments.addManualPayment(id, { amount, idempotencyKey: 'k' }, 'user:1'))
      ).toEqual([{ path: 'amount', code: 'invalid_amount' }]);
    }
    expect(await issues(payments.addManualPayment(id, { amount: 100 } as any, 'user:1'))).toEqual([
      { path: 'idempotencyKey', code: 'required' },
    ]);
    expect(tables[UIDS.payment]).toHaveLength(0);
  });

  it('accepts an amount of exactly 1_000_000_000 cents (the upper bound)', async () => {
    const { orders, payments } = setup();
    const { id } = await createOrder(orders);
    const p = await payments.addManualPayment(id, { amount: 1_000_000_000, idempotencyKey: 'max' }, 'user:1');
    expect(p.amount).toBe(1_000_000_000);
  });

  it('accepts an amount above the due: the excess becomes refundable', async () => {
    const { orders, payments } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 8000, idempotencyKey: 'k' }, 'user:1');
    const order = await orders.get(id);
    expect(order.paymentStatus).toBe('PAID');
    expect(order.summary).toMatchObject({ due: 0, excess: 1000 });
    expect(order.availableActions).toContain('REFUND');
  });

  it('is not available on a cancelled order', async () => {
    const { orders, payments, tables } = setup();
    const { id } = await createOrder(orders);
    await orders.cancel(id, 'user:1');
    expect(
      await issues(payments.addManualPayment(id, { amount: 100, idempotencyKey: 'k' }, 'user:1'))
    ).toEqual(ACTION_NOT_AVAILABLE);
    expect(tables[UIDS.payment]).toHaveLength(0);
  });
});

describe('EcommerceOrderService.cancel', () => {
  it('restocks every deducted unit once; a second cancel fails without effects (Review Focus 2)', async () => {
    const { orders, tables, bus, depth } = setup();
    const { id } = await createOrder(orders);
    expect(stockOf(tables, 10)).toBe(3);
    expect(stockOf(tables, 11)).toBe(0);
    const events: any[] = [];
    bus.subscribe('ORDER_CANCELLED', async (e) => {
      events.push({ ...e, depth: depth() });
    });

    const view = await orders.cancel(id, 'user:1');
    expect(view.orderStatus).toBe('CANCELLED');
    expect(view.cancelledAt).toEqual(expect.any(String));
    expect(stockOf(tables, 10)).toBe(5);
    expect(stockOf(tables, 11)).toBe(1);
    expect(
      tables[UIDS.stockMovement]
        .filter((m) => m.type === 'CANCEL_RESTOCK')
        .map((m) => [m.operationKey, m.quantity, m.order, m.actor])
    ).toEqual([
      [`cancel:${id}:10`, 2, id, 'user:1'],
      [`cancel:${id}:11`, 1, id, 'user:1'],
    ]);
    const types = tables[UIDS.orderHistory].map((h) => h.type);
    expect(types).toEqual(['ORDER_CREATED', 'ORDER_CANCELLED', 'ORDER_STATUS_CHANGED']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'ORDER_CANCELLED',
      orderId: id,
      depth: 0,
      payload: { amountPaid: 0 },
    });

    const movements = tables[UIDS.stockMovement].length;
    const history = tables[UIDS.orderHistory].length;
    expect(await issues(orders.cancel(id, 'user:1'))).toEqual(ACTION_NOT_AVAILABLE);
    expect(stockOf(tables, 10)).toBe(5);
    expect(stockOf(tables, 11)).toBe(1);
    expect(tables[UIDS.stockMovement]).toHaveLength(movements);
    expect(tables[UIDS.orderHistory]).toHaveLength(history);
    expect(events).toHaveLength(1);
  });

  it('cancels an order whose variant was deleted: records the movement, restocks the rest', async () => {
    const { orders, tables } = setup();
    const { id } = await createOrder(orders);
    // The variant row is gone (e.g. removed from its product after the order closed).
    tables[UIDS.variant] = tables[UIDS.variant].filter((v) => v.id !== 11);
    const view = await orders.cancel(id, 'user:1');
    expect(view.orderStatus).toBe('CANCELLED');
    expect(stockOf(tables, 10)).toBe(5);
    const restock = tables[UIDS.stockMovement].filter((m) => m.type === 'CANCEL_RESTOCK');
    expect(restock.map((m) => [m.variant, m.variantId, m.quantity])).toEqual([
      [10, 10, 2],
      [null, 11, 1],
    ]);
  });

  it('a concurrent cancel that committed first makes this one fail with no effects', async () => {
    const { orders, tables, bus, loseNextOrderUpdate } = setup();
    const { id } = await createOrder(orders);
    const events: any[] = [];
    bus.subscribe('*', async (e) => {
      events.push(e);
    });
    const movements = tables[UIDS.stockMovement].length;
    const history = tables[UIDS.orderHistory].length;
    loseNextOrderUpdate();
    expect(await issues(orders.cancel(id, 'user:1'))).toEqual(ACTION_NOT_AVAILABLE);
    expect(tables[UIDS.stockMovement]).toHaveLength(movements);
    expect(tables[UIDS.orderHistory]).toHaveLength(history);
    expect(stockOf(tables, 10)).toBe(3);
    expect(events).toHaveLength(0);
  });

  it('records only the restocks actually applied', async () => {
    const { orders, tables } = setup();
    const { id } = await createOrder(orders);
    // A crashed earlier attempt already wrote variant 11's restock key.
    tables[UIDS.stockMovement].push({
      id: 98,
      variantId: 11,
      order: null,
      type: 'MANUAL_ADJUST',
      quantity: 0,
      operationKey: `cancel:${id}:11`,
    });
    await orders.cancel(id, 'user:1');
    const entry = tables[UIDS.orderHistory].find((h) => h.type === 'ORDER_CANCELLED');
    expect(entry.newValue.restocked).toEqual([{ variantId: 10, quantity: 2 }]);
  });

  it('cancelled and paid: REFUND is available and excess equals paid', async () => {
    const { orders, payments, bus } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'k' }, 'user:1');
    const events: any[] = [];
    bus.subscribe('ORDER_CANCELLED', async (e) => {
      events.push(e);
    });
    await orders.cancel(id, 'user:1');
    const order = await orders.get(id);
    expect(order.availableActions).toEqual(['REFUND']);
    expect(order.summary).toMatchObject({ paid: 7000, excess: 7000, due: 0 });
    expect(events[0].payload).toMatchObject({ amountPaid: 7000 });
  });

  it('only restocks what the order still holds', async () => {
    const { orders, tables } = setup();
    const { id } = await createOrder(orders);
    // A previous partial restock of variant 10 (e.g. a modification) already returned 1 unit.
    tables[UIDS.stockMovement].push({
      id: 99,
      variantId: 10,
      order: id,
      type: 'ORDER_RESTOCK',
      quantity: 1,
      operationKey: 'x',
    });
    await orders.cancel(id, 'user:1');
    const restock = tables[UIDS.stockMovement].filter((m) => m.type === 'CANCEL_RESTOCK');
    expect(restock.map((m) => [m.variantId, m.quantity])).toEqual([
      [10, 1],
      [11, 1],
    ]);
  });
});

describe('EcommerceOrderService.archive', () => {
  it('is not available on an UNFULFILLED order', async () => {
    const { orders, payments, tables } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'k' }, 'user:1');
    const history = tables[UIDS.orderHistory].length;
    expect(await issues(orders.archive(id, 'user:1'))).toEqual(ACTION_NOT_AVAILABLE);
    expect(tables[UIDS.order][0].orderStatus).toBe('OPEN');
    expect(tables[UIDS.orderHistory]).toHaveLength(history);
  });

  it('archives when ARCHIVE is available, with history and an event', async () => {
    const { orders, payments, tables, bus } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'k' }, 'user:1');
    // Shipments arrive in plan 4: simulate a fully shipped (and, with no shipment rows,
    // fully delivered) order through the stored status.
    tables[UIDS.order][0].fulfillmentStatus = 'FULFILLED';
    const events: any[] = [];
    bus.subscribe('ORDER_ARCHIVED', async (e) => {
      events.push(e);
    });
    const view = await orders.archive(id, 'user:1');
    expect(view.orderStatus).toBe('ARCHIVED');
    expect(view.archivedAt).toEqual(expect.any(String));
    expect(view.availableActions).toEqual([]);
    expect(tables[UIDS.orderHistory].map((h) => h.type)).toContain('ORDER_ARCHIVED');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ORDER_ARCHIVED', orderId: id });
  });
});

describe('order-level writes take a row lock first', () => {
  const LOCK = (id: number) => ({
    op: 'order.updateMany',
    args: { where: { id }, data: { updatedAt: expect.any(Date) } },
  });

  it('addManualPayment', async () => {
    const { orders, payments, writes } = setup();
    const { id } = await createOrder(orders);
    writes.length = 0;
    await payments.addManualPayment(id, { amount: 1000, idempotencyKey: 'lock-1' }, 'user:1');
    expect(writes[0]).toEqual(LOCK(id));
  });

  it('cancel', async () => {
    const { orders, writes } = setup();
    const { id } = await createOrder(orders);
    writes.length = 0;
    await orders.cancel(id, 'user:1');
    expect(writes[0]).toEqual(LOCK(id));
  });

  it('archive', async () => {
    const { orders, payments, tables, writes } = setup();
    const { id } = await createOrder(orders);
    await payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'k' }, 'user:1');
    tables[UIDS.order][0].fulfillmentStatus = 'FULFILLED';
    writes.length = 0;
    await orders.archive(id, 'user:1');
    expect(writes[0]).toEqual(LOCK(id));
  });

  it('applyModification', async () => {
    const { orders, tables, writes } = setup();
    const { id } = await createOrder(orders);
    const lines = tables[UIDS.orderLine]
      .filter((l) => l.order === id)
      .map((l) => ({ orderLineId: l.id, variantId: l.variantId, quantity: 1 }));
    writes.length = 0;
    await orders.applyModification(id, { lines, shipping: { mode: 'KEEP' } }, 'user:1', 'op-lock-0001');
    expect(writes[0]).toEqual(LOCK(id));
  });
});
