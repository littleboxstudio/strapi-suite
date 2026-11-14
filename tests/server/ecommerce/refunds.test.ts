import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveRefund: vi.fn(),
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
  stripe.retrieveRefund.mockReset();
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
  it('manual transfer: COMPLETED MONEY refund of the excess → PAID, then REFUNDED', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    await payManual(c, orderId, 6000); // excess 1500

    const [r] = await c.refunds.create(
      orderId,
      { method: 'MANUAL_TRANSFER', amount: 1500, reason: 'OTHER', reference: 'TRF-1', idempotencyKey: 'r1' },
      actor
    );
    expect(r).toMatchObject({ method: 'MANUAL_TRANSFER', kind: 'MONEY', status: 'COMPLETED', amount: 1500, reference: 'TRF-1' });
    expect(order(c, orderId).paymentStatus).toBe('PAID');
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
    expect(order(c2, o2).paymentStatus).toBe('PAID');
  });

  it('F2: an excess funded by store credit is never refunded as money', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c); // 4500
    await issueAndPay(c, orderId, 4500);
    order(c, orderId).total = 2500; // modified down: 2000 of excess, all voucher value
    expect(await c.refunds.preview(orderId)).toMatchObject({ refundable: 2000, moneyRefundable: 0 });
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 100, reason: 'OTHER', idempotencyKey: 'm' }, actor)
      )
    ).toEqual(['exceeds_money_refundable']);
    expect(refundsOf(c)).toHaveLength(0);
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 2000, reason: 'OTHER', idempotencyKey: 's' },
      actor
    );
    expect(r).toMatchObject({ kind: 'STORE_CREDIT', status: 'COMPLETED', amount: 2000 });
  });

  it('F2: money refunds are capped by the money received minus money refunds already made', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c); // 4500
    await issueAndPay(c, orderId, 3000);
    await payManual(c, orderId, 1500);
    order(c, orderId).total = 2500; // excess 2000; money received 1500
    expect(await c.refunds.preview(orderId)).toMatchObject({ refundable: 2000, moneyRefundable: 1500 });
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 1600, reason: 'OTHER', idempotencyKey: 'm1' }, actor)
      )
    ).toEqual(['exceeds_money_refundable']);
    await c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 1500, reason: 'OTHER', idempotencyKey: 'm2' }, actor);
    expect(await c.refunds.preview(orderId)).toMatchObject({ refundable: 500, moneyRefundable: 0 });
    expect(
      await codesOf(
        c.refunds.create(orderId, { method: 'MANUAL_TRANSFER', amount: 100, reason: 'OTHER', idempotencyKey: 'm3' }, actor)
      )
    ).toEqual(['exceeds_money_refundable']);
    await c.refunds.create(orderId, { method: 'STORE_CREDIT', amount: 500, reason: 'OTHER', idempotencyKey: 's1' }, actor);
    expect((await c.refunds.preview(orderId)).refundable).toBe(0);
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
    expect(order(c, orderId).paymentStatus).toBe('PAID');
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
    expect(order(c, orderId).paymentStatus).toBe('PAID');
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
    stripe.createRefund.mockRejectedValueOnce(
      new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'x', 'invalid_request_error', 400)
    );
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
      moneyRefundable: 1000,
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

