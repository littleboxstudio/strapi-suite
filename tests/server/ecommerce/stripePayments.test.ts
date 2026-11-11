import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
}));
vi.mock('../../../server/src/services/modules/ecommerce/providers/payments/stripeClient', () => ({
  createStripeClient: () => stripe,
}));

import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import EcommerceStoreCreditService from '../../../server/src/services/modules/ecommerce/storeCredits';
import EcommerceRefundService from '../../../server/src/services/modules/ecommerce/refunds';
import EcommercePaymentService from '../../../server/src/services/modules/ecommerce/payments';
import EcommerceStripePaymentService from '../../../server/src/services/modules/ecommerce/stripePayments';
import EcommerceOrderHistoryService from '../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import {
  createEventBus,
  __resetEventHandlersForTests,
} from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
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
  stripeSession: `${P}stripe-session`,
  refund: `${P}refund`,
  storeCredit: `${P}store-credit`,
  storeCreditMovement: `${P}store-credit-movement`,
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
  [UIDS.stripeSession]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
  },
};

const HOUR = 3600;
const nowSec = () => Math.floor(Date.now() / 1000);

function setup(opts: { storefrontUrl?: string | null; stripeActive?: boolean } = {}) {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [UIDS.stockMovement, UIDS.order, UIDS.payment, UIDS.stripeSession],
  });
  const services: Record<string, any> = {};
  const bus = createEventBus(() => undefined);
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const strapi: any = {
    log,
    db: {
      query: db.query,
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
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  const realHistory = EcommerceOrderHistoryService({ strapi });
  // Simulates a database failure in the next transaction that records `type`.
  const failHistory = new Set<string>();
  services.EcommerceOrderHistoryService = {
    record: async (entry: any) => {
      if (failHistory.delete(entry.type)) throw new Error('db down');
      return realHistory.record(entry);
    },
  };
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
    getStoreSettings: async () => ({
      shippingCountries: ['PT'],
      storefrontUrl:
        opts.storefrontUrl === undefined ? 'https://shop.example/' : opts.storefrontUrl,
      paymentSuccessPath: '/checkout/success',
      paymentCancelPath: '/checkout/cancel',
    }),
    getRuntime: async (id: string) =>
      id === 'stripe'
        ? { config: {}, secrets: { secretKey: 'sk_test_x' }, active: opts.stripeActive ?? true }
        : null,
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  services.EcommerceOrderService = EcommerceOrderService({ strapi });
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  services.EcommercePaymentService = EcommercePaymentService({ strapi });
  services.EcommerceStripePaymentService = EcommerceStripePaymentService({ strapi });

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push({ id: 1, product: 1, locale: 'en', name: 'Shirt' });
  t[UIDS.variant].push({
    id: 10,
    product: 1,
    sku: 'SH-M',
    price: 2000,
    tax: 23,
    stock: 5,
    active: true,
  });

  const events: any[] = [];
  bus.subscribe('*', async (e) => {
    events.push(e);
  });
  return {
    orders: services.EcommerceOrderService,
    payments: services.EcommercePaymentService,
    stripePayments: services.EcommerceStripePaymentService,
    tables: t,
    events,
    log,
    failNextHistory: (type: string) => failHistory.add(type),
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

/** Total 4500: 2 × 2000 + 500 shipping. */
const createOrder = async (orders: any) =>
  orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity: 2 }],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor: 'user:1', source: 'admin' }
  );

let sessionSeq = 0;
beforeEach(() => {
  __resetEventHandlersForTests();
  sessionSeq = 0;
  stripe.createCheckoutSession.mockReset();
  stripe.retrieveCheckoutSession.mockReset();
  stripe.expireCheckoutSession.mockReset();
  // Same Idempotency-Key -> same session, like Stripe.
  const byKey = new Map<string, any>();
  stripe.createCheckoutSession.mockImplementation(async (p: any) => {
    if (byKey.has(p.idempotencyKey)) return byKey.get(p.idempotencyKey);
    sessionSeq += 1;
    const s = {
      id: `cs_${sessionSeq}`,
      url: `https://checkout.stripe.com/c/pay/cs_${sessionSeq}`,
      status: 'open',
      expiresAt: p.expiresAt,
      paymentIntentId: null,
    };
    byKey.set(p.idempotencyKey, s);
    return s;
  });
  stripe.expireCheckoutSession.mockResolvedValue('expired');
});

