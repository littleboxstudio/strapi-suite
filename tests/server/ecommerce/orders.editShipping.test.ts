import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import EcommerceOrderEditingService from '../../../server/src/services/modules/ecommerce/orderEditing';
import EcommerceShippingService from '../../../server/src/services/modules/ecommerce/shipping';
import EcommerceStoreCreditService from '../../../server/src/services/modules/ecommerce/storeCredits';
import EcommerceRefundService from '../../../server/src/services/modules/ecommerce/refunds';
import EcommercePaymentService from '../../../server/src/services/modules/ecommerce/payments';
import EcommerceOrderHistoryService from '../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceReturnService from '../../../server/src/services/modules/ecommerce/returns';
import EcommerceInvoiceService from '../../../server/src/services/modules/ecommerce/invoices';
import {
  createEventBus,
  __resetEventHandlersForTests,
} from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb, type FakeRelations } from './helpers/fakeDb';
import {
  PROMOTION_UIDS,
  promotionRelations,
  registerPromotionService,
} from './helpers/promotionFakes';

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
  shipment: `${P}shipment`,
  shipmentEvent: `${P}shipment-event`,
  orderReturn: `${P}order-return`,
  invoice: `${P}invoice`,
  invoiceAllocation: `${P}invoice-allocation`,
  ...PROMOTION_UIDS,
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
  ...promotionRelations({ order: UIDS.order, customer: UIDS.customer }),
};

/** Manual method 1: up to 1 kg 500, up to 5 kg 900, above 1500 (PT and ES). */
const BRACKETS = [
  { upTo: 1, price: 500 },
  { upTo: 5, price: 900 },
  { upTo: null, price: 1500 },
];

function setup() {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.stockMovement, UIDS.order, UIDS.payment, UIDS.orderHistory],
  });
  const services: Record<string, any> = {};
  // Simulates a concurrent request: the next N history lookups by uniqueKey miss.
  const misses = { uniqueKeyLookups: 0 };
  const query = (uid: string) => {
    const q = db.query(uid);
    if (uid !== UIDS.orderHistory) return q;
    return {
      ...q,
      findOne: async (p: any) => {
        if (misses.uniqueKeyLookups > 0 && p?.where?.uniqueKey) {
          misses.uniqueKeyLookups--;
          return null;
        }
        return q.findOne(p);
      },
    };
  };
  const bus = createEventBus(() => undefined);
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const strapi: any = {
    log,
    db: {
      query,
      transaction: db.transaction,
      connection: db.connection,
      getConnection: db.connection,
      metadata: db.metadata,
    },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : { service: (name: string) => services[name] },
  };
  const methods = [
    {
      id: 1,
      name: { en: 'Standard' },
      rates: { PT: BRACKETS, ES: BRACKETS } as Record<string, typeof BRACKETS>,
      tax: 23,
      active: true,
      position: 0,
      deletable: false,
    },
    {
      id: 2,
      name: { en: 'Express' },
      rates: { PT: [{ upTo: null, price: 1200 }] } as Record<string, typeof BRACKETS>,
      tax: 6,
      active: true,
      position: 1,
      deletable: true,
    },
  ];
  services.EcommerceSettingsService = {
    getActiveProviders: async () => ['manual'],
    getStoreSettings: async () => ({ markets: ['PT', 'ES'] }),
    listManualMethods: async () => methods,
    getRuntime: async () => null,
  };
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  services.EcommerceOrderHistoryService = EcommerceOrderHistoryService({ strapi });
  services.EcommerceShippingService = EcommerceShippingService({ strapi });
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  const orders = EcommerceOrderService({ strapi });
  services.EcommerceOrderService = orders;
  const editing = EcommerceOrderEditingService({ strapi });
  services.EcommerceOrderEditingService = editing;
  registerPromotionService(strapi, services);
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceReturnService = EcommerceReturnService({ strapi });
  services.EcommerceInvoiceService = EcommerceInvoiceService({ strapi });
  const payments = EcommercePaymentService({ strapi });
  services.EcommercePaymentService = payments;
  const findOption = vi.spyOn(services.EcommerceShippingService, 'findOption');
  const quote = vi.spyOn(services.EcommerceShippingService, 'quote');

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push(
    { id: 1, product: 1, locale: 'en', name: 'Shirt' },
    { id: 2, product: 1, locale: 'pt', name: 'Camisa' }
  );
  t[UIDS.variant].push(
    { id: 10, product: 1, sku: 'SH-M', price: 2000, tax: 23, stock: 10, active: true, weight: 0.2 },
    { id: 11, product: 1, sku: 'SH-L', price: 2500, tax: 23, stock: 1, active: true, weight: 0.25 },
    {
      id: 12,
      product: 1,
      sku: 'SH-XL',
      price: 1500,
      tax: 23,
      stock: 10,
      active: true,
      weight: 0.3,
    },
    { id: 13, product: 1, sku: 'SH-XS', price: 1000, tax: 23, stock: 10, active: false }
  );
  t[UIDS.variantTranslation].push({ id: 1, variant: 12, locale: 'en', option: 'Extra large' });
  t[UIDS.image].push(
    { id: 1, product: 1, url: '/p1.jpg', position: 0 },
    { id: 2, variant: 12, url: '/v12.jpg', position: 0 }
  );
  return { orders, editing, payments, tables: t, bus, findOption, quote, methods, misses, log };
}

