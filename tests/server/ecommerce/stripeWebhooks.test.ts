import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

import EcommerceOrderService from '../../../server/src/services/modules/ecommerce/orders';
import EcommerceShipmentService from '../../../server/src/services/modules/ecommerce/shipments';
import EcommerceReturnService from '../../../server/src/services/modules/ecommerce/returns';
import EcommerceStoreCreditService from '../../../server/src/services/modules/ecommerce/storeCredits';
import EcommerceRefundService from '../../../server/src/services/modules/ecommerce/refunds';
import EcommercePaymentService from '../../../server/src/services/modules/ecommerce/payments';
import EcommerceStripePaymentService from '../../../server/src/services/modules/ecommerce/stripePayments';
import EcommerceStripeWebhookService from '../../../server/src/services/modules/ecommerce/stripeWebhooks';
import EcommerceOrderHistoryService from '../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import {
  createEventBus,
  __resetEventHandlersForTests,
} from '../../../server/src/services/modules/ecommerce/events';
import { EcommercePaymentError } from '../../../server/src/services/modules/ecommerce/errors';
import createWebhookController from '../../../server/src/controllers/modules/ecommerce/stripeWebhook';
import webhookRoutes from '../../../server/src/routes/ecommerce/content-api-webhooks';
import contentApiRoutes from '../../../server/src/routes/content-api';
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
  notification: `${P}notification`,
  webhookEvent: `${P}webhook-event`,
  storeCredit: `${P}store-credit`,
  storeCreditMovement: `${P}store-credit-movement`,
  shipment: `${P}shipment`,
  shipmentEvent: `${P}shipment-event`,
  orderReturn: `${P}order-return`,
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
  [UIDS.refund]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
    storeCredit: [UIDS.storeCredit, 'storeCredit', 'manyToOne'],
  },
  [UIDS.shipment]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.orderReturn]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.shipmentEvent]: {
    shipment: [UIDS.shipment, 'shipment', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
  },
};

const SECRET = 'whsec_test_123';

