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

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push(
    { id: 1, product: 1, locale: 'en', name: 'Shirt' },
    { id: 2, product: 1, locale: 'pt', name: 'Camisa' }
  );
  t[UIDS.variant].push(
    { id: 10, product: 1, sku: 'SH-M', price: 2000, tax: 23, stock: 10, active: true, weight: 0.2 },
    { id: 11, product: 1, sku: 'SH-L', price: 2500, tax: 23, stock: 1, active: true, weight: 0.25 },
    { id: 12, product: 1, sku: 'SH-XL', price: 1500, tax: 23, stock: 10, active: true, weight: 0.3 },
    { id: 13, product: 1, sku: 'SH-XS', price: 1000, tax: 23, stock: 10, active: false }
  );
  t[UIDS.variantTranslation].push({ id: 1, variant: 12, locale: 'en', option: 'Extra large' });
  t[UIDS.image].push(
    { id: 1, product: 1, url: '/p1.jpg', position: 0 },
    { id: 2, variant: 12, url: '/v12.jpg', position: 0 }
  );
  return { orders, editing, payments, tables: t, bus, findOption, methods, misses, log };
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
const lineInputs = (ctx: Ctx, orderId: number) =>
  linesOf(ctx, orderId).map((l) => ({
    orderLineId: l.id,
    variantId: l.variantId,
    quantity: l.quantity,
  }));
const stockOf = (ctx: Ctx, id: number) => ctx.tables[UIDS.variant].find((v) => v.id === id).stock;
const historyOf = (ctx: Ctx, orderId: number, type?: string) =>
  ctx.tables[UIDS.orderHistory].filter((h) => h.order === orderId && (!type || h.type === type));
const orderRow = (ctx: Ctx, id: number) => ctx.tables[UIDS.order].find((o) => o.id === id);
const flagsOf = (ctx: Ctx, id: number) => orderRow(ctx, id).reviewFlags?.flags ?? [];
const flag = (ctx: Ctx, id: number, code: string) => flagsOf(ctx, id).find((f: any) => f.code === code);

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

/** An ACTIVE shipment of every unit of the order (fully shipped and delivered). */
const shipEverything = (ctx: Ctx, orderId: number, shippingCost = 500) => {
  ctx.tables[UIDS.shipment].push({
    id: ctx.tables[UIDS.shipment].length + 1,
    order: orderId,
    providerId: 'manual',
    carrierName: 'CTT',
    status: 'ACTIVE',
    deliveryStatus: 'DELIVERED',
    items: {
      lines: linesOf(ctx, orderId).map((l) => ({
        orderLineId: l.id,
        sku: l.sku,
        name: l.name,
        option: null,
        quantity: l.quantity,
      })),
    },
    shippingCost,
    idempotencyKey: `ship-${orderId}`,
  });
  orderRow(ctx, orderId).fulfillmentStatus = 'FULFILLED';
};

const STACK_ALL = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };
const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
const addPromotion = (ctx: Ctx, over: Record<string, unknown> = {}): number => {
  const id = ctx.tables[UIDS.promotion].length + 1;
  ctx.tables[UIDS.promotion].push({
    id,
    name: 'Promo',
    description: null,
    code: null,
    method: 'AUTOMATIC',
    active: true,
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: null,
    priority: 0,
    displayName: {},
    eligibility: { mode: 'ALL' },
    conditions: group(),
    benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
    stacking: STACK_ALL,
    usageLimit: null,
    perCustomerLimit: null,
    perOrderLimit: null,
    redemptions: 0,
    version: 1,
    ...over,
  });
  return id;
};
const tenPercentAbove100 = (ctx: Ctx) =>
  addPromotion(ctx, {
    name: '10% above 100 €',
    conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 10000 }]),
  });

beforeEach(() => __resetEventHandlersForTests());

