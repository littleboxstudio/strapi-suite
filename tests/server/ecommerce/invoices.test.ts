import { describe, it, expect, beforeEach, vi } from 'vitest';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveRefund: vi.fn(),
}));
vi.mock(
  '../../../server/src/services/modules/ecommerce/providers/payments/stripeClient',
  async (importOriginal) => {
    const actual: any = await importOriginal();
    return { ...actual, createStripeClient: () => stripe };
  }
);

import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { billingErrorDetail } from '../../../server/src/services/modules/ecommerce/invoices';
import {
  EcommerceBillingError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import {
  __resetBillingProvidersForTests,
  registerBillingProvider,
  type BillingProvider,
  type InvoiceDraft,
} from '../../../server/src/services/modules/ecommerce/providers/billing';
import { setupCommerce, testIssueAll, UIDS, type Commerce } from './helpers/commerceSetup';

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  nif: '123456789',
};

let docSeq = 0;
const issued = (draft: InvoiceDraft) => {
  docSeq += 1;
  return {
    externalId: `ext-${docSeq}`,
    number: draft.kind === 'CREDIT_NOTE' ? `NC 2025/${docSeq}` : `FR 2025/${docSeq}`,
    series: '2025',
    documentType: draft.kind === 'CREDIT_NOTE' ? 'NC' : 'FR',
    total: draft.total,
    issuedAt: '2025-03-01T10:00:00.000Z',
    warnings: [] as string[],
  };
};

const fakeProvider = (id = 'fakebill', caps = { creditNotes: true, findByReference: true }) => {
  const p = {
    id,
    capabilities: caps,
    /** Longest an `issue` may legitimately take: a PENDING row is stale after this. */
    maxIssueDurationMs: 5 * 60 * 1000,
    issue: vi.fn(async (draft: InvoiceDraft) => issued(draft)),
    getDocument: vi.fn(),
    getPdf: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
    findByReference: vi.fn(async () => null),
  };
  return p as typeof p & BillingProvider;
};

type Setup = {
  c: Commerce;
  inv: any;
  provider: ReturnType<typeof fakeProvider>;
  active: string[];
  runtimes: Record<string, any>;
};

function setup(opts: { caps?: { creditNotes: boolean; findByReference: boolean } } = {}): Setup {
  const c = setupCommerce();
  const provider = fakeProvider('fakebill', opts.caps);
  registerBillingProvider(provider);
  const active = ['fakebill'];
  const runtimes: Record<string, any> = {
    fakebill: { config: { k: 1 }, secrets: { s: 'x' }, active: true },
  };
  const settings = c.services.EcommerceSettingsService;
  settings.getActiveProviders = async (category: string) => (category === 'billing' ? active : []);
  const baseRuntime = settings.getRuntime;
  settings.getRuntime = async (id: string) => runtimes[id] ?? baseRuntime(id);
  settings.getStoreSettings = async () => ({
    markets: ['PT'],
    storefrontUrl: 'https://shop.example/',
    timezone: 'Europe/Lisbon',
  });
  c.tables[UIDS.variant].push({
    id: 12,
    product: 1,
    sku: 'SH-S',
    price: 200,
    tax: 23,
    stock: 50,
    active: true,
  });
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  return { c, inv: c.services.EcommerceInvoiceService, provider, active, runtimes };
}

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const lineIdOf = (c: Commerce, id: number, variantId = 10) =>
  c.tables[UIDS.orderLine].find((l) => l.order === id && l.variantId === variantId).id as number;
const paymentRows = (c: Commerce, id: number) =>
  c.tables[UIDS.payment].filter((p) => p.order === id).sort((a, b) => a.id - b.id);
const invoiceRows = (c: Commerce) => c.tables[UIDS.invoice];
const allocations = (c: Commerce) => c.tables[UIDS.invoiceAllocation];

const create = async (
  c: Commerce,
  lines: { variantId: number; quantity: number }[]
): Promise<number> => {
  const o = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'pt',
      lines,
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  return o.id as number;
};

const pay = (c: Commerce, id: number, amount: number, key: string, methodLabel?: string) =>
  c.payments.addManualPayment(id, { amount, idempotencyKey: key, methodLabel }, 'user:1');

/** 2 × 2000 + 500 shipping = 4500. `payments` are manual amounts (default: paid in full). */
const order = async (c: Commerce, payments: number[] = [4500], quantity = 2) => {
  const id = await create(c, [{ variantId: 10, quantity }]);
  for (const [i, amount] of payments.entries()) await pay(c, id, amount, `pay-${id}-${i}`);
  return id;
};

/** The full selection of a 2 × 2000 + 500 order, paid by `paymentIds`. */
const everything = (c: Commerce, id: number, paymentIds: number[], key: string, expectedTotal = 4500) => ({
  lines: [{ orderLineId: lineIdOf(c, id), quantity: 2 }],
  shippingLineIds: [1],
  paymentIds,
  expectedTotal,
  idempotencyKey: key,
});

const codesOf = async (p: Promise<unknown>): Promise<string[]> => {
  const err: any = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e
  );
  if (err instanceof EcommerceValidationError) return err.errors.map((e: any) => e.code);
  if (err instanceof EcommerceBillingError) return [err.code];
  throw err;
};

const DATE = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

beforeEach(() => {
  __resetEventHandlersForTests();
  __resetBillingProvidersForTests();
  stripe.createRefund.mockReset();
  docSeq = 0;
});