const actor = 'user:1';

describe('getOrCreatePaymentLink', () => {
  it('creates a Stripe session, a PENDING payment and history', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });

    expect(link).toMatchObject({
      url: 'https://checkout.stripe.com/c/pay/cs_1',
      sessionId: 'cs_1',
      amount: 4500,
      reused: false,
    });
    expect(typeof link.expiresAt).toBe('string');

    const params = stripe.createCheckoutSession.mock.calls[0][0];
    const payment = tables[UIDS.payment][0];
    expect(params).toMatchObject({
      amount: 4500,
      currency: 'EUR',
      description: `Order #${order.reference}`,
      customerEmail: 'ana@example.pt',
      successUrl: `https://shop.example/checkout/success?order=${order.publicId}`,
      cancelUrl: `https://shop.example/checkout/cancel?order=${order.publicId}`,
      metadata: { orderId: String(order.id), paymentId: String(payment.id), purpose: 'CHECKOUT' },
      idempotencyKey: `session:${order.id}:4500:0`,
    });
    // 23h55m from now (below Stripe's 24 h maximum).
    expect(Math.abs(params.expiresAt - (nowSec() + 23 * HOUR + 55 * 60))).toBeLessThanOrEqual(5);

    expect(payment).toMatchObject({
      method: 'STRIPE',
      status: 'PENDING',
      amount: 4500,
      externalId: 'cs_1',
    });
    expect(tables[UIDS.stripeSession]).toHaveLength(1);
    expect(tables[UIDS.stripeSession][0]).toMatchObject({
      order: order.id,
      payment: payment.id,
      sessionId: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
      amount: 4500,
      status: 'OPEN',
      purpose: 'CHECKOUT',
    });
    const h = tables[UIDS.orderHistory].filter((r) => r.type === 'PAYMENT_CREATED');
    expect(h).toHaveLength(1);
    expect(h[0].description).toBe('Stripe payment link created');
    // Creating a link never settles anything.
    expect((await orders.get(order.id)).summary.paid).toBe(0);
  });

  it('Review Focus 3: same due reuses the session; a changed due expires it', async () => {
    const { orders, payments, stripePayments, tables } = setup();
    const order = await createOrder(orders);

    const first = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    const second = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    expect(second).toMatchObject({
      sessionId: first.sessionId,
      url: first.url,
      reused: true,
      amount: 4500,
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(tables[UIDS.payment]).toHaveLength(1);

    // The due changes: 4500 -> 3500.
    await payments.addManualPayment(order.id, { amount: 1000, idempotencyKey: 'm-1' }, actor);
    const third = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'SUPPLEMENTARY',
      actor,
    });

    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_1');
    expect(third).toMatchObject({ sessionId: 'cs_2', amount: 3500, reused: false });
    expect(stripe.createCheckoutSession.mock.calls[1][0].idempotencyKey).toBe(
      `session:${order.id}:3500:1`
    );
    const sessions = tables[UIDS.stripeSession];
    expect(sessions.find((s) => s.sessionId === 'cs_1').status).toBe('EXPIRED');
    expect(sessions.find((s) => s.sessionId === 'cs_2')).toMatchObject({
      status: 'OPEN',
      amount: 3500,
      purpose: 'SUPPLEMENTARY',
    });
    const stripePaymentsRows = tables[UIDS.payment].filter((p) => p.method === 'STRIPE');
    expect(stripePaymentsRows.map((p) => [p.externalId, p.status, p.amount])).toEqual([
      ['cs_1', 'CANCELLED', 4500],
      ['cs_2', 'PENDING', 3500],
    ]);
  });

  it('replaces a session that expires within the hour', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    tables[UIDS.stripeSession][0].expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const next = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    expect(next).toMatchObject({ sessionId: 'cs_2', reused: false, amount: 4500 });
    expect(tables[UIDS.stripeSession][0].status).toBe('EXPIRED');
  });

  it('without storefrontUrl -> STOREFRONT_URL_MISSING', async () => {
    const { orders, stripePayments, tables } = setup({ storefrontUrl: null });
    const order = await createOrder(orders);
    const err: any = await stripePayments
      .getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(EcommercePaymentError);
    expect(err.code).toBe('STOREFRONT_URL_MISSING');
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    expect(tables[UIDS.payment]).toHaveLength(0);
  });

  it('Stripe inactive -> STRIPE_NOT_CONFIGURED', async () => {
    const { orders, stripePayments } = setup({ stripeActive: false });
    const order = await createOrder(orders);
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('nothing due -> NOTHING_DUE', async () => {
    const { orders, payments, stripePayments } = setup();
    const order = await createOrder(orders);
    await payments.addManualPayment(order.id, { amount: 4500, idempotencyKey: 'm-1' }, actor);
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toMatchObject({ code: 'NOTHING_DUE' });
  });

  it('cancelled order -> ACTION_NOT_AVAILABLE', async () => {
    const { orders, stripePayments } = setup();
    const order = await createOrder(orders);
    await orders.cancel(order.id, actor);
    const err: any = await stripePayments
      .getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }]);
  });

  it('a Stripe failure leaves a pending payment that the retry reuses with the same key', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    stripe.createCheckoutSession.mockRejectedValueOnce(
      new EcommercePaymentError('STRIPE_UNREACHABLE', 'Could not reach Stripe.')
    );
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toMatchObject({ code: 'STRIPE_UNREACHABLE' });

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    expect(link).toMatchObject({ sessionId: 'cs_1', amount: 4500 });
    const [a, b] = stripe.createCheckoutSession.mock.calls.map((c) => c[0]);
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(b.expiresAt).toBe(a.expiresAt);
    expect(b.metadata).toEqual(a.metadata);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.payment][0]).toMatchObject({ status: 'PENDING', externalId: 'cs_1' });
  });

  it('an old session that was actually paid is completed instead of replaced', async () => {
    const { orders, payments, stripePayments, tables, events } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    // The due changes, but the customer had already paid the old 4500 session.
    await payments.addManualPayment(order.id, { amount: 1000, idempotencyKey: 'm-1' }, actor);
    stripe.expireCheckoutSession.mockResolvedValueOnce('complete');
    stripe.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_1',
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_1',
      amountTotal: 4500,
      metadata: {},
    });

    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'SUPPLEMENTARY', actor })
    ).rejects.toMatchObject({ code: 'NOTHING_DUE' });

    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
    const stripeRow = tables[UIDS.payment].find((p) => p.method === 'STRIPE');
    expect(stripeRow).toMatchObject({ status: 'COMPLETED', externalId: 'pi_1', amount: 4500 });
    expect(stripeRow.completedAt).toBeTruthy();
    expect(stripeRow.coverage).toBeTruthy();
    expect(tables[UIDS.stripeSession][0]).toMatchObject({
      status: 'COMPLETE',
      paymentIntentId: 'pi_1',
    });
    const view = await orders.get(order.id);
    expect(view.summary.paid).toBe(5500);
    expect(view.paymentStatus).toBe('PAID');
    const completedHistory = tables[UIDS.orderHistory].filter(
      (h) => h.type === 'PAYMENT_COMPLETED' && h.actor === 'system'
    );
    expect(completedHistory).toHaveLength(1);
    expect(
      events.filter((e) => e.type === 'PAYMENT_COMPLETED' && e.payload.method === 'STRIPE')
    ).toHaveLength(1);
  });

  it('a paid old session with remaining due completes it and creates a new session', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    // The order grows (modification) — simulated by raising the stored total.
    tables[UIDS.order][0].total = 6000;
    stripe.expireCheckoutSession.mockResolvedValueOnce('complete');
    stripe.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_1',
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_1',
      amountTotal: 4500,
      metadata: {},
    });

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'SUPPLEMENTARY',
      actor,
    });
    expect(link).toMatchObject({ sessionId: 'cs_2', amount: 1500, reused: false });
    expect(
      tables[UIDS.payment].filter((p) => p.method === 'STRIPE').map((p) => [p.status, p.amount])
    ).toEqual([
      ['COMPLETED', 4500],
      ['PENDING', 1500],
    ]);
  });
});