describe('EcommerceOrderEditingService.previewLines', () => {
  it('writes nothing and returns before/after subtotal and total', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const before = JSON.stringify(ctx.tables);
    const preview = await ctx.editing.previewLines(id, {
      lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }],
    });
    expect(JSON.stringify(ctx.tables)).toBe(before);
    expect(preview.errors).toEqual([]);
    expect(preview.before).toMatchObject({ subtotal: 6500, total: 7000 });
    expect(preview.after).toMatchObject({ subtotal: 8000, total: 8500 });
    expect(preview.difference).toBe(1500);
    expect(preview.outcome).toBe('DUE');
    expect(preview.stockMovements).toEqual([{ variantId: 12, quantity: -1 }]);
    expect(Object.keys(preview).sort()).toEqual(
      ['after', 'before', 'difference', 'errors', 'lineChanges', 'outcome', 'stockMovements'].sort()
    );
  });

  it('returns the simulation errors', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const preview = await ctx.editing.previewLines(id, {
      lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 50 }],
    });
    expect(preview.errors).toEqual([{ path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' }]);
  });

  it('rejects malformed input', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect(await issues(ctx.editing.previewLines(id, { lines: 'x' } as any))).toEqual([
      { path: 'lines', code: 'required' },
    ]);
  });

  it('a PENDING shipment blocks the edit (ORDER_NOT_EDITABLE / SHIPMENT_PENDING)', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const line10 = linesOf(ctx, id).find((l) => l.variantId === 10);
    ctx.tables[UIDS.shipment].push({
      id: 1,
      order: id,
      providerId: 'acme',
      carrierName: 'Acme',
      status: 'PENDING',
      error: 'UNCERTAIN',
      items: { lines: [{ orderLineId: line10.id, sku: 'SH-M', name: 'Shirt', option: null, quantity: 2 }] },
      shippingCost: 0,
      idempotencyKey: 'pending-1',
    });
    const input = { lines: lineInputs(ctx, id).filter((l) => l.variantId !== 10) };
    expect(await issues(ctx.editing.previewLines(id, input))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'SHIPMENT_PENDING' },
    ]);
    expect(await issues(ctx.editing.applyLines(id, input, 'user:1', 'op-pending-1'))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'SHIPMENT_PENDING' },
    ]);
    expect(linesOf(ctx, id)).toHaveLength(2);
  });
});