type Ctx = ReturnType<typeof setup>;

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

/** Total 7000: 2 × 2000 + 1 × 2500 + 500 shipping (0.65 kg). */
const createOrder = async (
  ctx: Ctx,
  lines = [
    { variantId: 10, quantity: 2 },
    { variantId: 11, quantity: 1 },
  ],
  locale = 'en'
): Promise<number> => {
  const created = await ctx.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale,
      lines,
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  return created.id;
};

const linesOf = (ctx: Ctx, orderId: number) =>
  ctx.tables[UIDS.orderLine].filter((l) => l.order === orderId);
const historyOf = (ctx: Ctx, orderId: number, type?: string) =>
  ctx.tables[UIDS.orderHistory].filter((h) => h.order === orderId && (!type || h.type === type));
const orderRow = (ctx: Ctx, id: number) => ctx.tables[UIDS.order].find((o) => o.id === id);
const flagsOf = (ctx: Ctx, id: number) => orderRow(ctx, id).reviewFlags?.flags ?? [];
const flag = (ctx: Ctx, id: number, code: string) =>
  flagsOf(ctx, id).find((f: any) => f.code === code);

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

/** An ACTIVE shipment of the given lines (every line by default), delivered. */
const ship = (ctx: Ctx, orderId: number, shippingCost: number, variantIds?: number[]) => {
  const lines = linesOf(ctx, orderId).filter(
    (l) => !variantIds || variantIds.includes(l.variantId)
  );
  ctx.tables[UIDS.shipment].push({
    id: ctx.tables[UIDS.shipment].length + 1,
    order: orderId,
    providerId: 'manual',
    carrierName: 'CTT',
    status: 'ACTIVE',
    deliveryStatus: 'DELIVERED',
    items: {
      lines: lines.map((l) => ({
        orderLineId: l.id,
        sku: l.sku,
        name: l.name,
        option: null,
        quantity: l.quantity,
      })),
    },
    shippingCost,
    idempotencyKey: `ship-${orderId}-${ctx.tables[UIDS.shipment].length + 1}`,
  });
  orderRow(ctx, orderId).fulfillmentStatus = variantIds ? 'PARTIALLY_FULFILLED' : 'FULFILLED';
};

beforeEach(() => __resetEventHandlersForTests());

/** Method 1 charges `price` for any weight in PT. */
const setRate = (ctx: Ctx, price: number) => {
  ctx.methods[0].rates.PT = [{ upTo: null, price }];
};

const raiseShippingReview = (ctx: Ctx, id: number) => {
  orderRow(ctx, id).reviewFlags = {
    flags: [
      {
        code: 'SHIPPING_REVIEW',
        reason: 'PRODUCTS_CHANGED',
        raisedAt: '2026-11-13T10:00:00.000Z',
        actor: 'user:1',
      },
    ],
  };
};

/** A free-shipping promotion's discount (SHIPPING_FREE): 500 off the 500 shipping. */
const withShippingDiscount = (ctx: Ctx, id: number) => {
  const row = orderRow(ctx, id);
  row.shippingDiscount = 500;
  row.shippingTotal = 0;
  row.total -= 500;
};

/** An issued invoice that includes shipping, created after the order's shipping lines. */
const issueInvoice = (ctx: Ctx, orderId: number) => {
  ctx.tables[UIDS.invoice].push({
    id: ctx.tables[UIDS.invoice].length + 1,
    order: orderId,
    kind: 'INVOICE',
    status: 'ISSUED',
    createdAt: new Date(Date.now() + 1000).toISOString(),
    lines: { lines: [{ kind: 'SHIPPING', total: 500 }] },
  });
};