describe('completeFromSession', () => {
  it('is idempotent', async () => {
    const { orders, stripePayments, tables, events } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    const row = tables[UIDS.stripeSession][0];
    const retrieved = {
      id: 'cs_1',
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_1',
      amountTotal: 4500,
      metadata: {},
    };
    await stripePayments.completeFromSession(row, retrieved, 'webhook:stripe');
    await stripePayments.completeFromSession(row, retrieved, 'webhook:stripe');

    expect(tables[UIDS.payment][0].status).toBe('COMPLETED');
    expect(tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_COMPLETED')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(1);
    expect((await orders.get(order.id)).summary.paid).toBe(4500);
  });

  it('an unpaid complete session (async method) keeps the payment PENDING', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    const row = tables[UIDS.stripeSession][0];
    await stripePayments.completeFromSession(
      row,
      {
        id: 'cs_1',
        status: 'complete',
        paymentStatus: 'unpaid',
        paymentIntentId: 'pi_1',
        amountTotal: 4500,
        metadata: {},
      },
      'webhook:stripe'
    );
    expect(tables[UIDS.payment][0].status).toBe('PENDING');
    expect(tables[UIDS.stripeSession][0]).toMatchObject({
      status: 'COMPLETE',
      paymentIntentId: 'pi_1',
    });

    // While that payment awaits confirmation, no second link is created.
    stripe.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_1',
      status: 'complete',
      paymentStatus: 'unpaid',
      paymentIntentId: 'pi_1',
      amountTotal: 4500,
      metadata: {},
    });
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toMatchObject({ code: 'PAYMENT_PENDING' });
    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
  });
});

