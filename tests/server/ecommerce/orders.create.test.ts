import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceReturnService from '../../../server/src/services/modules/ecommerce/returns';
import EcommerceInvoiceService from '../../../server/src/services/modules/ecommerce/invoices';
import EcommerceOrderHistoryService from '../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
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

function setup(opts: { shippingPrice?: number | null } = {}) {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.stockMovement, UIDS.order],
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
  const settings = { countries: ['PT', 'ES'] };
  const bus = createEventBus(() => undefined);
  const shipping = {
    findOption: vi.fn(async (_req: any, providerId: string, serviceId: string) =>
      opts.shippingPrice === null || serviceId !== '1'
        ? null
        : { providerId, serviceId, name: 'Standard', price: opts.shippingPrice ?? 500, tax: 23 }
    ),
  };
  const strapi: any = {
    db: { query: db.query, transaction, connection: db.connection, getConnection: db.connection, metadata: db.metadata },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : { service: (name: string) => services[name] },
  };
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  services.EcommerceOrderHistoryService = EcommerceOrderHistoryService({ strapi });
  services.EcommerceShippingService = shipping;
  services.EcommerceSettingsService = {
    getActiveProviders: async () => [],
    getStoreSettings: async () => ({ shippingCountries: settings.countries }),
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  const service = EcommerceOrderService({ strapi });
  services.EcommerceOrderService = service;
  registerPromotionService(strapi, services);
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceReturnService = EcommerceReturnService({ strapi });
  services.EcommerceInvoiceService = EcommerceInvoiceService({ strapi });

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true }, { id: 2, active: false });
  t[UIDS.productTranslation].push(
    { id: 1, product: 1, locale: 'en', name: 'Shirt' },
    { id: 2, product: 2, locale: 'en', name: 'Old' }
  );
  t[UIDS.variant].push(
    {
      id: 10,
      product: 1,
      sku: 'SH-M',
      price: 2000,
      tax: 23,
      stock: 5,
      weight: 1,
      width: 1,
      height: 1,
      depth: 1,
      active: true,
    },
    {
      id: 11,
      product: 1,
      sku: 'SH-L',
      price: 2500,
      tax: '23.00',
      stock: 1,
      weight: 1,
      width: 1,
      height: 1,
      depth: 1,
      active: true,
    },
    { id: 12, product: 1, sku: 'SH-X', price: 2500, tax: 23, stock: 9, active: false },
    { id: 20, product: 2, sku: 'OLD', price: 100, tax: 23, stock: 9, active: true }
  );
  t[UIDS.variantTranslation].push(
    { id: 1, variant: 10, locale: 'en', option: 'Medium' },
    { id: 2, variant: 10, locale: 'pt', option: 'Médio' },
    { id: 3, variant: 11, locale: 'en', option: 'Large' }
  );
  t[UIDS.image].push(
    { id: 1, product: 1, position: 1, url: '/p2.jpg' },
    { id: 2, product: 1, position: 0, url: '/p1.jpg' },
    { id: 3, variant: 11, position: 0, url: '/v11.jpg' }
  );
  return { service, tables: t, bus, shipping, transaction, strapi, depth: () => depth, settings };
}

const address = (extra = {}) => ({
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  ...extra,
});

const input = (extra: any = {}) => ({
  customer: { firstName: 'Ana', lastName: 'Silva', email: 'Ana@Example.pt' },
  shippingAddress: address(),
  billingAddress: address({ nif: '123456789' }),
  locale: 'en',
  lines: [
    { variantId: 10, quantity: 2 },
    { variantId: 11, quantity: 1 },
  ],
  shipping: { providerId: 'manual', serviceId: '1' },
  ...extra,
});

const ctx = { actor: 'user:1', source: 'admin' as const };

const stockOf = (tables: Record<string, any[]>, id: number) =>
  tables[UIDS.variant].find((v) => v.id === id).stock;

const codes = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(EcommerceValidationError);
  return err.errors;
};

beforeEach(() => __resetEventHandlersForTests());