describe('EcommerceInvoiceService.activeProvider', () => {
  it('no active billing provider → BILLING_NOT_CONFIGURED and nothing written', async () => {
    const { c, active } = setup();
    const id = await order(c);
    active.length = 0;
    expect(await codesOf(testIssueAll(c, id, 'k1'))).toEqual(['BILLING_NOT_CONFIGURED']);
    expect(invoiceRows(c)).toHaveLength(0);
    expect(allocations(c)).toHaveLength(0);
  });

  it('two active providers → BILLING_PROVIDER_AMBIGUOUS', async () => {
    const { c, active } = setup();
    const id = await order(c);
    active.push('moloni');
    expect(await codesOf(testIssueAll(c, id, 'k1'))).toEqual(['BILLING_PROVIDER_AMBIGUOUS']);
    expect(invoiceRows(c)).toHaveLength(0);
  });

  it('an active provider without an implementation → BILLING_NOT_CONFIGURED', async () => {
    const { c, inv, active } = setup();
    active.splice(0, 1, 'unknown-billing');
    await expect(inv.activeProvider()).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED' });
    const id = await order(c);
    expect((await c.orders.get(id)).billing).toEqual({ active: false, providerId: null });
  });

  it('the order view reports billing without reading provider credentials', async () => {
    const { c } = setup();
    const id = await order(c);
    const settings = c.services.EcommerceSettingsService;
    const spy = vi.spyOn(settings, 'getRuntime');
    expect((await c.orders.get(id)).billing).toEqual({ active: true, providerId: 'fakebill' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('EcommerceInvoiceService.selection', () => {
  it('lists what is left to invoice, the available shipping lines and payments', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    expect(await inv.selection(id)).toEqual({
      lines: [
        {
          orderLineId: lineIdOf(c, id),
          sku: 'SH-M',
          name: 'Shirt',
          option: null,
          tax: 23,
          isGift: false,
          remainingQuantity: 2,
          remainingValue: 4000,
        },
      ],
      shipping: [
        {
          shippingLineId: 1,
          name: expect.any(String),
          tax: 23,
          origin: 'CHECKOUT',
          createdAt: expect.any(String),
          value: 500,
        },
      ],
      payments: [{ paymentId, amount: 4500, refunded: 0, net: 4500 }],
      excess: 0,
      stranded: { products: 0, shipping: 0 },
    });
  });

  it('is empty when the order is not OPEN', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    await c.orders.cancel(id, 'user:1');
    expect(await inv.selection(id)).toMatchObject({
      lines: [],
      shipping: [],
      payments: [],
      stranded: { products: 0, shipping: 0 },
    });
  });
});

describe('EcommerceInvoiceService.issue', () => {
  it('issues a PENDING row with allocations before calling the provider, then ISSUED + history + event', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const lineId = lineIdOf(c, id);
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      // Outside the transaction, the PENDING row and its allocation are committed.
      const row = invoiceRows(c)[0];
      expect(row).toMatchObject({
        status: 'PENDING',
        ourReference: `LB-INV-${row.id}`,
        total: 4500,
      });
      expect(allocations(c)).toEqual([
        expect.objectContaining({
          invoice: row.id,
          amount: 4500,
          coverage: { paymentId, value: 4500 },
          uniqueKey: `payment:${paymentId}`,
        }),
      ]);
      expect(draft).toMatchObject({
        kind: 'INVOICE',
        ourReference: `LB-INV-${row.id}`,
        orderReference: `#${orderRow(c, id).reference}`,
        locale: 'pt',
        total: 4500,
        customer: { name: 'Ana Silva', nif: '123456789', email: 'ana@example.pt' },
      });
      return { ...issued(draft), warnings: ['RECEIPT_FAILED'] };
    });

    const view = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
    expect(view).toMatchObject({
      kind: 'INVOICE',
      status: 'ISSUED',
      provider: 'fakebill',
      number: 'FR 2025/1',
      documentType: 'FR',
      total: 4500,
      paymentIds: [paymentId],
      warnings: ['RECEIPT_FAILED'],
      credited: 0,
      creditedInvoiceId: null,
    });
    const draft: InvoiceDraft = provider.issue.mock.calls[0][0];
    expect(draft.lines).toEqual([
      expect.objectContaining({
        orderLineId: lineId,
        kind: 'ITEM',
        sku: 'SH-M',
        name: 'Shirt',
        quantity: 2,
        total: 4000,
        tax: 23,
        partial: false,
      }),
      expect.objectContaining({
        orderLineId: null,
        kind: 'SHIPPING',
        sku: 'SHIPPING',
        quantity: 1,
        total: 500,
        tax: 23,
        shippingLineId: 1,
      }),
    ]);
    expect(draft.payments).toEqual([{ method: 'MANUAL', amount: 4500, name: '', date: DATE }]);
    const history = c.tables[UIDS.orderHistory].find((h) => h.type === 'INVOICE_ISSUED');
    expect(history.newValue.selection).toEqual({
      lines: [{ orderLineId: lineId, quantity: 2, value: 4000 }],
      shippingLineIds: [1],
      paymentIds: [paymentId],
    });
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toEqual([
      expect.objectContaining({ orderId: id, payload: { invoiceId: view.id, kind: 'INVOICE' } }),
    ]);
    const o = await c.orders.get(id);
    expect(o.invoices).toEqual([expect.objectContaining({ id: view.id, status: 'ISSUED' })]);
    expect(o.payments[0]).not.toHaveProperty('invoice');
    expect(o.invoicing).toEqual({ hasUninvoicedPayments: false });
    expect(o.availableActions).not.toContain('ISSUE_INVOICE');
    expect(o.billing).toEqual({ active: true, providerId: 'fakebill' });
  });

  it('three payments → one invoice', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c, []);
    await pay(c, id, 1500, 'p1', 'MB WAY');
    await pay(c, id, 1500, 'p2');
    await pay(c, id, 1500, 'p3', 'Transferência');
    const view = await testIssueAll(c, id, 'k1');
    expect(view.total).toBe(4500);
    expect(view.paymentIds).toHaveLength(3);
    expect(invoiceRows(c)).toHaveLength(1);
    const draft: InvoiceDraft = provider.issue.mock.calls[0][0];
    expect(draft.payments).toEqual([
      { method: 'MANUAL', amount: 1500, name: 'MB WAY', date: DATE },
      { method: 'MANUAL', amount: 1500, name: '', date: DATE },
      { method: 'MANUAL', amount: 1500, name: 'Transferência', date: DATE },
    ]);
    expect((await inv.selection(id)).payments).toEqual([]);
  });

  it('invoices in parts', async () => {
    const { c, inv } = setup();
    const id = await order(c, [2000, 2500]);
    const [p1, p2] = paymentRows(c, id);
    const lineId = lineIdOf(c, id);
    const first = await inv.issue(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 1 }],
        shippingLineIds: [],
        paymentIds: [p1.id],
        expectedTotal: 2000,
        idempotencyKey: 'k1',
      },
      'user:1'
    );
    expect(first).toMatchObject({ status: 'ISSUED', total: 2000, paymentIds: [p1.id] });

    const left = await inv.selection(id);
    expect(left.lines).toEqual([
      expect.objectContaining({ orderLineId: lineId, remainingQuantity: 1, remainingValue: 2000 }),
    ]);
    expect(left.shipping.map((s: any) => s.shippingLineId)).toEqual([1]);
    expect(left.payments).toEqual([{ paymentId: p2.id, amount: 2500, refunded: 0, net: 2500 }]);
    const second = await testIssueAll(c, id, 'k2');
    expect(second).toMatchObject({ status: 'ISSUED', total: 2500, paymentIds: [p2.id] });
    expect(first.total + second.total).toBe(orderRow(c, id).total);
    expect(await inv.selection(id)).toMatchObject({ lines: [], shipping: [], payments: [] });
  });

  it('a gift line at 0 € is invoiced as a 0 line', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    c.tables[UIDS.orderLine].push({
      id: 900,
      order: id,
      variant: 12,
      variantId: 12,
      productId: 1,
      sku: 'SH-S',
      name: 'Shirt',
      option: 'S',
      imageUrl: null,
      unitPrice: 200,
      unitDiscount: 200,
      manualDiscountPercent: null,
      quantity: 1,
      returnedQuantity: 0,
      tax: 23,
      isGift: true,
      promotionRefs: { refs: [] },
      position: 1,
    });
    const selection = await inv.selection(id);
    expect(selection.lines.find((l: any) => l.orderLineId === 900)).toMatchObject({
      isGift: true,
      remainingQuantity: 1,
      remainingValue: 0,
    });
    const view = await testIssueAll(c, id, 'k1');
    expect(view.total).toBe(4500);
    expect(view.lines).toContainEqual(
      expect.objectContaining({ orderLineId: 900, name: 'Shirt - S', quantity: 1, total: 0, grossTotal: 200 })
    );
  });

  it('a negative shipping line is never offered and lowers the shipping value', async () => {
    const { c, inv } = setup();
    const id = await order(c, []);
    const row = orderRow(c, id);
    const checkout = row.shippingLines.lines[0];
    row.shippingLines = {
      lines: [checkout, { ...checkout, id: 2, origin: 'MANUAL', amount: -200, name: 'Desconto' }],
    };
    row.shippingTotal -= 200;
    row.total -= 200;
    await pay(c, id, 4300, 'p1');
    const selection = await inv.selection(id);
    expect(selection.shipping).toEqual([expect.objectContaining({ shippingLineId: 1, value: 300 })]);
    const view = await testIssueAll(c, id, 'k1');
    expect(view.total).toBe(4300);
    expect(view.lines).toContainEqual(
      expect.objectContaining({ kind: 'SHIPPING', shippingLineId: 1, total: 300, grossTotal: 500 })
    );
  });

  it('totals that differ → INVOICE_TOTALS_DIFFER and nothing is written', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const input = {
      lines: [{ orderLineId: lineIdOf(c, id), quantity: 1 }],
      shippingLineIds: [],
      paymentIds: [paymentId],
      expectedTotal: 2000,
      idempotencyKey: 'k1',
    };
    expect(await codesOf(inv.issue(id, input, 'user:1'))).toEqual(['INVOICE_TOTALS_DIFFER']);
    expect(provider.issue).not.toHaveBeenCalled();
    expect(invoiceRows(c)).toEqual([]);
    expect(allocations(c)).toEqual([]);
  });

  it('expectedTotal stale → TOTAL_CHANGED', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const err: any = await inv
      .issue(id, everything(c, id, [paymentId], 'k1', 4400), 'user:1')
      .catch((e: unknown) => e);
    expect(err.errors).toEqual([{ path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: '4500' }]);
    expect(provider.issue).not.toHaveBeenCalled();
    expect(invoiceRows(c)).toEqual([]);
  });

  it('a quantity above what is left → QUANTITY_EXCEEDS_UNINVOICED', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const input = { ...everything(c, id, [paymentId], 'k1') };
    input.lines = [{ orderLineId: lineIdOf(c, id), quantity: 3 }];
    const err: any = await inv.issue(id, input, 'user:1').catch((e: unknown) => e);
    expect(err.errors).toEqual([{ path: 'lines.0.quantity', code: 'QUANTITY_EXCEEDS_UNINVOICED' }]);
    expect(invoiceRows(c)).toEqual([]);
  });

  it('Review Focus 1: excess refunded as new store credit: the payment is listed at its net and the invoice is the net', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c, [5000]); // 500 over
    const paymentId = paymentRows(c, id)[0].id;
    expect((await inv.selection(id)).excess).toBe(500);
    c.tables[UIDS.refund].push({
      id: 1,
      order: id,
      payment: null,
      method: 'STORE_CREDIT',
      kind: 'STORE_CREDIT',
      status: 'COMPLETED',
      amount: 500,
    });
    const selection = await inv.selection(id);
    expect(selection.excess).toBe(0);
    expect(selection.payments).toEqual([{ paymentId, amount: 5000, refunded: 500, net: 4500 }]);
    const view = await testIssueAll(c, id, 'k1');
    expect(view.total).toBe(4500);
    expect(provider.issue.mock.calls[0][0].payments).toEqual([
      { method: 'MANUAL', amount: 4500, name: '', date: DATE },
    ]);
  });

  it('Review Focus 2: a PROCESSING Stripe refund leaves no blocking excess: the invoice issues at once', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c, []);
    c.tables[UIDS.payment].push({
      id: 801,
      order: id,
      method: 'STRIPE',
      status: 'COMPLETED',
      amount: 5000,
      currency: 'EUR',
      externalId: 'pi_1',
      idempotencyKey: 'stripe:801',
      coverage: null,
      completedAt: '2026-11-01T10:00:00.000Z',
      actor: 'webhook:stripe',
      metadata: null,
    });
    stripe.createRefund.mockResolvedValueOnce({ id: 're_1', status: 'pending' });
    const [refund] = await c.refunds.create(
      id,
      { method: 'STRIPE', amount: 500, reason: 'OTHER', idempotencyKey: 'sr' },
      'user:1'
    );
    expect(refund.status).toBe('PROCESSING');
    const selection = await inv.selection(id);
    expect(selection.excess).toBe(0);
    expect(selection.payments).toEqual([{ paymentId: 801, amount: 5000, refunded: 500, net: 4500 }]);
    const view = await testIssueAll(c, id, 'k1');
    expect(view).toMatchObject({ status: 'ISSUED', total: 4500 });
    expect(provider.issue.mock.calls[0][0].payments).toEqual([
      { method: 'STRIPE', amount: 4500, name: 'Stripe', date: DATE },
    ]);
  });

  it('unrefunded excess → INVOICE_EXCESS_UNRESOLVED, and selection().excess equals it', async () => {
    const { c, inv } = setup();
    const id = await order(c, [5000]);
    const paymentId = paymentRows(c, id)[0].id;
    expect((await inv.selection(id)).excess).toBe(500);
    expect(await codesOf(inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1'))).toEqual([
      'INVOICE_EXCESS_UNRESOLVED',
    ]);
    expect(invoiceRows(c)).toEqual([]);
  });

  it('Review Focus 4: timeout → UNCERTAIN, the payment cannot be invoiced again, reconcile finds it → ISSUED', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );

    const view = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
    expect(view.status).toBe('UNCERTAIN');
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'INVOICE_UNCERTAIN')).toBe(true);
    expect((await c.orders.get(id)).invoicing).toEqual({ hasUninvoicedPayments: false });

    expect(await codesOf(inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1'))).toContain(
      'PAYMENT_NOT_INVOICEABLE'
    );
    expect(provider.issue).toHaveBeenCalledTimes(1);

    provider.findByReference.mockResolvedValueOnce({
      externalId: 'ext-9',
      number: 'FR 2025/9',
      series: '2025',
      documentType: 'FR',
      total: 4500,
      issuedAt: '2025-03-01T10:00:00.000Z',
      warnings: [],
    });
    const done = await inv.reconcile(view.id, {}, 'user:2');
    expect(provider.findByReference).toHaveBeenCalledWith(`LB-INV-${view.id}`, {
      config: { k: 1 },
      secrets: { s: 'x' },
    });
    expect(done).toMatchObject({ status: 'ISSUED', number: 'FR 2025/9' });
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toEqual([
      expect.objectContaining({ payload: { invoiceId: view.id, kind: 'INVOICE' } }),
    ]);
  });

  it('Review Focus 4: UNCERTAIN keeps units, shipping and payment unavailable; markFailed returns all three', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const view = await testIssueAll(c, id, 'k1');
    expect(view.status).toBe('UNCERTAIN');
    expect(await inv.selection(id)).toMatchObject({ lines: [], shipping: [], payments: [] });
    expect((await c.orders.get(id)).availableActions).not.toContain('ISSUE_INVOICE');

    await inv.reconcile(view.id, { markFailed: true }, 'user:2');
    const back = await inv.selection(id);
    expect(back.lines).toEqual([expect.objectContaining({ remainingQuantity: 2, remainingValue: 4000 })]);
    expect(back.shipping).toEqual([expect.objectContaining({ shippingLineId: 1, value: 500 })]);
    expect(back.payments).toEqual([{ paymentId, amount: 4500, refunded: 0, net: 4500 }]);
    expect((await c.orders.get(id)).availableActions).toContain('ISSUE_INVOICE');
  });

  it('Review Focus 4: reconcile with no document → FAILED and the payment is invoiceable again', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const view = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
    expect(view.status).toBe('UNCERTAIN');

    const failed = await inv.reconcile(view.id, {}, 'user:2');
    expect(failed.status).toBe('FAILED');
    expect(allocations(c)[0].uniqueKey).toBeNull();
    expect((await c.orders.get(id)).invoicing).toEqual({ hasUninvoicedPayments: true });
    expect((await inv.selection(id)).payments).toEqual([
      { paymentId, amount: 4500, refunded: 0, net: 4500 },
    ]);

    const again = await inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1');
    expect(again.status).toBe('ISSUED');
  });

  it('a late success after the same units were invoiced with another payment → DUPLICATE_INVOICE, no customer event', async () => {
    const { c, inv, provider } = setup();
    // 1 × 200 (S) + 1 × 2000 (M) + 500 shipping = 2700.
    const id = await create(c, [
      { variantId: 12, quantity: 1 },
      { variantId: 10, quantity: 1 },
    ]);
    await pay(c, id, 200, 'p1');
    await pay(c, id, 2200, 'p2');
    await pay(c, id, 300, 'p3');
    const [p1, p2] = paymentRows(c, id);
    const small = lineIdOf(c, id, 12);
    const medium = lineIdOf(c, id, 10);
    let second: any;
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      const row = invoiceRows(c)[0];
      row.createdAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await inv.reconcile(row.id, { markFailed: true }, 'user:7');
      // The same S unit, now with another payment.
      second = await inv.issue(
        id,
        {
          lines: [
            { orderLineId: small, quantity: 1 },
            { orderLineId: medium, quantity: 1 },
          ],
          shippingLineIds: [],
          paymentIds: [p2.id],
          expectedTotal: 2200,
          idempotencyKey: 'k2',
        },
        'user:1'
      );
      return issued(draft);
    });
    const first = await inv.issue(
      id,
      {
        lines: [{ orderLineId: small, quantity: 1 }],
        shippingLineIds: [],
        paymentIds: [p1.id],
        expectedTotal: 200,
        idempotencyKey: 'k1',
      },
      'user:1'
    );
    expect(second.status).toBe('ISSUED');
    expect(first.status).toBe('ISSUED');
    expect(first.warnings).toEqual(expect.arrayContaining(['ISSUED_AFTER_FAILED', 'DUPLICATE_INVOICE']));
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: second.id, kind: 'INVOICE' },
    ]);
  });

  it('reconcile keeps the state when the provider cannot look up or errors', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const view = await testIssueAll(c, id, 'k1');
    provider.findByReference.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE')
    );
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['BILLING_UNREACHABLE']);
    expect(invoiceRows(c)[0].status).toBe('UNCERTAIN');

    provider.capabilities.findByReference = false;
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['NOT_SUPPORTED']);
    expect(invoiceRows(c)[0].status).toBe('UNCERTAIN');
  });

  it('reconcile markFailed releases the allocations and records the actor; only UNCERTAIN or stale PENDING', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const view = await testIssueAll(c, id, 'k1');
    expect(view.reconcilable).toBe(true);
    const res = await inv.reconcile(view.id, { markFailed: true }, 'user:7');
    expect(res.reconcilable).toBe(false);
    expect(res.status).toBe('FAILED');
    expect(provider.findByReference).not.toHaveBeenCalled();
    expect(allocations(c)[0].uniqueKey).toBeNull();
    const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'INVOICE_FAILED');
    expect(h.at(-1)).toMatchObject({ actor: 'user:7' });

    // ISSUED and FAILED cannot be reconciled.
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);

    // A PENDING row is only reconcilable once the provider's declared maximum (5 min) is over.
    const row = invoiceRows(c)[0];
    row.status = 'PENDING';
    row.createdAt = new Date().toISOString();
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
    row.createdAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
    expect((await c.orders.get(id)).invoices[0].reconcilable).toBe(false);
    row.createdAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect((await c.orders.get(id)).invoices[0].reconcilable).toBe(true);
    expect((await inv.reconcile(view.id, {}, 'user:1')).status).toBe('FAILED');
  });

  it('a provider without a declared maximum: PENDING is stale after 10 minutes', async () => {
    const { c, inv, provider } = setup();
    delete (provider as any).maxIssueDurationMs;
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    const row = invoiceRows(c)[0];
    row.status = 'PENDING';
    row.createdAt = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
    row.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect((await inv.reconcile(view.id, {}, 'user:1')).status).toBe('FAILED');
  });

  it('a definitive error → no document kept, the error reaches the caller, the history remembers it and the payment is invoiceable again', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(new EcommerceBillingError('BILLING_TAX_NOT_FOUND'));
    expect(await codesOf(inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1'))).toEqual([
      'BILLING_TAX_NOT_FOUND',
    ]);
    expect(invoiceRows(c)).toEqual([]);
    expect(allocations(c)).toEqual([]);
    expect(c.tables[UIDS.orderHistory].find((h) => h.type === 'INVOICE_FAILED')).toMatchObject({
      newValue: { kind: 'INVOICE', error: 'BILLING_TAX_NOT_FOUND' },
    });
    const o = await c.orders.get(id);
    expect(o.invoicing).toEqual({ hasUninvoicedPayments: true });
    expect((await inv.selection(id)).payments).toEqual([
      { paymentId, amount: 4500, refunded: 0, net: 4500 },
    ]);
    expect(o.availableActions).toContain('ISSUE_INVOICE');
    expect(o.invoices).toEqual([]);
  });

  it('a refusal reaches the caller with the provider message, which the history keeps; the next try is new', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_REQUEST_FAILED', 'Moloni rejected documents/insert (vat:2).')
    );
    const err: any = await inv
      .issue(id, everything(c, id, [paymentId], 'k1'), 'user:1')
      .catch((e: unknown) => e);
    expect(err.message).toBe('Moloni rejected documents/insert (vat:2).');
    expect((await c.orders.get(id)).invoices).toEqual([]);
    expect(c.tables[UIDS.orderHistory].find((h) => h.type === 'INVOICE_FAILED')?.newValue).toEqual({
      kind: 'INVOICE',
      error: 'BILLING_REQUEST_FAILED',
      detail: 'Moloni rejected documents/insert (vat:2).',
    });

    const done = await inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1');
    expect(done).toMatchObject({ status: 'ISSUED', errorDetail: null });
  });

  it('an unexpected error keeps its class and message as the detail of the UNCERTAIN row', async () => {
    const { c, provider } = setup();
    const id = await order(c);
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const view = await testIssueAll(c, id, 'k1');
    expect(view).toMatchObject({ status: 'UNCERTAIN', errorDetail: 'Error: socket hang up' });
  });

  it('prices the selection and writes the PENDING row under the order lock, inside one transaction', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const log: string[] = [];
    const ordersSvc = c.services.EcommerceOrderService;
    const { lockOrder, computeOrderState } = ordersSvc;
    ordersSvc.lockOrder = async (orderId: number) => {
      log.push('lock');
      return lockOrder(orderId);
    };
    ordersSvc.computeOrderState = async (orderId: number) => {
      log.push('state');
      return computeOrderState(orderId);
    };
    const transaction = c.strapi.db.transaction;
    c.strapi.db.transaction = async (cb: any) => {
      log.push('begin');
      const out = await transaction(cb);
      log.push(`commit rows=${invoiceRows(c).length} allocations=${allocations(c).length}`);
      return out;
    };
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      log.push('provider');
      return issued(draft);
    });

    await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
    // Two invoices cannot take the same units or shipping lines: only payments have a unique
    // index, so the position is read and the row written while the order is locked.
    expect(log.slice(0, log.indexOf('provider'))).toEqual([
      'begin',
      'lock',
      'state',
      'commit rows=1 allocations=1',
    ]);
  });

  it('a cancelled order refuses new invoices', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    await c.orders.cancel(id, 'user:1');
    expect(await codesOf(inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    expect(invoiceRows(c)).toEqual([]);
  });

  it('a payment that is not COMPLETED or does not belong to the order → PAYMENT_NOT_INVOICEABLE', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const err: any = await inv
      .issue(id, everything(c, id, [999], 'k1'), 'user:1')
      .catch((e: unknown) => e);
    expect(err.errors).toEqual([{ path: 'paymentIds.0', code: 'PAYMENT_NOT_INVOICEABLE' }]);
    expect(invoiceRows(c)).toHaveLength(0);
  });

  it('repeating issue with the same idempotencyKey returns the same invoice and calls the provider once', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const a = await inv.issue(id, everything(c, id, [paymentId], 'same'), 'user:1');
    const b = await inv.issue(id, everything(c, id, [paymentId], 'same'), 'user:1');
    expect(b.id).toBe(a.id);
    expect(provider.issue).toHaveBeenCalledTimes(1);
    expect(invoiceRows(c)).toHaveLength(1);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toHaveLength(1);
  });

  it('a refunded payment is invoiced net of its refunds', async () => {
    const { c, inv } = setup();
    const id = await order(c, [5000]); // 500 over
    const paymentId = paymentRows(c, id)[0].id;
    c.tables[UIDS.refund].push({
      id: 1,
      order: id,
      payment: paymentId,
      method: 'MANUAL_TRANSFER',
      kind: 'MONEY',
      status: 'COMPLETED',
      amount: 500,
    });
    expect((await inv.selection(id)).payments).toEqual([
      { paymentId, amount: 5000, refunded: 500, net: 4500 },
    ]);
    expect((await testIssueAll(c, id, 'k1')).total).toBe(4500);
  });

  it('logs and falls back to UTC on an invalid store time zone', async () => {
    const { c, provider } = setup();
    c.services.EcommerceSettingsService.getStoreSettings = async () => ({
      markets: ['PT'],
      timezone: 'Mars/Olympus',
    });
    const id = await order(c);
    await testIssueAll(c, id, 'k1');
    expect(c.log.warn).toHaveBeenCalledWith(expect.stringContaining('time zone'));
    expect(provider.issue.mock.calls[0][0].date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('EcommerceInvoiceService: a late provider success after the row was made FAILED', () => {
  const STALE = () => new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const paths: [string, (inv: any, id: number) => Promise<unknown>][] = [
    ['markFailed', (inv, id) => inv.reconcile(id, { markFailed: true }, 'user:7')],
    ['reconcile with no document found', (inv, id) => inv.reconcile(id, {}, 'user:7')],
  ];

  for (const [name, failIt] of paths) {
    it(`${name}: recorded ISSUED, allocation re-claimed, payment not invoiceable`, async () => {
      const { c, inv, provider } = setup();
      const id = await order(c);
      const paymentId = paymentRows(c, id)[0].id;
      provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
        // The admin acts while the provider is still working.
        const row = invoiceRows(c)[0];
        row.createdAt = STALE();
        expect(((await failIt(inv, row.id)) as any).status).toBe('FAILED');
        expect(allocations(c)[0].uniqueKey).toBeNull();
        return issued(draft);
      });
      const view = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
      expect(view.status).toBe('ISSUED');
      expect(view.warnings).toContain('ISSUED_AFTER_FAILED');
      expect(view.warnings).not.toContain('DUPLICATE_INVOICE');
      expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
      expect((await c.orders.get(id)).invoicing).toEqual({ hasUninvoicedPayments: false });
      expect((await inv.selection(id)).payments).toEqual([]);
      expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toEqual([
        expect.objectContaining({ payload: { invoiceId: view.id, kind: 'INVOICE' } }),
      ]);
      const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'INVOICE_ISSUED');
      expect(h.at(-1).newValue.warnings).toContain('ISSUED_AFTER_FAILED');
    });

    it(`${name}: the payment was re-invoiced meanwhile → DUPLICATE_INVOICE, no customer event`, async () => {
      const { c, inv, provider } = setup();
      const id = await order(c);
      const paymentId = paymentRows(c, id)[0].id;
      let second: any;
      provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
        const row = invoiceRows(c)[0];
        row.createdAt = STALE();
        await failIt(inv, row.id);
        second = await inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1');
        return issued(draft);
      });
      const first = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
      expect(first.status).toBe('ISSUED');
      expect(first.warnings).toEqual(
        expect.arrayContaining(['ISSUED_AFTER_FAILED', 'DUPLICATE_INVOICE'])
      );
      const byInvoice = (invoiceId: number) =>
        allocations(c).find((a) => a.invoice === invoiceId).uniqueKey;
      expect(byInvoice(first.id)).toBeNull();
      expect(byInvoice(second.id)).toBe(`payment:${paymentId}`);
      expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
        { invoiceId: second.id, kind: 'INVOICE' },
      ]);
      expect(c.log.warn).toHaveBeenCalledWith(expect.stringContaining('DUPLICATE_INVOICE'));
      const h = c.tables[UIDS.orderHistory].filter((x) => x.type === 'INVOICE_ISSUED');
      expect(h.some((x) => x.newValue.warnings?.includes('DUPLICATE_INVOICE'))).toBe(true);
    });
  }

  it('the payment was refunded meanwhile (its net is below the allocation) → DUPLICATE_INVOICE, no customer event', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      const row = invoiceRows(c)[0];
      row.createdAt = STALE();
      await inv.reconcile(row.id, { markFailed: true }, 'user:7');
      c.tables[UIDS.refund].push({
        id: 1,
        order: id,
        payment: paymentId,
        method: 'MANUAL_TRANSFER',
        kind: 'MONEY',
        status: 'COMPLETED',
        amount: 500,
      });
      return issued(draft);
    });
    const first = await inv.issue(id, everything(c, id, [paymentId], 'k1'), 'user:1');
    expect(first.status).toBe('ISSUED');
    expect(first.warnings).toEqual(expect.arrayContaining(['ISSUED_AFTER_FAILED', 'DUPLICATE_INVOICE']));
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toEqual([]);
  });
});

