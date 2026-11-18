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
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [{ code: 'en' }, { code: 'pt' }],
            }),
          }
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
  const promotions = services.EcommercePromotionService;
  return {
    orders,
    editing,
    payments,
    promotions,
    tables: t,
    bus,
    findOption,
    methods,
    misses,
    log,
  };
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
const flag = (ctx: Ctx, id: number, code: string) =>
  flagsOf(ctx, id).find((f: any) => f.code === code);

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

/** An ACTIVE shipment of every unit of the order (fully shipped and delivered). */
const shipEverything = (ctx: Ctx, orderId: number) => {
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

const T = (variantIds: number[] = [], productIds: number[] = []) => ({ productIds, variantIds });

/** An order created with promotion codes. */
const createWithCodes = async (
  ctx: Ctx,
  lines: { variantId: number; quantity: number }[],
  codes: string[]
) => {
  const created = await ctx.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines,
      shipping: { providerId: 'manual', serviceId: '1' },
      promotionCodes: codes,
    } as any,
    { actor: 'user:1', source: 'admin' }
  );
  return created.id as number;
};

const promotionRow = (ctx: Ctx, id: number) => ctx.tables[UIDS.promotion].find((p) => p.id === id);
const redemptionsOf = (ctx: Ctx, orderId: number) =>
  ctx.tables[UIDS.promotionRedemption].filter((r) => r.order === orderId);

/** An issued invoice of the whole order. */
const issueInvoice = (ctx: Ctx, orderId: number) => {
  ctx.tables[UIDS.invoice].push({
    id: ctx.tables[UIDS.invoice].length + 1,
    order: orderId,
    kind: 'INVOICE',
    status: 'ISSUED',
    createdAt: new Date(Date.now() + 1000).toISOString(),
    lines: {
      lines: [
        { kind: 'PRODUCT', total: 4000 },
        { kind: 'SHIPPING', total: 500 },
      ],
    },
  });
};

const pay = (ctx: Ctx, id: number, amount: number, key = 'pay-1') =>
  ctx.payments.addManualPayment(id, { amount, idempotencyKey: key }, 'user:1');

/** "2× X oferece Y": buying 2 of variant 10 makes one 12 in the cart free. */
const twoXGetY = (ctx: Ctx) =>
  addPromotion(ctx, {
    name: '2 X get Y',
    benefits: {
      items: [
        {
          type: 'BUY_X_GET_Y',
          buy: { target: T([10]), quantity: 2, minAmount: null },
          get: { mode: 'IN_CART', target: T([12]), quantity: 1 },
          reward: { kind: 'FREE' },
        },
      ],
    },
  });

/** 10% off the order, no conditions. */
const tenPercent = (ctx: Ctx, over: Record<string, unknown> = {}) => addPromotion(ctx, over);

beforeEach(() => __resetEventHandlersForTests());

describe("spec 2's example: 2× X offers Y", () => {
  it('adding Y raises DISCOUNTS_REVIEW; the preview offers the promotion; applying it makes Y free', async () => {
    const ctx = setup();
    const promo = twoXGetY(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 4000, total: 4500 });
    await pay(ctx, id, 4500);
    issueInvoice(ctx, id);
    const invoices = JSON.stringify(ctx.tables[UIDS.invoice]);

    const added = await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }] },
      'user:1',
      'op-add-y-01'
    );
    expect(added).toMatchObject({ outcome: 'DUE', difference: 1500 });
    expect(linesOf(ctx, id).find((l) => l.variantId === 12)).toMatchObject({
      unitPrice: 1500,
      unitDiscount: 0,
    });
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toMatchObject({ reason: 'PRODUCTS_CHANGED' });

    const before = JSON.stringify(ctx.tables);
    const preview = await ctx.editing.previewDiscounts(id, {});
    expect(JSON.stringify(ctx.tables)).toBe(before);
    expect(preview.rows).toEqual([
      expect.objectContaining({ key: `p:${promo}`, kind: 'NEW', selected: false, amount: 1500 }),
    ]);

    const res = await ctx.editing.applyDiscounts(
      id,
      { selection: [`p:${promo}`] },
      'user:1',
      'op-disc-01'
    );
    expect(res).toMatchObject({ outcome: 'NONE', difference: -1500 });
    const y = linesOf(ctx, id).find((l) => l.variantId === 12);
    expect(y.unitDiscount).toBe(1500);
    expect(y.promotionRefs.refs).toEqual([
      expect.objectContaining({ promotionId: promo, amount: 1500 }),
    ]);
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 4000, total: 4500 });
    expect(orderRow(ctx, id).promotions.applied.map((a: any) => a.promotionId)).toEqual([promo]);
    expect(orderRow(ctx, id).promotions.recalculatedAt).toEqual(expect.any(String));
    expect(promotionRow(ctx, promo).redemptions).toBe(1);
    expect(redemptionsOf(ctx, id)).toEqual([
      expect.objectContaining({ status: 'RESERVED', amount: 1500 }),
    ]);
    expect(JSON.stringify(ctx.tables[UIDS.invoice])).toBe(invoices);
    expect(flag(ctx, id, 'DISCOUNTS_REVIEW')).toBeUndefined();
    expect(historyOf(ctx, id, 'REVIEW_FLAG_CLEARED').map((h) => h.newValue)).toEqual([
      { code: 'DISCOUNTS_REVIEW' },
    ]);
    const [entry] = historyOf(ctx, id, 'DISCOUNTS_RECALCULATED');
    expect(entry).toMatchObject({ uniqueKey: 'edit:op-disc-01', actor: 'user:1' });
    expect(entry.newValue).toMatchObject({
      kind: 'discounts',
      added: [{ promotionId: promo, amount: 1500 }],
      removed: [],
      kept: { promotions: [], manual: [] },
      totals: { total: 4500 },
    });
    expect(entry.previousValue).toMatchObject({ totals: { total: 6000 } });
  });
});

describe('exact line discounts: a recalculated promotion splits the line', () => {
  it('buy 2 get 1 on a 3-unit line → lines of 2 and 1 of the same variant; stock unchanged', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 3 }]);
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 6000, total: 6500 });
    const stock = stockOf(ctx, 10);
    const movements = ctx.tables[UIDS.stockMovement].length;
    const original = linesOf(ctx, id)[0];
    const promo = addPromotion(ctx, {
      name: 'Buy 2 get 1',
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'IN_CART', target: T([10]), quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });

    const res = await ctx.editing.applyDiscounts(
      id,
      { selection: [`p:${promo}`] },
      'user:1',
      'op-split-01'
    );
    expect(res).toMatchObject({ difference: -2000 });

    const lines = linesOf(ctx, id).filter((l) => l.variantId === 10);
    expect(lines).toHaveLength(2);
    const [kept, added] = lines;
    expect(kept).toMatchObject({
      id: original.id,
      quantity: 2,
      unitDiscount: 0,
      promotionRefs: { refs: [] },
    });
    expect(added).toMatchObject({
      variant: 10,
      variantId: 10,
      productId: original.productId,
      sku: original.sku,
      name: original.name,
      option: original.option,
      imageUrl: original.imageUrl,
      unitPrice: 2000,
      tax: original.tax,
      quantity: 1,
      returnedQuantity: 0,
      isGift: false,
      manualDiscountPercent: null,
      unitDiscount: 2000,
      promotionRefs: { refs: [{ promotionId: promo, benefitIndex: 0, amount: 2000 }] },
    });
    expect(added.position).toBeGreaterThan(kept.position);
    expect(orderRow(ctx, id)).toMatchObject({
      subtotal: 4000,
      productDiscount: 2000,
      orderDiscount: 0,
      total: 4500,
    });
    expect(stockOf(ctx, 10)).toBe(stock);
    expect(ctx.tables[UIDS.stockMovement]).toHaveLength(movements);
    const [entry] = historyOf(ctx, id, 'DISCOUNTS_RECALCULATED');
    expect(entry.newValue).toMatchObject({
      added: [{ promotionId: promo, amount: 2000 }],
      totals: { total: 4500 },
      splitLines: [
        { orderLineId: original.id, quantity: 2, newLines: [{ id: added.id, quantity: 1 }] },
      ],
    });
  });
});