describe('EcommerceOrderService.create', () => {
  it('creates the order with totals, references, stock moves, history and an event after commit', async () => {
    const { service, tables, bus, depth } = setup();
    const events: any[] = [];
    bus.subscribe('ORDER_CREATED', async (e) => {
      events.push({ ...e, depth: depth(), orders: tables[UIDS.order].length });
    });

    const a = await service.create(input(), ctx);
    expect(a).toMatchObject({
      id: expect.any(Number),
      reference: 1001,
      publicId: expect.any(String),
    });

    const order = tables[UIDS.order][0];
    expect(order).toMatchObject({
      reference: 1001,
      locale: 'en',
      source: 'admin',
      orderStatus: 'OPEN',
      paymentStatus: 'PENDING',
      fulfillmentStatus: 'UNFULFILLED',
      itemsOriginal: 6500,
      productDiscount: 0,
      subtotal: 6500,
      orderDiscount: 0,
      shippingOriginal: 500,
      shippingDiscount: 0,
      shippingTotal: 500,
      total: 7000,
      currency: 'EUR',
      shippingMethod: {
        providerId: 'manual',
        serviceId: '1',
        name: 'Standard',
        price: 500,
        tax: 23,
      },
      customerSnapshot: { firstName: 'Ana', lastName: 'Silva', email: 'Ana@Example.pt' },
      promotions: { applied: [], codes: [], exhaustive: true },
    });
    expect(order.customer).toBe(1);
    expect(tables[UIDS.customer][0]).toMatchObject({ emailNormalized: 'ana@example.pt' });

    const lines = tables[UIDS.orderLine];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      order: a.id,
      variantId: 10,
      productId: 1,
      sku: 'SH-M',
      name: 'Shirt',
      option: 'Medium',
      imageUrl: '/p1.jpg',
      unitPrice: 2000,
      unitDiscount: 0,
      quantity: 2,
      returnedQuantity: 0,
      tax: 23,
      isGift: false,
    });
    expect(lines[1]).toMatchObject({
      variantId: 11,
      option: 'Large',
      imageUrl: '/v11.jpg',
      tax: 23,
    });

    expect(stockOf(tables, 10)).toBe(3);
    expect(stockOf(tables, 11)).toBe(0);
    expect(
      tables[UIDS.stockMovement].map((m) => [m.operationKey, m.type, m.quantity, m.order])
    ).toEqual([
      [`order:${a.id}:create:10`, 'ORDER_DEDUCT', -2, a.id],
      [`order:${a.id}:create:11`, 'ORDER_DEDUCT', -1, a.id],
    ]);

    expect(tables[UIDS.orderHistory]).toHaveLength(1);
    expect(tables[UIDS.orderHistory][0]).toMatchObject({
      order: a.id,
      type: 'ORDER_CREATED',
      description: 'Order created with 3 items',
      actor: 'user:1',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ORDER_CREATED', orderId: a.id, depth: 0, orders: 1 });
    expect(events[0].id).toEqual(expect.any(String));

    const b = await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    expect(b.reference).toBe(1002);
    expect(b.publicId).not.toBe(a.publicId);
  });

  it('sums repeated variants into one line', async () => {
    const { service, tables } = setup();
    await service.create(
      input({
        lines: [
          { variantId: 10, quantity: 1 },
          { variantId: 10, quantity: 2 },
        ],
      }),
      ctx
    );
    expect(tables[UIDS.orderLine]).toHaveLength(1);
    expect(tables[UIDS.orderLine][0].quantity).toBe(3);
    expect(stockOf(tables, 10)).toBe(2);
  });

  it('rejects insufficient stock and creates nothing', async () => {
    const { service, tables, bus } = setup();
    const handler = vi.fn(async () => {});
    bus.subscribe('*', handler);
    const errors = await codes(
      service.create(
        input({
          lines: [
            { variantId: 10, quantity: 1 },
            { variantId: 11, quantity: 2 },
          ],
        }),
        ctx
      )
    );
    expect(errors).toEqual([{ path: 'lines.1.quantity', code: 'INSUFFICIENT_STOCK' }]);
    for (const uid of [
      UIDS.order,
      UIDS.orderLine,
      UIDS.customer,
      UIDS.stockMovement,
      UIDS.orderHistory,
    ]) {
      expect(tables[uid]).toHaveLength(0);
    }
    expect(stockOf(tables, 11)).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('validates fields, quantities, availability and shipping', async () => {
    const { service } = setup();
    expect(
      await codes(
        service.create(
          input({
            customer: { firstName: '', lastName: 'S', email: 'bad' },
            shippingAddress: address({ country: 'FR', city: '' }),
            lines: [
              { variantId: 10, quantity: 0 },
              { variantId: 11, quantity: 1.5 },
            ],
          }),
          ctx
        )
      )
    ).toEqual(
      expect.arrayContaining([
        { path: 'customer.firstName', code: 'required' },
        { path: 'customer.email', code: 'invalid_email' },
        { path: 'shippingAddress.city', code: 'required' },
        { path: 'shippingAddress.country', code: 'invalid_country' },
        { path: 'lines.0.quantity', code: 'INVALID_QUANTITY' },
        { path: 'lines.1.quantity', code: 'INVALID_QUANTITY' },
      ])
    );
    expect(
      await codes(
        service.create(
          input({
            shippingAddress: address({ country: 'pt' }),
            billingAddress: address({ country: 'PRT' }),
          }),
          ctx
        )
      )
    ).toEqual([{ path: 'billingAddress.country', code: 'invalid_country' }]);
    expect(await codes(service.create(input({ lines: [] }), ctx))).toEqual([
      { path: 'lines', code: 'required' },
    ]);
    expect(
      await codes(
        service.create(
          input({
            lines: [
              { variantId: 12, quantity: 1 },
              { variantId: 20, quantity: 1 },
              { variantId: 99, quantity: 1 },
            ],
          }),
          ctx
        )
      )
    ).toEqual([
      { path: 'lines.0.variantId', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.1.variantId', code: 'VARIANT_UNAVAILABLE' },
      { path: 'lines.2.variantId', code: 'VARIANT_UNAVAILABLE' },
    ]);
    expect(
      await codes(
        service.create(input({ shipping: { providerId: 'manual', serviceId: '9' } }), ctx)
      )
    ).toEqual([{ path: 'shipping', code: 'SHIPPING_UNAVAILABLE' }]);
  });

  it('returns the same order for a repeated idempotencyKey with a single stock deduction', async () => {
    const { service, tables } = setup();
    const a = await service.create(input({ idempotencyKey: 'k-1' }), ctx);
    const b = await service.create(input({ idempotencyKey: 'k-1' }), ctx);
    expect(b).toEqual(a);
    expect(tables[UIDS.order]).toHaveLength(1);
    expect(tables[UIDS.stockMovement]).toHaveLength(2);
    expect(stockOf(tables, 10)).toBe(3);
  });

  it('replays an idempotencyKey before validation, even after settings changed', async () => {
    const { service, tables, settings, shipping } = setup();
    const a = await service.create(input({ idempotencyKey: 'k-r' }), ctx);
    settings.countries = ['ES'];
    shipping.findOption.mockClear();
    expect(await service.create(input({ idempotencyKey: 'k-r' }), ctx)).toEqual(a);
    expect(shipping.findOption).not.toHaveBeenCalled();
    expect(tables[UIDS.order]).toHaveLength(1);
  });

  it('returns the existing order when a concurrent duplicate wins the idempotencyKey', async () => {
    const { service, tables, strapi } = setup();
    const one = { idempotencyKey: 'k-2', lines: [{ variantId: 10, quantity: 2 }] };
    const first = await service.create(input(one), ctx);
    // The pre-check misses (the other request had not committed yet); the insert hits the unique index.
    let missed = false;
    const query = strapi.db.query;
    strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.order) return q;
      return {
        ...q,
        findOne: async (p: any) => {
          if (p?.where?.idempotencyKey && !missed) return ((missed = true), null);
          return q.findOne(p);
        },
      };
    };
    expect(await service.create(input(one), ctx)).toEqual(first);
    expect(missed).toBe(true);
    expect(tables[UIDS.order]).toHaveLength(1);
    expect(tables[UIDS.customer]).toHaveLength(1);
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
    expect(stockOf(tables, 10)).toBe(3);
  });

  it('retries the whole creation when another order took the reference', async () => {
    const { service, tables, strapi } = setup();
    await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    // A stale max(reference) read: the first attempt computes 1001, which is taken.
    let stale = 1;
    const query = strapi.db.query;
    strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.order) return q;
      return {
        ...q,
        findMany: async (p: any) =>
          p?.orderBy?.reference === 'desc' && stale-- > 0 ? [] : q.findMany(p),
      };
    };
    const r = await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    expect(r.reference).toBe(1002);
    expect(tables[UIDS.order].map((o) => o.reference)).toEqual([1001, 1002]);
    expect(tables[UIDS.stockMovement]).toHaveLength(2);
    expect(stockOf(tables, 10)).toBe(3);
  });

  it('gives up after 3 reference collisions', async () => {
    const { service, tables, strapi } = setup();
    await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    const query = strapi.db.query;
    strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.order) return q;
      return {
        ...q,
        findMany: async (p: any) => (p?.orderBy?.reference === 'desc' ? [] : q.findMany(p)),
      };
    };
    const err: any = await service
      .create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx)
      .catch((e) => e);
    expect(err.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(tables[UIDS.order]).toHaveLength(1);
    expect(stockOf(tables, 10)).toBe(4);
  });

  /** Makes the order INSERT fail with `errors` (one per attempt), then behave normally. */
  const failOrderInserts = (strapi: any, errors: unknown[]) => {
    const query = strapi.db.query;
    let calls = 0;
    strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.order) return q;
      return {
        ...q,
        create: async (p: any) => {
          const e = errors[calls++];
          if (e) throw e;
          return q.create(p);
        },
      };
    };
    return () => calls;
  };
  const dbError = (props: Record<string, unknown>, message = 'db error') =>
    Object.assign(new Error(message), props);

  it.each([
    [
      'MariaDB ER_CHECKREAD (1020)',
      dbError(
        { errno: 1020, code: 'ER_CHECKREAD', sqlState: 'HY000' },
        "Record has changed since last read in table 'ltb_st_module_ecommerce_orders'"
      ),
    ],
    ['MySQL deadlock (1213)', dbError({ errno: 1213, code: 'ER_LOCK_DEADLOCK' })],
    ['PostgreSQL serialization_failure (40001)', dbError({ code: '40001' })],
    ['PostgreSQL deadlock_detected (40P01)', dbError({ code: '40P01' })],
  ])('retries the whole creation after %s', async (_label, e) => {
    const { service, tables, strapi } = setup();
    const calls = failOrderInserts(strapi, [e]);
    const r = await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    expect(calls()).toBe(2);
    expect(r.reference).toBe(1001);
    expect(tables[UIDS.order]).toHaveLength(1);
    expect(tables[UIDS.customer]).toHaveLength(1);
    expect(tables[UIDS.stockMovement]).toHaveLength(1);
    expect(stockOf(tables, 10)).toBe(4);
  });

  it('propagates the last transient conflict after 3 attempts', async () => {
    const { service, tables, strapi } = setup();
    const last = dbError({ errno: 1020, code: 'ER_CHECKREAD' }, 'third');
    const calls = failOrderInserts(strapi, [
      dbError({ errno: 1213 }, 'first'),
      dbError({ code: '40001' }, 'second'),
      last,
    ]);
    const err = await service
      .create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx)
      .catch((x) => x);
    expect(err).toBe(last);
    expect(calls()).toBe(3);
    expect(tables[UIDS.order]).toHaveLength(0);
    expect(tables[UIDS.stockMovement]).toHaveLength(0);
    expect(stockOf(tables, 10)).toBe(5);
  });

  it('does not retry other database errors', async () => {
    const { service, tables, strapi } = setup();
    const boom = dbError({ errno: 1054, code: 'ER_BAD_FIELD_ERROR' });
    const calls = failOrderInserts(strapi, [boom]);
    const err = await service
      .create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx)
      .catch((x) => x);
    expect(err).toBe(boom);
    expect(calls()).toBe(1);
    expect(tables[UIDS.order]).toHaveLength(0);
    expect(stockOf(tables, 10)).toBe(5);
  });

  it('snapshots line texts in the order locale with fallback to the default locale', async () => {
    const { service, tables } = setup();
    await service.create(input({ locale: 'pt' }), ctx);
    const [l1, l2] = tables[UIDS.orderLine];
    expect(l1).toMatchObject({ name: 'Shirt', option: 'Médio' });
    expect(l2).toMatchObject({ name: 'Shirt', option: 'Large' });
    expect(tables[UIDS.order][0].locale).toBe('pt');
  });
});

