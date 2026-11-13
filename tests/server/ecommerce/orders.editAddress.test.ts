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

beforeEach(() => __resetEventHandlersForTests());

const newAddress = { ...address, line1: 'Rua B 2', city: 'Madrid', postalCode: '28001', country: 'ES' };

describe('EcommerceOrderEditingService.shippingAddressCountries', () => {
  it('the countries the current method serves inside the markets', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect((await ctx.editing.shippingAddressCountries(id)).countries.sort()).toEqual(['ES', 'PT']);
  });
});

describe('EcommerceOrderEditingService.updateShippingAddress', () => {
  it('saves the address: history with before/after, whole-order re-quote, no flag when the price holds', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const billing = structuredClone(orderRow(ctx, id).billingAddress);
    const total = orderRow(ctx, id).total;
    ctx.findOption.mockClear();
    const res = await ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0001');
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(orderRow(ctx, id).shippingAddress).toMatchObject({ country: 'ES', city: 'Madrid' });
    expect(orderRow(ctx, id).billingAddress).toEqual(billing);
    expect(orderRow(ctx, id).total).toBe(total);
    expect(ctx.findOption).toHaveBeenCalledTimes(1);
    const req: any = ctx.findOption.mock.calls[0][0];
    expect(req).toMatchObject({ country: 'ES', postalCode: '28001' });
    expect(req.items.reduce((n: number, i: any) => n + i.quantity, 0)).toBe(3);
    const [entry] = historyOf(ctx, id, 'ADDRESS_CHANGED');
    expect(entry).toMatchObject({ uniqueKey: 'edit:op-addr-0001', actor: 'user:1' });
    expect(entry.previousValue).toMatchObject({ country: 'PT' });
    expect(entry.newValue).toMatchObject({ kind: 'address', country: 'ES' });
    expect(flagsOf(ctx, id)).toEqual([]);
  });

  it('raises SHIPPING_REVIEW / ADDRESS_CHANGED when the quote differs; amounts stay', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ctx.methods[0].rates.ES = [{ upTo: 5, price: 900 }];
    const total = orderRow(ctx, id).total;
    await ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0002');
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toMatchObject({ reason: 'ADDRESS_CHANGED' });
    expect(orderRow(ctx, id).total).toBe(total);
    expect(orderRow(ctx, id).shippingOriginal).toBe(500);
  });

  it('a failed quote raises SHIPPING_QUOTE_FAILED and the save succeeds, logging no address', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ctx.findOption.mockRejectedValueOnce(new Error('boom Rua B 2'));
    await ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0003');
    expect(orderRow(ctx, id).shippingAddress.country).toBe('ES');
    expect(flag(ctx, id, 'SHIPPING_REVIEW')).toMatchObject({ reason: 'SHIPPING_QUOTE_FAILED' });
    expect(JSON.stringify(ctx.log.warn.mock.calls)).not.toContain('Rua B');
  });

  it('an unchanged address writes no flag or quote and only the idempotency row; a replay is idempotent', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    ctx.findOption.mockClear();
    const res = await ctx.editing.updateShippingAddress(
      id,
      { address: { ...address, country: 'pt' } },
      'user:1',
      'op-addr-0004'
    );
    expect(res).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(ctx.findOption).not.toHaveBeenCalled();
    expect(flagsOf(ctx, id)).toEqual([]);
    const entries = historyOf(ctx, id, 'ADDRESS_CHANGED');
    expect(entries).toHaveLength(1);
    expect(entries[0].newValue).toMatchObject({ unchanged: true });
    expect(entries[0].previousValue ?? null).toBeNull();
    await ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0004');
    expect(orderRow(ctx, id).shippingAddress.country).toBe('PT');
    expect(historyOf(ctx, id, 'ADDRESS_CHANGED')).toHaveLength(1);
  });

  it('a country the method does not serve is COUNTRY_NOT_SERVED and nothing is written', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    const before = JSON.stringify(ctx.tables);
    expect(
      await issues(
        ctx.editing.updateShippingAddress(id, { address: { ...newAddress, country: 'FR' } }, 'user:1', 'op-addr-0005')
      )
    ).toEqual([{ path: 'address.country', code: 'COUNTRY_NOT_SERVED' }]);
    expect(JSON.stringify(ctx.tables)).toBe(before);
  });

  it('a malformed address is rejected', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    expect(
      await issues(
        ctx.editing.updateShippingAddress(id, { address: { ...newAddress, city: '' } }, 'user:1', 'op-addr-0006')
      )
    ).toEqual([{ path: 'address.city', code: 'required' }]);
  });

  it('an ACTIVE shipment gives ORDER_HAS_SHIPMENTS', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    shipEverything(ctx, id);
    expect(
      await issues(ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0007'))
    ).toEqual([{ path: 'order', code: 'ORDER_HAS_SHIPMENTS' }]);
    expect(orderRow(ctx, id).shippingAddress.country).toBe('PT');
  });

  it('a cancelled order gives ORDER_NOT_EDITABLE', async () => {
    const ctx = setup();
    const id = await createOrder(ctx);
    await ctx.orders.cancel(id, 'user:1');
    const errors = await issues(
      ctx.editing.updateShippingAddress(id, { address: newAddress }, 'user:1', 'op-addr-0008')
    );
    expect(errors[0]).toMatchObject({ path: 'order', code: 'ORDER_NOT_EDITABLE' });
  });
});