const storedLines = (ctx: Ctx, id: number) => orderRow(ctx, id).shippingLines.lines;
const standard = { providerId: 'manual', serviceId: '1' };
const express = { providerId: 'manual', serviceId: '2' };

describe('EcommerceOrderEditingService.shippingOptionsForOrder', () => {
  it('quotes the pending units at the current address', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ctx.quote.mockClear();
    const { options, failures } = await ctx.editing.shippingOptionsForOrder(id);
    expect(options.map((o) => [o.serviceId, o.price, o.tax])).toEqual([
      ['1', 500, 23],
      ['2', 1200, 6],
    ]);
    expect(failures).toEqual([]);
    const req: any = ctx.quote.mock.calls[0][0];
    expect(req).toMatchObject({ country: 'PT', postalCode: '1000-001' });
    expect(req.items.reduce((n: number, i: any) => n + i.quantity, 0)).toBe(3);
  });

  it('quotes every effective unit when nothing is pending', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ship(ctx, id, 500);
    ctx.quote.mockClear();
    await ctx.editing.shippingOptionsForOrder(id);
    const req: any = ctx.quote.mock.calls[0][0];
    expect(req.items.reduce((n: number, i: any) => n + i.quantity, 0)).toBe(3);
  });
});

describe('EcommerceOrderEditingService.recalculateShipping', () => {
  it('no shipment: one RECALCULATION line of the quote; the payment link asks for the new due', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    setRate(ctx, 650);
    raiseShippingReview(ctx, id);
    const snapshot = JSON.stringify(ctx.tables);
    const preview = await ctx.editing.previewShippingRecalculation(id);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    expect(preview).toMatchObject({
      charged: 500,
      due: 650,
      quote: 650,
      previousShipmentsCost: 0,
      mode: 'REPLACED',
    });
    expect(preview.lines).toMatchObject([
      { id: 2, origin: 'RECALCULATION', amount: 650, paid: false, invoiced: false, spent: false },
    ]);
    expect(preview.before.total).toBe(7000);
    expect(preview.after.total).toBe(7150);

    const res = await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0001');
    expect(res).toMatchObject({ outcome: 'DUE', difference: 150 });
    expect(storedLines(ctx, id)).toMatchObject([{ origin: 'RECALCULATION', amount: 650 }]);
    expect(orderRow(ctx, id)).toMatchObject({
      shippingOriginal: 650,
      shippingTotal: 650,
      total: 7150,
    });
    expect(res.order.summary.due).toBe(7150);
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toBeUndefined();
    const [entry] = historyOf(ctx, id, 'SHIPPING_RECALCULATED');
    expect(entry).toMatchObject({ uniqueKey: 'edit:op-ship-0001', actor: 'user:1' });
    expect(entry.newValue).toMatchObject({
      kind: 'shipping-recalculate',
      charged: 500,
      due: 650,
      quote: 650,
      previousShipmentsCost: 0,
      mode: 'REPLACED',
    });
    expect(entry.previousValue.lines).toMatchObject([{ origin: 'CHECKOUT', amount: 500 }]);
    expect(entry.newValue.lines).toMatchObject([{ origin: 'RECALCULATION', amount: 650 }]);
    expect(historyOf(ctx, id, 'REVIEW_FLAG_CLEARED')).toHaveLength(1);
  });

  it('partially shipped: appends the difference; a paid order becomes REFUNDABLE, no refund is made', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'pay-0001' }, 'user:1');
    ship(ctx, id, 300, [10]);
    setRate(ctx, 100);
    ctx.findOption.mockClear();
    const res = await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0002');
    const req: any = ctx.findOption.mock.calls[0][0];
    expect(req.items.map((i: any) => [i.variantId, i.quantity])).toEqual([[11, 1]]);
    expect(storedLines(ctx, id)).toMatchObject([
      { id: 1, origin: 'CHECKOUT', amount: 500 },
      { id: 2, origin: 'RECALCULATION', amount: -100 },
    ]);
    expect(res).toMatchObject({ outcome: 'REFUNDABLE', difference: -100 });
    expect(res.order.availableActions).toContain('REFUND');
    expect(ctx.tables[UIDS.refund]).toHaveLength(0);
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 400, total: 6900 });
  });

  it('fully shipped, nothing added: no carrier call; due is the ACTIVE shipments cost', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ship(ctx, id, 450);
    ctx.findOption.mockClear();
    const preview = await ctx.editing.previewShippingRecalculation(id);
    expect(preview).toMatchObject({
      due: 450,
      quote: 0,
      previousShipmentsCost: 450,
      mode: 'APPENDED',
    });
    expect(preview.lines).toMatchObject([
      { id: 1, spent: true },
      { id: 2, origin: 'RECALCULATION', amount: -50, spent: true },
    ]);
    await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0003');
    expect(ctx.findOption).not.toHaveBeenCalled();
    expect(orderRow(ctx, id).shippingOriginal).toBe(450);
  });

  it('due equals charged: no line, the flag clears, history UNCHANGED', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    raiseShippingReview(ctx, id);
    const res = await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0004');
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(storedLines(ctx, id)).toMatchObject([{ id: 1, origin: 'CHECKOUT', amount: 500 }]);
    expect(flagsOf(ctx, id)).toEqual([]);
    const [entry] = historyOf(ctx, id, 'SHIPPING_RECALCULATED');
    expect(entry.newValue).toMatchObject({ mode: 'UNCHANGED', charged: 500, due: 500 });
  });

  it('a failed quote is SHIPPING_QUOTE_FAILED: nothing is written and the flag stays', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    raiseShippingReview(ctx, id);
    ctx.findOption.mockRejectedValueOnce(new Error('carrier down'));
    const before = JSON.stringify(ctx.tables);
    expect(await issues(ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0005'))).toEqual([
      { path: 'shipping', code: 'SHIPPING_QUOTE_FAILED' },
    ]);
    expect(JSON.stringify(ctx.tables)).toBe(before);
    ctx.findOption.mockResolvedValueOnce(null);
    expect(await issues(ctx.editing.previewShippingRecalculation(id))).toEqual([
      { path: 'shipping', code: 'SHIPPING_QUOTE_FAILED' },
    ]);
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toBeDefined();
  });

  it('a shipping discount keeps its euro value: up raises DISCOUNTS_REVIEW, down caps at the gross', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    withShippingDiscount(ctx, id);
    setRate(ctx, 700);
    await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0006');
    expect(orderRow(ctx, id)).toMatchObject({
      shippingOriginal: 700,
      shippingDiscount: 500,
      shippingTotal: 200,
      total: 6700,
    });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'SHIPPING_CHANGED' });

    setRate(ctx, 300);
    await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0007');
    expect(orderRow(ctx, id)).toMatchObject({
      shippingOriginal: 300,
      shippingDiscount: 300,
      shippingTotal: 0,
      total: 6500,
    });
  });

  it('a shipping change without a shipping discount raises no DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    setRate(ctx, 700);
    await ctx.editing.recalculateShipping(id, 'user:1', 'op-ship-0008');
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toBeUndefined();
  });
});