describe('EcommerceOrderEditingService.applyLines', () => {
  it('adding a variant to a paid order: one LINES_CHANGED entry, stock edit:<op>:<variant>, shipping untouched', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'pay-1' }, 'user:1');
    const shippingLines = structuredClone(orderRow(ctx, id).shippingLines);
    const shippingOriginal = orderRow(ctx, id).shippingOriginal;
    const events: any[] = [];
    ctx.bus.subscribe('ORDER_MODIFIED', async (e) => {
      events.push(e);
    });

    const res = await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 2 }] },
      'user:1',
      'op-add-0001'
    );

    expect(res).toMatchObject({ outcome: 'DUE', difference: 3000 });
    expect(res.order.paymentStatus).toBe('PARTIALLY_PAID');
    expect(res.order.totals.total).toBe(10000);
    expect(stockOf(ctx, 12)).toBe(8);
    expect(
      ctx.tables[UIDS.stockMovement].find((m) => m.operationKey === 'edit:op-add-0001:12')
    ).toMatchObject({ type: 'ORDER_DEDUCT', quantity: -2, order: id, actor: 'user:1' });
    expect(linesOf(ctx, id).find((l) => l.variantId === 12)).toMatchObject({
      productId: 1,
      sku: 'SH-XL',
      name: 'Shirt',
      option: 'Extra large',
      imageUrl: '/v12.jpg',
      unitPrice: 1500,
      unitDiscount: 0,
      quantity: 2,
      isGift: false,
      promotionRefs: { refs: [] },
      position: 2,
    });

    const entries = historyOf(ctx, id, 'LINES_CHANGED');
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      actor: 'user:1',
      operationId: 'op-add-0001',
      uniqueKey: 'edit:op-add-0001',
    });
    expect(entry.newValue).toMatchObject({
      kind: 'lines',
      outcome: 'DUE',
      difference: 3000,
      added: [{ variantId: 12, sku: 'SH-XL', quantity: 2, unitPrice: 1500 }],
      changed: [],
      removed: [],
      totals: { subtotal: 9500, total: 10000 },
    });
    expect(entry.previousValue).toMatchObject({ totals: { subtotal: 6500, total: 7000 } });
    for (const type of ['LINE_ADDED', 'LINE_QUANTITY_CHANGED', 'LINE_REMOVED', 'ORDER_MODIFIED']) {
      expect(historyOf(ctx, id, type)).toEqual([]);
    }

    expect(orderRow(ctx, id).shippingLines).toEqual(shippingLines);
    expect(orderRow(ctx, id).shippingOriginal).toBe(shippingOriginal);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'ORDER_MODIFIED',
      orderId: id,
      payload: { kind: 'lines', outcome: 'DUE', difference: 3000 },
    });
  });

  it('snapshots added lines in the order locale', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 1 }], 'pt');
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-locale-1'
    );
    expect(linesOf(ctx, id).find((l) => l.variantId === 12)).toMatchObject({
      name: 'Camisa',
      option: 'Extra large',
    });
  });

  it('reducing 3 to 1 restocks 2 and records the change', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 12, quantity: 3 }]);
    expect(stockOf(ctx, 12)).toBe(7);
    const [line] = linesOf(ctx, id);
    const res = await ctx.editing.applyLines(
      id,
      { lines: [{ orderLineId: line.id, variantId: 12, quantity: 1 }] },
      'user:1',
      'op-reduce-1'
    );
    expect(stockOf(ctx, 12)).toBe(9);
    expect(
      ctx.tables[UIDS.stockMovement].find((m) => m.operationKey === 'edit:op-reduce-1:12')
    ).toMatchObject({ type: 'ORDER_RESTOCK', quantity: 2 });
    expect(linesOf(ctx, id)[0].quantity).toBe(1);
    expect(res).toMatchObject({ outcome: 'NONE', difference: -3000 });
    expect(historyOf(ctx, id, 'LINES_CHANGED')[0].newValue.changed).toEqual([
      expect.objectContaining({
        orderLineId: line.id,
        variantId: 12,
        sku: 'SH-XL',
        previousQuantity: 3,
        quantity: 1,
      }),
    ]);
  });

  it('removing a line deletes it and restocks', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const removed = linesOf(ctx, id).find((l) => l.variantId === 11);
    await ctx.editing.applyLines(
      id,
      { lines: lineInputs(ctx, id).filter((l) => l.variantId === 10) },
      'user:1',
      'op-remove-1'
    );
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10]);
    expect(stockOf(ctx, 11)).toBe(1);
    expect(historyOf(ctx, id, 'LINES_CHANGED')[0].newValue.removed).toEqual([
      expect.objectContaining({ orderLineId: removed.id, variantId: 11, sku: 'SH-L', quantity: 1 }),
    ]);
  });

  it('the same operationId twice applies once', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const input = { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] };
    const a = await ctx.editing.applyLines(id, input, 'user:1', 'op-repeat-1');
    const snapshot = JSON.stringify(ctx.tables);
    const b = await ctx.editing.applyLines(id, input, 'user:1', 'op-repeat-1');
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    expect(b).toMatchObject({ outcome: a.outcome, difference: a.difference });
    expect(b.order.totals).toEqual(a.order.totals);
    expect(stockOf(ctx, 12)).toBe(9);
    expect(historyOf(ctx, id, 'LINES_CHANGED')).toHaveLength(1);
  });

  it('a concurrent duplicate loses on the unique key and replays the winner', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const events: any[] = [];
    ctx.bus.subscribe('ORDER_MODIFIED', async (e) => {
      events.push(e);
    });
    const input = { lines: lineInputs(ctx, id).filter((l) => l.variantId === 10) };
    const a = await ctx.editing.applyLines(id, input, 'user:1', 'op-race-0001');
    const snapshot = JSON.stringify(ctx.tables);
    // The second request started before the first committed: both of its lookups miss.
    ctx.misses.uniqueKeyLookups = 2;
    const b = await ctx.editing.applyLines(id, input, 'user:1', 'op-race-0001');
    expect(ctx.misses.uniqueKeyLookups).toBe(0);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    expect(historyOf(ctx, id, 'LINES_CHANGED')).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(b).toMatchObject({ outcome: a.outcome, difference: a.difference });
    expect(b.order).toEqual(a.order);
  });

  it('validates the operationId', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    for (const op of [undefined, '', 'short', 'x'.repeat(65), 12345678]) {
      expect(
        await issues(ctx.editing.applyLines(id, { lines: lineInputs(ctx, id) }, 'user:1', op as any))
      ).toEqual([{ path: 'operationId', code: 'required' }]);
    }
  });

  it('rejects simulation errors without any effect', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const snapshot = JSON.stringify(ctx.tables);
    expect(
      await issues(
        ctx.editing.applyLines(
          id,
          {
            lines: [
              ...lineInputs(ctx, id),
              { variantId: 12, quantity: 50 },
              { variantId: 13, quantity: 1 },
            ],
          },
          'user:1',
          'op-errors-1'
        )
      )
    ).toEqual([
      { path: 'lines.3.quantity', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' },
    ]);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
  });

  it('is ORDER_NOT_EDITABLE on a cancelled order', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.orders.cancel(id, 'user:1');
    expect(
      await issues(ctx.editing.applyLines(id, { lines: lineInputs(ctx, id) }, 'user:1', 'op-cancelled-1'))
    ).toEqual([{ path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'CANCELLED' }]);
  });

  it('caps the order discount at the new subtotal', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    orderRow(ctx, id).orderDiscount = 5000;
    const res = await ctx.editing.applyLines(
      id,
      { lines: lineInputs(ctx, id).filter((l) => l.variantId === 11) },
      'user:1',
      'op-discount-1'
    );
    expect(res.order.totals).toMatchObject({ subtotal: 2500, orderDiscount: 2500, total: 500 });
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 2500, orderDiscount: 2500, total: 500 });
  });
});

