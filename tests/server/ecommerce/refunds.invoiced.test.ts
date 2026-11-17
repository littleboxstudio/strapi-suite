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

/**
 * The active billing provider (never called here: no document is issued). An INVOICED refund picks
 * elements of its invoices only.
 */
const withBilling = (c: Commerce) => {
  c.services.EcommerceSettingsService.getActiveProviders = async (category: string) =>
    category === 'billing' ? ['moloni'] : [];
};

/** An ISSUED invoice of the whole order: 2 × 2000 (one line, 4000) and the 500 shipping line. */
const seedInvoice = (c: Commerce, orderId: number, id = 900) => {
  withBilling(c);
  const shippingLineId = order(c, orderId).shippingLines.lines[0].id;
  c.tables[UIDS.invoice].push({
    id,
    order: orderId,
    provider: 'moloni',
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

/**
 * The elements of invoice 900 that make `amount` (plan 15: an INVOICED refund is the sum of chosen
 * elements): 500 the shipping line, 2000 one unit, 2500 both, 4000 both units.
 */
const ELEMENTS: Record<number, { invoiceId: number; index: number; quantity: number }[]> = {
  500: [{ invoiceId: 900, index: 1, quantity: 1 }],
  2000: [{ invoiceId: 900, index: 0, quantity: 1 }],
  2500: [
    { invoiceId: 900, index: 0, quantity: 1 },
    { invoiceId: 900, index: 1, quantity: 1 },
  ],
  4000: [{ invoiceId: 900, index: 0, quantity: 2 }],
};

const invoiced = (amount: number, extra: Record<string, unknown> = {}) => ({
  method: 'MANUAL_TRANSFER' as const,
  amount,
  items: ELEMENTS[amount],
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
    // Its unit is no longer an element: both units are more than is left.
    expect(await codesOf(c.refunds.create(id, invoiced(4000), actor))).toEqual(['REFUND_ITEMS_INVALID']);
  });

  it('the limit leaves out value invoiced above what the order now charges (a return not credited yet)', async () => {
    const { c, id } = await invoicedOrder();
    // One unit returned: the order now charges 2500; the invoice still holds 4500.
    c.tables[UIDS.orderLine].find((l) => l.order === id).returnedQuantity = 1;
    order(c, id).total = 2500;
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2500);
  });
});

const issuesOf = async (p: Promise<unknown>): Promise<any[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors as any[];
    throw e;
  }
  return [];
};

describe('INVOICED refunds: elements above the invoiced refundable value (fix round 1)', () => {
  it('value invoiced above what the order charges: REFUND_ITEMS_INVALID on items, with the limit', async () => {
    const { c, id } = await invoicedOrder();
    c.tables[UIDS.orderLine].find((l) => l.order === id).returnedQuantity = 1;
    order(c, id).total = 2500;
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2500);
    expect(await issuesOf(c.refunds.create(id, invoiced(4000), actor))).toEqual([
      { path: 'items', code: 'REFUND_ITEMS_INVALID', detail: '2500' },
    ]);
    expect(c.tables[UIDS.refund]).toHaveLength(0);
  });

  it('a legacy refund reserving by amount: REFUND_ITEMS_INVALID on items, with the limit', async () => {
    const { c, id } = await invoicedOrder();
    c.tables[UIDS.refund].push({
      id: 700, order: id, payment: null, method: 'MANUAL_TRANSFER', kind: 'MONEY', status: 'COMPLETED',
      scope: 'INVOICED', amount: 500, currency: 'EUR', reason: 'GOODWILL', idempotencyKey: 'legacy',
      storeCredit: null, metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4000);
    expect(
      await issuesOf(
        c.refunds.create(id, invoiced(2500, { items: [...ELEMENTS[4000], ...ELEMENTS[500]], amount: undefined }), actor)
      )
    ).toEqual([{ path: 'items', code: 'REFUND_ITEMS_INVALID', detail: '4000' }]);
  });
});

