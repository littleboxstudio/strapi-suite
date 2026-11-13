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

  it('kept: its amount is unchanged; deselected: it comes off the total, is released and the outcome is DUE', async () => {
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

    const res = await ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-drop-01');
    expect(res).toMatchObject({ outcome: 'DUE', difference: 650 });
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 0, total: 7000 });
    expect(orderRow(ctx, id).promotions.applied).toEqual([]);
    expect(release).toHaveBeenCalledWith(id, [promo]);
    expect(redemptionsOf(ctx, id)).toEqual([expect.objectContaining({ status: 'RELEASED' })]);
    expect(promotionRow(ctx, promo).redemptions).toBe(0);
    expect(historyOf(ctx, id, 'DISCOUNTS_RECALCULATED')[1].newValue).toMatchObject({
      added: [],
      removed: [{ promotionId: promo, amount: 650 }],
    });
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

  it('deselecting a gift promotion removes its gift line and restocks it', async () => {
    const ctx = setup();
    const promo = giftOf12(ctx);
    const id = await createOrder(ctx, [{ variantId: 10, quantity: 2 }]);
    expect(linesOf(ctx, id).find((l) => l.isGift)).toMatchObject({ variantId: 12, quantity: 1 });
    expect(stockOf(ctx, 12)).toBe(9);
    promotionRow(ctx, promo).active = false;

    await ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-gift-01');
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10]);
    expect(stockOf(ctx, 12)).toBe(10);
    expect(
      ctx.tables[UIDS.stockMovement].find((m) => m.operationKey === 'edit:op-gift-01:12')
    ).toMatchObject({ type: 'ORDER_RESTOCK', quantity: 1 });
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
  it('a LEGACY item above the clamped order discount is capped when the discounts are saved', async () => {
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
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 5000 }),
    ]);

    await ctx.editing.applyDiscounts(id, { selection: ['m:1'] }, 'user:1', 'op-legacy-02');
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 2500, total: 500 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 2500 }),
    ]);
  });

  it('deselecting the LEGACY item removes it from the total', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    Object.assign(orderRow(ctx, id), { orderDiscount: 1000, total: 6000, manualDiscounts: null });
    const res = await ctx.editing.applyDiscounts(id, { selection: [] }, 'user:1', 'op-legacy-03');
    expect(res.difference).toBe(1000);
    expect(orderRow(ctx, id)).toMatchObject({ orderDiscount: 0, total: 7000 });
    expect(orderRow(ctx, id).manualDiscounts.items).toEqual([]);
    expect(historyOf(ctx, id, 'DISCOUNTS_RECALCULATED')[0].newValue.removedManual).toEqual([1]);
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
