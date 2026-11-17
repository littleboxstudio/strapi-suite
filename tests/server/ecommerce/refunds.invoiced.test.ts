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
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { UIDS, setupCommerce, createOrder, type Commerce } from './helpers/commerceSetup';

beforeEach(() => {
  __resetEventHandlersForTests();
  stripe.createRefund.mockReset();
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
const refundRow = (c: Commerce, id: number) => c.tables[UIDS.refund].find((r) => r.id === id);
const lineIdOf = (c: Commerce, orderId: number) =>
  c.tables[UIDS.orderLine].find((l) => l.order === orderId).id as number;
const historyTypes = (c: Commerce) => c.tables[UIDS.orderHistory].map((h) => h.type);

const SECRET = 'whsec_test_123';
const deliver = (c: Commerce, id: string, type: string, object: any) => {
  const raw = Buffer.from(JSON.stringify({ id, object: 'event', type, data: { object } }));
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.`).update(raw).digest('hex')}`;
  return c.webhooks.handle(raw, sig);
};

/** An ISSUED invoice of the whole order: 2 × 2000 (one line, 4000) and the 500 shipping line. */
const seedInvoice = (c: Commerce, orderId: number, id = 900) => {
  const shippingLineId = order(c, orderId).shippingLines.lines[0].id;
  c.tables[UIDS.invoice].push({
    id,
    order: orderId,
    kind: 'INVOICE',
    status: 'ISSUED',
    creditedInvoice: null,
    number: `FR 2026/${id}`,
    lines: {
      lines: [
        { orderLineId: lineIdOf(c, orderId), kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 2, total: 4000, tax: 23, partial: false, discountShare: 0 },
        { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId },
      ],
    },
    metadata: null,
  });
};

/** Order 4500, paid in full by manual payment, fully invoiced: no excess. */
const invoicedOrder = async (c: Commerce = setupCommerce()) => {
  const id = await createOrder(c);
  await c.payments.addManualPayment(id, { amount: 4500, idempotencyKey: 'pay-1' }, actor);
  seedInvoice(c, id);
  return { c, id };
};

const invoiced = (amount: number, extra: Record<string, unknown> = {}) => ({
  method: 'MANUAL_TRANSFER' as const,
  amount,
  reason: 'GOODWILL',
  scope: 'INVOICED' as const,
  idempotencyKey: `inv-${amount}`,
  ...extra,
});

describe('INVOICED refunds: preview and the REFUND action', () => {
  it('a fully paid invoiced order offers REFUND with the invoiced value and no excess', async () => {
    const { c, id } = await invoicedOrder();
    const state = await c.orders.computeOrderState(id);
    expect(state.summary.excess).toBe(0);
    expect(state.actions).toContain('REFUND');
    const p = await c.refunds.preview(id);
    expect(p).toMatchObject({
      excess: 0,
      refundable: 0,
      invoicedRefundable: 4500,
      limits: {
        EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
        INVOICED: { refundable: 4500, moneyRefundable: 4500, stripeRefundable: 0 },
      },
    });
  });

  it('without an invoice there is nothing invoiced to refund (no REFUND without an excess)', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await c.payments.addManualPayment(id, { amount: 4500, idempotencyKey: 'pay-1' }, actor);
    expect((await c.orders.computeOrderState(id)).actions).not.toContain('REFUND');
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(0);
  });

  it('the limit excludes the value a RETURN credit note already credited', async () => {
    const { c, id } = await invoicedOrder();
    c.tables[UIDS.invoice].push({
      id: 901,
      order: id,
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      creditedInvoice: 900,
      lines: {
        lines: [
          { orderLineId: lineIdOf(c, id), kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 1, total: 2000, tax: 23, partial: false, discountShare: 0 },
        ],
      },
      metadata: { creditType: 'RETURN', creditedLines: [{ index: 0, value: 2000, quantity: 1 }] },
    });
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2500);
    expect(
      await codesOf(c.refunds.create(id, invoiced(2501), actor))
    ).toEqual(['exceeds_refundable']);
  });

  it('the limit leaves out value invoiced above what the order now charges (a return not credited yet)', async () => {
    const { c, id } = await invoicedOrder();
    // One unit returned: the order now charges 2500; the invoice still holds 4500.
    c.tables[UIDS.orderLine].find((l) => l.order === id).returnedQuantity = 1;
    order(c, id).total = 2500;
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2500);
  });
});