describe('EcommerceOrderEditingService.editShippingLine', () => {
  it('replaces a replaceable line in place with the new method', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    raiseShippingReview(ctx, id);
    const res = await ctx.editing.editShippingLine(
      id,
      1,
      { ...express, amount: 800 },
      'user:1',
      'op-line-0001'
    );
    expect(res).toMatchObject({ outcome: 'DUE', difference: 300 });
    expect(storedLines(ctx, id)).toMatchObject([
      {
        id: 1,
        origin: 'EDIT',
        amount: 800,
        providerId: 'manual',
        serviceId: '2',
        name: 'Express',
        tax: 6,
        actor: 'user:1',
      },
    ]);
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 800, shippingTax: 6, total: 7300 });
    expect(orderRow(ctx, id).shippingMethod).toMatchObject({
      serviceId: '2',
      name: 'Express',
      price: 800,
      tax: 6,
    });
    expect(flagsOf(ctx, id)).toEqual([]);
    const [entry] = historyOf(ctx, id, 'SHIPPING_LINE_EDITED');
    expect(entry).toMatchObject({ uniqueKey: 'edit:op-line-0001' });
    expect(entry.newValue).toMatchObject({
      kind: 'shipping-line-edit',
      lineId: 1,
      mode: 'REPLACED',
    });
    expect(entry.previousValue.lines).toMatchObject([{ origin: 'CHECKOUT', amount: 500 }]);
  });

  it('after an invoice that includes shipping: appends an EDIT line with the difference', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    issueInvoice(ctx, id);
    await ctx.editing.editShippingLine(
      id,
      1,
      { ...standard, amount: 700 },
      'user:1',
      'op-line-0002'
    );
    expect(storedLines(ctx, id)).toMatchObject([
      { id: 1, origin: 'CHECKOUT', amount: 500 },
      { id: 2, origin: 'EDIT', amount: 200, serviceId: '1', name: 'Standard', tax: 23 },
    ]);
    expect(orderRow(ctx, id).shippingOriginal).toBe(700);
  });

  it('an ACTIVE shipment gives ORDER_HAS_SHIPMENTS', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ship(ctx, id, 500);
    expect(
      await issues(
        ctx.editing.editShippingLine(id, 1, { ...standard, amount: 700 }, 'user:1', 'op-line-0003')
      )
    ).toEqual([{ path: 'order', code: 'ORDER_HAS_SHIPMENTS' }]);
  });

  it('an unknown line id is SHIPPING_LINE_NOT_FOUND', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect(
      await issues(
        ctx.editing.editShippingLine(id, 99, { ...standard, amount: 700 }, 'user:1', 'op-line-0004')
      )
    ).toEqual([{ path: 'lineId', code: 'SHIPPING_LINE_NOT_FOUND' }]);
  });

  it('a method not offered for the destination or weight is SHIPPING_METHOD_UNAVAILABLE', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    delete ctx.methods[1].rates.PT;
    const before = JSON.stringify(ctx.tables);
    expect(
      await issues(
        ctx.editing.editShippingLine(id, 1, { ...express, amount: 700 }, 'user:1', 'op-line-0005')
      )
    ).toEqual([{ path: 'method', code: 'SHIPPING_METHOD_UNAVAILABLE' }]);
    expect(
      await issues(
        ctx.editing.editShippingLine(
          id,
          1,
          { providerId: 'manual', serviceId: '9', amount: 700 },
          'user:1',
          'op-line-0006'
        )
      )
    ).toEqual([{ path: 'method', code: 'SHIPPING_METHOD_UNAVAILABLE' }]);
    expect(JSON.stringify(ctx.tables)).toBe(before);
  });

  it('a bad amount is INVALID_AMOUNT', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    for (const amount of [-1, 1.5, Number.NaN, '700' as any]) {
      expect(
        await issues(
          ctx.editing.editShippingLine(id, 1, { ...standard, amount }, 'user:1', 'op-line-0007')
        )
      ).toEqual([{ path: 'amount', code: 'INVALID_AMOUNT' }]);
    }
  });

  it('with a shipping discount: a gross change raises DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    withShippingDiscount(ctx, id);
    await ctx.editing.editShippingLine(
      id,
      1,
      { ...standard, amount: 700 },
      'user:1',
      'op-line-0008'
    );
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 700, shippingDiscount: 500 });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'SHIPPING_CHANGED' });
  });
});

