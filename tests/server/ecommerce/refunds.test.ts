import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
}));
vi.mock('../../../server/src/services/modules/ecommerce/providers/payments/stripeClient', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, createStripeClient: () => stripe };
});

import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import {
  EcommercePaymentError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import {
  UIDS,
  setupCommerce,
  createOrder,
  customerIdOf,
  type Commerce,
} from './helpers/commerceSetup';

beforeEach(() => {
  __resetEventHandlersForTests();
  stripe.createRefund.mockReset();
  stripe.expireCheckoutSession.mockReset();
  stripe.retrieveCheckoutSession.mockReset();
});

const actor = 'user:1';

const codesOf = async (p: Promise<unknown>): Promise<string[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors.map((x) => x.code);
    throw e;
  }
  return [];
};

const order = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const refundsOf = (c: Commerce) => c.tables[UIDS.refund];

const payManual = (c: Commerce, orderId: number, amount: number, key = `m-${amount}`) =>
  c.payments.addManualPayment(orderId, { amount, idempotencyKey: key }, actor);

/** A Stripe payment settled at `completedAt`, as `completeFromSession` leaves it. */
const seedStripePayment = (
  c: Commerce,
  orderId: number,
  id: number,
  amount: number,
  pi: string,
  completedAt: string
) => {
  c.tables[UIDS.payment].push({
    id,
    order: orderId,
    method: 'STRIPE',
    status: 'COMPLETED',
    amount,
    currency: 'EUR',
    externalId: pi,
    idempotencyKey: `stripe:${id}`,
    coverage: null,
    completedAt,
    actor: 'webhook:stripe',
    metadata: null,
  });
};

const issueAndPay = async (c: Commerce, orderId: number, amount: number) => {
  const credit = await c.storeCredits.issue({
    customerId: customerIdOf(c, orderId),
    amount,
    actor,
    operationKey: `issue-${amount}`,
  });
  const payment = await c.payments.addStoreCreditPayment(
    orderId,
    { code: credit.code, idempotencyKey: `sc-${amount}` },
    actor
  );
  return { credit, payment };
};

const balanceOf = (c: Commerce, id: number) =>
  c.tables[UIDS.storeCredit].find((x) => x.id === id).balance;

const SECRET = 'whsec_test_123';
const deliver = (c: Commerce, id: string, type: string, object: any) => {
  const raw = Buffer.from(JSON.stringify({ id, object: 'event', type, data: { object } }));
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.`).update(raw).digest('hex')}`;
  return c.webhooks.handle(raw, sig);
};