describe('sendPaymentInstructions', () => {
  it('MANUAL emits the event without a link and settles nothing', async () => {
    const { orders, payments, tables, events } = setup();
    const order = await createOrder(orders);

    const out = await payments.sendPaymentInstructions(
      order.id,
      { mode: 'MANUAL', instructions: 'IBAN PT50 0000' },
      actor
    );

    expect(out).toEqual({});
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    const e = events.filter((x) => x.type === 'PAYMENT_INSTRUCTIONS_SENT');
    expect(e).toHaveLength(1);
    expect(e[0].orderId).toBe(order.id);
    expect(e[0].payload).toEqual({
      mode: 'MANUAL',
      instructions: 'IBAN PT50 0000',
      amountDue: 4500,
      supplementary: false,
    });
    expect(
      tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_INSTRUCTIONS_SENT')
    ).toHaveLength(1);
    expect(tables[UIDS.payment]).toHaveLength(0);
    expect((await orders.get(order.id)).paymentStatus).toBe('PENDING');
  });

  it('MANUAL validates 1..5000 characters', async () => {
    const { orders, payments } = setup();
    const order = await createOrder(orders);
    for (const instructions of ['', '   ', 'x'.repeat(5001), undefined]) {
      const err: any = await payments
        .sendPaymentInstructions(order.id, { mode: 'MANUAL', instructions }, actor)
        .catch((x: any) => x);
      expect(err).toBeInstanceOf(EcommerceValidationError);
      expect(err.errors[0].path).toBe('instructions');
    }
    await expect(
      payments.sendPaymentInstructions(
        order.id,
        { mode: 'MANUAL', instructions: 'x'.repeat(5000) },
        actor
      )
    ).resolves.toEqual({});
  });

  it('STRIPE creates a CHECKOUT link before any payment, SUPPLEMENTARY after one', async () => {
    const { orders, payments, tables, events } = setup();
    const order = await createOrder(orders);

    const out = await payments.sendPaymentInstructions(order.id, { mode: 'STRIPE' }, actor);
    expect(out.url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(typeof out.expiresAt).toBe('string');
    expect(tables[UIDS.stripeSession][0].purpose).toBe('CHECKOUT');
    const first = events.filter((x) => x.type === 'PAYMENT_INSTRUCTIONS_SENT')[0];
    expect(first.payload).toEqual({
      mode: 'STRIPE',
      url: out.url,
      expiresAt: out.expiresAt,
      amountDue: 4500,
      supplementary: false,
    });

    await payments.addManualPayment(order.id, { amount: 1000, idempotencyKey: 'm-1' }, actor);
    await payments.sendPaymentInstructions(order.id, { mode: 'STRIPE' }, actor);
    expect(tables[UIDS.stripeSession][1].purpose).toBe('SUPPLEMENTARY');
    const second = events.filter((x) => x.type === 'PAYMENT_INSTRUCTIONS_SENT')[1];
    expect(second.payload).toMatchObject({ mode: 'STRIPE', amountDue: 3500, supplementary: true });
  });

  it('requires SEND_PAYMENT_INSTRUCTIONS', async () => {
    const { orders, payments, events } = setup();
    const order = await createOrder(orders);
    await payments.addManualPayment(order.id, { amount: 4500, idempotencyKey: 'm-1' }, actor);
    const err: any = await payments
      .sendPaymentInstructions(order.id, { mode: 'MANUAL', instructions: 'x' }, actor)
      .catch((x: any) => x);
    expect(err.errors).toEqual([{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }]);
    expect(events.filter((x) => x.type === 'PAYMENT_INSTRUCTIONS_SENT')).toHaveLength(0);
  });

  it('rejects an unknown mode', async () => {
    const { orders, payments } = setup();
    const order = await createOrder(orders);
    const err: any = await payments
      .sendPaymentInstructions(order.id, { mode: 'CASH' } as any, actor)
      .catch((x: any) => x);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors[0]).toEqual({ path: 'mode', code: 'invalid' });
  });
});