describe('exact line discounts: a shipped line is never split', () => {
  it('buy 2 get 1 on a partially shipped order: the shipped line keeps its units and price', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [
      { variantId: 10, quantity: 3 },
      { variantId: 12, quantity: 1 },
    ]);
    const before = linesOf(ctx, id).map((l) => ({ ...l }));
    const a = before.find((l) => l.variantId === 10);
    // An ACTIVE shipment of line A only (B not shipped): the order is partially shipped.
    ctx.tables[UIDS.shipment].push({
      id: ctx.tables[UIDS.shipment].length + 1,
      order: id,
      providerId: 'manual',
      carrierName: 'CTT',
      status: 'ACTIVE',
      deliveryStatus: 'DELIVERED',
      items: {
        lines: [{ orderLineId: a.id, sku: a.sku, name: a.name, option: null, quantity: 3 }],
      },
      idempotencyKey: `ship-${id}`,
    });
    const stock = stockOf(ctx, 10);
    const promo = addPromotion(ctx, {
      name: 'Buy 2 get 1',
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'IN_CART', target: T([10]), quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });

    await ctx.editing.applyDiscounts(id, { selection: [`p:${promo}`] }, 'user:1', 'op-split-02');

    const after = linesOf(ctx, id);
    expect(after).toHaveLength(2);
    expect(after.find((l) => l.id === a.id)).toMatchObject({
      quantity: 3,
      unitDiscount: 0,
      promotionRefs: a.promotionRefs,
    });
    expect(orderRow(ctx, id)).toMatchObject({ productDiscount: 0, orderDiscount: 0 });
    expect(stockOf(ctx, 10)).toBe(stock);
    const [entry] = historyOf(ctx, id, 'DISCOUNTS_RECALCULATED');
    expect(entry.newValue).not.toHaveProperty('splitLines');
  });
});

describe('applied promotions that are no longer valid (ruling 13)', () => {
  const recalcOf = async (ctx: Ctx, id: number) =>
    (await ctx.editing.previewDiscounts(id, {})).rows;

  it('deactivated → INACTIVE; expired → EXPIRED; deleted → NOT_FOUND', async () => {
    for (const [change, reason] of [
      [(r: any) => (r.active = false), 'INACTIVE'],
      [(r: any) => (r.endsAt = '2021-01-01T00:00:00.000Z'), 'EXPIRED'],
    ] as const) {
      const ctx = setup();
      const promo = tenPercent(ctx);
      const id = await createOrder(ctx);
      change(promotionRow(ctx, promo));
      expect(await recalcOf(ctx, id)).toEqual([
        expect.objectContaining({
          kind: 'APPLIED_INVALID',
          invalidReason: reason,
          currentAmount: 650,
        }),
      ]);
    }
    const ctx = setup();
    const promo = tenPercent(ctx);
    const id = await createOrder(ctx);
    ctx.tables[UIDS.promotion].splice(
      ctx.tables[UIDS.promotion].indexOf(promotionRow(ctx, promo)),
      1
    );
    expect(await recalcOf(ctx, id)).toEqual([
      expect.objectContaining({ kind: 'APPLIED_INVALID', invalidReason: 'NOT_FOUND' }),
    ]);
  });

  it('a CODE promotion whose code was renamed is still valid (its current code is evaluated)', async () => {
    const ctx = setup();
    const promo = tenPercent(ctx, { method: 'CODE', code: 'SAVE10' });
    const id = await createWithCodes(ctx, [{ variantId: 10, quantity: 2 }], ['SAVE10']);
    expect(orderRow(ctx, id).orderDiscount).toBe(400);
    promotionRow(ctx, promo).code = 'SAVE20';
    expect(await recalcOf(ctx, id)).toEqual([
      expect.objectContaining({ key: `p:${promo}`, kind: 'APPLIED_VALID', amount: 400 }),
    ]);
  });

  it('kept: its amount is unchanged; an empty selection never removes it', async () => {
    const ctx = setup();
    const promo = tenPercent(ctx);
    const id = await createOrder(ctx);
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 650, total: 6350 });
    await pay(ctx, id, 6350);
    promotionRow(ctx, promo).endsAt = '2021-01-01T00:00:00.000Z';
    const release = vi.spyOn(ctx.promotions, 'releasePromotions');

    const kept = await ctx.editing.applyDiscounts(
      id,
      { selection: [`p:${promo}`] },
      'user:1',
      'op-keep-01'
    );
    expect(kept).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 650, total: 6350 });
    expect(redemptionsOf(ctx, id)).toEqual([expect.objectContaining({ status: 'RESERVED' })]);
    expect(release).not.toHaveBeenCalled();

    expect(
      await issues(ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-drop-01'))
    ).toEqual([{ path: 'selection', code: 'DISCOUNT_NOT_REMOVABLE' }]);
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 650, total: 6350 });
    expect(orderRow(ctx, id).promotions.applied).toEqual([
      expect.objectContaining({ promotionId: promo }),
    ]);
    expect(release).not.toHaveBeenCalled();
    expect(redemptionsOf(ctx, id)).toEqual([expect.objectContaining({ status: 'RESERVED' })]);
  });

  it("the order's own redemption does not count against perCustomerLimit (Review Focus 1)", async () => {
    const ctx = setup();
    const promo = tenPercent(ctx, { perCustomerLimit: 1, usageLimit: 1 });
    const id = await createOrder(ctx);
    expect(promotionRow(ctx, promo).redemptions).toBe(1);
    expect(await recalcOf(ctx, id)).toEqual([
      expect.objectContaining({ kind: 'APPLIED_VALID', invalidReason: null, amount: 650 }),
    ]);
    await ctx.editing.applyDiscounts(id, { selection: [`p:${promo}`] }, 'user:1', 'op-own-001');
    expect(promotionRow(ctx, promo).redemptions).toBe(1);
    expect(orderRow(ctx, id).orderDiscount).toBe(650);
  });
});