describe('cancel releases store credit', () => {
  it('restores the balance with a COMPLETED STORE_CREDIT refund; a second cancel restores nothing', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c); // 4500
    const { credit, payment } = await issueAndPay(c, orderId, 3000);
    expect(balanceOf(c, credit.id)).toBe(0);

    await c.orders.cancel(orderId, actor);

    expect(balanceOf(c, credit.id)).toBe(3000);
    expect(refundsOf(c)).toEqual([
      expect.objectContaining({
        order: orderId,
        payment: payment.id,
        method: 'STORE_CREDIT',
        kind: 'STORE_CREDIT',
        status: 'COMPLETED',
        amount: 3000,
        storeCredit: credit.id,
        idempotencyKey: `cancel-credit:${payment.id}`,
      }),
    ]);
    const restore = c.tables[UIDS.storeCreditMovement].filter((m) => m.type === 'RESTORE');
    expect(restore).toEqual([
      expect.objectContaining({ amount: 3000, operationKey: `cancel-credit:${payment.id}` }),
    ]);
    expect(order(c, orderId).paymentStatus).toBe('REFUNDED');
    const types = c.tables[UIDS.orderHistory].map((h) => h.type);
    expect(types).toEqual(expect.arrayContaining(['STORE_CREDIT_RESTORED', 'REFUND_COMPLETED']));
    expect(c.events.filter((e) => e.type === 'REFUND_COMPLETED')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'STORE_CREDIT', amount: 3000 }) }),
    ]);
    // Nothing left to refund.
    const state = await c.orders.computeOrderState(orderId);
    expect(state.actions).not.toContain('REFUND');

    expect(await codesOf(c.orders.cancel(orderId, actor))).toEqual(['ACTION_NOT_AVAILABLE']);
    await c.refunds.releaseStoreCreditOnCancel(orderId, actor);
    expect(balanceOf(c, credit.id)).toBe(3000);
    expect(refundsOf(c)).toHaveLength(1);
  });

  it('a mixed payment releases only the credit part; the money part stays refundable', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const { credit } = await issueAndPay(c, orderId, 1000);
    await payManual(c, orderId, 3500);

    await c.orders.cancel(orderId, actor);

    expect(balanceOf(c, credit.id)).toBe(1000);
    expect(order(c, orderId).paymentStatus).toBe('PARTIALLY_REFUNDED');
    const preview = await c.refunds.preview(orderId);
    expect(preview).toMatchObject({ received: 4500, refunded: 1000, inFlight: 0, refundable: 3500 });
  });

  it('expires the open Stripe sessions after the commit; a Stripe failure never undoes the cancel', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 900, order: orderId, method: 'STRIPE', status: 'PENDING', amount: 4500,
      externalId: 'cs_1', idempotencyKey: 'stripe:x', coverage: null, metadata: null,
    });
    c.tables[UIDS.stripeSession].push({
      id: 50, order: orderId, payment: 900, sessionId: 'cs_1', amount: 4500, status: 'OPEN',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), purpose: 'CHECKOUT',
    });
    stripe.expireCheckoutSession.mockResolvedValueOnce('expired');

    const view = await c.orders.cancel(orderId, actor);
    expect(view.orderStatus).toBe('CANCELLED');
    expect(stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_1');
    expect(c.tables[UIDS.stripeSession][0].status).toBe('EXPIRED');
    expect(c.tables[UIDS.payment][0].status).toBe('CANCELLED');

    const c2 = setupCommerce();
    const o2 = await createOrder(c2);
    c2.tables[UIDS.stripeSession].push({
      id: 51, order: o2, payment: null, sessionId: 'cs_2', amount: 4500, status: 'OPEN',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), purpose: 'CHECKOUT',
    });
    stripe.expireCheckoutSession.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_UNREACHABLE'));
    const v2 = await c2.orders.cancel(o2, actor);
    expect(v2.orderStatus).toBe('CANCELLED');
    expect(c2.tables[UIDS.stripeSession][0].status).toBe('OPEN');
    expect(c2.log.error).toHaveBeenCalled();
  });

  it('a session Stripe reports complete and paid is settled instead (money recorded, refundable)', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 900, order: orderId, method: 'STRIPE', status: 'PENDING', amount: 4500,
      externalId: 'cs_1', idempotencyKey: 'stripe:x', coverage: null, metadata: null,
    });
    c.tables[UIDS.stripeSession].push({
      id: 50, order: orderId, payment: 900, sessionId: 'cs_1', amount: 4500, status: 'OPEN',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), purpose: 'CHECKOUT',
    });
    stripe.expireCheckoutSession.mockResolvedValueOnce('complete');
    stripe.retrieveCheckoutSession.mockResolvedValueOnce({
      id: 'cs_1', status: 'complete', paymentStatus: 'paid', paymentIntentId: 'pi_1',
      amountTotal: 4500, metadata: {},
    });
    const view = await c.orders.cancel(orderId, actor);
    expect(view.orderStatus).toBe('CANCELLED');
    expect(c.tables[UIDS.payment][0]).toMatchObject({ status: 'COMPLETED', externalId: 'pi_1' });
    expect((await c.refunds.preview(orderId)).refundable).toBe(4500);
  });
});