describe('fix round 1', () => {
  const paidSession = (id: string, amountTotal: number) => ({
    id,
    status: 'complete',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${id}`,
    amountTotal,
    metadata: {},
  });

  it('due changes while Stripe creates the session: that session is retired, the link is for the new due', async () => {
    const { orders, payments, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    const impl = stripe.createCheckoutSession.getMockImplementation()!;
    stripe.createCheckoutSession.mockImplementationOnce(async (p: any) => {
      await payments.addManualPayment(order.id, { amount: 1000, idempotencyKey: 'm-race' }, actor);
      return impl(p);
    });

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });

    expect(link).toMatchObject({ sessionId: 'cs_2', amount: 3500, reused: false });
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_1');
    const sessions = tables[UIDS.stripeSession];
    expect(sessions.map((s) => [s.sessionId, s.status, s.amount])).toEqual([
      ['cs_1', 'EXPIRED', 4500],
      ['cs_2', 'OPEN', 3500],
    ]);
    expect(
      tables[UIDS.payment].filter((p) => p.method === 'STRIPE').map((p) => [p.status, p.amount])
    ).toEqual([
      ['CANCELLED', 4500],
      ['PENDING', 3500],
    ]);
  });

  it('reusing a session retires every other OPEN session of the order', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    // A second OPEN row with another amount (left behind by a race).
    tables[UIDS.payment].push({
      id: 99,
      order: order.id,
      method: 'STRIPE',
      status: 'PENDING',
      amount: 1234,
      externalId: 'cs_x',
      metadata: {},
    });
    tables[UIDS.stripeSession].push({
      id: 99,
      order: order.id,
      payment: 99,
      sessionId: 'cs_x',
      url: 'https://checkout.stripe.com/c/pay/cs_x',
      amount: 1234,
      status: 'OPEN',
      expiresAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
      purpose: 'CHECKOUT',
    });

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });

    expect(link).toMatchObject({ sessionId: 'cs_1', reused: true });
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_x');
    expect(stripe.expireCheckoutSession).not.toHaveBeenCalledWith('cs_1');
    expect(
      tables[UIDS.stripeSession].filter((s) => s.status === 'OPEN').map((s) => s.sessionId)
    ).toEqual(['cs_1']);
    expect(tables[UIDS.payment].find((p) => p.id === 99).status).toBe('CANCELLED');
  });

  it('Stripe succeeded but the store transaction failed: the retry returns the same session', async () => {
    const { orders, stripePayments, tables, failNextHistory } = setup();
    const order = await createOrder(orders);
    failNextHistory('PAYMENT_CREATED');
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toThrow('db down');
    expect(tables[UIDS.stripeSession]).toHaveLength(0);

    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    expect(link).toMatchObject({ sessionId: 'cs_1', amount: 4500 });
    expect(sessionSeq).toBe(1); // Stripe replayed the same session
    expect(tables[UIDS.stripeSession]).toHaveLength(1);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_CREATED')).toHaveLength(1);
  });

  it('a concurrent replay of the same orphan finds the stored row (existing-row branch)', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    const impl = stripe.createCheckoutSession.getMockImplementation()!;
    let inner: any;
    // While the first call waits on Stripe, a second call reuses the same reserved payment
    // and key, gets the same session and stores it first.
    stripe.createCheckoutSession.mockImplementationOnce(async (p: any) => {
      inner = await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
      return impl(p);
    });

    const outer = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });

    expect(inner.sessionId).toBe('cs_1');
    expect(outer).toMatchObject({ sessionId: 'cs_1', amount: 4500 });
    expect(sessionSeq).toBe(1);
    expect(tables[UIDS.stripeSession]).toHaveLength(1);
    expect(tables[UIDS.payment]).toHaveLength(1);
    expect(tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_CREATED')).toHaveLength(1);
  });

  it('a retry reuses the stored create params, even if settings changed', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    stripe.createCheckoutSession.mockRejectedValueOnce(
      new EcommercePaymentError('STRIPE_UNREACHABLE', 'x')
    );
    await stripePayments
      .getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
      .catch(() => null);
    tables[UIDS.order][0].customerSnapshot = {
      ...tables[UIDS.order][0].customerSnapshot,
      email: 'new@example.pt',
    };
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    const [a, b] = stripe.createCheckoutSession.mock.calls.map((c) => c[0]);
    expect(b).toEqual(a);
    expect(a.customerEmail).toBe('ana@example.pt');
  });

  it('an idempotency mismatch cancels the orphan and uses a fresh key', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    stripe.createCheckoutSession.mockRejectedValueOnce(
      new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'x', 'idempotency_error')
    );
    const link = await stripePayments.getOrCreatePaymentLink(order.id, {
      purpose: 'CHECKOUT',
      actor,
    });
    expect(link.amount).toBe(4500);
    const keys = stripe.createCheckoutSession.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys).toEqual([`session:${order.id}:4500:0`, `session:${order.id}:4500:1`]);
    expect(tables[UIDS.payment].map((p) => p.status)).toEqual(['CANCELLED', 'PENDING']);
  });

  it('completeFromSession refuses a session whose id or amount does not match', async () => {
    const { orders, stripePayments, tables, log } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    const row = tables[UIDS.stripeSession][0];
    for (const bad of [paidSession('cs_other', 4500), paidSession('cs_1', 100)]) {
      await expect(
        stripePayments.completeFromSession(row, bad, 'webhook:stripe')
      ).rejects.toMatchObject({ code: 'STRIPE_SESSION_MISMATCH' });
    }
    expect(tables[UIDS.payment][0].status).toBe('PENDING');
    expect(tables[UIDS.stripeSession][0].status).toBe('OPEN');
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('an awaiting session that is now paid is completed instead of blocking', async () => {
    const { orders, stripePayments, tables } = setup();
    const order = await createOrder(orders);
    await stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor });
    const row = tables[UIDS.stripeSession][0];
    await stripePayments.completeFromSession(
      row,
      { ...paidSession('cs_1', 4500), paymentStatus: 'unpaid' },
      'webhook:stripe'
    );
    stripe.retrieveCheckoutSession.mockResolvedValueOnce(paidSession('cs_1', 4500));
    await expect(
      stripePayments.getOrCreatePaymentLink(order.id, { purpose: 'CHECKOUT', actor })
    ).rejects.toMatchObject({ code: 'NOTHING_DUE' });
    expect(tables[UIDS.payment][0].status).toBe('COMPLETED');
  });

  it('STRIPE instructions report the link amount as amountDue', async () => {
    const { orders, payments, events } = setup();
    const order = await createOrder(orders);
    await payments.sendPaymentInstructions(order.id, { mode: 'STRIPE' }, actor);
    const e = events.find((x) => x.type === 'PAYMENT_INSTRUCTIONS_SENT');
    expect(e.payload.amountDue).toBe(4500);
  });
});