describe('gift lines (ruling 16)', () => {
  const giftOf12 = (ctx: Ctx) =>
    addPromotion(ctx, {
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds: [12], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });

  it('a gift promotion is never removed: its gift line stays', async () => {
    const ctx = setup();
    const promo = giftOf12(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    expect(linesOf(ctx, id).find((l) => l.isGift)).toMatchObject({ variantId: 12, quantity: 1 });
    expect(stockOf(ctx, 12)).toBe(9);
    promotionRow(ctx, promo).active = false;

    expect(
      await issues(ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-gift-01'))
    ).toEqual([{ path: 'selection', code: 'DISCOUNT_NOT_REMOVABLE' }]);
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10, 12]);
    expect(stockOf(ctx, 12)).toBe(9);
  });

  it('deselecting it once its gift was shipped → PROMOTION_GIFT_SHIPPED', async () => {
    const ctx = setup();
    const promo = giftOf12(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    shipEverything(ctx, id);
    promotionRow(ctx, promo).active = false;
    expect((await ctx.editing.previewDiscounts(id, {})).rows).toEqual([
      expect.objectContaining({ key: `p:${promo}`, locked: 'GIFT_SHIPPED' }),
    ]);
    const snapshot = JSON.stringify(ctx.tables);
    expect(
      await issues(ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-gift-02'))
    ).toEqual([{ path: 'selection', code: 'PROMOTION_GIFT_SHIPPED' }]);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
  });
});

describe('applyDiscounts errors', () => {
  it('a conflicting selection → PROMOTIONS_NOT_COMBINABLE', async () => {
    const ctx = setup();
    const a = tenPercent(ctx);
    const id = await createOrder(ctx);
    const b = addPromotion(ctx, {
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 20 }] },
      stacking: { ...STACK_ALL, exclusive: true },
    });
    const preview = await ctx.editing.previewDiscounts(id, { selection: [`p:${a}`, `p:${b}`] });
    expect(preview.conflicts).toEqual([[`p:${a}`, `p:${b}`]]);
    const snapshot = JSON.stringify(ctx.tables);
    expect(
      await issues(
        ctx.editing.applyDiscounts(
          id,
          { selection: [`p:${a}`, `p:${b}`] },
          'user:1',
          'op-conflict1'
        )
      )
    ).toEqual([{ path: 'selection', code: 'PROMOTIONS_NOT_COMBINABLE' }]);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
  });

  it('a cancelled order → ORDER_NOT_EDITABLE', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.orders.cancel(id, 'user:1');
    expect(
      await issues(ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-cancel-01'))
    ).toEqual([{ path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'CANCELLED' }]);
    expect(await issues(ctx.editing.previewDiscounts(id, {}))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'CANCELLED' },
    ]);
  });

  it('a malformed selection → 400', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect(
      await issues(
        ctx.editing.applyDiscounts(id, { selection: 'x' } as any, 'user:1', 'op-bad-sel1')
      )
    ).toEqual([{ path: 'selection', code: 'required' }]);
  });
});

describe('legacy manual discount (spec 7.4)', () => {
  it('a LEGACY item above the clamped order discount is capped by the products save and the discounts save', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const row = orderRow(ctx, id);
    Object.assign(row, { orderDiscount: 5000, total: 2000, manualDiscounts: null });
    // The products save clamps the discount at the new subtotal (2500).
    await ctx.editing.applyLines(
      id,
      { lines: lineInputs(ctx, id).filter((l) => l.variantId === 11) },
      'user:1',
      'op-legacy-01'
    );
    expect(orderRow(ctx, id).orderDiscount).toBe(2500);
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 2500 }),
    ]);

    await ctx.editing.applyDiscounts(id, { selection: ['m:1'] }, 'user:1', 'op-legacy-02');
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 2500, total: 500 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 2500 }),
    ]);
  });

  /** Products save down to variant 11 (subtotal 2500), then back up with 2 × variant 10 (6500). */
  const clampThenRaise = async (ctx: Ctx, id: number) => {
    await ctx.editing.applyLines(
      id,
      { lines: lineInputs(ctx, id).filter((l) => l.variantId === 11) },
      'user:1',
      'op-clamp-001'
    );
    expect(orderRow(ctx, id).orderDiscount).toBe(2500);
    await ctx.editing.applyLines(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 10, quantity: 2 }] },
      'user:1',
      'op-raise-001'
    );
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 6500, orderDiscount: 2500 });
  };

  it('a clamped LEGACY item is persisted capped by the products save; a later recalculation keeps 2500', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    Object.assign(orderRow(ctx, id), { orderDiscount: 5000, total: 2000, manualDiscounts: null });
    await clampThenRaise(ctx, id);
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 2500 }),
    ]);
    const preview = await ctx.editing.previewDiscounts(id, {});
    expect(preview.rows).toEqual([expect.objectContaining({ key: 'm:1', amount: 2500 })]);
    expect(preview.orderDiscount).toBe(2500);
    await ctx.editing.applyDiscounts(id, { selection: ['m:1'] }, 'user:1', 'op-recalc-01');
    expect(orderRow(ctx, id).orderDiscount).toBe(2500);
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 2500 }),
    ]);
  });

  it('a stored manual list above the order discount is priced capped (preview and apply)', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    // Persisted unreconciled by an earlier version: LEGACY 5000 next to orderDiscount 2500.
    Object.assign(orderRow(ctx, id), {
      orderDiscount: 2500,
      total: 4500,
      manualDiscounts: {
        items: [
          {
            id: 1,
            kind: 'LEGACY',
            percent: null,
            amount: 5000,
            reason: 'Previous manual adjustment',
            createdAt: '',
            actor: 'system',
          },
        ],
      },
    });
    const preview = await ctx.editing.previewDiscounts(id, {});
    expect(preview.rows).toEqual([
      expect.objectContaining({ key: 'm:1', currentAmount: 2500, amount: 2500 }),
    ]);
    expect(preview.orderDiscount).toBe(2500);
    await ctx.editing.applyDiscounts(id, { selection: ['m:1'] }, 'user:1', 'op-recalc-03');
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 2500, total: 4500 });
  });

  it('the same with a FIXED manual item', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.editing.addManualDiscount(
      id,
      { kind: 'FIXED', value: 5000, reason: 'Gesture' },
      'user:1',
      'op-fixed-big'
    );
    await clampThenRaise(ctx, id);
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'FIXED', amount: 2500 }),
    ]);
    await ctx.editing.applyDiscounts(id, { selection: ['m:1'] }, 'user:1', 'op-recalc-02');
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 2500, total: 4500 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'FIXED', amount: 2500 }),
    ]);
  });

  it('the LEGACY item is never removed by the recalculation', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    Object.assign(orderRow(ctx, id), { orderDiscount: 1000, total: 6000, manualDiscounts: null });
    expect(
      await issues(ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-legacy-03'))
    ).toEqual([{ path: 'selection', code: 'DISCOUNT_NOT_REMOVABLE' }]);
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 1000, total: 6000 });
  });
});