const sign = (raw: Buffer, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')}`;

const evt = (id: string, type: string, object: any) =>
  Buffer.from(JSON.stringify({ id, object: 'event', type, data: { object } }));

function setup(opts: { webhookSecret?: string | null } = {}) {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [
      UIDS.stockMovement,
      UIDS.order,
      UIDS.payment,
      UIDS.stripeSession,
      UIDS.webhookEvent,
    ],
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
  const secret = opts.webhookSecret === undefined ? SECRET : opts.webhookSecret;
  services.EcommerceSettingsService = {
    getStoreSettings: async () => ({ shippingCountries: ['PT'] }),
    getRuntime: async (id: string) =>
      id === 'stripe'
        ? {
            config: {},
            secrets: secret ? { secretKey: 'sk_test_x', webhookSecret: secret } : { secretKey: 'sk_test_x' },
            active: true,
          }
        : null,
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  services.EcommerceOrderService = EcommerceOrderService({ strapi });
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceReturnService = EcommerceReturnService({ strapi });
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  services.EcommercePaymentService = EcommercePaymentService({ strapi });
  services.EcommerceStripePaymentService = EcommerceStripePaymentService({ strapi });
  services.EcommerceStripeWebhookService = EcommerceStripeWebhookService({ strapi });

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
    strapi,
    services,
    orders: services.EcommerceOrderService,
    webhooks: services.EcommerceStripeWebhookService,
    tables: t,
    events,
    log,
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

/** Order of 4500 cents with an OPEN Stripe session `cs_1` and its PENDING payment. */
async function seedSession(s: ReturnType<typeof setup>) {
  const order = await s.orders.create(
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
  const orderId = order.id ?? order.order?.id;
  const t = s.tables;
  const payment = {
    id: 900,
    order: orderId,
    method: 'STRIPE',
    status: 'PENDING',
    amount: 4500,
    currency: 'EUR',
    externalId: 'cs_1',
    idempotencyKey: 'stripe:session:x',
    coverage: null,
    completedAt: null,
    actor: 'user:1',
    metadata: null,
  };
  t[UIDS.payment].push(payment);
  t[UIDS.stripeSession].push({
    id: 50,
    order: orderId,
    payment: 900,
    sessionId: 'cs_1',
    paymentIntentId: null,
    url: 'https://checkout.stripe.com/c/pay/cs_1',
    amount: 4500,
    status: 'OPEN',
    expiresAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
    purpose: 'CHECKOUT',
  });
  return { orderId, payment: () => t[UIDS.payment].find((p) => p.id === 900) };
}

const session = (over: any = {}) => ({
  id: 'cs_1',
  object: 'checkout.session',
  status: 'complete',
  payment_status: 'paid',
  payment_intent: 'pi_1',
  amount_total: 4500,
  metadata: { orderId: '1', paymentId: '900', purpose: 'CHECKOUT' },
  ...over,
});

const deliver = (s: ReturnType<typeof setup>, raw: Buffer, signature = sign(raw)) =>
  s.webhooks.handle(raw, signature);

beforeEach(() => {
  __resetEventHandlersForTests();
});

describe('EcommerceStripeWebhookService.handle', () => {
  it('Review Focus 1: a repeated event settles and notifies the payment once', async () => {
    const s = setup();
    const { orderId, payment } = await seedSession(s);
    const raw = evt('evt_1', 'checkout.session.completed', session());

    const first = await deliver(s, raw);
    const second = await deliver(s, raw);

    expect(first).toEqual({ duplicate: false, status: 'PROCESSED' });
    expect(second).toEqual({ duplicate: true });
    expect(payment()).toMatchObject({ status: 'COMPLETED', externalId: 'pi_1' });
    expect(payment().completedAt).toBeTruthy();
    expect(payment().coverage).toBeTruthy();
    const completedEvents = s.events.filter((e) => e.type === 'PAYMENT_COMPLETED');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      orderId,
      payload: { paymentId: 900, amount: 4500, method: 'STRIPE' },
    });
    const history = s.tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_COMPLETED');
    expect(history).toHaveLength(1);
    expect(history[0].actor).toBe('webhook:stripe');
    expect(s.tables[UIDS.stripeSession][0]).toMatchObject({
      status: 'COMPLETE',
      paymentIntentId: 'pi_1',
    });
    expect(s.tables[UIDS.webhookEvent]).toHaveLength(1);
    expect(s.tables[UIDS.webhookEvent][0]).toMatchObject({
      provider: 'stripe',
      eventId: 'evt_1',
      type: 'checkout.session.completed',
      status: 'PROCESSED',
    });
    const order = s.tables[UIDS.order].find((o) => o.id === orderId);
    expect(order.paymentStatus).toBe('PAID');
  });

  it('a concurrent delivery losing the eventId unique race is a duplicate', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const raw = evt('evt_r', 'checkout.session.completed', session());
    // The other request inserted the row between our lookup and our insert.
    const realQuery = s.strapi.db.query;
    let raced = false;
    s.strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.webhookEvent || raced) return q;
      return {
        ...q,
        findOne: async (p: any) => {
          const r = await q.findOne(p);
          raced = true;
          s.tables[UIDS.webhookEvent].push({
            id: 99,
            provider: 'stripe',
            eventId: 'evt_r',
            type: 'checkout.session.completed',
            status: 'PROCESSED',
          });
          return r;
        },
      };
    };
    await expect(deliver(s, raw)).resolves.toEqual({ duplicate: true });
    expect(payment().status).toBe('PENDING');
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(0);
  });

  it('rejects an invalid signature (and a missing webhook secret) without recording anything', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const raw = evt('evt_2', 'checkout.session.completed', session());
    await expect(deliver(s, raw, sign(raw, 'whsec_wrong'))).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
    await expect(deliver(s, raw, '')).rejects.toBeInstanceOf(EcommercePaymentError);
    // Body tampered after signing.
    const sig = sign(raw);
    const tampered = Buffer.from(raw.toString().replace('4500', '1'));
    await expect(deliver(s, tampered, sig)).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
    expect(payment().status).toBe('PENDING');
    expect(s.tables[UIDS.webhookEvent]).toHaveLength(0);

    const noSecret = setup({ webhookSecret: null });
    await expect(
      noSecret.webhooks.handle(raw, sign(raw))
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  });

  it('a signed body that is not an event is rejected as invalid payload', async () => {
    const s = setup();
    const raw = Buffer.from('{"hello":1}');
    await expect(deliver(s, raw)).rejects.toMatchObject({ code: 'WEBHOOK_PAYLOAD_INVALID' });
    const notJson = Buffer.from('nope');
    await expect(deliver(s, notJson)).rejects.toMatchObject({ code: 'WEBHOOK_PAYLOAD_INVALID' });
  });

  it('asynchronous payment: unpaid completion keeps PENDING, async_payment_succeeded settles once', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const unpaid = session({ payment_status: 'unpaid' });

    const r1 = await deliver(s, evt('evt_a1', 'checkout.session.completed', unpaid));
    expect(r1).toEqual({ duplicate: false, status: 'PROCESSED' });
    expect(payment().status).toBe('PENDING');
    expect(s.tables[UIDS.stripeSession][0]).toMatchObject({
      status: 'COMPLETE',
      paymentIntentId: 'pi_1',
    });
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(0);

    await deliver(s, evt('evt_a2', 'checkout.session.async_payment_succeeded', session()));
    // Stripe may also deliver a distinct event for the same settlement.
    await deliver(s, evt('evt_a3', 'checkout.session.async_payment_succeeded', session()));

    expect(payment()).toMatchObject({ status: 'COMPLETED', externalId: 'pi_1' });
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(1);
    expect(
      s.tables[UIDS.orderHistory].filter((h) => h.type === 'PAYMENT_COMPLETED')
    ).toHaveLength(1);
  });

  it('async_payment_failed marks the payment FAILED and the session EXPIRED', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    await deliver(s, evt('evt_f1', 'checkout.session.completed', session({ payment_status: 'unpaid' })));
    const r = await deliver(
      s,
      evt('evt_f2', 'checkout.session.async_payment_failed', session({ payment_status: 'unpaid' }))
    );
    expect(r.status).toBe('PROCESSED');
    expect(payment().status).toBe('FAILED');
    expect(s.tables[UIDS.stripeSession][0].status).toBe('EXPIRED');
    const h = s.tables[UIDS.orderHistory].filter((x) => x.type === 'PAYMENT_FAILED');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      actor: 'webhook:stripe',
      previousValue: { paymentId: 900, status: 'PENDING' },
      newValue: { paymentId: 900, status: 'FAILED', sessionId: 'cs_1' },
    });
  });

  it('checkout.session.expired: session EXPIRED, PENDING payment CANCELLED', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const r = await deliver(
      s,
      evt('evt_e', 'checkout.session.expired', session({ status: 'expired', payment_status: 'unpaid', payment_intent: null }))
    );
    expect(r).toEqual({ duplicate: false, status: 'PROCESSED' });
    expect(s.tables[UIDS.stripeSession][0].status).toBe('EXPIRED');
    expect(payment().status).toBe('CANCELLED');
    const h = s.tables[UIDS.orderHistory].filter((x) => x.type === 'PAYMENT_CANCELLED');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      actor: 'webhook:stripe',
      previousValue: { paymentId: 900, status: 'PENDING' },
      newValue: { paymentId: 900, status: 'CANCELLED' },
    });
  });

  it('a session/amount mismatch is a terminal failure: 200 FAILED, never retried', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const raw = evt('evt_mm', 'checkout.session.completed', session({ amount_total: 1 }));

    expect(await deliver(s, raw)).toEqual({ duplicate: false, status: 'FAILED' });
    expect(payment().status).toBe('PENDING');
    expect(s.tables[UIDS.stripeSession][0].status).toBe('OPEN');
    expect(s.tables[UIDS.webhookEvent]).toHaveLength(1);
    expect(s.tables[UIDS.webhookEvent][0]).toMatchObject({
      eventId: 'evt_mm',
      status: 'FAILED',
      error: 'Error:STRIPE_SESSION_MISMATCH',
    });
    expect(s.log.error).toHaveBeenCalled();
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(0);

    // Redelivery: terminal, answered as a duplicate.
    expect(await deliver(s, raw)).toEqual({ duplicate: true });
    expect(payment().status).toBe('PENDING');
  });

  it('an expired event never cancels a paid payment', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    await deliver(s, evt('evt_p', 'checkout.session.completed', session()));
    const r = await deliver(s, evt('evt_px', 'checkout.session.expired', session({ status: 'expired' })));
    expect(r.status).toBe('IGNORED');
    expect(payment().status).toBe('COMPLETED');
    expect(s.tables[UIDS.stripeSession][0].status).toBe('COMPLETE');
  });

  it('events for sessions not created by this plugin, and unhandled types, are IGNORED', async () => {
    const s = setup();
    await seedSession(s);
    const r1 = await deliver(s, evt('evt_o', 'checkout.session.completed', session({ id: 'cs_other' })));
    const r2 = await deliver(s, evt('evt_u', 'customer.created', { id: 'cus_1' }));
    expect(r1).toEqual({ duplicate: false, status: 'IGNORED' });
    expect(r2).toEqual({ duplicate: false, status: 'IGNORED' });
    expect(s.tables[UIDS.webhookEvent].map((w) => w.status)).toEqual(['IGNORED', 'IGNORED']);
    expect(await deliver(s, evt('evt_u', 'customer.created', { id: 'cus_1' }))).toEqual({
      duplicate: true,
    });
  });

  describe('refunds', () => {
    const seedRefund = async (s: ReturnType<typeof setup>, status = 'PROCESSING') => {
      const { orderId } = await seedSession(s);
      await deliver(s, evt('evt_pay', 'checkout.session.completed', session()));
      s.tables[UIDS.refund].push({
        id: 70,
        order: orderId,
        payment: 900,
        method: 'STRIPE',
        kind: 'MONEY',
        status,
        amount: 1000,
        currency: 'EUR',
        externalId: 're_1',
        idempotencyKey: 'k:900',
        completedAt: null,
        metadata: null,
      });
      return { orderId, refund: () => s.tables[UIDS.refund].find((r) => r.id === 70) };
    };

    it('refund.updated succeeded completes the refund once', async () => {
      const s = setup();
      const { orderId, refund } = await seedRefund(s);
      const raw = evt('evt_r1', 'refund.updated', { id: 're_1', object: 'refund', status: 'succeeded' });
      expect(await deliver(s, raw)).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(await deliver(s, evt('evt_r1b', 'refund.updated', { id: 're_1', status: 'succeeded' }))).toEqual({
        duplicate: false,
        status: 'IGNORED',
      });
      expect(refund().status).toBe('COMPLETED');
      expect(refund().completedAt).toBeTruthy();
      const done = s.events.filter((e) => e.type === 'REFUND_COMPLETED');
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({
        orderId,
        payload: { refundId: 70, amount: 1000, method: 'STRIPE', kind: 'MONEY' },
      });
    });

    it('charge.refunded carries the refunds list', async () => {
      const s = setup();
      const { refund } = await seedRefund(s);
      const charge = {
        id: 'ch_1',
        object: 'charge',
        refunds: { data: [{ id: 're_1', status: 'succeeded' }, { id: 're_unknown', status: 'succeeded' }] },
      };
      expect(await deliver(s, evt('evt_c', 'charge.refunded', charge))).toEqual({
        duplicate: false,
        status: 'PROCESSED',
      });
      expect(refund().status).toBe('COMPLETED');
      // Newer API versions omit the list: nothing to do.
      expect(await deliver(s, evt('evt_c2', 'charge.refunded', { id: 'ch_1' }))).toEqual({
        duplicate: false,
        status: 'IGNORED',
      });
    });

    it('a refund marked failed by an admin (no Stripe id) is promoted via metadata.refundId', async () => {
      const s = setup();
      const { orderId, refund } = await seedRefund(s, 'FAILED');
      Object.assign(refund(), { externalId: null, metadata: { failureReason: 'MARKED_FAILED' } });
      expect(
        await deliver(
          s,
          evt('evt_promo', 'refund.updated', { id: 're_new', status: 'succeeded', metadata: { refundId: '70' } })
        )
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refund()).toMatchObject({ status: 'COMPLETED', externalId: 're_new' });
      expect(refund().completedAt).toBeTruthy();
      const h = s.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_COMPLETED');
      expect(h).toHaveLength(1);
      expect(h[0].previousValue).toMatchObject({ refundId: 70, status: 'FAILED' });
      // recalculation ran: the refund counts in the order's financial state
      const order = s.tables[UIDS.order].find((o) => o.id === orderId);
      expect(order.paymentStatus).toBe('PARTIALLY_REFUNDED');
      const view: any = await s.orders.get(orderId);
      expect(view.summary.refunded).toBe(1000);
      expect(view.refunds[0]).toMatchObject({ id: 70, status: 'COMPLETED', amount: 1000, failureReason: null });
    });

    it('stores Stripe failure_reason on a failed refund', async () => {
      const s = setup();
      const { refund } = await seedRefund(s);
      await deliver(s, evt('evt_fr', 'refund.updated', { id: 're_1', status: 'failed', failure_reason: 'expired_or_canceled_card' }));
      expect(refund().status).toBe('FAILED');
      expect(refund().metadata).toMatchObject({ failureReason: 'expired_or_canceled_card' });
    });

    it('refund.failed / canceled mark the refund FAILED', async () => {
      const s = setup();
      const { refund } = await seedRefund(s);
      await deliver(s, evt('evt_rf', 'refund.failed', { id: 're_1', status: 'failed' }));
      expect(refund().status).toBe('FAILED');
      expect(s.events.filter((e) => e.type === 'REFUND_FAILED')).toHaveLength(1);

      const s2 = setup();
      const r2 = await seedRefund(s2, 'PENDING');
      await deliver(s2, evt('evt_rc', 'refund.updated', { id: 're_1', status: 'canceled' }));
      expect(r2.refund().status).toBe('FAILED');
    });

    it('a FAILED refund Stripe reports succeeded is COMPLETED (promotion flagged)', async () => {
      const s = setup();
      const { refund } = await seedRefund(s, 'FAILED');
      expect(
        await deliver(s, evt('evt_fs', 'refund.updated', { id: 're_1', status: 'succeeded' }))
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refund().status).toBe('COMPLETED');
      expect(refund().metadata).toMatchObject({ promotedFromFailed: true });
      const h = s.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_COMPLETED');
      expect(h).toHaveLength(1);
      expect(h[0].previousValue).toMatchObject({ refundId: 70, status: 'FAILED' });
    });

    it('F4: a promotion that refunds twice is over-refunded: no amount due, history notes it', async () => {
      const s = setup();
      const { orderId, refund } = await seedRefund(s, 'FAILED');
      // Modified down to 3500 after the 4500 payment: 1000 of excess, refunded by transfer
      // after the Stripe refund was (wrongly) held as failed.
      const order = () => s.tables[UIDS.order].find((o) => o.id === orderId);
      order().total = 3500;
      s.tables[UIDS.refund].push({
        id: 71, order: orderId, payment: null, method: 'MANUAL_TRANSFER', kind: 'MONEY',
        status: 'COMPLETED', amount: 1000, currency: 'EUR', externalId: null,
        idempotencyKey: 'manual', completedAt: new Date().toISOString(), metadata: null,
      });
      expect(
        await deliver(s, evt('evt_dbl', 'refund.updated', { id: 're_1', status: 'succeeded' }))
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refund().status).toBe('COMPLETED');
      const view: any = await s.orders.get(orderId);
      expect(view.summary).toMatchObject({ refunded: 2000, overRefunded: 1000, due: 0, excess: 0 });
      expect(view.availableActions).not.toContain('ADD_PAYMENT');
      expect(view.availableActions).not.toContain('REFUND');
      const note = s.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_OVER_REFUNDED');
      expect(note).toHaveLength(1);
      expect(note[0].newValue).toMatchObject({ refundId: 70, overRefunded: 1000 });
    });

    it('F1: a COMPLETED Stripe refund that Stripe reports failed is reversed (FAILED, recalculated, no e-mail source)', async () => {
      const s = setup();
      const { orderId, refund } = await seedRefund(s, 'COMPLETED');
      await s.orders.recalculate(orderId, {});
      const order = () => s.tables[UIDS.order].find((o) => o.id === orderId);
      expect(order().paymentStatus).toBe('PARTIALLY_REFUNDED');

      expect(
        await deliver(
          s,
          evt('evt_rev', 'refund.failed', { id: 're_1', status: 'failed', failure_reason: 'expired_or_canceled_card' })
        )
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refund().status).toBe('FAILED');
      expect(refund().metadata).toMatchObject({ failureReason: 'expired_or_canceled_card', stripeFailed: true });
      expect(order().paymentStatus).toBe('PAID');
      const view: any = await s.orders.get(orderId);
      expect(view.summary.refunded).toBe(0);
      const h = s.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_FAILED');
      expect(h).toHaveLength(1);
      expect(h[0].description).toContain('Refund failed at Stripe after completion');
      expect(h[0].previousValue).toMatchObject({ refundId: 70, status: 'COMPLETED' });
      const failed = s.events.filter((e) => e.type === 'REFUND_FAILED');
      expect(failed).toHaveLength(1);
      expect(failed[0].payload).toMatchObject({ refundId: 70, source: 'STRIPE_REVERSED' });

      // Stripe's failure is final: a late (out-of-order) `succeeded` never re-completes it.
      expect(
        await deliver(s, evt('evt_late', 'refund.updated', { id: 're_1', status: 'succeeded' }))
      ).toEqual({ duplicate: false, status: 'IGNORED' });
      expect(refund().status).toBe('FAILED');
    });

    it('F1: refund.updated status=failed on a COMPLETED refund is reversed too; a COMPLETED refund is never "canceled"', async () => {
      const s = setup();
      const { refund } = await seedRefund(s, 'COMPLETED');
      expect(
        await deliver(s, evt('evt_cx', 'refund.updated', { id: 're_1', status: 'canceled' }))
      ).toEqual({ duplicate: false, status: 'IGNORED' });
      expect(refund().status).toBe('COMPLETED');
      expect(
        await deliver(s, evt('evt_upd', 'refund.updated', { id: 're_1', status: 'failed' }))
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refund().status).toBe('FAILED');
    });

    it('a refund event without a matching refund is IGNORED', async () => {
      const s = setup();
      expect(
        await deliver(s, evt('evt_rn', 'refund.updated', { id: 're_none', status: 'succeeded' }))
      ).toEqual({ duplicate: false, status: 'IGNORED' });
    });
  });

  it('a processing error records FAILED, rethrows, and a retry of the same event is processed', async () => {
    const s = setup();
    const { payment } = await seedSession(s);
    const history = s.services.EcommerceOrderHistoryService;
    const realRecord = history.record;
    history.record = vi.fn().mockRejectedValueOnce(new Error('db down'));
    const raw = evt('evt_x', 'checkout.session.completed', session());

    await expect(deliver(s, raw)).rejects.toThrow('db down');
    expect(payment().status).toBe('PENDING');
    expect(s.tables[UIDS.webhookEvent]).toHaveLength(1);
    expect(s.tables[UIDS.webhookEvent][0]).toMatchObject({ eventId: 'evt_x', status: 'FAILED' });
    expect(s.tables[UIDS.webhookEvent][0].error).toBe('Error');
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(0);

    history.record = realRecord;
    expect(await deliver(s, raw)).toEqual({ duplicate: false, status: 'PROCESSED' });
    expect(payment().status).toBe('COMPLETED');
    expect(s.tables[UIDS.webhookEvent]).toHaveLength(1);
    expect(s.tables[UIDS.webhookEvent][0]).toMatchObject({ status: 'PROCESSED', error: null });
    expect(s.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(1);
    expect(await deliver(s, raw)).toEqual({ duplicate: true });
  });
});