describe('fix round 1', () => {
  const stripeOrder = async (c: Commerce) => {
    const orderId = await createOrder(c);
    seedStripePayment(c, orderId, 801, 2000, 'pi_old', '2026-11-01T10:00:00.000Z');
    seedStripePayment(c, orderId, 802, 2000, 'pi_new', '2026-11-02T10:00:00.000Z');
    await payManual(c, orderId, 3500); // paid 7500, excess 3000
    return orderId;
  };
  const stripeErr = (status: number, type?: string) =>
    new EcommercePaymentError('STRIPE_REQUEST_FAILED', 'x', type, status);

  describe('Stripe refund failure classification', () => {
    it.each([
      ['409 idempotency_error', stripeErr(409, 'idempotency_error')],
      ['429 rate limit', stripeErr(429, 'rate_limit_error')],
      ['500 api_error', stripeErr(500, 'api_error')],
      ['503 without a body', stripeErr(503)],
      ['400 without a Stripe error body', stripeErr(400)],
      ['400 idempotency_error (same key, other request)', stripeErr(400, 'idempotency_error')],
      ['unreachable', new EcommercePaymentError('STRIPE_UNREACHABLE')],
    ])('%s is transient: the refund stays PROCESSING and the error surfaces', async (_l, err) => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(err);
      await expect(
        c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 't' }, actor)
      ).rejects.toBe(err);
      expect(refundsOf(c)[0]).toMatchObject({ status: 'PROCESSING', externalId: null });
      expect(c.events.filter((e) => e.type === 'REFUND_FAILED')).toHaveLength(0);
      expect((await c.refunds.preview(orderId)).inFlight).toBe(1000);
    });

    it.each([
      ['400 invalid_request_error', stripeErr(400, 'invalid_request_error')],
      ['402 card_error', stripeErr(402, 'card_error')],
      ['404 invalid_request_error', stripeErr(404, 'invalid_request_error')],
    ])('%s is a definitive rejection: FAILED', async (_l, err) => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(err);
      const [r] = await c.refunds.create(
        orderId,
        { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'd' },
        actor
      );
      expect(r.status).toBe('FAILED');
    });

    it('the double-click path: a 409 on the replay never fails a refund Stripe then completes', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(stripeErr(409, 'idempotency_error'));
      await expect(
        c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'dc' }, actor)
      ).rejects.toMatchObject({ code: 'STRIPE_REQUEST_FAILED' });
      const id = refundsOf(c)[0].id;
      await deliver(c, 'evt_dc', 'refund.updated', {
        id: 're_dc',
        status: 'succeeded',
        metadata: { refundId: String(id) },
      });
      expect(refundsOf(c)[0]).toMatchObject({ status: 'COMPLETED', externalId: 're_dc' });
      expect((await c.refunds.preview(orderId)).refundable).toBe(2000);
    });
  });

  describe('webhook: Stripe is the truth for money that left', () => {
    it('a FAILED Stripe refund that Stripe reports succeeded becomes COMPLETED, with history', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(stripeErr(400, 'invalid_request_error'));
      const [r] = await c.refunds.create(
        orderId,
        { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'ff' },
        actor
      );
      expect(r.status).toBe('FAILED');
      expect(
        await deliver(c, 'evt_ff', 'refund.updated', {
          id: 're_ff',
          status: 'succeeded',
          metadata: { refundId: String(r.id) },
        })
      ).toEqual({ duplicate: false, status: 'PROCESSED' });
      expect(refundsOf(c)[0]).toMatchObject({ status: 'COMPLETED', externalId: 're_ff' });
      const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_COMPLETED');
      expect(h).toHaveLength(1);
      expect(h[0].previousValue).toMatchObject({ refundId: r.id, status: 'FAILED' });
      expect(order(c, orderId).paymentStatus).toBe('PAID');
      expect((await c.refunds.preview(orderId)).refundable).toBe(2000);
    });

    it('F1 (supersedes "never downgraded"): a COMPLETED refund Stripe later fails is reversed and refundable again', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockResolvedValueOnce({ id: 're_ok', status: 'succeeded' });
      await c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'ok' }, actor);
      const before = (await c.refunds.preview(orderId)).refundable;
      expect(await deliver(c, 'evt_late', 'refund.failed', { id: 're_ok', status: 'failed' })).toEqual({
        duplicate: false,
        status: 'PROCESSED',
      });
      expect(refundsOf(c)[0].status).toBe('FAILED');
      expect((await c.refunds.preview(orderId)).refundable).toBe(before + 1000);
      // A canceled event never applies to a COMPLETED refund.
      const c2 = setupCommerce();
      const o2 = await stripeOrder(c2);
      stripe.createRefund.mockResolvedValueOnce({ id: 're_ok2', status: 'succeeded' });
      await c2.refunds.create(o2, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'ok' }, actor);
      expect(await deliver(c2, 'evt_cx', 'refund.updated', { id: 're_ok2', status: 'canceled' })).toEqual({
        duplicate: false,
        status: 'IGNORED',
      });
    });
  });

  describe('F5 refunds.refresh', () => {
    const pendingRefund = async (c: Commerce, orderId: number) => {
      stripe.createRefund.mockResolvedValueOnce({ id: 're_mb', status: 'pending' });
      const [r] = await c.refunds.create(
        orderId,
        { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'rf' },
        actor
      );
      expect(r).toMatchObject({ status: 'PROCESSING', externalId: 're_mb' });
      return r;
    };

    it('reads a PROCESSING Stripe refund back from Stripe and applies its status', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      const r = await pendingRefund(c, orderId);

      stripe.retrieveRefund.mockResolvedValueOnce({ id: 're_mb', status: 'requires_action', failureReason: null });
      expect(await c.refunds.refresh(r.id, 'user:2')).toMatchObject({ id: r.id, status: 'PROCESSING' });
      expect(stripe.retrieveRefund).toHaveBeenCalledWith('re_mb');

      stripe.retrieveRefund.mockResolvedValueOnce({ id: 're_mb', status: 'succeeded', failureReason: null });
      expect(await c.refunds.refresh(r.id, 'user:2')).toMatchObject({ status: 'COMPLETED' });
      expect(order(c, orderId).paymentStatus).toBe('PAID');
      const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_COMPLETED');
      expect(h).toHaveLength(1);
      expect(h[0].actor).toBe('user:2');
    });

    it('refreshing a still-pending refund never re-emits REFUND_STARTED', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      const r = await pendingRefund(c, orderId);
      stripe.retrieveRefund.mockResolvedValue({ id: 're_mb', status: 'pending', failureReason: null });
      await c.refunds.refresh(r.id, 'user:2');
      await c.refunds.refresh(r.id, 'user:2');
      expect(c.events.filter((e) => e.type === 'REFUND_STARTED')).toHaveLength(1);
    });

    it('a failed Stripe refund becomes FAILED with Stripe failure_reason and releases its amount', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      const r = await pendingRefund(c, orderId);
      const before = (await c.refunds.preview(orderId)).refundable;
      stripe.retrieveRefund.mockResolvedValueOnce({ id: 're_mb', status: 'failed', failureReason: 'lost_or_stolen_card' });
      expect(await c.refunds.refresh(r.id, 'user:2')).toMatchObject({ status: 'FAILED' });
      expect(refundsOf(c)[0].metadata).toMatchObject({ failureReason: 'lost_or_stolen_card', stripeFailed: true });
      expect((await c.refunds.preview(orderId)).refundable).toBe(before + 1000);
    });

    it('only a PROCESSING Stripe refund with a Stripe id can be refreshed', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_UNREACHABLE'));
      await expect(
        c.refunds.create(orderId, { method: 'STRIPE', amount: 500, reason: 'OTHER', idempotencyKey: 'u' }, actor)
      ).rejects.toMatchObject({ code: 'STRIPE_UNREACHABLE' });
      const noId = refundsOf(c)[0].id;
      expect(await codesOf(c.refunds.refresh(noId, actor))).toEqual(['REFUND_NOT_REFRESHABLE']);
      const [manual] = await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', idempotencyKey: 'm' },
        actor
      );
      expect(await codesOf(c.refunds.refresh(manual.id, actor))).toEqual(['REFUND_NOT_REFRESHABLE']);
      await expect(c.refunds.refresh(99999, actor)).rejects.toMatchObject({ name: 'EcommerceNotFoundError' });
      expect(stripe.retrieveRefund).not.toHaveBeenCalled();
    });
  });

  describe('refunds.resume', () => {
    it('re-issues a PROCESSING Stripe refund with its stored key and applies the answer', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockRejectedValueOnce(new EcommercePaymentError('STRIPE_UNREACHABLE'));
      await expect(
        c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'rs' }, actor)
      ).rejects.toMatchObject({ code: 'STRIPE_UNREACHABLE' });
      const id = refundsOf(c)[0].id;

      // Still unreachable: stays PROCESSING, the error surfaces.
      stripe.createRefund.mockRejectedValueOnce(stripeErr(503));
      await expect(c.refunds.resume(id, 'user:2')).rejects.toMatchObject({ code: 'STRIPE_REQUEST_FAILED' });
      expect(refundsOf(c)[0].status).toBe('PROCESSING');

      stripe.createRefund.mockResolvedValueOnce({ id: 're_rs', status: 'succeeded' });
      const view = await c.refunds.resume(id, 'user:2');
      expect(stripe.createRefund).toHaveBeenLastCalledWith({
        paymentIntentId: 'pi_new',
        amount: 1000,
        idempotencyKey: 'refund:rs:802',
        metadata: expect.objectContaining({ orderId: String(orderId), refundId: String(id), paymentId: '802' }),
      });
      expect(view).toMatchObject({ id, status: 'COMPLETED', externalId: 're_rs' });
      expect(order(c, orderId).paymentStatus).toBe('PAID');
      expect(refundsOf(c)).toHaveLength(1);
    });

    it('refuses refunds that are not PROCESSING Stripe refunds awaiting Stripe (REFUND_NOT_RESUMABLE)', async () => {
      const c = setupCommerce();
      const orderId = await stripeOrder(c);
      stripe.createRefund.mockResolvedValueOnce({ id: 're_c', status: 'succeeded' });
      const [done] = await c.refunds.create(
        orderId,
        { method: 'STRIPE', amount: 500, reason: 'OTHER', idempotencyKey: 'c1' },
        actor
      );
      stripe.createRefund.mockResolvedValueOnce({ id: 're_p', status: 'pending' });
      const [pending] = await c.refunds.create(
        orderId,
        { method: 'STRIPE', amount: 500, reason: 'OTHER', idempotencyKey: 'c2' },
        actor
      );
      const [manual] = await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', idempotencyKey: 'c3' },
        actor
      );
      stripe.createRefund.mockClear();
      for (const r of [done, pending, manual]) {
        expect(await codesOf(c.refunds.resume(r.id, actor))).toEqual(['REFUND_NOT_RESUMABLE']);
      }
      expect(stripe.createRefund).not.toHaveBeenCalled();
      await expect(c.refunds.resume(9999, actor)).rejects.toMatchObject({ name: 'EcommerceNotFoundError' });
    });
  });

  describe('restore onto an unusable voucher issues a new credit', () => {
    it.each([
      ['VOID', (row: any) => (row.status = 'VOID')],
      ['expired', (row: any) => (row.expiresAt = new Date(Date.now() - 1000).toISOString())],
    ])('cancel with a %s voucher: a new credit for the same e-mail, the old one untouched', async (_l, spoil) => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const { credit, payment } = await issueAndPay(c, orderId, 3000);
      const row = c.tables[UIDS.storeCredit].find((x) => x.id === credit.id);
      spoil(row);
      const before = { status: row.status, balance: row.balance };

      await c.orders.cancel(orderId, actor);

      expect(c.tables[UIDS.storeCredit].find((x) => x.id === credit.id)).toMatchObject(before);
      const fresh = c.tables[UIDS.storeCredit].find((x) => x.id !== credit.id);
      expect(fresh).toMatchObject({
        status: 'ACTIVE',
        balance: 3000,
        initialAmount: 3000,
        emailNormalized: 'ana@example.pt',
        sourceOrder: orderId,
      });
      expect(Date.parse(fresh.expiresAt)).toBeGreaterThan(Date.now());
      expect(refundsOf(c)).toEqual([
        expect.objectContaining({ payment: payment.id, status: 'COMPLETED', storeCredit: fresh.id }),
      ]);
      expect(c.tables[UIDS.storeCreditMovement].filter((m) => m.type === 'RESTORE')).toHaveLength(0);
      expect(c.tables[UIDS.storeCreditMovement]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ storeCredit: fresh.id, type: 'ISSUE', amount: 3000, operationKey: `cancel-credit:${payment.id}` }),
        ])
      );
      const issued = c.tables[UIDS.orderHistory].find((h) => h.type === 'STORE_CREDIT_ISSUED');
      expect(issued.description).toContain(`••••${credit.code.slice(-4)}`);
      expect(issued.description).not.toContain(credit.code);
      expect(issued.description).toContain(`••••${fresh.code.slice(-4)}`);
      expect(c.events.map((e) => e.type)).toEqual(expect.arrayContaining(['STORE_CREDIT_ISSUED']));
      // Idempotent: a second release does nothing.
      await c.refunds.releaseStoreCreditOnCancel(orderId, actor);
      expect(c.tables[UIDS.storeCredit]).toHaveLength(2);
    });

    it('a refund onto a VOID original credit also issues a new credit', async () => {
      const c = setupCommerce();
      const o = await createOrder(c);
      const paid = await issueAndPay(c, o, 3000);
      await payManual(c, o, 2500); // excess 1000
      await c.storeCredits.void(paid.credit.id, actor);
      const [r] = await c.refunds.create(
        o,
        { method: 'STORE_CREDIT', amount: 1000, reason: 'OTHER', paymentId: paid.payment.id, idempotencyKey: 'v' },
        actor
      );
      const fresh = c.tables[UIDS.storeCredit].find((x) => x.id !== paid.credit.id);
      expect(fresh).toMatchObject({ balance: 1000, status: 'ACTIVE' });
      expect(r.storeCredit).toMatchObject({ id: fresh.id });
      expect(balanceOf(c, paid.credit.id)).toBe(0);
    });
  });

  describe('idempotency key matching', () => {
    it('a key used for a Stripe refund on another order is a conflict', async () => {
      const c = setupCommerce();
      const a = await stripeOrder(c);
      stripe.createRefund.mockResolvedValueOnce({ id: 're_x', status: 'succeeded' });
      await c.refunds.create(a, { method: 'STRIPE', amount: 500, reason: 'OTHER', idempotencyKey: 'shared' }, actor);
      const b = await createOrder(c);
      await payManual(c, b, 6000, 'mb');
      expect(
        await codesOf(
          c.refunds.create(b, { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', idempotencyKey: 'shared' }, actor)
        )
      ).toEqual(['IDEMPOTENCY_KEY_CONFLICT']);
    });

    it('never matches unrelated keys that share a prefix (cancel-credit:*, key:abc)', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      await issueAndPay(c, orderId, 3000);
      await payManual(c, orderId, 3000); // paid 6000
      await c.orders.cancel(orderId, actor); // cancel-credit:<pid> refund
      c.tables[UIDS.refund].push({
        id: 999,
        order: orderId,
        payment: null,
        method: 'MANUAL_TRANSFER',
        kind: 'MONEY',
        status: 'CANCELLED',
        amount: 1,
        currency: 'EUR',
        idempotencyKey: 'manual:abc',
        completedAt: null,
        metadata: null,
      });
      const before = refundsOf(c).length;
      const [r1] = await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 100, reason: 'OTHER', idempotencyKey: 'cancel-credit' },
        actor
      );
      expect(r1).toMatchObject({ amount: 100, method: 'MANUAL_TRANSFER' });
      const [r2] = await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 200, reason: 'OTHER', idempotencyKey: 'manual' },
        actor
      );
      expect(r2).toMatchObject({ amount: 200 });
      expect(refundsOf(c)).toHaveLength(before + 2);
    });
  });

  describe('manual transfer naming a source payment', () => {
    it('is capped by the payment (paid minus already refunded or in flight)', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const small = await payManual(c, orderId, 1000, 'small');
      await payManual(c, orderId, 5000, 'big'); // excess 1500
      expect(
        await codesOf(
          c.refunds.create(
            orderId,
            { method: 'MANUAL_TRANSFER', amount: 1200, reason: 'OTHER', paymentId: small.id, idempotencyKey: 'm1' },
            actor
          )
        )
      ).toEqual(['exceeds_payment']);
      await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 800, reason: 'OTHER', paymentId: small.id, idempotencyKey: 'm2' },
        actor
      );
      expect(
        await codesOf(
          c.refunds.create(
            orderId,
            { method: 'MANUAL_TRANSFER', amount: 300, reason: 'OTHER', paymentId: small.id, idempotencyKey: 'm3' },
            actor
          )
        )
      ).toEqual(['exceeds_payment']);
    });

    it('rejects a store-credit source payment (incompatible_payment)', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const { payment } = await issueAndPay(c, orderId, 3000);
      await payManual(c, orderId, 2500);
      expect(
        await codesOf(
          c.refunds.create(
            orderId,
            { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', paymentId: payment.id, idempotencyKey: 'mi' },
            actor
          )
        )
      ).toEqual(['incompatible_payment']);
    });
  });
});