describe('manual discounts (spec 7.2, ruling 18)', () => {
  it('PERCENT 10 on a subtotal of 4000 → 400 off; removing it restores the total', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    const res = await ctx.editing.addManualDiscount(
      id,
      { kind: 'PERCENT', value: 10, reason: 'Damaged box' },
      'user:1',
      'op-manual-01'
    );
    expect(res).toMatchObject({ outcome: 'NONE', difference: -400 });
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 400, total: 4100 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({
        id: 1,
        kind: 'PERCENT',
        percent: 10,
        amount: 400,
        reason: 'Damaged box',
        actor: 'user:1',
      }),
    ]);
    const [entry] = historyOf(ctx, id, 'MANUAL_DISCOUNT_ADDED');
    expect(entry.newValue).toMatchObject({
      kind: 'manual-discount-add',
      id: 1,
      percent: 10,
      amount: 400,
      reason: 'Damaged box',
    });
    expect(
      JSON.stringify([ctx.log.warn.mock.calls, ctx.log.info.mock.calls, ctx.log.error.mock.calls])
    ).not.toContain('Damaged box');

    const removed = await ctx.editing.removeManualDiscount(id, 1, 'user:1', 'op-manual-02');
    expect(removed).toMatchObject({ difference: 400 });
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 0, total: 4500 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([]);
    expect(historyOf(ctx, id, 'MANUAL_DISCOUNT_REMOVED')[0].newValue).toMatchObject({
      id: 1,
      amount: 400,
    });
  });

  it('FIXED above the remaining products → DISCOUNT_EXCEEDS_PRODUCTS; unknown id → MANUAL_DISCOUNT_NOT_FOUND', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    await ctx.editing.addManualDiscount(
      id,
      { kind: 'FIXED', value: 1000, reason: 'Gesture' },
      'user:1',
      'op-fixed-001'
    );
    expect(
      await issues(
        ctx.editing.addManualDiscount(
          id,
          { kind: 'FIXED', value: 3001, reason: 'Too much' },
          'user:1',
          'op-fixed-002'
        )
      )
    ).toEqual([{ path: 'value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }]);
    expect(await issues(ctx.editing.removeManualDiscount(id, 9, 'user:1', 'op-fixed-003'))).toEqual(
      [{ path: 'discountId', code: 'MANUAL_DISCOUNT_NOT_FOUND' }]
    );
    expect(orderRow(ctx, id).orderDiscount).toBe(1000);
  });

  it('a discount added after invoicing a paid order → REFUNDABLE, and no refund or credit note', async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    await pay(ctx, id, 4500);
    issueInvoice(ctx, id);
    const res = await ctx.editing.addManualDiscount(
      id,
      { kind: 'FIXED', value: 500, reason: 'Late delivery' },
      'user:1',
      'op-after-inv1'
    );
    expect(res).toMatchObject({ outcome: 'REFUNDABLE', difference: -500 });
    expect(ctx.tables[UIDS.refund]).toEqual([]);
    expect(ctx.tables[UIDS.invoice].map((i) => i.kind)).toEqual(['INVOICE']);
  });
});

describe('manual discount removal lock (whole-item and legacy invoices)', () => {
  const invoiceWith = (ctx: Ctx, orderId: number, lines: unknown[]) =>
    ctx.tables[UIDS.invoice].push({
      id: ctx.tables[UIDS.invoice].length + 1,
      order: orderId,
      kind: 'INVOICE',
      status: 'ISSUED',
      createdAt: new Date(Date.now() + 1000).toISOString(),
      lines: { lines },
    });
  const withTwoDiscounts = async () => {
    const ctx = setup();
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    await ctx.editing.addManualDiscount(id, { kind: 'FIXED', value: 300, reason: 'A' }, 'user:1', 'op-lock-001');
    await ctx.editing.addManualDiscount(id, { kind: 'FIXED', value: 200, reason: 'B' }, 'user:1', 'op-lock-002');
    return { ctx, id };
  };

  it('a whole-item invoice locks only the manual discounts it has a DISCOUNT record of', async () => {
    const { ctx, id } = await withTwoDiscounts();
    invoiceWith(ctx, id, [
      { kind: 'SHIPPING', orderLineId: null, sku: 'SHIPPING', name: 'S', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId: 1, discountShare: 0 },
      { kind: 'DISCOUNT', orderLineId: null, sku: 'DISCOUNT', name: 'B', quantity: 1, total: -200, tax: 0, partial: false, discountId: 'm:2' },
    ]);
    const view = await ctx.orders.get(id);
    expect(view.manualDiscounts.map((m: any) => [m.id, m.invoiced])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(await issues(ctx.editing.removeManualDiscount(id, 2, 'user:1', 'op-lock-003'))).toEqual([
      { path: 'discountId', code: 'MANUAL_DISCOUNT_INVOICED' },
    ]);
    await ctx.editing.removeManualDiscount(id, 1, 'user:1', 'op-lock-004');
    expect(orderRow(ctx, id).manualDiscounts.items.map((m: any) => m.id)).toEqual([2]);
  });

  it('a legacy invoice (no DISCOUNT record, no share) keeps the date rule', async () => {
    const { ctx, id } = await withTwoDiscounts();
    issueInvoice(ctx, id);
    const view = await ctx.orders.get(id);
    expect(view.manualDiscounts.map((m: any) => m.invoiced)).toEqual([true, true]);
    expect(await issues(ctx.editing.removeManualDiscount(id, 1, 'user:1', 'op-lock-005'))).toEqual([
      { path: 'discountId', code: 'MANUAL_DISCOUNT_INVOICED' },
    ]);
  });
});

describe('dismissReviewFlag (ruling 23)', () => {
  const raised = (ctx: Ctx, id: number) => {
    orderRow(ctx, id).reviewFlags = {
      flags: [
        {
          code: 'DISCOUNTS_REVIEW',
          reason: 'PRODUCTS_CHANGED',
          raisedAt: '2026-01-01T00:00:00.000Z',
          actor: 'user:1',
        },
      ],
    };
  };

  it('on an editable order → REVIEW_FLAG_NOT_DISMISSABLE', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    raised(ctx, id);
    expect(
      await issues(ctx.editing.dismissReviewFlag(id, 'DISCOUNTS_REVIEW', 'user:1', 'op-dismiss-1'))
    ).toEqual([{ path: 'code', code: 'REVIEW_FLAG_NOT_DISMISSABLE' }]);
    expect(flagsOf(ctx, id)).toHaveLength(1);
  });

  it('SHIPPING_REVIEW can be marked as seen on an editable order; the other flags stay', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    orderRow(ctx, id).reviewFlags = {
      flags: [
        { code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED', raisedAt: '2026-01-01T00:00:00.000Z', actor: 'user:1' },
        { code: 'DISCOUNTS_REVIEW', reason: 'PRODUCTS_CHANGED', raisedAt: '2026-01-01T00:00:00.000Z', actor: 'user:1' },
      ],
    };
    await ctx.editing.dismissReviewFlag(id, 'SHIPPING_REVIEW', 'user:1', 'op-dismiss-ship');
    expect(flagsOf(ctx, id).map((f: any) => f.code)).toEqual(['DISCOUNTS_REVIEW']);
  });

  it('REFUND_REVIEW (plan 15) can be dismissed on an editable order', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    orderRow(ctx, id).reviewFlags = {
      flags: [
        {
          code: 'REFUND_REVIEW',
          reason: 'REFUND_REVERSED_WITH_CREDIT_NOTE',
          raisedAt: '2026-01-01T00:00:00.000Z',
          actor: 'webhook:stripe',
        },
      ],
    };
    await ctx.editing.dismissReviewFlag(id, 'REFUND_REVIEW', 'user:1', 'op-dismiss-refund');
    expect(flagsOf(ctx, id)).toEqual([]);
  });

  it('on a cancelled order: the flag is removed and REVIEW_FLAG_DISMISSED recorded', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.orders.cancel(id, 'user:1');
    raised(ctx, id);
    const res = await ctx.editing.dismissReviewFlag(
      id,
      'DISCOUNTS_REVIEW',
      'user:1',
      'op-dismiss-2'
    );
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(flagsOf(ctx, id)).toEqual([]);
    expect(historyOf(ctx, id, 'REVIEW_FLAG_DISMISSED')).toEqual([
      expect.objectContaining({
        uniqueKey: 'edit:op-dismiss-2',
        newValue: expect.objectContaining({ kind: 'review-dismiss', code: 'DISCOUNTS_REVIEW' }),
      }),
    ]);
  });

  it('a flag that is not raised, or not a flag code → 400 invalid', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.orders.cancel(id, 'user:1');
    raised(ctx, id);
    expect(
      await issues(ctx.editing.dismissReviewFlag(id, 'SHIPPING_REVIEW', 'user:1', 'op-dismiss-3'))
    ).toEqual([{ path: 'code', code: 'invalid' }]);
    expect(
      await issues(ctx.editing.dismissReviewFlag(id, 'NOPE' as any, 'user:1', 'op-dismiss-4'))
    ).toEqual([{ path: 'code', code: 'invalid' }]);
  });
});