describe('EcommerceStripeWebhookController.handle', () => {
  const ctrl = (handle: any) =>
    createWebhookController({
      strapi: {
        log: { warn: vi.fn(), error: vi.fn() },
        plugin: () => ({ service: () => ({ handle }) }),
      } as any,
    });
  const mkCtx = (extra: any = {}): any => ({
    state: { ecommerceRawBody: Buffer.from('{}') },
    request: { body: {}, headers: { 'stripe-signature': 't=1,v1=ab' } },
    get: (h: string) => (h.toLowerCase() === 'stripe-signature' ? 't=1,v1=ab' : ''),
    badRequest: vi.fn(),
    ...extra,
  });

  it('200 { received: true } with the duplicate flag', async () => {
    const handle = vi.fn().mockResolvedValue({ duplicate: true });
    const ctx = mkCtx();
    await ctrl(handle).handle(ctx);
    expect(handle).toHaveBeenCalledWith(Buffer.from('{}'), 't=1,v1=ab');
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ received: true, duplicate: true });
  });

  it('400 on an invalid signature or payload', async () => {
    for (const code of ['WEBHOOK_SIGNATURE_INVALID', 'WEBHOOK_PAYLOAD_INVALID'] as const) {
      const ctx = mkCtx();
      await ctrl(vi.fn().mockRejectedValue(new EcommercePaymentError(code))).handle(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code });
    }
  });

  it('400 when the raw body was not captured', async () => {
    const handle = vi.fn();
    const ctx = mkCtx({ state: {} });
    await ctrl(handle).handle(ctx);
    expect(handle).not.toHaveBeenCalled();
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), {
      code: 'WEBHOOK_RAW_BODY_MISSING',
    });
  });

  it('falls back to koa-body includeUnparsed when the middleware did not run', async () => {
    const handle = vi.fn().mockResolvedValue({ duplicate: false, status: 'IGNORED' });
    const body: any = { id: 'evt' };
    body[Symbol.for('unparsedBody')] = '{"id":"evt"}';
    const ctx = mkCtx({ state: {}, request: { body } });
    await ctrl(handle).handle(ctx);
    expect(handle).toHaveBeenCalledWith(Buffer.from('{"id":"evt"}'), 't=1,v1=ab');
    expect(ctx.status).toBe(200);
  });

  it('200 for a terminal failure (Stripe must stop retrying)', async () => {
    const ctx = mkCtx();
    await ctrl(vi.fn().mockResolvedValue({ duplicate: false, status: 'FAILED' })).handle(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ received: true, duplicate: false });
  });

  it('500 on a processing failure (Stripe retries)', async () => {
    const ctx = mkCtx();
    await ctrl(vi.fn().mockRejectedValue(new Error('db down'))).handle(ctx);
    expect(ctx.status).toBe(500);
    expect(ctx.body).toEqual({ received: false });
  });
});

describe('Stripe webhook route', () => {
  it('POST /ecommerce/stripe/webhook is public and module-guarded', () => {
    expect(webhookRoutes).toEqual([
      {
        method: 'POST',
        path: '/ecommerce/stripe/webhook',
        handler: 'EcommerceStripeWebhookController.handle',
        config: {
          auth: false,
          policies: [],
          middlewares: ['plugin::littlebox-strapi-suite.check-module-is-active'],
        },
      },
    ]);
    expect(contentApiRoutes).toEqual(expect.arrayContaining(webhookRoutes));
  });
});