describe('products save: shipping review (rulings 6, 20)', () => {
  it('adding 3 kg moves the weight bracket: SHIPPING_REVIEW raised with PRODUCTS_CHANGED, shipping unchanged', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ctx.findOption.mockClear();
    const res = await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 10 }] },
      'user:1',
      'op-weight-01'
    );
    expect(ctx.findOption).toHaveBeenCalledTimes(1);
    const [req, providerId, serviceId] = ctx.findOption.mock.calls[0] as any[];
    expect([providerId, serviceId]).toEqual(['manual', '1']);
    expect(req).toMatchObject({ country: 'PT', postalCode: '1000-001', locale: 'en' });
    expect(req.items.reduce((s: number, i: any) => s + i.weight * i.quantity, 0)).toBeCloseTo(3.65);
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toMatchObject({
      code: 'SHIPPING_REVIEW',
      reason: 'PRODUCTS_CHANGED',
      actor: 'user:1',
    });
    expect(res.order.reviewFlags).toContainEqual(
      expect.objectContaining({ code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED' })
    );
    expect(historyOf(ctx, id, 'REVIEW_FLAG_RAISED').map((h) => h.newValue)).toEqual([
      { code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED' },
    ]);
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 500, shippingTotal: 500 });
  });

  it('due = charged → no flag', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-weight-02'
    );
    expect(flagsOf(ctx, id)).toEqual([]);
    expect(historyOf(ctx, id, 'REVIEW_FLAG_RAISED')).toEqual([]);
  });

  it('a failed quote (the method no longer serves the country) still saves and raises SHIPPING_QUOTE_FAILED', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    delete ctx.methods[0].rates.PT;
    const res = await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-quote-fail'
    );
    expect(res.outcome).toBe('DUE');
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10, 11, 12]);
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toMatchObject({ reason: 'SHIPPING_QUOTE_FAILED' });
  });
});