describe('EcommerceOrderEditingService.addShippingLine', () => {
  it('with a shipment: appends a MANUAL line and clears SHIPPING_REVIEW', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ship(ctx, id, 500);
    raiseShippingReview(ctx, id);
    const res = await ctx.editing.addShippingLine(
      id,
      { ...standard, amount: 300 },
      'user:1',
      'op-add-00001'
    );
    expect(res).toMatchObject({ outcome: 'DUE', difference: 300 });
    expect(storedLines(ctx, id)).toMatchObject([
      { id: 1, origin: 'CHECKOUT', amount: 500 },
      {
        id: 2,
        origin: 'MANUAL',
        amount: 300,
        serviceId: '1',
        name: 'Standard',
        tax: 23,
        actor: 'user:1',
      },
    ]);
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 800, total: 7300 });
    expect(flagsOf(ctx, id)).toEqual([]);
    const [entry] = historyOf(ctx, id, 'SHIPPING_LINE_ADDED');
    expect(entry.newValue).toMatchObject({
      kind: 'shipping-line-add',
      lines: [{ id: 1 }, { id: 2 }],
    });
  });

  it('with a shipping discount: raises DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    withShippingDiscount(ctx, id);
    await ctx.editing.addShippingLine(id, { ...standard, amount: 300 }, 'user:1', 'op-add-00002');
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'SHIPPING_CHANGED' });
  });

  it('a bad amount or an unavailable method is rejected', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect(
      await issues(
        ctx.editing.addShippingLine(id, { ...standard, amount: -5 }, 'user:1', 'op-add-00003')
      )
    ).toEqual([{ path: 'amount', code: 'INVALID_AMOUNT' }]);
    expect(
      await issues(
        ctx.editing.addShippingLine(
          id,
          { providerId: 'manual', serviceId: '9', amount: 5 },
          'user:1',
          'op-add-00004'
        )
      )
    ).toEqual([{ path: 'method', code: 'SHIPPING_METHOD_UNAVAILABLE' }]);
  });
});