describe('EcommerceInvoiceService.getPdf', () => {
  it('works with the provider deactivated; filename sanitized; not ISSUED → error', async () => {
    const { c, inv, provider, active, runtimes } = setup();
    const id = await order(c);
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => ({
      ...issued(draft),
      number: 'FR 2025/1',
    }));
    const view = await testIssueAll(c, id, 'k1');
    active.length = 0;
    runtimes.fakebill = { ...runtimes.fakebill, active: false };
    const pdf = await inv.getPdf(view.id);
    expect(pdf.filename).toBe('FR_2025_1.pdf');
    expect(pdf.content.toString()).toContain('%PDF');
    expect(provider.getPdf).toHaveBeenCalledWith('ext-1', {
      config: { k: 1 },
      secrets: { s: 'x' },
    });

    provider.getPdf.mockRejectedValueOnce(new EcommerceBillingError('BILLING_REQUEST_FAILED'));
    expect(await codesOf(inv.getPdf(view.id))).toEqual(['INVOICE_PDF_UNAVAILABLE']);

    invoiceRows(c)[0].status = 'UNCERTAIN';
    await expect(inv.getPdf(view.id)).rejects.toBeInstanceOf(Error);
  });
});

describe('EcommerceInvoiceService credit notes', () => {
  /** Ships every unit of the 2 × 2000 line, then registers the return of `quantity` of them. */
  const returnUnits = async (c: Commerce, id: number, quantity = 1) => {
    const lineId = lineIdOf(c, id);
    await c.services.EcommerceShipmentService.create(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 2 }],
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: `s-${id}`,
      },
      'user:1'
    );
    await c.services.EcommerceReturnService.register(
      id,
      {
        lines: [{ orderLineId: lineId, quantity, restock: false }],
        reason: 'Damaged',
        idempotencyKey: `r-${id}`,
      },
      'user:1'
    );
  };
  const correction = (key: string, reason = 'Wrong data') => ({
    creditType: 'CORRECTION',
    reason,
    idempotencyKey: key,
  });
  const creditNoteRow = (c: Commerce, cnId: number) => invoiceRows(c).find((r) => r.id === cnId);
  const creditHistory = (c: Commerce) =>
    c.tables[UIDS.orderHistory].filter((h) => h.type === 'CREDIT_NOTE_ISSUED');

  it('RETURN credits returned units at their invoiced value', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const lineId = lineIdOf(c, id);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);

    const preview = await inv.creditNotePreview(view.id);
    expect(preview.creditable).toEqual([4000, 500]);
    expect(preview.returnable).toEqual([{ index: 0, units: 1, unitsLeft: 2, valueLeft: 4000 }]);
    expect(preview.shipping).toEqual([{ index: 1, value: 500 }]);
    expect(preview.correction.total).toBe(4500);

    const cn = await inv.issueCreditNote(
      view.id,
      {
        creditType: 'RETURN',
        lines: [{ index: 0, quantity: 1 }],
        reason: 'Returned',
        idempotencyKey: 'cn1',
      },
      'user:1'
    );
    expect(cn).toMatchObject({ kind: 'CREDIT_NOTE', status: 'ISSUED', total: 2000 });
    const draft: InvoiceDraft = provider.issue.mock.calls[1][0];
    expect(draft).toMatchObject({ kind: 'CREDIT_NOTE', payments: [], total: 2000 });
    expect(draft.lines).toEqual([
      expect.objectContaining({ orderLineId: lineId, kind: 'ITEM', quantity: 1, total: 2000, partial: false }),
    ]);
    expect(creditNoteRow(c, cn.id).metadata).toMatchObject({
      locale: 'pt',
      reason: 'Returned',
      creditType: 'RETURN',
      creditedLines: [{ index: 0, value: 2000, quantity: 1 }],
    });
    expect(creditNoteRow(c, cn.id).metadata).not.toHaveProperty('returnIds');
    expect(creditHistory(c)[0].newValue).toMatchObject({ creditType: 'RETURN', creditedInvoiceId: view.id });
    expect((await inv.selection(id)).lines).toEqual([]);
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
    expect((await inv.creditNotePreview(view.id)).returnable).toEqual([
      { index: 0, units: 0, unitsLeft: 1, valueLeft: 2000 },
    ]);
  });

  it('RETURN can add the invoice shipping line; it stays invoiced', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);

    const cn = await inv.issueCreditNote(
      view.id,
      {
        creditType: 'RETURN',
        lines: [{ index: 0, quantity: 1 }],
        shippingIndexes: [1],
        reason: 'Returned',
        idempotencyKey: 'cn1',
      },
      'user:1'
    );
    expect(cn).toMatchObject({ status: 'ISSUED', total: 2500 });
    expect(provider.issue.mock.calls[1][0].lines).toEqual([
      expect.objectContaining({ kind: 'ITEM', quantity: 1, total: 2000 }),
      expect.objectContaining({ kind: 'SHIPPING', quantity: 1, total: 500, shippingLineId: 1 }),
    ]);
    // Its value has no line left to carry it: stranded, shown by the modal, never selectable.
    expect(await inv.selection(id)).toMatchObject({ shipping: [], stranded: { products: 0, shipping: 500 } });
    expect((await inv.creditNotePreview(view.id)).shipping).toEqual([]);
    const order1 = await c.orders.get(id);
    expect(order1.shippingLines.find((l: any) => l.id === 1).invoiced).toBe(true);
  });

  it('CORRECTION annuls the invoice: once ISSUED, products, shipping and payments are available again; the same payment invoices the correct invoice', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const view = await testIssueAll(c, id, 'k1');
    expect((await inv.creditNotePreview(view.id)).correction).toEqual({
      lines: [
        expect.objectContaining({ kind: 'ITEM', quantity: 2, total: 4000, partial: false }),
        expect.objectContaining({ kind: 'SHIPPING', quantity: 1, total: 500, partial: false }),
      ],
      total: 4500,
    });

    const cn = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    expect(cn).toMatchObject({ status: 'ISSUED', total: 4500, creditedInvoiceId: view.id });
    expect(provider.issue.mock.calls[1][0].lines).toEqual([
      expect.objectContaining({ kind: 'ITEM', quantity: 2, total: 4000, partial: false }),
      expect.objectContaining({ kind: 'SHIPPING', quantity: 1, total: 500 }),
    ]);
    expect(creditNoteRow(c, cn.id).metadata).toMatchObject({
      creditType: 'CORRECTION',
      creditedLines: [
        { index: 0, value: 4000, quantity: 2 },
        { index: 1, value: 500, quantity: 1 },
      ],
    });
    expect(creditHistory(c)[0].newValue).toMatchObject({ creditType: 'CORRECTION' });
    expect(allocations(c)[0].uniqueKey).toBeNull();
    const back = await inv.selection(id);
    expect(back.lines).toEqual([expect.objectContaining({ remainingQuantity: 2, remainingValue: 4000 })]);
    expect(back.shipping).toEqual([expect.objectContaining({ shippingLineId: 1, value: 500 })]);
    expect(back.payments).toEqual([{ paymentId, amount: 4500, refunded: 0, net: 4500 }]);
    expect((await c.orders.get(id)).availableActions).toContain('ISSUE_INVOICE');

    const again = await inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1');
    expect(again).toMatchObject({ status: 'ISSUED', total: 4500, paymentIds: [paymentId] });
  });

  it('a CORRECTION that ends UNCERTAIN keeps everything invoiced; reconcile found → released then', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const view = await testIssueAll(c, id, 'k1');
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const cn = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    expect(cn.status).toBe('UNCERTAIN');
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
    expect(await inv.selection(id)).toMatchObject({ lines: [], shipping: [], payments: [] });

    provider.findByReference.mockResolvedValueOnce(issued({ kind: 'CREDIT_NOTE', total: 4500 } as any));
    expect((await inv.reconcile(cn.id, {}, 'user:1')).status).toBe('ISSUED');
    expect(allocations(c)[0].uniqueKey).toBeNull();
    expect((await inv.selection(id)).payments).toEqual([
      { paymentId, amount: 4500, refunded: 0, net: 4500 },
    ]);
  });

  it('CORRECTION after a RETURN credit credits only what is left; the returned unit is not offered again', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);
    await inv.issueCreditNote(
      view.id,
      { creditType: 'RETURN', lines: [{ index: 0, quantity: 1 }], reason: 'Returned', idempotencyKey: 'cn1' },
      'user:1'
    );
    expect(
      await codesOf(
        inv.issueCreditNote(
          view.id,
          { creditType: 'RETURN', lines: [{ index: 0, quantity: 1 }], reason: 'Again', idempotencyKey: 'cn2' },
          'user:1'
        )
      )
    ).toEqual(['QUANTITY_EXCEEDS_CREDITABLE']);

    const cn = await inv.issueCreditNote(view.id, correction('cn3'), 'user:1');
    expect(cn).toMatchObject({ status: 'ISSUED', total: 2500 });
    expect(provider.issue.mock.calls.at(-1)![0].lines).toEqual([
      expect.objectContaining({ kind: 'ITEM', quantity: 1, total: 2000 }),
      expect.objectContaining({ kind: 'SHIPPING', total: 500 }),
    ]);
    // Annulled: the order's one kept unit (2 − 1 returned) is invoiceable again, never the returned one.
    expect((await inv.selection(id)).lines).toEqual([
      expect.objectContaining({ remainingQuantity: 1, remainingValue: 2000 }),
    ]);
  });

  it('refuses a RETURN above the returnable units, an empty RETURN and a CORRECTION with lines; nothing is written', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    const errorsOf = async (input: any) =>
      ((await inv.issueCreditNote(view.id, input, 'user:1').catch((e: unknown) => e)) as any).errors;
    const base = { reason: 'x', idempotencyKey: 'cn1' };

    expect(await errorsOf({ ...base, creditType: 'RETURN', lines: [{ index: 0, quantity: 1 }] })).toEqual([
      { path: 'lines.0.quantity', code: 'QUANTITY_EXCEEDS_CREDITABLE' },
    ]);
    expect(await errorsOf({ ...base, creditType: 'RETURN' })).toEqual([{ path: 'lines', code: 'required' }]);
    expect(
      await errorsOf({ ...base, creditType: 'CORRECTION', lines: [{ index: 0, quantity: 1 }] })
    ).toEqual([{ path: 'lines', code: 'invalid' }]);
    expect(await errorsOf({ ...base, creditType: 'OTHER' })).toEqual([{ path: 'creditType', code: 'invalid' }]);
    expect(await errorsOf({ ...correction('cn1'), reason: '  ' })).toEqual([{ path: 'reason', code: 'required' }]);
    expect(invoiceRows(c)).toHaveLength(1);
    expect(allocations(c).every((a) => a.uniqueKey !== null)).toBe(true);
  });

  it('the draft reuses the original customerData and locale, payments [] and the original', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    // The billing address changes later: the credit note keeps the invoiced customer.
    orderRow(c, id).billingAddress = { ...address, firstName: 'Other', nif: '999' };
    orderRow(c, id).locale = 'en';

    const cn = await inv.issueCreditNote(view.id, correction('cn1', 'Damaged'), 'user:1');
    const draft: InvoiceDraft = provider.issue.mock.calls[1][0];
    expect(draft).toMatchObject({
      kind: 'CREDIT_NOTE',
      ourReference: `LB-INV-${cn.id}`,
      locale: 'pt',
      customer: { name: 'Ana Silva', nif: '123456789' },
      payments: [],
      original: { externalId: 'ext-1', total: 4500 },
      reason: 'Damaged',
      total: 4500,
    });
    expect(cn).toMatchObject({ status: 'ISSUED', kind: 'CREDIT_NOTE', creditedInvoiceId: view.id });
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: view.id, kind: 'INVOICE' },
      { invoiceId: cn.id, kind: 'CREDIT_NOTE' },
    ]);
    const list = await inv.listForOrder(id);
    expect(list.find((v: any) => v.id === view.id).credited).toBe(4500);
    const preview = await inv.creditNotePreview(view.id);
    expect(preview.creditable).toEqual([0, 0]);
    expect(preview.correction).toEqual({ lines: [], total: 0 });
  });

  it('repeating issueCreditNote with the same key returns the same credit note and calls the provider once', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    const a = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    const b = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    expect(b.id).toBe(a.id);
    expect(provider.issue).toHaveBeenCalledTimes(2);
  });

  it('credit note on an invoice that is not ISSUED → ACTION_NOT_AVAILABLE; provider without creditNotes → NOT_SUPPORTED', async () => {
    const { c, inv, provider } = setup({ caps: { creditNotes: false, findByReference: true } });
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    expect(await codesOf(inv.issueCreditNote(view.id, correction('cn1'), 'user:1'))).toEqual([
      'NOT_SUPPORTED',
    ]);
    provider.capabilities.creditNotes = true;
    invoiceRows(c)[0].status = 'UNCERTAIN';
    expect(await codesOf(inv.issueCreditNote(view.id, correction('cn1'), 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
  });

  it('reconcile of a credit note found → INVOICE_ISSUED with kind CREDIT_NOTE', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const cn = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    expect(cn.status).toBe('UNCERTAIN');
    // An uncertain credit note already counts against the creditable value.
    expect((await inv.creditNotePreview(view.id)).creditable).toEqual([0, 0]);

    provider.findByReference.mockResolvedValueOnce({
      ...issued({ kind: 'CREDIT_NOTE', total: 4500 } as any),
    });
    const done = await inv.reconcile(cn.id, {}, 'user:1');
    expect(done.status).toBe('ISSUED');
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').at(-1).payload).toEqual({
      invoiceId: cn.id,
      kind: 'CREDIT_NOTE',
    });
    expect(creditHistory(c)).toHaveLength(1);
  });

  const STALE = () => new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const ret = (key: string) => ({
    creditType: 'RETURN',
    lines: [{ index: 0, quantity: 1 }],
    reason: 'Returned',
    idempotencyKey: key,
  });
  /** Marks the PENDING credit note FAILED while the provider is still working on it. */
  const failPendingCreditNote = async (c: Commerce, inv: any) => {
    const row = invoiceRows(c).find((r) => r.kind === 'CREDIT_NOTE' && r.status === 'PENDING');
    row.createdAt = STALE();
    await inv.reconcile(row.id, { markFailed: true }, 'user:7');
  };

  it('a late RETURN after the same returned unit was credited again → DUPLICATE_CREDIT_NOTE, no customer event', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);
    let second: any;
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      await failPendingCreditNote(c, inv);
      second = await inv.issueCreditNote(view.id, ret('cn2'), 'user:1');
      return issued(draft);
    });
    const first = await inv.issueCreditNote(view.id, ret('cn1'), 'user:1');
    expect(second.status).toBe('ISSUED');
    expect(first.status).toBe('ISSUED');
    expect(first.warnings).toEqual(
      expect.arrayContaining(['ISSUED_AFTER_FAILED', 'DUPLICATE_CREDIT_NOTE'])
    );
    expect(first.warnings).not.toContain('DUPLICATE_INVOICE');
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: view.id, kind: 'INVOICE' },
      { invoiceId: second.id, kind: 'CREDIT_NOTE' },
    ]);
    const late = creditHistory(c).find((h) => h.newValue.invoiceId === first.id);
    expect(late.description).toMatch(/corrective invoice/);
    expect(late.newValue.warnings).toContain('DUPLICATE_CREDIT_NOTE');
  });

  it('a late RETURN with nothing credited meanwhile is not a duplicate', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      await failPendingCreditNote(c, inv);
      return issued(draft);
    });
    const first = await inv.issueCreditNote(view.id, ret('cn1'), 'user:1');
    expect(first.warnings).toEqual(['ISSUED_AFTER_FAILED']);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: view.id, kind: 'INVOICE' },
      { invoiceId: first.id, kind: 'CREDIT_NOTE' },
    ]);
  });

  it('a late CORRECTION after another CORRECTION → DUPLICATE_CREDIT_NOTE; the re-invoiced payment stays claimed', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const view = await testIssueAll(c, id, 'k1');
    let second: any;
    let reinvoice: any;
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      await failPendingCreditNote(c, inv);
      second = await inv.issueCreditNote(view.id, correction('cn2'), 'user:1');
      reinvoice = await inv.issue(id, everything(c, id, [paymentId], 'k2'), 'user:1');
      return issued(draft);
    });
    const first = await inv.issueCreditNote(view.id, correction('cn1'), 'user:1');
    expect(second.status).toBe('ISSUED');
    expect(reinvoice.status).toBe('ISSUED');
    expect(first.status).toBe('ISSUED');
    expect(first.warnings).toEqual(
      expect.arrayContaining(['ISSUED_AFTER_FAILED', 'DUPLICATE_CREDIT_NOTE'])
    );
    const byInvoice = (invoiceId: number) =>
      allocations(c).find((a) => a.invoice === invoiceId).uniqueKey;
    expect(byInvoice(view.id)).toBeNull();
    expect(byInvoice(reinvoice.id)).toBe(`payment:${paymentId}`);
    expect((await inv.selection(id)).payments).toEqual([]);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: view.id, kind: 'INVOICE' },
      { invoiceId: second.id, kind: 'CREDIT_NOTE' },
      { invoiceId: reinvoice.id, kind: 'INVOICE' },
    ]);
  });

  it('a CORRECTION that ends FAILED keeps the original invoice and its payments claimed', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    const view = await testIssueAll(c, id, 'k1');
    provider.issue.mockRejectedValueOnce(new EcommerceBillingError('BILLING_REQUEST_FAILED'));
    expect(await codesOf(inv.issueCreditNote(view.id, correction('cn1'), 'user:1'))).toEqual([
      'BILLING_REQUEST_FAILED',
    ]);
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);

    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const cn = await inv.issueCreditNote(view.id, correction('cn2'), 'user:1');
    expect(cn.status).toBe('UNCERTAIN');
    expect((await inv.reconcile(cn.id, { markFailed: true }, 'user:1')).status).toBe('FAILED');
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
    expect(await inv.selection(id)).toMatchObject({ lines: [], shipping: [], payments: [] });
    expect((await inv.creditNotePreview(view.id)).correction.total).toBe(4500);
  });

  it('a CORRECTION while another credit note on the invoice is unconfirmed → CREDIT_NOTE_IN_PROGRESS', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await returnUnits(c, id);
    expect((await inv.creditNotePreview(view.id)).correctionBlocked).toBe(false);
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const pending = await inv.issueCreditNote(view.id, ret('cn1'), 'user:1');
    expect(pending.status).toBe('UNCERTAIN');

    expect((await inv.creditNotePreview(view.id)).correctionBlocked).toBe(true);
    const err: any = await inv.issueCreditNote(view.id, correction('cn2'), 'user:1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'creditType', code: 'CREDIT_NOTE_IN_PROGRESS' }]);
    expect(invoiceRows(c)).toHaveLength(2);

    await inv.reconcile(pending.id, { markFailed: true }, 'user:1');
    expect((await inv.creditNotePreview(view.id)).correctionBlocked).toBe(false);
    const cn = await inv.issueCreditNote(view.id, correction('cn3'), 'user:1');
    expect(cn).toMatchObject({ status: 'ISSUED', total: 4500 });
  });

  it('a cancelled order allows a CORRECTION credit note', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const view = await testIssueAll(c, id, 'k1');
    await c.orders.cancel(id, 'user:1');
    const cn = await inv.issueCreditNote(view.id, correction('cn1', 'Cancelled'), 'user:1');
    expect(cn).toMatchObject({
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      total: 4500,
      creditedInvoiceId: view.id,
    });
    expect(allocations(c)[0].uniqueKey).toBeNull();
  });
});

describe('billingErrorDetail', () => {
  it('is null when the message only repeats the code', () => {
    expect(billingErrorDetail(new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true))).toBeNull();
    expect(billingErrorDetail('nope')).toBeNull();
  });

  it('caps a long message', () => {
    const detail = billingErrorDetail(new EcommerceBillingError('BILLING_REQUEST_FAILED', 'x'.repeat(5000)));
    expect(detail).toHaveLength(1000);
    expect(detail?.endsWith('…')).toBe(true);
  });
});