describe('INVOICED refunds: create', () => {
  it('Stripe: elements that would span several Stripe payments are stripe_split_unavailable', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    for (const [pid, amount, at] of [[801, 2500, '2026-11-01T10:00:00.000Z'], [802, 2000, '2026-11-02T10:00:00.000Z']] as const) {
      c.tables[UIDS.payment].push({
        id: pid, order: id, method: 'STRIPE', status: 'COMPLETED', amount, currency: 'EUR',
        externalId: `pi_${pid}`, idempotencyKey: `stripe:${pid}`, coverage: null,
        completedAt: at, actor: 'webhook:stripe', metadata: null,
      });
    }
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    expect(await issuesOf(c.refunds.create(id, invoiced(4000, { method: 'STRIPE' }), actor))).toEqual([
      { path: 'method', code: 'stripe_split_unavailable' },
    ]);
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(c.tables[UIDS.refund]).toHaveLength(0);
  });

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
    // No credit note: nothing to review.
    expect(historyTypes(c)).not.toContain('REFUND_REVERSED_WITH_CREDIT_NOTE');
    expect(order(c, id).reviewFlags?.flags ?? []).toEqual([]);
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

describe('INVOICED refunds: the removable flag of the list', () => {
  const removableOf = async (c: Commerce, id: number, refundId: number) =>
    (await c.refunds.list(id)).find((v: any) => v.id === refundId).removable;

  it('follows the remove rules without changing anything', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500), actor);
    expect(await removableOf(c, id, r.id)).toBe(true);

    refundRow(c, r.id).metadata = { creditNoteId: 77 };
    expect(await removableOf(c, id, r.id)).toBe(false);
    refundRow(c, r.id).metadata = null;

    order(c, id).orderStatus = 'ARCHIVED';
    expect(await removableOf(c, id, r.id)).toBe(false);
    order(c, id).orderStatus = 'OPEN';

    refundRow(c, r.id).method = 'STRIPE';
    expect(await removableOf(c, id, r.id)).toBe(false);
    refundRow(c, r.id).method = 'MANUAL_TRANSFER';

    refundRow(c, r.id).scope = 'EXCESS';
    expect(await removableOf(c, id, r.id)).toBe(false);
    refundRow(c, r.id).scope = 'INVOICED';

    refundRow(c, r.id).status = 'PROCESSING';
    expect(await removableOf(c, id, r.id)).toBe(false);
    refundRow(c, r.id).status = 'COMPLETED';
    expect(await removableOf(c, id, r.id)).toBe(true);
  });

  it('a store credit refund: removable while its own credit is unused; reading never voids it', async () => {
    const { c, id } = await invoicedOrder();
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STORE_CREDIT' }), actor);
    const credit = c.tables[UIDS.storeCredit].find((s) => s.id === r.storeCredit.id);
    expect(await removableOf(c, id, r.id)).toBe(true);
    expect(credit.status).not.toBe('VOID');
    expect(credit.balance).toBe(500);
    credit.balance = 200;
    expect(await removableOf(c, id, r.id)).toBe(false);
  });
});