describe('markFailed', () => {
  const stripeOrder = async (c: Commerce) => {
    const orderId = await createOrder(c);
    seedStripePayment(c, orderId, 801, 2000, 'pi_old', '2026-11-01T10:00:00.000Z');
    await payManual(c, orderId, 3500);
    return orderId;
  };
  /** A Stripe refund whose outcome is unknown: PROCESSING without a Stripe id. */
  const unknownRefund = async (c: Commerce, orderId: number) => {
    stripe.createRefund.mockRejectedValueOnce(
      new EcommercePaymentError('STRIPE_UNREACHABLE')
    );
    await expect(
      c.refunds.create(orderId, { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'mf' }, actor)
    ).rejects.toBeDefined();
    return refundsOf(c)[0];
  };

  it('FAILED, releases the reserved amount, writes history and keeps the note', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    const row = await unknownRefund(c, orderId);
    expect((await c.refunds.preview(orderId)).inFlight).toBe(1000);

    const view = await c.refunds.markFailed(row.id, 'user:9', { note: 'Not in the dashboard' });
    expect(view.status).toBe('FAILED');
    expect((await c.refunds.preview(orderId)).inFlight).toBe(0);
    expect(refundsOf(c)[0].metadata).toMatchObject({ failureReason: 'MARKED_FAILED', failureNote: 'Not in the dashboard' });
    const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'REFUND_FAILED');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ actor: 'user:9' });
    const failed = c.events.filter((e) => e.type === 'REFUND_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].payload).toMatchObject({ source: 'ADMIN_MARKED' });
  });

  it('rejects other states with REFUND_NOT_MARKABLE', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    const row = await unknownRefund(c, orderId);
    await c.refunds.markFailed(row.id, actor, {});
    expect(await codesOf(c.refunds.markFailed(row.id, actor, {}))).toEqual(['REFUND_NOT_MARKABLE']);

    refundsOf(c).push({ id: 9001, order: orderId, method: 'MANUAL_TRANSFER', kind: 'MONEY', status: 'PROCESSING', amount: 5, externalId: null, idempotencyKey: 'seed', actor, metadata: null });
    const m = { id: 9001 };
    expect(await codesOf(c.refunds.markFailed(m.id, actor, {}))).toEqual(['REFUND_NOT_MARKABLE']);
  });

  it('rejects a Stripe refund that already has a Stripe id, and an unknown id', async () => {
    const c = setupCommerce();
    const orderId = await stripeOrder(c);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_9', status: 'pending' });
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STRIPE', amount: 1000, reason: 'OTHER', idempotencyKey: 'has-id' },
      actor
    );
    expect(await codesOf(c.refunds.markFailed(r.id, actor, {}))).toEqual(['REFUND_NOT_MARKABLE']);
    await expect(c.refunds.markFailed(9999, actor, {})).rejects.toThrow('Refund not found');
  });
});

