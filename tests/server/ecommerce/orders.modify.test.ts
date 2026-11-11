import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
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
import { computeTotals } from '../../../server/src/services/modules/ecommerce/domain/orders';
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
  const strapi: any = {
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
  /** Price the (mocked) carrier quotes; null = the option is not available. */
  const quote = { price: 500 as number | null };
  const findOption = vi.fn(async (_req: any, providerId: string, serviceId: string) =>
    quote.price === null
      ? null
      : { providerId, serviceId, name: 'Standard', price: quote.price, tax: 23 }
  );
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  services.EcommerceOrderHistoryService = EcommerceOrderHistoryService({ strapi });
  services.EcommerceShippingService = { findOption };
  services.EcommerceSettingsService = {
    getActiveProviders: async () => [],
    getStoreSettings: async () => ({ shippingCountries: ['PT', 'ES'] }),
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  const orders = EcommerceOrderService({ strapi });
  services.EcommerceOrderService = orders;
  registerPromotionService(strapi, services);
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceReturnService = EcommerceReturnService({ strapi });
  services.EcommerceInvoiceService = EcommerceInvoiceService({ strapi });
  const payments = EcommercePaymentService({ strapi });
  services.EcommercePaymentService = payments;

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push(
    { id: 1, product: 1, locale: 'en', name: 'Shirt' },
    { id: 2, product: 1, locale: 'pt', name: 'Camisa' }
  );
  t[UIDS.variant].push(
    { id: 10, product: 1, sku: 'SH-M', price: 2000, tax: 23, stock: 5, active: true, weight: 200 },
    { id: 11, product: 1, sku: 'SH-L', price: 2500, tax: 23, stock: 1, active: true, weight: 250 },
    {
      id: 12,
      product: 1,
      sku: 'SH-XL',
      price: 1500,
      tax: 23,
      stock: 10,
      active: true,
      weight: 300,
    },
    { id: 13, product: 1, sku: 'SH-XS', price: 1000, tax: 23, stock: 10, active: false }
  );
  t[UIDS.variantTranslation].push({ id: 1, variant: 12, locale: 'en', option: 'Extra large' });
  t[UIDS.image].push(
    { id: 1, product: 1, url: '/p1.jpg', position: 0 },
    { id: 2, variant: 12, url: '/v12.jpg', position: 0 }
  );
  return { orders, payments, tables: t, bus, findOption, quote, misses };
}

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

type Ctx = ReturnType<typeof setup>;

/** Total 7000: 2 × 2000 + 1 × 2500 + 500 shipping. */
const createOrder = (
  orders: any,
  lines = [
    { variantId: 10, quantity: 2 },
    { variantId: 11, quantity: 1 },
  ],
  locale = 'en'
) =>
  orders.create(
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

const KEEP = { mode: 'KEEP' as const };

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

beforeEach(() => __resetEventHandlersForTests());

describe('EcommerceOrderService.previewModification', () => {
  it('simulates without writing anything', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const before = JSON.stringify(ctx.tables);
    const result = await ctx.orders.previewModification(id, {
      lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }],
      shipping: KEEP,
    });
    expect(result.errors).toEqual([]);
    expect(result.difference).toBe(1500);
    expect(result.outcome).toBe('DUE');
    expect(result.stockMovements).toEqual([{ variantId: 12, quantity: -1 }]);
    expect(JSON.stringify(ctx.tables)).toBe(before);
  });

  it('RECALCULATE quotes the pending items with the order method and the new address', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    ctx.findOption.mockClear();
    ctx.quote.price = 700;
    const newAddress = { ...address, country: 'ES', postalCode: '28001', city: 'Madrid' };
    const result = await ctx.orders.previewModification(id, {
      lines: [
        ...lineInputs(ctx, id).filter((l) => l.variantId !== 11),
        { variantId: 12, quantity: 2 },
      ],
      shipping: { mode: 'RECALCULATE' },
      addresses: { shipping: newAddress },
    });
    expect(ctx.findOption).toHaveBeenCalledTimes(1);
    const [req, providerId, serviceId] = ctx.findOption.mock.calls[0];
    expect(providerId).toBe('manual');
    expect(serviceId).toBe('1');
    expect(req.country).toBe('ES');
    expect(req.postalCode).toBe('28001');
    expect(req.locale).toBe('en');
    expect(req.subtotal).toBe(4000 + 3000);
    expect(req.items).toEqual([
      { variantId: 10, quantity: 2, weight: 200, width: 0, height: 0, depth: 0 },
      { variantId: 12, quantity: 2, weight: 300, width: 0, height: 0, depth: 0 },
    ]);
    expect(result.shipping).toMatchObject({
      mode: 'RECALCULATE',
      previousCharged: 500,
      newCharged: 700,
      quote: 700,
      previousShipmentsCost: 0,
      shippingOriginal: 700,
      shippingDiscount: 0,
    });
  });

  it('RECALCULATE excludes reserved units from both the items and the subtotal (PENDING ones block MODIFY)', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const line10 = linesOf(ctx, id).find((l) => l.variantId === 10);
    ctx.tables[UIDS.shipment].push({
      id: 1,
      order: id,
      providerId: 'acme',
      carrierName: 'Acme',
      status: 'ACTIVE',
      deliveryStatus: 'IN_TRANSIT',
      items: { lines: [{ orderLineId: line10.id, sku: 'SH-M', name: 'Shirt', option: null, quantity: 1 }] },
      shippingCost: 0,
      idempotencyKey: 'pending-1',
    });
    ctx.findOption.mockClear();
    await ctx.orders.previewModification(id, {
      lines: lineInputs(ctx, id),
      shipping: { mode: 'RECALCULATE' },
    });
    const [req] = ctx.findOption.mock.calls[0];
    expect(req.items).toEqual([
      { variantId: 10, quantity: 1, weight: 200, width: 0, height: 0, depth: 0 },
      { variantId: 11, quantity: 1, weight: 250, width: 0, height: 0, depth: 0 },
    ]);
    expect(req.subtotal).toBe(2000 + 2500);
  });

  it('a PENDING (uncertain) shipment blocks modification with SHIPMENT_PENDING', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
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
    const removeLine = {
      lines: lineInputs(ctx, id).filter((l) => l.variantId !== 10),
      shipping: KEEP,
    };
    expect((await issues(ctx.orders.previewModification(id, removeLine))).map((e: any) => e.code)).toEqual([
      'SHIPMENT_PENDING',
    ]);
    expect(
      (await issues(ctx.orders.applyModification(id, removeLine, 'user:1', 'op-pending-1'))).map(
        (e: any) => e.code
      )
    ).toEqual(['SHIPMENT_PENDING']);
    expect(linesOf(ctx, id)).toHaveLength(2);
    expect((await ctx.orders.get(id)).availableActions).not.toContain('MODIFY');
  });

  it('RECALCULATE adds the cost of previous shipments (requirement 16.5.2)', async () => {
    const ctx = setup();
    ctx.quote.price = 1000;
    const { id } = await createOrder(ctx.orders);
    const line10 = linesOf(ctx, id).find((l) => l.variantId === 10);
    ctx.tables[UIDS.shipment].push({
      id: 1,
      order: id,
      providerId: 'manual',
      carrierName: 'CTT',
      status: 'ACTIVE',
      items: { lines: [{ orderLineId: line10.id, sku: 'SH-M', name: 'Shirt', option: null, quantity: 1 }] },
      shippingCost: 600,
      deliveryStatus: 'IN_TRANSIT',
      idempotencyKey: 'active-1',
    });
    ctx.quote.price = 800;
    const result = await ctx.orders.previewModification(id, {
      lines: lineInputs(ctx, id),
      shipping: { mode: 'RECALCULATE' },
    });
    expect(result.shipping).toMatchObject({
      mode: 'RECALCULATE',
      previousCharged: 1000,
      previousShipmentsCost: 600,
      quote: 800,
      newCharged: 1400,
    });
  });

  it('RECALCULATE with invalid lines returns their errors without quoting', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    ctx.findOption.mockClear();
    ctx.quote.price = null; // a quote would fail: it must not be requested
    const result = await ctx.orders.previewModification(id, {
      lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 50 }],
      shipping: { mode: 'RECALCULATE' },
    });
    expect(ctx.findOption).not.toHaveBeenCalled();
    expect(result.errors).toEqual([{ path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' }]);
    expect(result.shipping.mode).toBe('RECALCULATE');
    expect(
      await issues(
        ctx.orders.applyModification(
          id,
          {
            lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 50 }],
            shipping: { mode: 'RECALCULATE' },
          },
          'user:1',
          'op-invalid-1'
        )
      )
    ).toEqual([{ path: 'lines.2.quantity', code: 'INSUFFICIENT_STOCK' }]);
    expect(ctx.findOption).not.toHaveBeenCalled();
  });

  it('a failed quote is SHIPPING_QUOTE_FAILED', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    ctx.quote.price = null;
    expect(
      await issues(
        ctx.orders.previewModification(id, {
          lines: lineInputs(ctx, id),
          shipping: { mode: 'RECALCULATE' },
        })
      )
    ).toEqual([{ path: 'shipping', code: 'SHIPPING_QUOTE_FAILED' }]);
  });

  it('is ACTION_NOT_AVAILABLE on a cancelled order', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.orders.cancel(id, 'user:1');
    expect(
      await issues(
        ctx.orders.previewModification(id, { lines: lineInputs(ctx, id), shipping: KEEP })
      )
    ).toEqual([{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }]);
  });

  it('rejects malformed input', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    expect(
      await issues(
        ctx.orders.previewModification(id, { lines: 'x', shipping: { mode: 'NOPE' } } as any)
      )
    ).toEqual([
      { path: 'lines', code: 'required' },
      { path: 'shipping.mode', code: 'required' },
    ]);
    expect(
      await issues(
        ctx.orders.previewModification(id, {
          lines: lineInputs(ctx, id),
          shipping: KEEP,
          addresses: { shipping: { ...address, city: '' } },
        })
      )
    ).toEqual([{ path: 'addresses.shipping.city', code: 'required' }]);
  });
});