describe('products save: discounts review (rulings 12, 20)', () => {
  it('an applied "≥ 100 €" promotion no longer met at 80 €: DISCOUNTS_REVIEW, discounts unchanged', async () => {
    const ctx = setup();
    tenPercentAbove100(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 5 }]);
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 10000, orderDiscount: 1000 });
    const promotions = JSON.stringify(orderRow(ctx, id).promotions);
    const redemptions = JSON.stringify(ctx.tables[UIDS.promotionRedemption]);

    const res = await ctx.editing.applyLines(
      id,
      { lines: lineInputs(ctx, id).map((l) => ({ ...l, quantity: 4 })) },
      'user:1',
      'op-unmet-01'
    );
    expect(res.order.totals).toMatchObject({ subtotal: 8000, orderDiscount: 1000, total: 7500 });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'PRODUCTS_CHANGED' });
    expect(JSON.stringify(orderRow(ctx, id).promotions)).toBe(promotions);
    expect(JSON.stringify(ctx.tables[UIDS.promotionRedemption])).toBe(redemptions);
  });

  it('an automatic promotion that starts to apply after the change: DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    tenPercentAbove100(ctx);
    const id = await createOrder(ctx);
    expect(orderRow(ctx, id).orderDiscount).toBe(0);
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 3 }] },
      'user:1',
      'op-newpromo-1'
    );
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 11000, orderDiscount: 0 });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'PRODUCTS_CHANGED' });
  });

  it('neither: no DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    tenPercentAbove100(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 5 }]);
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-nopromo-1'
    );
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toBeUndefined();
  });
});

describe('products save: discounted lines', () => {
  const tenPercentOn10 = (ctx: Ctx) =>
    addPromotion(ctx, {
      benefits: {
        items: [
          {
            type: 'PRODUCT_PERCENT',
            target: { productIds: [], variantIds: [10] },
            percent: 10,
            maxQuantity: null,
          },
        ],
      },
    });

  it('a discounted line raised from 2 to 3 keeps its discount and adds a full-price line', async () => {
    const ctx = setup();
    tenPercentOn10(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    const [line] = linesOf(ctx, id);
    expect(line).toMatchObject({ quantity: 2, unitDiscount: 200 });
    await ctx.editing.applyLines(
      id,
      { lines: [{ orderLineId: line.id, variantId: 10, quantity: 3 }] },
      'user:1',
      'op-raise-01'
    );
    expect(
      linesOf(ctx, id).map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, unitDiscount: l.unitDiscount }))
    ).toEqual([
      { quantity: 2, unitPrice: 2000, unitDiscount: 200 },
      { quantity: 1, unitPrice: 2000, unitDiscount: 0 },
    ]);
    expect(orderRow(ctx, id)).toMatchObject({ productDiscount: 400, subtotal: 5600 });
  });

  it('a discounted line lowered from 2 to 1 lowers its discount proportionally', async () => {
    const ctx = setup();
    tenPercentOn10(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    const [line] = linesOf(ctx, id);
    await ctx.editing.applyLines(
      id,
      { lines: [{ orderLineId: line.id, variantId: 10, quantity: 1 }] },
      'user:1',
      'op-lower-01'
    );
    expect(linesOf(ctx, id)[0]).toMatchObject({ quantity: 1, unitDiscount: 200 });
    expect(orderRow(ctx, id)).toMatchObject({ productDiscount: 200, subtotal: 1800 });
  });
});