describe('OrderView refunds and notificationsSummary', () => {
  it('shows real refunds newest first (no codes, no Stripe ids) and the notification counts', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const p = await payManual(c, orderId, 6000);
    for (const key of ['a', 'b']) {
      await c.refunds.create(
        orderId,
        { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', reference: key, paymentId: p.id, idempotencyKey: key },
        actor
      );
    }
    refundsOf(c)[0].externalId = 're_secret';
    for (const status of ['SENT', 'SENT', 'FAILED', 'SKIPPED']) {
      c.tables[UIDS.notification].push({ id: c.tables[UIDS.notification].length + 1, order: orderId, status });
    }
    const view: any = await c.orders.get(orderId);
    expect(view.refunds.map((r: any) => r.id)).toEqual([refundsOf(c)[1].id, refundsOf(c)[0].id]);
    expect(view.refunds[0]).toMatchObject({ status: 'COMPLETED', amount: 500, method: 'MANUAL_TRANSFER', kind: 'MONEY', hasStripeRefundId: false, failureReason: null });
    expect(view.refunds[1].hasStripeRefundId).toBe(true);
    expect(JSON.stringify(view.refunds)).not.toContain('re_secret');
    expect(view.notificationsSummary).toEqual({ sent: 2, failed: 1, skipped: 1 });
  });
});