describe('INVOICED refunds: create', () => {
  it('lowers the order total; the order stays PAID and refunded grows', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500), actor);
    expect(r).toMatchObject({ scope: 'INVOICED', status: 'COMPLETED', amount: 500, kind: 'MONEY' });
    expect(refundRow(c, r.id).scope).toBe('INVOICED');
    expect(order(c, id).total).toBe(4000);
    expect(order(c, id).paymentStatus).toBe('PAID');
    const state = await c.orders.computeOrderState(id);
    expect(state.summary).toMatchObject({ orderTotal: 4000, paid: 4500, refunded: 500, due: 0, excess: 0 });
    const view = await c.orders.get(id);
    expect(view.totals).toMatchObject({ creditAdjustment: 500, total: 4000 });
    expect(historyTypes(c)).toContain('REFUND_COMPLETED');
    expect(c.events.filter((e) => e.type === 'REFUND_COMPLETED')).toHaveLength(1);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4000);
  });

  it('scope defaults to EXCESS; an unknown scope is refused', async () => {
    const { c, id } = await invoicedOrder();
    expect(
      await codesOf(c.refunds.create(id, { ...invoiced(500), scope: undefined }, actor))
    ).toEqual(['exceeds_refundable']);
    expect(
      await codesOf(c.refunds.create(id, { ...invoiced(500), scope: 'OTHER' as any }, actor))
    ).toEqual(['invalid_scope']);
    expect(order(c, id).total).toBe(4500);
  });

  it('a store credit refund issues a credit and lowers the total', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STORE_CREDIT' }), actor);
    expect(r).toMatchObject({ scope: 'INVOICED', kind: 'STORE_CREDIT', status: 'COMPLETED' });
    expect(r.storeCredit).not.toBeNull();
    expect(order(c, id).total).toBe(4000);
    expect(order(c, id).paymentStatus).toBe('PAID');
  });

  it('is refused on an archived order', async () => {
    const { c, id } = await invoicedOrder();
    order(c, id).orderStatus = 'ARCHIVED';
    expect(await codesOf(c.refunds.create(id, invoiced(500), actor))).toEqual(['ACTION_NOT_AVAILABLE']);
  });

  it('Stripe: the total drops while PROCESSING; a Stripe failure gives it back', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 801, order: id, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:801', coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    expect((await c.refunds.preview(id)).limits.INVOICED.stripeRefundable).toBe(4500);

    stripe.createRefund.mockResolvedValueOnce({ id: 're_1', status: 'pending' });
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STRIPE' }), actor);
    expect(r).toMatchObject({ scope: 'INVOICED', status: 'PROCESSING' });
    expect(order(c, id).total).toBe(4000);
    expect(historyTypes(c)).toContain('REFUND_CREATED');

    await deliver(c, 'evt_f', 'refund.updated', { id: 're_1', object: 'refund', status: 'failed' });
    expect(refundRow(c, r.id).status).toBe('FAILED');
    expect(order(c, id).total).toBe(4500);
    expect(order(c, id).paymentStatus).toBe('PAID');
  });

  it('Stripe: a completed refund keeps the total lowered and the order PAID', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 801, order: id, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:801', coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_2', status: 'succeeded' });
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STRIPE' }), actor);
    expect(r.status).toBe('COMPLETED');
    expect(order(c, id).total).toBe(4000);
    expect(order(c, id).paymentStatus).toBe('PAID');
  });
});

describe('INVOICED refunds: remove', () => {
  it('restores the total, keeps the refund as CANCELLED + removed and hides it from the lists', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500), actor);
    const view = await c.refunds.remove(r.id, actor);
    expect(view).toMatchObject({ id: r.id, status: 'CANCELLED' });
    expect(refundRow(c, r.id)).toMatchObject({ status: 'CANCELLED', metadata: expect.objectContaining({ removed: true }) });
    expect(order(c, id).total).toBe(4500);
    expect(order(c, id).paymentStatus).toBe('PAID');
    expect(historyTypes(c)).toContain('REFUND_REMOVED');
    expect(await c.refunds.list(id)).toEqual([]);
    expect((await c.orders.get(id)).refunds).toEqual([]);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4500);
    // A second remove is refused.
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['REFUND_NOT_REMOVABLE']);
  });

  it('voids an unused store credit', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STORE_CREDIT' }), actor);
    await c.refunds.remove(r.id, actor);
    const credit = c.tables[UIDS.storeCredit].find((s) => s.id === r.storeCredit.id);
    expect(credit).toMatchObject({ status: 'VOID', balance: 0 });
    expect(order(c, id).total).toBe(4500);
  });

  it('is refused when the store credit was used (STORE_CREDIT_USED)', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STORE_CREDIT' }), actor);
    const credit = c.tables[UIDS.storeCredit].find((s) => s.id === r.storeCredit.id);
    credit.balance = 200;
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['STORE_CREDIT_USED']);
    expect(refundRow(c, r.id).status).toBe('COMPLETED');
    expect(order(c, id).total).toBe(4000);
  });

  it('is refused for STRIPE, on an archived order, with a credit note, and for an EXCESS refund', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500), actor);

    refundRow(c, r.id).metadata = { creditNoteId: 77 };
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['REFUND_HAS_CREDIT_NOTE']);
    refundRow(c, r.id).metadata = null;

    order(c, id).orderStatus = 'ARCHIVED';
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['REFUND_NOT_REMOVABLE']);
    order(c, id).orderStatus = 'OPEN';

    refundRow(c, r.id).method = 'STRIPE';
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['REFUND_NOT_REMOVABLE']);
    refundRow(c, r.id).method = 'MANUAL_TRANSFER';

    refundRow(c, r.id).scope = 'EXCESS';
    expect(await codesOf(c.refunds.remove(r.id, actor))).toEqual(['REFUND_NOT_REMOVABLE']);
    refundRow(c, r.id).scope = 'INVOICED';

    expect(refundRow(c, r.id).status).toBe('COMPLETED');
    expect(order(c, id).total).toBe(4000);
  });
});