describe('products save on a FULFILLED order (Review Focus 2)', () => {
  it('lowering a shipped line → QUANTITY_BELOW_SHIPPED', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    shipEverything(ctx, id);
    const lines = lineInputs(ctx, id).map((l) => (l.variantId === 10 ? { ...l, quantity: 1 } : l));
    expect(await issues(ctx.editing.applyLines(id, { lines }, 'user:1', 'op-shipped-1'))).toEqual([
      { path: 'lines.0.quantity', code: 'QUANTITY_BELOW_SHIPPED' },
    ]);
  });

  it('adding a variant: PARTIALLY_FULFILLED, SHIP back once settled, no ARCHIVE; the quote prices only the new units', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'pay-1' }, 'user:1');
    shipEverything(ctx, id);
    expect((await ctx.orders.get(id)).availableActions).toContain('ARCHIVE');
    ctx.findOption.mockClear();

    const res = await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-fulfilled-1'
    );

    expect(res.order.fulfillmentStatus).toBe('PARTIALLY_FULFILLED');
    expect(res.order.availableActions).not.toContain('ARCHIVE');
    expect(ctx.findOption).toHaveBeenCalledTimes(1);
    expect(ctx.findOption.mock.calls[0][0]).toMatchObject({
      items: [{ variantId: 12, quantity: 1, weight: 0.3, width: 0, height: 0, depth: 0 }],
      subtotal: 1500,
    });
    // Due = 500 already spent + 500 for the new unit ≠ 500 charged.
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toMatchObject({ reason: 'PRODUCTS_CHANGED' });

    await ctx.payments.addManualPayment(id, { amount: 1500, idempotencyKey: 'pay-2' }, 'user:1');
    const view = await ctx.orders.get(id);
    expect(view.availableActions).toContain('SHIP');
    expect(view.availableActions).not.toContain('ARCHIVE');
  });
});