describe('refund list and view policies', () => {
  it('the refund list keeps the Stripe refund id but shows only the store credit id', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const { credit, payment } = await issueAndPay(c, orderId, 3000);
    await payManual(c, orderId, 2500); // excess 1000
    await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 500, reason: 'OTHER', paymentId: payment.id, idempotencyKey: 'pol' },
      actor
    );
    refundsOf(c)[0].externalId = 're_visible';
    const [r] = (await c.refunds.list(orderId)) as any[];
    expect(r.externalId).toBe('re_visible');
    expect(r.storeCredit).not.toBeNull();
    expect(r.storeCredit).not.toHaveProperty('code');
    expect(r.storeCredit.id).toBeTypeOf('number');
    expect(JSON.stringify(r)).not.toContain(credit.code);
  });

  it('OrderView shows failureReason only while the refund is FAILED', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const p = await payManual(c, orderId, 6000);
    await c.refunds.create(
      orderId,
      { method: 'MANUAL_TRANSFER', amount: 500, reason: 'OTHER', reference: 'r', paymentId: p.id, idempotencyKey: 'fr' },
      actor
    );
    refundsOf(c)[0].metadata = { failureReason: 'MARKED_FAILED' };
    const view: any = await c.orders.get(orderId);
    expect(view.refunds[0].status).toBe('COMPLETED');
    expect(view.refunds[0].failureReason).toBeNull();
    refundsOf(c)[0].status = 'FAILED';
    expect(((await c.orders.get(orderId)) as any).refunds[0].failureReason).toBe('MARKED_FAILED');
  });
});