describe('INVOICED refunds with their REFUND credit note (plan 15, task 3)', () => {
  /** The invoice 900's allocation of the 4500 payment, so nothing is left to invoice. */
  const allocate = (c: Commerce, id: number) => {
    const payment = c.tables[UIDS.payment].find((p) => p.order === id);
    c.tables[UIDS.invoiceAllocation].push({
      id: 800,
      order: id,
      invoice: 900,
      payment: payment.id,
      amount: 4500,
      uniqueKey: `alloc-${payment.id}`,
    });
  };
  /** An ISSUED REFUND credit note of `refundId`, crediting `entries` of invoice 900. */
  const refundNote = (
    c: Commerce,
    orderId: number,
    noteId: number,
    refundId: number,
    entries: { index: number; value: number; quantity: number }[]
  ) => {
    const invoice = c.tables[UIDS.invoice].find((i) => i.id === 900);
    c.tables[UIDS.invoice].push({
      id: noteId,
      order: orderId,
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      creditedInvoice: 900,
      number: `NC 2026/${noteId}`,
      total: entries.reduce((s, e) => s + e.value, 0),
      lines: {
        lines: entries.map((e) => ({ ...invoice.lines.lines[e.index], quantity: e.quantity || 1, total: e.value })),
      },
      metadata: {
        creditType: 'REFUND',
        refundId,
        creditedLines: entries.map((e) => ({ ...e, invoiceId: 900 })),
      },
    });
    refundRow(c, refundId).metadata = { ...(refundRow(c, refundId).metadata ?? {}), creditNoteId: noteId };
  };

  it('Stripe reverses a credited refund: total back up, credit note kept, history and a review flag', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 801, order: id, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:801', coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_9', status: 'succeeded' });
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STRIPE' }), actor);
    expect(r.status).toBe('COMPLETED');
    refundNote(c, id, 950, r.id, [{ index: 1, value: 500, quantity: 1 }]);

    await deliver(c, 'evt_rev', 'refund.updated', { id: 're_9', object: 'refund', status: 'failed' });
    expect(refundRow(c, r.id).status).toBe('FAILED');
    expect(order(c, id).total).toBe(4500);
    expect(c.tables[UIDS.invoice].find((i) => i.id === 950).status).toBe('ISSUED');
    const entry = c.tables[UIDS.orderHistory].find((h) => h.type === 'REFUND_REVERSED_WITH_CREDIT_NOTE');
    expect(entry).toMatchObject({ newValue: { refundId: r.id, creditNoteId: 950 }, actor: 'webhook:stripe' });
    expect(historyTypes(c)).toContain('REVIEW_FLAG_RAISED');
    const view = await c.orders.get(id);
    expect(view.reviewFlags).toEqual([
      expect.objectContaining({ code: 'REFUND_REVIEW', reason: 'REFUND_REVERSED_WITH_CREDIT_NOTE' }),
    ]);
  });

  /** An order paid 4500 by Stripe, invoiced (900), with a Stripe INVOICED refund of the shipping line we marked FAILED. */
  const failedStripeRefund = async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 801, order: id, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:801', coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_7', status: 'succeeded' });
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STRIPE' }), actor);
    // Held as failed by us (an indeterminate answer): its shipping line is free again.
    refundRow(c, r.id).status = 'FAILED';
    await c.orders.recalculate(id, { actor });
    return { c, id, r };
  };

  it('a late Stripe success whose elements another refund took meanwhile: history and a review flag', async () => {
    const { c, id, r } = await failedStripeRefund();
    const [other] = await c.refunds.create(id, invoiced(500, { idempotencyKey: 'inv-500-again' }), actor);
    expect(other.status).toBe('COMPLETED');

    await deliver(c, 'evt_late', 'refund.updated', { id: 're_7', object: 'refund', status: 'succeeded' });
    expect(refundRow(c, r.id).status).toBe('COMPLETED');
    const entry = c.tables[UIDS.orderHistory].find((h) => h.type === 'REFUND_ELEMENTS_CONFLICT');
    expect(entry).toMatchObject({ newValue: { refundId: r.id }, actor: 'webhook:stripe' });
    const view = await c.orders.get(id);
    expect(view.reviewFlags).toEqual([
      expect.objectContaining({ code: 'REFUND_REVIEW', reason: 'REFUND_ELEMENTS_CONFLICT' }),
    ]);
  });

  it('a late Stripe success whose elements are still free (itself left out) raises no flag', async () => {
    const { c, id, r } = await failedStripeRefund();
    await deliver(c, 'evt_late2', 'refund.updated', { id: 're_7', object: 'refund', status: 'succeeded' });
    expect(refundRow(c, r.id).status).toBe('COMPLETED');
    expect(historyTypes(c)).not.toContain('REFUND_ELEMENTS_CONFLICT');
    expect((await c.orders.get(id)).reviewFlags).toEqual([]);
  });

  it('a reversal whose credit note FAILED raises no flag', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 801, order: id, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:801', coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    await c.orders.recalculate(id, { actor });
    seedInvoice(c, id);
    stripe.createRefund.mockResolvedValueOnce({ id: 're_8', status: 'succeeded' });
    const [r] = await c.refunds.create(id, invoiced(500, { method: 'STRIPE' }), actor);
    refundNote(c, id, 951, r.id, [{ index: 1, value: 500, quantity: 1 }]);
    c.tables[UIDS.invoice].find((i) => i.id === 951).status = 'FAILED';
    await deliver(c, 'evt_rev2', 'refund.updated', { id: 're_8', object: 'refund', status: 'failed' });
    expect(refundRow(c, r.id).status).toBe('FAILED');
    expect(historyTypes(c)).not.toContain('REFUND_REVERSED_WITH_CREDIT_NOTE');
    expect((await c.orders.get(id)).reviewFlags).toEqual([]);
  });

  it('shipping refunded and credited: nothing to invoice, nothing over-invoiced or stranded', async () => {
    const { c, id } = await invoicedOrder();
    allocate(c, id);
    const [r] = await c.refunds.create(id, invoiced(500), actor);
    refundNote(c, id, 901, r.id, [{ index: 1, value: 500, quantity: 1 }]);

    const state = await c.orders.computeOrderState(id);
    expect(state.invoicing.position.stranded).toEqual({ products: 0, shipping: 0 });
    expect(state.invoicing.position.overInvoiced).toEqual({ products: 0, shipping: 0 });
    const selection = await c.services.EcommerceInvoiceService.selection(id);
    expect(selection).toMatchObject({ lines: [], shipping: [], discounts: [], payments: [], overInvoiced: { shipping: 0 } });
    expect((await c.orders.get(id)).invoicing.shippingToCredit).toBe(0);
    // Only the products are left to refund; the shipping is never offered twice.
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4000);

    // The rest refunded and credited too: nothing left at all.
    const [r2] = await c.refunds.create(id, invoiced(4000, { idempotencyKey: 'inv-rest' }), actor);
    refundNote(c, id, 902, r2.id, [{ index: 0, value: 4000, quantity: 2 }]);
    expect(order(c, id).total).toBe(0);
    const after = await c.orders.computeOrderState(id);
    expect(after.invoicing.position.stranded).toEqual({ products: 0, shipping: 0 });
    expect(after.invoicing.position.overInvoiced).toEqual({ products: 0, shipping: 0 });
    expect(after.invoicing.items.lines.every((l: any) => l.invoiced)).toBe(true);
    expect(await c.services.EcommerceInvoiceService.selection(id)).toMatchObject({ lines: [], shipping: [], payments: [] });
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(0);
  });

  it('an order with a promotion: an INVOICED refund lowers the total by its amount', async () => {
    const c = setupCommerce();
    c.tables[UIDS.promotion].push({
      id: 1,
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
      conditions: { type: 'GROUP', operator: 'AND', children: [] },
      benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
      stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
      usageLimit: null,
      perCustomerLimit: null,
      perOrderLimit: null,
      redemptions: 0,
      version: 1,
    });
    const id = await createOrder(c);
    const before = order(c, id).total;
    expect(order(c, id).orderDiscount).toBeGreaterThan(0);
    await c.payments.addManualPayment(id, { amount: before, idempotencyKey: 'pay-1' }, actor);
    seedInvoice(c, id);
    await c.refunds.create(id, invoiced(500), actor);
    expect(order(c, id).total).toBe(before - 500);
    expect(order(c, id).paymentStatus).toBe('PAID');
    expect((await c.orders.get(id)).totals).toMatchObject({ creditAdjustment: 500, total: before - 500 });
  });
});