describe('EcommerceOrderService.applyModification', () => {
  it('adding a line to a paid order → PARTIALLY_PAID, stock deducted, line snapshot, history, event', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'pay-1' }, 'user:1');
    const events: any[] = [];
    ctx.bus.subscribe('ORDER_MODIFIED', async (e) => {
      events.push(e);
    });

    const res = await ctx.orders.applyModification(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 2 }], shipping: KEEP },
      'user:1',
      'op-add-0001'
    );

    expect(res.outcome).toBe('DUE');
    expect(res.difference).toBe(3000);
    expect(res.order.paymentStatus).toBe('PARTIALLY_PAID');
    expect(res.order.totals.total).toBe(10000);
    expect(res.order.summary.due).toBe(3000);
    expect(res.order.availableActions).toContain('ADD_PAYMENT');
    expect(stockOf(ctx, 12)).toBe(8);

    const added = linesOf(ctx, id).find((l) => l.variantId === 12);
    expect(added).toMatchObject({
      productId: 1,
      sku: 'SH-XL',
      name: 'Shirt',
      option: 'Extra large',
      imageUrl: '/v12.jpg',
      unitPrice: 1500,
      unitDiscount: 0,
      quantity: 2,
      returnedQuantity: 0,
      tax: 23,
      isGift: false,
      position: 2,
    });

    const move = ctx.tables[UIDS.stockMovement].find(
      (m) => m.operationKey === 'modify:op-add-0001:12'
    );
    expect(move).toMatchObject({ type: 'ORDER_DEDUCT', quantity: -2, order: id, actor: 'user:1' });

    const [lineAdded] = historyOf(ctx, id, 'LINE_ADDED');
    expect(lineAdded).toMatchObject({ actor: 'user:1', operationId: 'op-add-0001' });
    expect(lineAdded.newValue).toMatchObject({ variantId: 12, sku: 'SH-XL', quantity: 2 });
    const [modified] = historyOf(ctx, id, 'ORDER_MODIFIED');
    expect(modified.operationId).toBe('op-add-0001');
    expect(modified.newValue).toMatchObject({
      operationId: 'op-add-0001',
      outcome: 'DUE',
      difference: 3000,
      totals: { total: 10000 },
    });
    expect(modified.previousValue).toMatchObject({ totals: { total: 7000 } });
    expect(historyOf(ctx, id, 'PAYMENT_STATUS_CHANGED').at(-1).newValue).toEqual({
      paymentStatus: 'PARTIALLY_PAID',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'ORDER_MODIFIED',
      orderId: id,
      payload: { outcome: 'DUE', difference: 3000 },
    });
  });

  it('snapshots added lines in the order locale with fallback to the default locale', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders, [{ variantId: 10, quantity: 1 }], 'pt');
    await ctx.orders.applyModification(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }], shipping: KEEP },
      'user:1',
      'op-locale-1'
    );
    const added = linesOf(ctx, id).find((l) => l.variantId === 12);
    expect(added).toMatchObject({ name: 'Camisa', option: 'Extra large' });
  });

  it('reducing 5 to 3 restocks 2', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders, [{ variantId: 12, quantity: 5 }]);
    expect(stockOf(ctx, 12)).toBe(5);
    const [line] = linesOf(ctx, id);

    const res = await ctx.orders.applyModification(
      id,
      { lines: [{ orderLineId: line.id, variantId: 12, quantity: 3 }], shipping: KEEP },
      'user:1',
      'op-reduce-1'
    );

    expect(stockOf(ctx, 12)).toBe(7);
    expect(
      ctx.tables[UIDS.stockMovement].find((m) => m.operationKey === 'modify:op-reduce-1:12')
    ).toMatchObject({ type: 'ORDER_RESTOCK', quantity: 2 });
    expect(linesOf(ctx, id)[0].quantity).toBe(3);
    expect(res.difference).toBe(-3000);
    expect(res.outcome).toBe('NONE');
    expect(res.order.totals.total).toBe(4500 + 500);
    const [changed] = historyOf(ctx, id, 'LINE_QUANTITY_CHANGED');
    expect(changed.previousValue).toMatchObject({ quantity: 5 });
    expect(changed.newValue).toMatchObject({ quantity: 3, orderLineId: line.id });
  });

  it('removing a line deletes it and restocks', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const keep = lineInputs(ctx, id).filter((l) => l.variantId === 10);
    await ctx.orders.applyModification(
      id,
      { lines: keep, shipping: KEEP },
      'user:1',
      'op-remove-1'
    );
    expect(linesOf(ctx, id).map((l) => l.variantId)).toEqual([10]);
    expect(stockOf(ctx, 11)).toBe(1);
    expect(historyOf(ctx, id, 'LINE_REMOVED')[0].previousValue).toMatchObject({
      variantId: 11,
      quantity: 1,
    });
  });

  it('a changed address records ADDRESS_CHANGED with before and after', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const newAddress = { ...address, line1: 'Rua B 2', line2: '3º Esq' };
    const res = await ctx.orders.applyModification(
      id,
      {
        lines: lineInputs(ctx, id),
        shipping: KEEP,
        addresses: { shipping: newAddress, billing: address },
      },
      'user:1',
      'op-address-1'
    );
    expect(res.order.shippingAddress).toEqual(newAddress);
    expect(res.order.billingAddress).toEqual(address);
    const changes = historyOf(ctx, id, 'ADDRESS_CHANGED');
    expect(changes).toHaveLength(1); // the billing address did not change
    expect(changes[0].previousValue).toEqual({ shippingAddress: address });
    expect(changes[0].newValue).toEqual({ shippingAddress: newAddress });
    expect(res.outcome).toBe('NONE');
    expect(res.difference).toBe(0);
  });

  it('MANUAL 0 shipping: free shipping, refundable on a paid order, method keeps its ids', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.payments.addManualPayment(id, { amount: 7000, idempotencyKey: 'pay-1' }, 'user:1');
    const res = await ctx.orders.applyModification(
      id,
      { lines: lineInputs(ctx, id), shipping: { mode: 'MANUAL', amount: 0 } },
      'user:1',
      'op-manual-1'
    );
    expect(res.outcome).toBe('REFUNDABLE');
    expect(res.difference).toBe(-500);
    expect(res.order.totals).toMatchObject({
      shippingOriginal: 0,
      shippingDiscount: 0,
      shippingTotal: 0,
      total: 6500,
    });
    expect(res.order.summary.excess).toBe(500);
    expect(res.order.shippingMethod).toMatchObject({
      providerId: 'manual',
      serviceId: '1',
      name: 'Standard',
      price: 0,
    });
    const [shippingChanged] = historyOf(ctx, id, 'SHIPPING_CHANGED');
    expect(shippingChanged.newValue).toMatchObject({
      mode: 'MANUAL',
      previousCharged: 500,
      newCharged: 0,
    });
  });

  it('RECALCULATE with the current manual method stores the new quote and method', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    ctx.quote.price = 800;
    const res = await ctx.orders.applyModification(
      id,
      { lines: lineInputs(ctx, id), shipping: { mode: 'RECALCULATE' } },
      'user:1',
      'op-recalc-1'
    );
    expect(res.difference).toBe(300);
    expect(res.order.totals).toMatchObject({
      shippingOriginal: 800,
      shippingTotal: 800,
      total: 7300,
    });
    expect(res.order.shippingMethod).toMatchObject({
      providerId: 'manual',
      serviceId: '1',
      price: 800,
    });
    const [shippingChanged] = historyOf(ctx, id, 'SHIPPING_CHANGED');
    expect(shippingChanged.newValue).toMatchObject({
      mode: 'RECALCULATE',
      previousCharged: 500,
      newCharged: 800,
      quote: 800,
      previousShipmentsCost: 0,
    });
  });

  it('the same operationId twice applies once and returns the same result', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const input = {
      lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }],
      shipping: KEEP,
    };
    const a = await ctx.orders.applyModification(id, input, 'user:1', 'op-repeat-1');
    const snapshot = JSON.stringify(ctx.tables);
    const b = await ctx.orders.applyModification(id, input, 'user:1', 'op-repeat-1');
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    expect(b.outcome).toBe(a.outcome);
    expect(b.difference).toBe(a.difference);
    expect(b.order.totals).toEqual(a.order.totals);
    expect(stockOf(ctx, 12)).toBe(9);
    expect(historyOf(ctx, id, 'ORDER_MODIFIED')).toHaveLength(1);
  });

  it('a concurrent duplicate without stock moves loses on the unique key and replays the winner', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const events: any[] = [];
    ctx.bus.subscribe('ORDER_MODIFIED', async (e) => {
      events.push(e);
    });
    const input = {
      lines: lineInputs(ctx, id),
      shipping: KEEP,
      addresses: { shipping: { ...address, line1: 'Rua C 3' } },
    };
    const a = await ctx.orders.applyModification(id, input, 'user:1', 'op-race-0001');
    const snapshot = JSON.stringify(ctx.tables);
    // The second request started before the first committed: both of its lookups miss.
    ctx.misses.uniqueKeyLookups = 2;
    const b = await ctx.orders.applyModification(id, input, 'user:1', 'op-race-0001');

    expect(ctx.misses.uniqueKeyLookups).toBe(0);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
    expect(historyOf(ctx, id, 'ORDER_MODIFIED')).toHaveLength(1);
    expect(historyOf(ctx, id, 'ADDRESS_CHANGED')).toHaveLength(1);
    expect(historyOf(ctx, id, 'ORDER_MODIFIED')[0].uniqueKey).toBe('modify:op-race-0001');
    expect(events).toHaveLength(1);
    expect(b.outcome).toBe(a.outcome);
    expect(b.difference).toBe(a.difference);
    expect(b.order).toEqual(a.order);
  });

  it('only the ORDER_MODIFIED entry carries the unique key', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.orders.applyModification(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }], shipping: KEEP },
      'user:1',
      'op-keys-0001'
    );
    const keyed = historyOf(ctx, id).filter((h) => h.uniqueKey);
    expect(keyed.map((h) => h.type)).toEqual(['ORDER_MODIFIED']);
  });

  it('rejects an operationId already used on another order', async () => {
    const ctx = setup();
    const a = await createOrder(ctx.orders, [{ variantId: 10, quantity: 1 }]);
    const b = await createOrder(ctx.orders, [{ variantId: 10, quantity: 1 }]);
    await ctx.orders.applyModification(
      a.id,
      { lines: lineInputs(ctx, a.id), shipping: KEEP },
      'user:1',
      'op-shared-1'
    );
    expect(
      await issues(
        ctx.orders.applyModification(
          b.id,
          { lines: lineInputs(ctx, b.id), shipping: KEEP },
          'user:1',
          'op-shared-1'
        )
      )
    ).toEqual([{ path: 'operationId', code: 'OPERATION_ID_CONFLICT' }]);
  });

  it('validates the operationId', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    for (const op of [undefined, '', 'short', 'x'.repeat(65), 12345678]) {
      expect(
        await issues(
          ctx.orders.applyModification(
            id,
            { lines: lineInputs(ctx, id), shipping: KEEP },
            'user:1',
            op as any
          )
        )
      ).toEqual([{ path: 'operationId', code: 'required' }]);
    }
  });

  it('rejects simulation errors without any effect', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const snapshot = JSON.stringify(ctx.tables);
    expect(
      await issues(
        ctx.orders.applyModification(
          id,
          {
            lines: [
              ...lineInputs(ctx, id),
              { variantId: 12, quantity: 50 },
              { variantId: 13, quantity: 1 },
            ],
            shipping: KEEP,
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

  it('caps the order discount at the new subtotal and records it', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const order = ctx.tables[UIDS.order].find((o) => o.id === id);
    order.orderDiscount = 5000;
    const keep = lineInputs(ctx, id).filter((l) => l.variantId === 11);
    const res = await ctx.orders.applyModification(
      id,
      { lines: keep, shipping: KEEP },
      'user:1',
      'op-discount-1'
    );
    expect(res.order.totals).toMatchObject({ subtotal: 2500, orderDiscount: 2500, total: 500 });
    const [changed] = historyOf(ctx, id, 'ORDER_DISCOUNT_CHANGED');
    expect(changed.previousValue).toEqual({ orderDiscount: 5000 });
    expect(changed.newValue).toEqual({ orderDiscount: 2500 });
  });

  it('is ACTION_NOT_AVAILABLE on a cancelled order', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.orders.cancel(id, 'user:1');
    expect(
      await issues(
        ctx.orders.applyModification(
          id,
          { lines: lineInputs(ctx, id), shipping: KEEP },
          'user:1',
          'op-cancelled-1'
        )
      )
    ).toEqual([{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }]);
  });
});

describe('modification with promotions (design 4.8)', () => {
  const STACK_ALL = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };
  const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
  let nextId = 1;
  const addPromotion = (ctx: Ctx, over: Record<string, unknown> = {}): number => {
    const id = nextId++;
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
  const orderRow = (ctx: Ctx, id: number) => ctx.tables[UIDS.order].find((o) => o.id === id);
  beforeEach(() => {
    nextId = 1;
  });

  /** 5 × 2000 = 10000 with "10% above 100 €" (1000 off). */
  const orderWithTenPercent = async (ctx: Ctx) => {
    const promotionId = addPromotion(ctx, {
      name: '10% above 100 €',
      conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: 10000 }]),
    });
    const { id } = await createOrder(ctx.orders, [{ variantId: 10, quantity: 5 }]);
    expect(orderRow(ctx, id)).toMatchObject({ subtotal: 10000, orderDiscount: 1000 });
    return { id, promotionId };
  };

  it('the order drops to 80 €: PROMOTION_CONDITION_UNMET, the discount and the stored promotions stay, no capacity change', async () => {
    const ctx = setup();
    const { id, promotionId } = await orderWithTenPercent(ctx);
    const storedPromotions = JSON.stringify(orderRow(ctx, id).promotions);
    const redemptions = JSON.stringify(ctx.tables[UIDS.promotionRedemption]);
    const lines = lineInputs(ctx, id).map((l) => ({ ...l, quantity: 4 }));

    const preview = await ctx.orders.previewModification(id, { lines, shipping: KEEP });
    expect(preview.discountWarnings).toEqual([
      { code: 'PROMOTION_CONDITION_UNMET', promotionId, name: '10% above 100 €' },
    ]);
    expect(preview.after).toMatchObject({ subtotal: 8000, orderDiscount: 1000 });

    const res = await ctx.orders.applyModification(id, { lines, shipping: KEEP }, 'user:1', 'op-unmet-1');
    expect(res.order.totals).toMatchObject({ subtotal: 8000, orderDiscount: 1000, total: 7500 });
    expect(JSON.stringify(orderRow(ctx, id).promotions)).toBe(storedPromotions);
    expect(ctx.tables[UIDS.promotion].find((p) => p.id === promotionId).redemptions).toBe(1);
    expect(JSON.stringify(ctx.tables[UIDS.promotionRedemption])).toBe(redemptions);
    expect(historyOf(ctx, id, 'ORDER_DISCOUNT_CHANGED')).toEqual([]);
  });

  it('orderDiscount: 0 raises the total and records ORDER_DISCOUNT_CHANGED once, manually, with the actor', async () => {
    const ctx = setup();
    const { id } = await orderWithTenPercent(ctx);
    const res = await ctx.orders.applyModification(
      id,
      { lines: lineInputs(ctx, id), shipping: KEEP, orderDiscount: 0 },
      'user:7',
      'op-manual-1'
    );
    expect(res.order.totals).toMatchObject({ subtotal: 10000, orderDiscount: 0, total: 10500 });
    expect(res.difference).toBe(1000);
    const changed = historyOf(ctx, id, 'ORDER_DISCOUNT_CHANGED');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      actor: 'user:7',
      operationId: 'op-manual-1',
      previousValue: { orderDiscount: 1000 },
      newValue: { orderDiscount: 0 },
    });
    expect(changed[0].description).toMatch(/^Order discount adjusted manually/);
  });

  it('orderDiscount: 0 with 1300 stored and a smaller subtotal: no capped warning, one manual entry', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    orderRow(ctx, id).orderDiscount = 1300;
    const lines = lineInputs(ctx, id).filter((l) => l.variantId === 11);
    const preview = await ctx.orders.previewModification(id, { lines, shipping: KEEP, orderDiscount: 0 });
    expect(preview.discountWarnings).toEqual([]);
    await ctx.orders.applyModification(id, { lines, shipping: KEEP, orderDiscount: 0 }, 'user:1', 'op-manual-2');
    const changed = historyOf(ctx, id, 'ORDER_DISCOUNT_CHANGED');
    expect(changed).toHaveLength(1);
    expect(changed[0].description).toMatch(/^Order discount adjusted manually/);
    expect(changed[0].newValue).toEqual({ orderDiscount: 0 });
  });

  it('without orderDiscount a capped discount warns and records one entry with the capped description', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    orderRow(ctx, id).orderDiscount = 5000;
    const lines = lineInputs(ctx, id).filter((l) => l.variantId === 11);
    const preview = await ctx.orders.previewModification(id, { lines, shipping: KEEP });
    expect(preview.discountWarnings).toEqual([{ code: 'ORDER_DISCOUNT_CAPPED' }]);
    await ctx.orders.applyModification(id, { lines, shipping: KEEP }, 'user:1', 'op-capped-1');
    const changed = historyOf(ctx, id, 'ORDER_DISCOUNT_CHANGED');
    expect(changed).toHaveLength(1);
    expect(changed[0].description).toMatch(/^Order discount capped at the new subtotal/);
  });

  it('orderDiscount: -1 → INVALID_AMOUNT, nothing written', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    const snapshot = JSON.stringify(ctx.tables);
    const input = { lines: lineInputs(ctx, id), shipping: KEEP, orderDiscount: -1 };
    expect((await ctx.orders.previewModification(id, input)).errors).toEqual([
      { path: 'orderDiscount', code: 'INVALID_AMOUNT' },
    ]);
    expect(await issues(ctx.orders.applyModification(id, input, 'user:1', 'op-invalid-1'))).toEqual([
      { path: 'orderDiscount', code: 'INVALID_AMOUNT' },
    ]);
    expect(JSON.stringify(ctx.tables)).toBe(snapshot);
  });

  it('an added line stores promotionRefs as { refs: [] }', async () => {
    const ctx = setup();
    const { id } = await createOrder(ctx.orders);
    await ctx.orders.applyModification(
      id,
      { lines: [...lineInputs(ctx, id), { variantId: 12, quantity: 1 }], shipping: KEEP },
      'user:1',
      'op-refs-1'
    );
    expect(linesOf(ctx, id).find((l) => l.variantId === 12).promotionRefs).toEqual({ refs: [] });
  });

  it.each([
    ['RECALCULATE', { mode: 'RECALCULATE' as const }],
    ['MANUAL', { mode: 'MANUAL' as const, amount: 300 }],
  ])('%s shipping drops the free-shipping promotion: SHIPPING_PROMOTION_DROPPED, promotions kept', async (_m, shipping) => {
    const ctx = setup();
    const promotionId = addPromotion(ctx, {
      name: 'Free shipping',
      benefits: { items: [{ type: 'SHIPPING_FREE', maxAmount: null }] },
    });
    const { id } = await createOrder(ctx.orders);
    expect(orderRow(ctx, id)).toMatchObject({ shippingOriginal: 500, shippingDiscount: 500 });
    const storedPromotions = JSON.stringify(orderRow(ctx, id).promotions);
    ctx.quote.price = 700;
    const input = { lines: lineInputs(ctx, id), shipping };

    const preview = await ctx.orders.previewModification(id, input);
    expect(preview.discountWarnings).toEqual([
      { code: 'SHIPPING_PROMOTION_DROPPED', promotionId, name: 'Free shipping' },
    ]);
    expect(preview.shipping.shippingDiscount).toBe(0);

    await ctx.orders.applyModification(id, input, 'user:1', `op-ship-${shipping.mode}`);
    expect(orderRow(ctx, id).shippingDiscount).toBe(0);
    expect(JSON.stringify(orderRow(ctx, id).promotions)).toBe(storedPromotions);
    expect(ctx.tables[UIDS.promotion].find((p) => p.id === promotionId).redemptions).toBe(1);
  });

  it('a variant with two lines (2 + 1) needs orderLineId: without it INVALID_QUANTITY, with it applied', async () => {
    const ctx = setup();
    addPromotion(ctx, {
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: { productIds: [], variantIds: [10] }, quantity: 2, minAmount: null },
            get: { mode: 'IN_CART', target: { productIds: [], variantIds: [10] }, quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const { id } = await createOrder(ctx.orders, [{ variantId: 10, quantity: 3 }]);
    expect(linesOf(ctx, id).map((l) => l.quantity)).toEqual([2, 1]);

    const ambiguous = { lines: [{ variantId: 10, quantity: 3 }], shipping: KEEP };
    expect((await ctx.orders.previewModification(id, ambiguous)).errors).toContainEqual({
      path: 'lines.0.orderLineId',
      code: 'INVALID_QUANTITY',
    });
    expect(
      await issues(ctx.orders.applyModification(id, ambiguous, 'user:1', 'op-split-1'))
    ).toContainEqual({ path: 'lines.0.orderLineId', code: 'INVALID_QUANTITY' });

    const [a, b] = lineInputs(ctx, id);
    const res = await ctx.orders.applyModification(
      id,
      { lines: [{ ...a, quantity: 3 }, b], shipping: KEEP },
      'user:1',
      'op-split-2'
    );
    expect(res.order.lines.map((l: any) => l.quantity)).toEqual([3, 1]);
  });

  it('"buy 3 pay 2": raising the free line 1 → 4 keeps 1 free unit and adds 3 at full price', async () => {
    const ctx = setup();
    ctx.tables[UIDS.variant].find((v) => v.id === 10).stock = 10;
    addPromotion(ctx, {
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: { productIds: [], variantIds: [10] }, quantity: 2, minAmount: null },
            get: { mode: 'IN_CART', target: { productIds: [], variantIds: [10] }, quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const { id } = await createOrder(ctx.orders, [{ variantId: 10, quantity: 3 }]);
    const [a, b] = lineInputs(ctx, id);
    expect(linesOf(ctx, id).find((l) => l.id === b.orderLineId)).toMatchObject({
      quantity: 1,
      unitDiscount: 2000,
    });
    const input = { lines: [a, { ...b, quantity: 4 }], shipping: KEEP };

    const preview = await ctx.orders.previewModification(id, input);
    expect(preview.errors).toEqual([]);
    expect(preview.after.subtotal).toBe(10000);

    const res = await ctx.orders.applyModification(id, input, 'user:1', 'op-bxgy-raise');
    const lines = linesOf(ctx, id);
    expect(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        isGift: l.isGift,
      }))
    ).toEqual([
      { quantity: 2, unitPrice: 2000, unitDiscount: 0, isGift: false },
      { quantity: 1, unitPrice: 2000, unitDiscount: 2000, isGift: false },
      { quantity: 3, unitPrice: 2000, unitDiscount: 0, isGift: false },
    ]);
    const added = lines[2];
    expect(added).toMatchObject({ variantId: 10, sku: 'SH-M', promotionRefs: { refs: [] } });
    // The stored totals are the plan-3 formula over the stored lines.
    const row = orderRow(ctx, id);
    const expected = computeTotals(lines, row);
    expect(res.order.totals).toMatchObject({
      subtotal: expected.subtotal,
      orderDiscount: expected.orderDiscount,
      total: expected.total,
    });
    expect(row).toMatchObject({ subtotal: 10000, total: expected.total });
    expect(stockOf(ctx, 10)).toBe(10 - 3 - 3);
    expect(historyOf(ctx, id, 'LINE_ADDED')).toHaveLength(1);
    expect(historyOf(ctx, id, 'LINE_QUANTITY_CHANGED')).toEqual([]);
  });
});