describe('store credit payments never expose the voucher code', () => {
  it('OrderView and the payment view show a masked reference and the credit id', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const { credit, payment } = await issueAndPay(c, orderId, 3000);
    const masked = `••••${credit.code.slice(-4)}`;
    const view: any = await c.orders.get(orderId);
    const p = view.payments.find((x: any) => x.method === 'STORE_CREDIT');
    expect(p.reference).toBe(masked);
    expect(p.storeCreditId).toBe(credit.id);
    expect(JSON.stringify(view.payments)).not.toContain(credit.code);
    expect(payment.reference).toBe(masked);
    expect(payment.storeCreditId).toBe(credit.id);
    expect(JSON.stringify(payment)).not.toContain(credit.code);
    // a manual payment keeps its reference
    const m: any = await payManual(c, orderId, 100, 'keep');
    expect(m.storeCreditId).toBeNull();
  });
});

describe('voucher codes in the order history', () => {
  const historyText = (c: Commerce) => JSON.stringify(c.tables[UIDS.orderHistory]);

  it('payment with a credit, a credit refund and a reissue write only masked codes', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const { credit, payment } = await issueAndPay(c, orderId, 3000);
    await payManual(c, orderId, 2500); // excess 1000
    // MANUAL issue of a new credit by a STORE_CREDIT refund without a source payment
    const [r] = await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 400, reason: 'OTHER', idempotencyKey: 'h-new' },
      actor
    );
    const newCode = c.tables[UIDS.storeCredit].find((x) => x.id === (r as any).storeCredit.id).code;
    // reissue: the credit paid with is VOID, refunding to its payment issues a new one
    c.tables[UIDS.storeCredit].find((x) => x.id === credit.id).status = 'VOID';
    await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 300, reason: 'OTHER', paymentId: payment.id, idempotencyKey: 'h-re' },
      actor
    );
    const text = historyText(c);
    expect(text).not.toContain(credit.code);
    expect(text).not.toContain(newCode);
    for (const x of c.tables[UIDS.storeCredit]) expect(text).not.toContain(x.code);
    expect(text).toContain(`••••${credit.code.slice(-4)}`);
    expect(c.tables[UIDS.orderHistory].some((h) => h.newValue?.storeCreditId === credit.id)).toBe(true);
  });

  it('OrderView redacts codes in rows already stored (description, previousValue, newValue)', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    c.tables[UIDS.orderHistory].push({
      id: 5001,
      order: orderId,
      type: 'STORE_CREDIT_ISSUED',
      description: 'Store credit AB12-CD34-EF56 issued, original GH78-JK90-LM12 void',
      previousValue: { storeCreditId: 1, code: 'GH78-JK90-LM12' },
      newValue: { storeCreditId: 2, nested: { code: 'AB12-CD34-EF56' }, code: 'AB12-CD34-EF56' },
      actor,
      operationId: null,
      createdAt: '2026-11-11T10:00:00.000Z',
    });
    const view: any = await c.orders.get(orderId);
    const h = view.history.find((x: any) => x.id === 5001);
    const text = JSON.stringify(h);
    expect(text).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    expect(h.description).toBe('Store credit ••••EF56 issued, original ••••LM12 void');
    expect(h.previousValue).toEqual({ storeCreditId: 1, code: '••••LM12' });
    expect(h.newValue).toMatchObject({ storeCreditId: 2, code: '••••EF56', nested: { code: '••••EF56' } });
  });
});