describe('EcommerceOrderService.list / get', () => {
  it('lists newest reference first and searches by #reference and e-mail', async () => {
    const { service } = setup();
    await service.create(input({ lines: [{ variantId: 10, quantity: 1 }] }), ctx);
    await service.create(
      input({
        customer: { firstName: 'Rui', lastName: 'Costa', email: 'rui@example.pt' },
        lines: [{ variantId: 10, quantity: 1 }],
      }),
      ctx
    );

    const all = await service.list({ page: 1 });
    expect(all.results.map((r: any) => r.reference)).toEqual([1002, 1001]);
    expect(all.pagination).toEqual({ page: 1, pageSize: 50, total: 2, pageCount: 1 });
    expect(all.results[0]).toEqual({
      id: expect.any(Number),
      reference: 1002,
      orderStatus: 'OPEN',
      paymentStatus: 'PENDING',
      fulfillmentStatus: 'UNFULFILLED',
      total: 2500,
      customerName: 'Rui Costa',
    });

    expect((await service.list({ search: '#1002' })).results.map((r: any) => r.reference)).toEqual([
      1002,
    ]);
    expect((await service.list({ search: '1001' })).results.map((r: any) => r.reference)).toEqual([
      1001,
    ]);
    expect(
      (await service.list({ search: 'RUI@example' })).results.map((r: any) => r.reference)
    ).toEqual([1002]);
    expect((await service.list({ search: 'nobody@x.pt' })).results).toEqual([]);
    expect((await service.list({ paymentStatus: 'PAID' })).results).toEqual([]);
    expect((await service.list({ orderStatus: 'OPEN' })).results).toHaveLength(2);
  });

  it('a numeric search matches the reference or a customer e-mail containing it', async () => {
    const { service } = setup();
    const one = { lines: [{ variantId: 10, quantity: 1 }] };
    await service.create(input(one), ctx);
    await service.create(
      input({ ...one, customer: { firstName: 'F', lastName: 'N', email: 'fan1001@x.pt' } }),
      ctx
    );
    await service.create(
      input({ ...one, customer: { firstName: 'O', lastName: 'T', email: 'other@x.pt' } }),
      ctx
    );
    expect((await service.list({ search: '1001' })).results.map((r: any) => r.reference)).toEqual([
      1002, 1001,
    ]);
    expect((await service.list({ search: '#1003' })).results.map((r: any) => r.reference)).toEqual([
      1003,
    ]);
  });

  it('get returns the order view with lines, summary, actions and history', async () => {
    const { service } = setup();
    const { id } = await service.create(input(), ctx);
    const view = await service.get(id);
    expect(view).toMatchObject({
      id,
      reference: 1001,
      locale: 'en',
      source: 'admin',
      orderStatus: 'OPEN',
      customer: { id: 1, firstName: 'Ana', email: 'Ana@Example.pt' },
      shippingAddress: { city: 'Lisboa', country: 'PT' },
      billingAddress: { nif: '123456789' },
      totals: { itemsOriginal: 6500, subtotal: 6500, shippingTotal: 500, total: 7000 },
      payments: [],
      refunds: [],
      invoices: [],
      shipments: [],
      promotions: [],
      summary: { orderTotal: 7000, total: 7000, paid: 0, due: 7000, excess: 0 },
      availableActions: ['MODIFY', 'CANCEL', 'ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS'],
    });
    expect(view.lines).toHaveLength(2);
    expect(view.lines[0]).toMatchObject({ variantId: 10, quantity: 2, shipped: 0, pending: 2 });
    expect(view.history.map((h: any) => h.type)).toEqual(['ORDER_CREATED']);
  });

  it('get orders history newest first and recalculate records status changes', async () => {
    const { service, tables } = setup();
    const { id } = await service.create(input(), ctx);
    tables[UIDS.payment].push({
      id: 1,
      order: id,
      status: 'COMPLETED',
      amount: 7000,
      method: 'MANUAL',
    });
    await service.recalculate(id, { actor: 'user:2' });
    expect(tables[UIDS.order][0].paymentStatus).toBe('PAID');
    const view = await service.get(id);
    expect(view.history.map((h: any) => h.type)).toEqual([
      'PAYMENT_STATUS_CHANGED',
      'ORDER_CREATED',
    ]);
    expect(view.history[0]).toMatchObject({
      previousValue: { paymentStatus: 'PENDING' },
      newValue: { paymentStatus: 'PAID' },
      actor: 'user:2',
    });
    // The settled payment is not invoiced yet.
    expect(view.availableActions).toEqual(['SHIP', 'MODIFY', 'CANCEL', 'INVOICE_TOTAL']);
    // No change → no new entry.
    await service.recalculate(id);
    expect(tables[UIDS.orderHistory]).toHaveLength(2);
  });

  it('get throws not found', async () => {
    const { service } = setup();
    await expect(service.get(42)).rejects.toThrow('Order not found');
  });
});