describe('manual line discount (spec 4.1)', () => {
  const halfOff = (ctx: Ctx, variantIds: number[]) =>
    addPromotion(ctx, {
      name: 'Half off',
      benefits: {
        items: [
          { type: 'PRODUCT_PERCENT', target: { productIds: [], variantIds }, percent: 50, maxQuantity: null },
        ],
      },
    });
  const withPercent = (ctx: Ctx, id: number, variantId: number, discountPercent: unknown) =>
    lineInputs(ctx, id).map((l) => (l.variantId === variantId ? { ...l, discountPercent } : l));

  it('products save: 10 % on a line stores the percent and the unit discount; history and view show it', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const res = await ctx.editing.applyLines(
      id,
      { lines: withPercent(ctx, id, 10, 10) },
      'user:1',
      'op-pct-0001'
    );
    const line10 = linesOf(ctx, id).find((l) => l.variantId === 10);
    expect(line10).toMatchObject({
      quantity: 2,
      unitDiscount: 200,
      manualDiscountPercent: 10,
      promotionRefs: { refs: [] },
    });
    expect(res).toMatchObject({ outcome: 'NONE', difference: -400 });
    expect(orderRow(ctx, id)).toMatchObject({ productDiscount: 400, subtotal: 6100, total: 6600 });
    const view = res.order.lines.find((l: any) => l.variantId === 10);
    expect(view).toMatchObject({ manualDiscountPercent: 10, unitDiscount: 200 });
    expect(res.order.lines.find((l: any) => l.variantId === 11).manualDiscountPercent).toBeNull();
    const [entry] = historyOf(ctx, id, 'LINES_CHANGED');
    expect(entry.newValue.changed).toEqual([
      expect.objectContaining({
        orderLineId: line10.id,
        previousQuantity: 2,
        quantity: 2,
        previousDiscountPercent: null,
        discountPercent: 10,
      }),
    ]);
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toBeUndefined();
  });

  it('the preview prices the discount and writes nothing', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const before = JSON.stringify(ctx.tables);
    const preview = await ctx.editing.previewLines(id, { lines: withPercent(ctx, id, 11, 20) });
    expect(JSON.stringify(ctx.tables)).toBe(before);
    expect(preview.errors).toEqual([]);
    expect(preview.after).toMatchObject({ subtotal: 6000, total: 6500 });
  });

  it('replacing a promotion discount drops its refs and raises DISCOUNTS_REVIEW', async () => {
    const ctx = setup();
    halfOff(ctx, [10]);
    const id = await createOrder(ctx);
    expect(linesOf(ctx, id).find((l) => l.variantId === 10)).toMatchObject({ unitDiscount: 1000 });
    await ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, 5) }, 'user:1', 'op-pct-0002');
    expect(linesOf(ctx, id).find((l) => l.variantId === 10)).toMatchObject({
      unitDiscount: 100,
      manualDiscountPercent: 5,
      promotionRefs: { refs: [] },
    });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'PRODUCTS_CHANGED' });
  });

  it('the released promotion discount leaves the stored promotions: the discounts add up', async () => {
    const ctx = setup();
    halfOff(ctx, [10]);
    const id = await createOrder(ctx);
    expect(orderRow(ctx, id).promotions.applied[0]).toMatchObject({ amount: 2000 });
    const res = await ctx.editing.applyLines(
      id,
      { lines: withPercent(ctx, id, 10, 5) },
      'user:1',
      'op-pct-0010'
    );
    const order = orderRow(ctx, id);
    const [promo] = order.promotions.applied;
    expect(promo).toMatchObject({ amount: 0, benefits: [{ amount: 0 }] });
    const promotionSum = order.promotions.applied.reduce((s: number, a: any) => s + a.amount, 0);
    const manualOrder = (order.manualDiscounts?.items ?? []).reduce((s: number, m: any) => s + m.amount, 0);
    const manualLines = res.order.lines
      .filter((l: any) => l.manualDiscountPercent !== null)
      .reduce((s: number, l: any) => s + l.unitDiscount * (l.quantity - l.returnedQuantity), 0);
    expect(promotionSum + manualOrder + manualLines).toBe(order.productDiscount + order.orderDiscount);
    const [entry] = historyOf(ctx, id, 'LINES_CHANGED');
    expect(entry.newValue.releasedPromotionDiscounts).toEqual([
      { promotionId: promo.promotionId, benefitIndex: 0, amount: 2000 },
    ]);
  });

  it('adding units to a shipped line with a manual percent keeps it on the whole line', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, 10) }, 'user:1', 'op-pct-0011');
    shipEverything(ctx, id);
    const lines = lineInputs(ctx, id).map((l) => (l.variantId === 10 ? { ...l, quantity: 3 } : l));
    await ctx.editing.applyLines(id, { lines }, 'user:1', 'op-pct-0012');
    expect(linesOf(ctx, id).filter((l) => l.variantId === 10)).toEqual([
      expect.objectContaining({ quantity: 3, unitDiscount: 200, manualDiscountPercent: 10 }),
    ]);
  });

  it('removing the percent returns the line to full price', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, 10) }, 'user:1', 'op-pct-0003');
    await ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, null) }, 'user:1', 'op-pct-0004');
    expect(linesOf(ctx, id).find((l) => l.variantId === 10)).toMatchObject({
      unitDiscount: 0,
      manualDiscountPercent: null,
    });
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 6500 });
    const entries = historyOf(ctx, id, 'LINES_CHANGED');
    expect(entries[1].newValue.changed[0]).toMatchObject({
      previousDiscountPercent: 10,
      discountPercent: null,
    });
  });

  it('a new line can be added with a percent', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 2, discountPercent: 50 }] },
      'user:1',
      'op-pct-0005'
    );
    expect(linesOf(ctx, id).find((l) => l.variantId === 12)).toMatchObject({
      unitPrice: 1500,
      unitDiscount: 750,
      manualDiscountPercent: 50,
    });
    const [entry] = historyOf(ctx, id, 'LINES_CHANGED');
    expect(entry.newValue.added[0]).toMatchObject({ variantId: 12, discountPercent: 50 });
  });

  it('a line with shipped units → DISCOUNT_LINE_SHIPPED; invalid → INVALID_PERCENT', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    shipEverything(ctx, id);
    expect(
      await issues(ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, 10) }, 'user:1', 'op-pct-0006'))
    ).toEqual([{ path: 'lines.0.discountPercent', code: 'DISCOUNT_LINE_SHIPPED' }]);
    const ctx2 = setup();
    const id2 = await createOrder(ctx2);
    expect(
      (await ctx2.editing.previewLines(id2, { lines: withPercent(ctx2, id2, 11, 0) })).errors
    ).toEqual([{ path: 'lines.1.discountPercent', code: 'INVALID_PERCENT' }]);
  });

  it('recalculate discounts leaves a manual line out of product promotions', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.applyLines(id, { lines: withPercent(ctx, id, 10, 10) }, 'user:1', 'op-pct-0007');
    halfOff(ctx, [10, 11]);
    const r = await ctx.editing.previewDiscounts(id, {});
    const row = r.rows.find((x: any) => x.kind === 'NEW');
    expect(row).toMatchObject({ amount: 1250 });
    const priced = await ctx.editing.previewDiscounts(id, { selection: [row!.key] });
    const line10 = linesOf(ctx, id).find((l) => l.variantId === 10);
    expect(priced.lines.map((l: any) => l.id)).not.toContain(line10.id);
  });
});