describe('EcommerceRefundService.create', () => {
  it('manual transfer: COMPLETED MONEY refund → PARTIALLY_REFUNDED, then REFUNDED', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000); // excess 1500

    const [r] = await c.refunds.create(
      orderId,
      { method: 'MANUAL_TRANSFER', amount: 1500, reason: 'OTHER', reference: 'TRF-1', idempotencyKey: 'r1' },
      actor
    );
    expect(r).toMatchObject({ method: 'MANUAL_TRANSFER', kind: 'MONEY', status: 'COMPLETED', amount: 1500, reference: 'TRF-1' });
    expect(order(c, orderId).paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'REFUND_COMPLETED')).toBe(true);
    expect(c.events.filter((e) => e.type === 'REFUND_COMPLETED')).toEqual([
      expect.objectContaining({ orderId, payload: expect.objectContaining({ refundId: r.id, kind: 'MONEY', amount: 1500 }) }),
    ]);

    // Cancelled: everything left becomes refundable.
    await c.orders.cancel(orderId, actor);
    await c.refunds.create(
      orderId,
      { method: 'MANUAL_TRANSFER', amount: 4500, reason: 'CANCELLATION', idempotencyKey: 'r2' },
      actor
    );
    expect(order(c, orderId).paymentStatus).toBe('REFUNDED');
  });

  it('refuses more than the refundable amount (exceeds_refundable), a missing reason and a bad method', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000);
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 1501, reason: 'OTHER', idempotencyKey: 'x' }, actor)
      )
    ).toEqual(['exceeds_refundable']);
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 100, reason: ' ', idempotencyKey: 'y' }, actor)
      )
    ).toEqual(['required']);
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'CASH', amount: 100, reason: 'OTHER', idempotencyKey: 'z' } as any, actor)
      )
    ).toEqual(['invalid_method']);
    expect(refundsOf(c)).toHaveLength(0);
  });

  it('REFUND is not available without an excess', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 4500);
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 1, reason: 'OTHER', idempotencyKey: 'x' }, actor)
      )
    ).toEqual(['ACTION_NOT_AVAILABLE']);
  });

  it('a repeated idempotencyKey returns the existing refunds', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000);
    const input = { method: 'MANUAL_TRANSFER' as const, amount: 1000, reason: 'OTHER', idempotencyKey: 'same' };
    const a = await c.refunds.create(orderId, input, actor);
    const b = await c.refunds.create(orderId, input, actor);
    expect(b.map((r: any) => r.id)).toEqual(a.map((r: any) => r.id));
    expect(refundsOf(c)).toHaveLength(1);
  });

  it('store credit: issues a credit linked to the refund (COMPLETED, kind STORE_CREDIT)', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000);
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 1500, reason: 'OTHER', expiresAt, idempotencyKey: 'sc' },
      actor
    );
    expect(r).toMatchObject({ method: 'STORE_CREDIT', kind: 'STORE_CREDIT', status: 'COMPLETED', amount: 1500 });
    const credit = c.tables[UIDS.storeCredit][0];
    expect(credit).toMatchObject({
      balance: 1500,
      sourceOrder: orderId,
      sourceRefund: r.id,
      customer: customerIdOf(c, orderId),
      expiresAt,
    });
    expect(refundsOf(c)[0].storeCredit).toBe(credit.id);
    expect(c.events.map((e) => e.type)).toEqual(expect.arrayContaining(['STORE_CREDIT_ISSUED', 'REFUND_COMPLETED']));
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'STORE_CREDIT_ISSUED')).toBe(true);
  });

  it('store credit on a STORE_CREDIT payment restores the original credit', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const { credit, payment } = await issueAndPay(c, orderId, 3000);
    await payManual(c, orderId, 1500); // paid 4500 + ... no excess yet
    await c.orders.cancel(orderId, actor); // releases 3000 automatically
    expect(balanceOf(c, credit.id)).toBe(3000);
    // Only the manual 1500 is left, and it is not a store-credit payment.
    expect(
      await codesOf(
        c.refunds.create(
          orderId,
          { method: 'STORE_CREDIT', amount: 100, reason: 'OTHER', paymentId: payment.id, idempotencyKey: 'x' },
          actor
        )
      )
    ).toEqual(['exceeds_payment']);

    // An open order with an excess paid by credit.
    const c2 = setupCommerce();
    const o2 = await createOrder(c2);
    const paid = await issueAndPay(c2, o2, 3000);
    await payManual(c2, o2, 2500); // paid 5500, excess 1000
    const [r] = await c2.refunds.create(
      o2,
      { method: 'STORE_CREDIT', amount: 1000, reason: 'OTHER', paymentId: paid.payment.id, idempotencyKey: 'y' },
      actor
    );
    expect(r).toMatchObject({ kind: 'STORE_CREDIT', status: 'COMPLETED', storeCredit: expect.objectContaining({ id: paid.credit.id }) });
    expect(c2.tables[UIDS.storeCredit]).toHaveLength(1);
    expect(balanceOf(c2, paid.credit.id)).toBe(1000);
    expect(order(c2, o2).paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('a refund never creates stock movements', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000);
    const before = c.tables[UIDS.stockMovement].length;
    await c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 1500, reason: 'OTHER', idempotencyKey: 'r' }, actor);
    expect(c.tables[UIDS.stockMovement]).toHaveLength(before);
    expect(c.tables[UIDS.variant][0].stock).toBe(3);
  });
});