describe('create order with manual discounts (duplicate order spec)', () => {
  const baseInput = (extra: Record<string, unknown> = {}) => ({
    customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
    shippingAddress: address,
    billingAddress: address,
    locale: 'en',
    lines: [
      { variantId: 10, quantity: 2 },
      { variantId: 11, quantity: 1 },
    ],
    shipping: { providerId: 'manual', serviceId: '1' },
    ...extra,
  });
  const quoteInput = (extra: Record<string, unknown> = {}) => ({
    locale: 'en',
    email: 'ana@example.pt',
    lines: [
      { variantId: 10, quantity: 2 },
      { variantId: 11, quantity: 1 },
    ],
    shipping: { country: 'PT', postalCode: '1000-001', providerId: 'manual', serviceId: '1' },
    ...extra,
  });
  const admin = { actor: 'user:1', source: 'admin' as const };
  /** Subtotal 6500, promotion ORDER_PERCENT 10 → 650, shipping 500: total 6350. */
  const TWO = [
    { kind: 'FIXED', value: 500, reason: 'Gesture' },
    { kind: 'PERCENT', value: 10, reason: 'Loyal customer' },
  ];

  it('rejects malformed entries with indexed paths and creates nothing', async () => {
    const ctx = setup();
    const errs = await issues(
      ctx.orders.create(
        baseInput({
          manualDiscounts: [
            { kind: 'FIXED', value: 1.5, reason: 'Cents only' },
            { kind: 'PERCENT', value: 10.123, reason: '  ' },
            { kind: 'PERCENT', value: 5, reason: 'x'.repeat(201) },
            { kind: 'OTHER', value: 5, reason: 'Kind' },
          ],
        }) as any,
        admin
      )
    );
    expect(errs).toEqual(
      expect.arrayContaining([
        { path: 'manualDiscounts.0.value', code: 'INVALID_AMOUNT' },
        { path: 'manualDiscounts.1.value', code: 'INVALID_AMOUNT' },
        { path: 'manualDiscounts.1.reason', code: 'required' },
        { path: 'manualDiscounts.2.reason', code: 'required' },
        { path: 'manualDiscounts.3.kind', code: 'required' },
      ])
    );
    expect(errs).toHaveLength(5);
    expect(ctx.tables[UIDS.order]).toEqual([]);
  });

  it('rejects a non-list and more than ten entries', async () => {
    const ctx = setup();
    expect(
      await issues(ctx.orders.create(baseInput({ manualDiscounts: 'x' }) as any, admin))
    ).toEqual([{ path: 'manualDiscounts', code: 'invalid' }]);
    const eleven = Array.from({ length: 11 }, () => ({ kind: 'FIXED', value: 1, reason: 'R' }));
    expect(
      await issues(ctx.orders.create(baseInput({ manualDiscounts: eleven }) as any, admin))
    ).toEqual([{ path: 'manualDiscounts', code: 'too_many' }]);
    expect(
      await issues(ctx.orders.quote(quoteInput({ manualDiscounts: eleven }) as any, { manualDiscounts: true }))
    ).toEqual([{ path: 'manualDiscounts', code: 'too_many' }]);
    expect(ctx.tables[UIDS.order]).toEqual([]);
  });

  it('a discount above the subtotal after promotions → DISCOUNT_EXCEEDS_PRODUCTS (quote and create)', async () => {
    const ctx = setup();
    addPromotion(ctx);
    const over = [{ kind: 'FIXED', value: 5851, reason: 'Too much' }];
    expect(
      await issues(ctx.orders.create(baseInput({ manualDiscounts: over }) as any, admin))
    ).toEqual([{ path: 'manualDiscounts.0.value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }]);
    expect(
      await issues(ctx.orders.quote(quoteInput({ manualDiscounts: over }) as any, { manualDiscounts: true }))
    ).toEqual([{ path: 'manualDiscounts.0.value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }]);
    // The second entry's base already has the first one taken off.
    const pair = [
      { kind: 'FIXED', value: 5000, reason: 'A' },
      { kind: 'FIXED', value: 851, reason: 'B' },
    ];
    expect(
      await issues(ctx.orders.create(baseInput({ manualDiscounts: pair }) as any, admin))
    ).toEqual([{ path: 'manualDiscounts.1.value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' }]);
    expect(ctx.tables[UIDS.order]).toEqual([]);
    const exact = await ctx.orders.create(
      baseInput({ manualDiscounts: [{ kind: 'FIXED', value: 5850, reason: 'All' }] }) as any,
      admin
    );
    expect(exact.total).toBe(500);
  });

  it('the quote applies them on top of the promotions and reports each amount', async () => {
    const ctx = setup();
    addPromotion(ctx);
    const plain = await ctx.orders.quote(quoteInput() as any, { manualDiscounts: true });
    expect(plain.totals).toMatchObject({ subtotal: 6500, orderDiscount: 650, total: 6350 });
    expect(plain.manualDiscounts).toEqual([]);
    const q = await ctx.orders.quote(quoteInput({ manualDiscounts: TWO }) as any, {
      manualDiscounts: true,
    });
    expect(q.manualDiscounts).toEqual([
      { kind: 'FIXED', percent: null, amount: 500, reason: 'Gesture' },
      { kind: 'PERCENT', percent: 10, amount: 650, reason: 'Loyal customer' },
    ]);
    expect(q.totals).toMatchObject({
      subtotal: 6500,
      orderDiscount: 1800,
      shippingTotal: 500,
      total: 5200,
      totalDiscount: plain.totals.totalDiscount + 1150,
    });
  });

  it('the storefront quote and order ignore them', async () => {
    const ctx = setup();
    const q = await ctx.orders.quote(quoteInput({ manualDiscounts: TWO }) as any);
    expect(q.totals.total).toBe(7000);
    expect(q.manualDiscounts).toEqual([]);
  });

  it('create stores them as addManualDiscount would; totals reconcile with the view and the quote', async () => {
    const ctx = setup();
    addPromotion(ctx);
    const q = await ctx.orders.quote(quoteInput({ manualDiscounts: TWO }) as any, {
      manualDiscounts: true,
    });
    const created = await ctx.orders.create(
      baseInput({ manualDiscounts: TWO, expectedTotal: q.totals.total, idempotencyKey: 'dup-1' }) as any,
      admin
    );
    expect(created.total).toBe(5200);
    const row = orderRow(ctx, created.id);
    expect(row).toMatchObject({ subtotal: 6500, orderDiscount: 1800, shippingTotal: 500, total: 5200 });
    expect(row.manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'FIXED', percent: null, amount: 500, reason: 'Gesture', actor: 'user:1' }),
      expect.objectContaining({ id: 2, kind: 'PERCENT', percent: 10, amount: 650, reason: 'Loyal customer', actor: 'user:1' }),
    ]);
    const added = historyOf(ctx, created.id, 'MANUAL_DISCOUNT_ADDED');
    expect(added.map((h) => h.newValue)).toEqual([
      { id: 1, kind: 'FIXED', percent: null, amount: 500, reason: 'Gesture' },
      { id: 2, kind: 'PERCENT', percent: 10, amount: 650, reason: 'Loyal customer' },
    ]);
    expect(added.map((h) => h.description)).toEqual([
      'Manual discount added: 500 cents',
      'Manual discount added: 650 cents',
    ]);

    // The view and the order's own recomputation agree with what was stored.
    const view = await ctx.orders.get(created.id);
    expect(view.totals).toMatchObject({ orderDiscount: 1800, total: 5200 });
    expect(view.summary.due).toBe(5200);
    expect(view.manualDiscounts.map((m: any) => [m.id, m.amount, m.invoiced])).toEqual([
      [1, 500, false],
      [2, 650, false],
    ]);
    const preview = await ctx.editing.previewDiscounts(created.id, {});
    expect(preview.orderDiscount).toBe(1800);
    // Removing then re-adding through the order editing lands on the same totals.
    await ctx.editing.removeManualDiscount(created.id, 2, 'user:1', 'op-dup-rm-2');
    expect(orderRow(ctx, created.id)).toMatchObject({ orderDiscount: 1150, total: 5850 });
    await ctx.editing.addManualDiscount(
      created.id,
      { kind: 'PERCENT', value: 10, reason: 'Loyal customer' },
      'user:1',
      'op-dup-add-2'
    );
    expect(orderRow(ctx, created.id)).toMatchObject({ orderDiscount: 1800, total: 5200 });

    // An idempotent replay returns the stored order.
    const replay = await ctx.orders.create(
      baseInput({ manualDiscounts: TWO, idempotencyKey: 'dup-1' }) as any,
      admin
    );
    expect(replay).toMatchObject({ id: created.id, replayed: true });
  });

  it('TOTAL_CHANGED when the shown total left the manual discounts out', async () => {
    const ctx = setup();
    addPromotion(ctx);
    const plain = await ctx.orders.quote(quoteInput() as any, { manualDiscounts: true });
    const err: any = await ctx.orders
      .create(baseInput({ manualDiscounts: TWO, expectedTotal: plain.totals.total }) as any, admin)
      .catch((e) => e);
    expect(err.errors).toEqual([
      { path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: '5200' },
    ]);
    expect(ctx.tables[UIDS.order]).toEqual([]);
  });

  it('an order without manual discounts is stored as before', async () => {
    const ctx = setup();
    addPromotion(ctx);
    ctx.tables[UIDS.variant].find((v) => v.id === 11).stock = 10;
    const a = await ctx.orders.create(baseInput() as any, admin);
    const b = await ctx.orders.create(baseInput({ manualDiscounts: [] }) as any, admin);
    const strip = (r: any) => {
      const { id, reference, publicId, createdAt, updatedAt, promotions, shippingLines, ...rest } = r;
      return {
        ...rest,
        promotions: { ...promotions, evaluatedAt: null },
        shippingLines: shippingLines.lines.map(({ createdAt: _c, ...l }: any) => l),
      };
    };
    expect(strip(orderRow(ctx, b.id))).toEqual(strip(orderRow(ctx, a.id)));
    expect(orderRow(ctx, a.id)).toMatchObject({ orderDiscount: 650, total: 6350, manualDiscounts: { items: [] } });
    for (const id of [a.id, b.id]) {
      expect(historyOf(ctx, id).map((h) => h.type)).toEqual(['ORDER_CREATED', 'PROMOTIONS_APPLIED']);
    }
  });

  it('a storefront order ignores them', async () => {
    const ctx = setup();
    const created = await ctx.orders.create(baseInput({ manualDiscounts: TWO }) as any, {
      actor: 'storefront',
      source: 'storefront',
    });
    expect(created.total).toBe(7000);
    expect(orderRow(ctx, created.id).manualDiscounts).toEqual({ items: [] });
  });
});

describe('remove an applied promotion (owner approved)', () => {
  /** Buy 2 of variant 10, get a variant 12 free (a gift line). */
  const buy2Gift = (ctx: Ctx) =>
    addPromotion(ctx, {
      name: 'Buy 2 get a gift',
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds: [12], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
  const freeShipping = (ctx: Ctx) =>
    addPromotion(ctx, {
      name: 'Free shipping over 30',
      conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 3000 }]),
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });

  /** Order 25's shape: a gift promotion, free shipping and a manual discount of 300. */
  const order25 = async () => {
    const ctx = setup();
    const gift = buy2Gift(ctx);
    const shipping = freeShipping(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    await ctx.editing.addManualDiscount(id, { kind: 'FIXED', value: 300, reason: 'Loyal' }, 'user:1', 'op-rp-manual');
    const row = orderRow(ctx, id);
    expect(row.promotions.applied.map((a: any) => a.promotionId).sort()).toEqual([gift, shipping].sort());
    expect(linesOf(ctx, id).find((l) => l.isGift)).toMatchObject({ variantId: 12, quantity: 1 });
    return { ctx, id, gift, shipping };
  };

  it('the order view says each promotion can be removed, with the total change and gift units', async () => {
    const { ctx, id, gift, shipping } = await order25();
    const view = await ctx.orders.get(id);
    const byId = new Map(view.promotions.map((p: any) => [p.promotionId, p.removal]));
    expect(byId.get(gift)).toEqual({ blockedBy: null, difference: 0, giftUnits: 1 });
    expect(byId.get(shipping)).toEqual({ blockedBy: null, difference: 500, giftUnits: 0 });
  });

  it('removing the gift promotion removes its gift line (restocked); the rest stays', async () => {
    const { ctx, id, gift, shipping } = await order25();
    const before = orderRow(ctx, id);
    const total = before.total;
    const productDiscount = before.productDiscount;
    expect(stockOf(ctx, 12)).toBe(9);
    const result = await ctx.editing.removePromotion(id, gift, 'user:1', 'op-rp-gift-1');
    const row = orderRow(ctx, id);
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10]);
    expect(stockOf(ctx, 12)).toBe(10);
    expect(row.promotions.applied.map((a: any) => a.promotionId)).toEqual([shipping]);
    expect(row.productDiscount).toBe(productDiscount - 1500);
    expect(row.total).toBe(total);
    expect(row.shippingDiscount).toBe(500);
    expect(row.manualDiscounts.items.map((m: any) => m.amount)).toEqual([300]);
    expect(row.orderDiscount).toBe(300);
    expect(result.difference).toBe(0);
    expect(redemptionsOf(ctx, id).find((r) => r.promotion === gift)?.status).toBe('RELEASED');
    expect(redemptionsOf(ctx, id).find((r) => r.promotion === shipping)?.status).toBe('RESERVED');
    const [entry] = historyOf(ctx, id, 'PROMOTION_REMOVED');
    expect(entry.previousValue).toMatchObject({ promotionId: gift, name: 'Buy 2 get a gift', amount: 1500 });
    expect(entry.newValue).toMatchObject({ promotionId: gift, giftUnits: 1, kind: 'promotion-remove' });
  });

  it('removing free shipping charges the shipping again: a paid order now owes it', async () => {
    const { ctx, id, shipping } = await order25();
    const total = orderRow(ctx, id).total;
    await pay(ctx, id, total);
    expect(orderRow(ctx, id).paymentStatus).toBe('PAID');
    const result = await ctx.editing.removePromotion(id, shipping, 'user:1', 'op-rp-ship-1');
    const row = orderRow(ctx, id);
    expect(row.shippingDiscount).toBe(0);
    expect(row.total).toBe(total + 500);
    expect(result).toMatchObject({ outcome: 'DUE', difference: 500 });
    expect(row.paymentStatus).not.toBe('PAID');
    expect(linesOf(ctx, id).some((l) => l.isGift)).toBe(true);
  });

  it('is idempotent by operationId', async () => {
    const { ctx, id, shipping } = await order25();
    await ctx.editing.removePromotion(id, shipping, 'user:1', 'op-rp-same-1');
    const again = await ctx.editing.removePromotion(id, shipping, 'user:1', 'op-rp-same-1');
    expect(again.difference).toBe(500);
    expect(historyOf(ctx, id, 'PROMOTION_REMOVED')).toHaveLength(1);
  });

  it('refused once its gift was shipped → PROMOTION_SHIPPED, nothing written', async () => {
    const { ctx, id, gift, shipping } = await order25();
    shipEverything(ctx, id);
    const view = await ctx.orders.get(id);
    expect(view.promotions.find((p: any) => p.promotionId === gift).removal.blockedBy).toBe('PROMOTION_SHIPPED');
    const snapshot = JSON.stringify(ctx.tables);
    expect(await issues(ctx.editing.removePromotion(id, gift, 'user:1', 'op-rp-shipped'))).toEqual([
      { path: 'promotionId', code: 'PROMOTION_SHIPPED' },
    ]);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    // The shipping promotion discounts no shipped unit: still removable.
    await ctx.editing.removePromotion(id, shipping, 'user:1', 'op-rp-shipped-2');
  });

  it('refused once its gift units or the shipping are invoiced → PROMOTION_INVOICED', async () => {
    const { ctx, id, gift, shipping } = await order25();
    const giftLine = linesOf(ctx, id).find((l) => l.isGift);
    ctx.tables[UIDS.invoice].push({
      id: ctx.tables[UIDS.invoice].length + 1,
      order: id,
      kind: 'INVOICE',
      status: 'ISSUED',
      createdAt: new Date(Date.now() + 1000).toISOString(),
      lines: {
        lines: [
          { kind: 'ITEM', orderLineId: giftLine.id, sku: 'G', name: 'G', quantity: 1, total: 0, tax: 23, partial: false, discountShare: 0 },
          { kind: 'SHIPPING', orderLineId: null, sku: 'SHIPPING', name: 'S', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId: 1, discountShare: 0 },
        ],
      },
    });
    for (const [promo, op] of [
      [gift, 'op-rp-inv-1'],
      [shipping, 'op-rp-inv-2'],
    ] as const) {
      expect(await issues(ctx.editing.removePromotion(id, promo, 'user:1', op))).toEqual([
        { path: 'promotionId', code: 'PROMOTION_INVOICED' },
      ]);
    }
    expect(historyOf(ctx, id, 'PROMOTION_REMOVED')).toEqual([]);
  });

  it('a promotion the order does not have → PROMOTION_NOT_APPLIED; a cancelled order → ORDER_NOT_EDITABLE', async () => {
    const { ctx, id, gift } = await order25();
    expect(await issues(ctx.editing.removePromotion(id, 999, 'user:1', 'op-rp-none'))).toEqual([
      { path: 'promotionId', code: 'PROMOTION_NOT_APPLIED' },
    ]);
    orderRow(ctx, id).orderStatus = 'CANCELLED';
    const err = await issues(ctx.editing.removePromotion(id, gift, 'user:1', 'op-rp-cancel'));
    expect(err[0].code).toBe('ORDER_NOT_EDITABLE');
  });

  it("a code promotion: removed the same way, its redemption released and its code reads REMOVED", async () => {
    const ctx = setup();
    const promo = addPromotion(ctx, {
      name: '10 off',
      method: 'CODE',
      code: 'TEN',
      benefits: { items: [{ type: 'ORDER_FIXED', amount: 1000 }] },
    });
    const id = await createWithCodes(ctx, [{ variantId: 10, quantity: 2 }], ['TEN']);
    const total = orderRow(ctx, id).total;
    expect(orderRow(ctx, id).orderDiscount).toBe(1000);
    await ctx.editing.removePromotion(id, promo, 'user:1', 'op-rp-code-1');
    const row = orderRow(ctx, id);
    expect(row.orderDiscount).toBe(0);
    expect(row.total).toBe(total + 1000);
    expect(row.promotions.applied).toEqual([]);
    expect(row.promotions.codes).toEqual([
      expect.objectContaining({ code: 'TEN', status: 'REMOVED', promotionId: promo }),
    ]);
    expect(redemptionsOf(ctx, id).find((r) => r.promotion === promo)?.status).toBe('RELEASED');
    expect(promotionRow(ctx, promo).redemptions).toBe(0);
  });
});

describe('Recalculate discounts offers GIFT promotions (order 25)', () => {
  /** Buy 2 of variant 10, get one of `variantIds` free (a gift line). */
  const buy2Gift = (ctx: Ctx, variantIds = [12]) =>
    addPromotion(ctx, {
      name: 'Buy 2 get a gift',
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: T([10]), quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds, quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });

  /** Order 25: 2 × 10 and 2 × 12, paid; the gift promotion was removed. */
  const order25 = async (variantIds = [12]) => {
    const ctx = setup();
    const gift = buy2Gift(ctx, variantIds);
    const id = await createOrder(ctx, [
      { variantId: 10, quantity: 2 },
      { variantId: 12, quantity: 2 },
    ]);
    await ctx.editing.removePromotion(id, gift, 'user:1', 'op-g25-remove');
    expect(linesOf(ctx, id).some((l) => l.isGift)).toBe(false);
    await pay(ctx, id, orderRow(ctx, id).total);
    expect(orderRow(ctx, id).paymentStatus).toBe('PAID');
    return { ctx, id, gift };
  };

  it('the preview offers it, unselected, at its gift value with the gift variant', async () => {
    const { ctx, id, gift } = await order25();
    const before = JSON.stringify(ctx.tables);
    const preview = await ctx.editing.previewDiscounts(id, {});
    expect(JSON.stringify(ctx.tables)).toBe(before);
    expect(preview.rows).toEqual([
      expect.objectContaining({ key: `p:${gift}`, kind: 'NEW', selected: false, amount: 1500 }),
    ]);
    expect(preview.selection).toEqual([]);
    expect(preview.giftOptions).toEqual([
      {
        promotionId: gift,
        benefitIndex: 0,
        quantity: 1,
        selectedVariantId: 12,
        variants: [expect.objectContaining({ variantId: 12, sku: 'SH-XL', available: true })],
      },
    ]);
  });

  it('confirming adds one gift line at 0 net; the total and the payment status do not change', async () => {
    const { ctx, id, gift } = await order25();
    const total = orderRow(ctx, id).total;
    const stock12 = stockOf(ctx, 12);
    const res = await ctx.editing.applyDiscounts(
      id,
      { selection: [`p:${gift}`] },
      'user:1',
      'op-g25-apply'
    );
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    const giftLines = linesOf(ctx, id).filter((l) => l.isGift);
    expect(giftLines).toEqual([
      expect.objectContaining({
        variantId: 12,
        quantity: 1,
        unitPrice: 1500,
        unitDiscount: 1500,
        sku: 'SH-XL',
        promotionRefs: { refs: [{ promotionId: gift, benefitIndex: 0, amount: 1500 }] },
      }),
    ]);
    expect(stockOf(ctx, 12)).toBe(stock12 - 1);
    const row = orderRow(ctx, id);
    expect(row.total).toBe(total);
    expect(row.paymentStatus).toBe('PAID');
    expect(row.promotions.applied.map((a: any) => a.promotionId)).toEqual([gift]);
    expect(redemptionsOf(ctx, id).find((r) => r.status === 'RESERVED')).toMatchObject({
      promotion: gift,
    });
    const [entry] = historyOf(ctx, id, 'DISCOUNTS_RECALCULATED');
    expect(entry.newValue).toMatchObject({
      added: [{ promotionId: gift, amount: 1500 }],
      addedGiftLines: [{ variantId: 12, quantity: 1, promotionId: gift }],
      totals: { total },
    });
    // Applied now: the next preview keeps it locked and adds no further gift.
    const again = await ctx.editing.previewDiscounts(id, {});
    expect(again.rows).toEqual([
      expect.objectContaining({ key: `p:${gift}`, kind: 'APPLIED_VALID', locked: 'APPLIED' }),
    ]);
    expect(again.giftOptions).toEqual([]);
    expect(again.addedGiftLines).toEqual([]);
  });

  it('several gift variants: the admin chooses which one is added', async () => {
    const { ctx, id, gift } = await order25([12, 11]);
    const preview = await ctx.editing.previewDiscounts(id, { giftChoices: { [gift]: 11 } });
    expect(preview.giftOptions).toEqual([
      expect.objectContaining({
        selectedVariantId: 11,
        variants: [
          expect.objectContaining({ variantId: 12, available: true }),
          expect.objectContaining({ variantId: 11, available: true }),
        ],
      }),
    ]);
    expect(preview.rows[0]).toMatchObject({ amount: 2500 });
    await ctx.editing.applyDiscounts(
      id,
      { selection: [`p:${gift}`], giftChoices: { [gift]: 11 } },
      'user:1',
      'op-g25-choice'
    );
    expect(linesOf(ctx, id).filter((l) => l.isGift)).toEqual([
      expect.objectContaining({ variantId: 11, unitPrice: 2500, unitDiscount: 2500 }),
    ]);
    expect(stockOf(ctx, 11)).toBe(0);
  });

  it('invalid gift choices are refused', async () => {
    const { ctx, id } = await order25();
    expect(
      await issues(ctx.editing.previewDiscounts(id, { giftChoices: { 1: 'x' } as any }))
    ).toEqual([{ path: 'giftChoices.1', code: 'invalid' }]);
  });

  it('confirming with nothing selected changes nothing on the lines or totals', async () => {
    const { ctx, id } = await order25();
    const lines = JSON.stringify(linesOf(ctx, id));
    const total = orderRow(ctx, id).total;
    const res = await ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-g25-none');
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(JSON.stringify(linesOf(ctx, id))).toBe(lines);
    expect(orderRow(ctx, id).total).toBe(total);
    expect(orderRow(ctx, id).promotions.applied).toEqual([]);
  });
});

describe('Recalculate discounts is a recommender: nothing new is preselected', () => {
  it('a new applicable promotion is listed unselected; confirming with no selection changes nothing', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const promo = tenPercent(ctx);
    const preview = await ctx.editing.previewDiscounts(id, {});
    expect(preview.rows).toEqual([
      expect.objectContaining({ key: `p:${promo}`, kind: 'NEW', selected: false, amount: 650 }),
    ]);
    expect(preview.selection).toEqual([]);
    expect(preview.after.total).toBe(preview.before.total);
    const snapshotLines = JSON.stringify(linesOf(ctx, id));
    const total = orderRow(ctx, id).total;
    await ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-rec-none');
    expect(JSON.stringify(linesOf(ctx, id))).toBe(snapshotLines);
    expect(orderRow(ctx, id)).toMatchObject({ total, orderDiscount: 0 });
    expect(orderRow(ctx, id).promotions.applied).toEqual([]);
  });

  it('selecting one incompatible with a kept promotion: the preview flags it, confirm refuses it', async () => {
    const ctx = setup();
    const a = tenPercent(ctx, { stacking: { ...STACK_ALL, exclusive: true } });
    const id = await createOrder(ctx);
    expect(orderRow(ctx, id).promotions.applied.map((x: any) => x.promotionId)).toEqual([a]);
    promotionRow(ctx, a).active = false;
    const b = tenPercent(ctx, { benefits: { items: [{ type: 'ORDER_FIXED', amount: 100 }] } });
    const initial = await ctx.editing.previewDiscounts(id, {});
    expect(initial.rows.find((r) => r.key === `p:${b}`)).toMatchObject({ kind: 'NEW', selected: false });
    expect(initial.conflicts).toEqual([]);
    const preview = await ctx.editing.previewDiscounts(id, { selection: [`p:${a}`, `p:${b}`] });
    expect(preview.conflicts).toEqual([[`p:${a}`, `p:${b}`]]);
    expect(
      await issues(
        ctx.editing.applyDiscounts(id, { selection: [`p:${a}`, `p:${b}`] }, 'user:1', 'op-rec-x')
      )
    ).toEqual([{ path: 'selection', code: 'PROMOTIONS_NOT_COMBINABLE' }]);
  });
});