describe('manual order creation with a line discount (spec 4.1)', () => {
  const createWith = (ctx: Ctx, lines: any[], source: 'admin' | 'storefront' = 'admin') =>
    ctx.orders.create(
      {
        customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
        shippingAddress: address,
        billingAddress: address,
        locale: 'en',
        lines,
        shipping: { providerId: 'manual', serviceId: '1' },
      },
      { actor: 'user:1', source }
    );

  it('the line keeps its percent; promotions are evaluated with it frozen at its net price', async () => {
    const ctx = setup();
    addPromotion(ctx, {
      name: 'Half off',
      benefits: {
        items: [
          {
            type: 'PRODUCT_PERCENT',
            target: { productIds: [], variantIds: [10, 11] },
            percent: 50,
            maxQuantity: null,
          },
        ],
      },
    });
    const { id } = await createWith(ctx, [
      { variantId: 10, quantity: 2, discountPercent: 10 },
      { variantId: 11, quantity: 1 },
    ]);
    const lines = linesOf(ctx, id);
    expect(lines.find((l) => l.variantId === 10)).toMatchObject({
      unitPrice: 2000,
      unitDiscount: 200,
      manualDiscountPercent: 10,
      promotionRefs: { refs: [] },
    });
    expect(lines.find((l) => l.variantId === 11)).toMatchObject({
      unitPrice: 2500,
      unitDiscount: 1250,
      manualDiscountPercent: null,
    });
    expect(orderRow(ctx, id)).toMatchObject({
      itemsOriginal: 6500,
      productDiscount: 1650,
      subtotal: 4850,
      total: 5350,
    });
  });

  it('an order-level promotion counts a manual line at its net price', async () => {
    const ctx = setup();
    addPromotion(ctx, { name: '10 %' });
    const { id } = await createWith(ctx, [{ variantId: 10, quantity: 2, discountPercent: 50 }]);
    // 10 % of 2 × 1000.
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 2000, orderDiscount: 200 });
  });

  it('the admin quote prices it; the default quote (storefront) ignores it', async () => {
    const ctx = setup();
    const input = { lines: [{ variantId: 10, quantity: 2, discountPercent: 25 }], locale: 'en' };
    const admin = await ctx.orders.quote(input as any, { manualDiscounts: true });
    expect(admin.totals).toMatchObject({ itemsOriginal: 4000, productDiscount: 1000, subtotal: 3000 });
    expect(admin.lines[0]).toMatchObject({ unitPrice: 2000, unitDiscount: 500, manualDiscountPercent: 25 });
    const plain = await ctx.orders.quote(input as any);
    expect(plain.totals).toMatchObject({ subtotal: 4000, productDiscount: 0 });
  });

  it('an invalid percent → INVALID_PERCENT on the line', async () => {
    const ctx = setup();
    expect(await issues(createWith(ctx, [{ variantId: 10, quantity: 1, discountPercent: 120 }]))).toEqual([
      { path: 'lines.0.discountPercent', code: 'INVALID_PERCENT' },
    ]);
  });

  it('a storefront order never takes the field', async () => {
    const ctx = setup();
    const { id } = await createWith(ctx, [{ variantId: 10, quantity: 2, discountPercent: 50 }], 'storefront');
    expect(linesOf(ctx, id)[0]).toMatchObject({ unitDiscount: 0 });
    expect(linesOf(ctx, id)[0].manualDiscountPercent ?? null).toBeNull();
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 4000 });
  });
});