describe('Stripe refunds', () => {
  const stripeOrder = async (c: Commerce) => {
    const orderId = await createOrder(c);
    seedStripePayment(c, orderId, 801, 2000, 'pi_old', '2026-11-01T10:00:00.000Z');
    seedStripePayment(c, orderId, 802, 2000, 'pi_new', '2026-11-02T10:00:00.000Z');
    await payManual(c, orderId, 3500); // paid 7500, excess 3000
    return orderId;
  };

  it('pending → PROCESSING with REFUND_STARTED; the webhook then completes it', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_1', status: 'pending' });

    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1500, reason: 'OTHER', idempotencyKey: 'sr' },
      actor
    );
    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_new',
      amount: 1500,
      idempotencyKey: 'refund:sr:802',
      metadata: expect.objectContaining({ orderId: String(orderId), paymentId: '802' }),
    });
    expect(r).toMatchObject({ status: 'PROCESSING', externalId: 're_1', method: 'STRIPE', kind: 'MONEY' });
    expect(refundsOf(c)[0]).toMatchObject({ payment: 802, idempotencyKey: 'sr:802' });
    expect(c.events.filter((e) => e.type === 'REFUND_STARTED')).toHaveLength(1);
    const state = await c.orders.computeOrderState(orderId);
    expect(state.hasPendingRefunds).toBe(true);
    expect((await c.refunds.preview(orderId)).inFlight).toBe(1500);
    expect(order(c, orderId).paymentStatus).toBe('PAID');

    expect(await deliver(c, 'evt_1', 'refund.updated', { id: 're_1', object: 'refund', status: 'succeeded' })).toEqual({
      duplicate: false,
      status: 'PROCESSED',
    });
    expect(refundsOf(c)[0].status).toBe('COMPLETED');
    expect(order(c, orderId).paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('Review Focus 2 at the service: 30 € over two 20 € payments, newest first, one refund each', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund
      .mockResolvedValueOnce({ id: 're_a', status: 'succeeded' })
      .mockResolvedValueOnce({ id: 're_b', status: 'succeeded' });
    const out = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 3000, reason: 'OTHER', idempotencyKey: 'k' },
      actor
    );
    expect(out.map((r: any) => [r.payment?.id, r.amount, r.status])).toEqual([
      [802, 2000, 'COMPLETED'],
      [801, 1000, 'COMPLETED'],
    ]);
    expect(order(c, orderId).paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(c.events.filter((e) => e.type === 'REFUND_COMPLETED')).toHaveLength(2);
  });

  it('failed → FAILED, and the amount becomes refundable again', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_f', status: 'failed' });
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'f' },
      actor
    );
    expect(r.status).toBe('FAILED');
    expect(c.events.filter((e) => e.type === 'REFUND_FAILED')).toHaveLength(1);
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'REFUND_FAILED')).toBe(true);
    expect((await c.refunds.preview(orderId)).refundable).toBe(3000);
  });

  it('stripe_unavailable when the Stripe payments cannot cover the amount', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000);
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'x' }, actor)
      )
    ).toEqual(['stripe_unavailable']);
  });

  it('Stripe unreachable leaves the refund PROCESSING; retrying the same key resumes it', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_UNREACHABLE'));
    await expect(
      c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'u' }, actor)
    ).rejects.toMatchObject({ code: 'STRIPE_UNREACHABLE' });
    expect(refundsOf(c)[0]).toMatchObject({ status: 'PROCESSING', externalId: null });

    stripe.createRefund.mockResolvedValueOnce({ id: 're_u', status: 'succeeded' });
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'u' },
      actor
    );
    expect(stripe.createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: 'refund:u:802' })
    );
    expect(r).toMatchObject({ status: 'COMPLETED', externalId: 're_u' });
    expect(refundsOf(c)).toHaveLength(1);
  });

  it('a webhook that beats the stored Stripe id finds the refund by its metadata refundId', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_UNREACHABLE'));
    await expect(
      c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'w' }, actor)
    ).rejects.toMatchObject({ code: 'STRIPE_UNREACHABLE' });
    const id = refundsOf(c)[0].id;
    expect(
      await deliver(c, 'evt_w', 'refund.updated', {
        id: 're_w',
        object: 'refund',
        status: 'succeeded',
        metadata: { refundId: String(id), orderId: String(orderId) },
      })
    ).toEqual({ duplicate: false, status: 'PROCESSED' });
    expect(refundsOf(c)[0]).toMatchObject({ status: 'COMPLETED', externalId: 're_w' });
    expect(c.tables[UIDS.orderHistory].filter((h) => h.type === 'REFUND_COMPLETED')).toHaveLength(1);

    // The retry then finds nothing left to send.
    stripe.createRefund.mockClear();
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'w' },
      actor
    );
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(r.status).toBe('COMPLETED');
  });

  it('a Stripe rejection marks the refund FAILED', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_REQUEST_FAILED'));
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'rj' },
      actor
    );
    expect(r.status).toBe('FAILED');
  });
});

describe('preview and list', () => {
  it('preview reports totals, in-flight, refundable and Stripe capacity', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    seedStripePayment(c, orderId, 801, 2000, 'pi_1', '2026-11-01T10:00:00.000Z');
    await payManual(c, orderId, 3500); // paid 5500, excess 1000
    expect(await c.refunds.preview(orderId)).toEqual({
      orderTotal: 4500,
      received: 5500,
      refunded: 0,
      inFlight: 0,
      refundable: 1000,
      stripeRefundable: 1000,
      hasStripe: true,
    });
  });

  it('list shows the refunds with reason, description, actor and payment', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const p = await payManual(c, orderId, 6000);
    await c.refunds.create(
      orderId,
      {
        method: 'MANUAL_TRANSFER',
        amount: 1000,
        reason: 'OTHER',
        description: 'Too much paid',
        reference: 'TRF-9',
        paymentId: p.id,
        idempotencyKey: 'l',
      },
      actor
    );
    const list = await c.refunds.list(orderId);
    expect(list).toEqual([
      expect.objectContaining({
        method: 'MANUAL_TRANSFER',
        amount: 1000,
        status: 'COMPLETED',
        reason: 'OTHER',
        description: 'Too much paid',
        reference: 'TRF-9',
        externalId: null,
        actor,
        payment: expect.objectContaining({ id: p.id, method: 'MANUAL', amount: 6000 }),
        storeCredit: null,
      }),
    ]);
  });
});
