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

/**
 * Plan 15, Task 7 (owner decision, option a): an INVOICED refund is built from chosen invoiced
 * elements, and its amount is their sum.
 */

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
const fakeProvider = () => {
  const p = {
    id: 'fakebill',
    capabilities: { creditNotes: true, findByReference: true },
    maxIssueDurationMs: 5 * 60 * 1000,
    issue: vi.fn(async (draft: InvoiceDraft) => {
      docSeq += 1;
      return {
        externalId: `ext-${docSeq}`,
        number: draft.kind === 'CREDIT_NOTE' ? `NC 2026/${docSeq}` : `FR 2026/${docSeq}`,
        series: '2026',
        documentType: draft.kind === 'CREDIT_NOTE' ? 'NC' : 'FR',
        total: draft.total,
        issuedAt: '2026-11-17T10:00:00.000Z',
        warnings: [] as string[],
      };
    }),
    getDocument: vi.fn(),
    getPdf: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
    findByReference: vi.fn(async () => null),
  };
  return p as typeof p & BillingProvider;
};

function setup() {
  const c = setupCommerce();
  const provider = fakeProvider();
  registerBillingProvider(provider);
  const settings = c.services.EcommerceSettingsService;
  settings.getActiveProviders = async (category: string) => (category === 'billing' ? ['fakebill'] : []);
  const baseRuntime = settings.getRuntime;
  settings.getRuntime = async (id: string) =>
    id === 'fakebill' ? { config: {}, secrets: {}, active: true } : baseRuntime(id);
  settings.getStoreSettings = async () => ({ markets: ['PT'], timezone: 'Europe/Lisbon' });
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  return { c, inv: c.services.EcommerceInvoiceService, provider };
}

const actor = 'user:1';
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const lineIdOf = (c: Commerce, id: number) =>
  c.tables[UIDS.orderLine].find((l) => l.order === id && l.variantId === 10).id as number;
const paymentRows = (c: Commerce, id: number) =>
  c.tables[UIDS.payment].filter((p) => p.order === id).sort((a, b) => a.id - b.id);
const refundRow = (c: Commerce, id: number) => c.tables[UIDS.refund].find((r) => r.id === id);

const issuesOf = async (p: Promise<unknown>): Promise<{ path: string; code: string }[]> => {
  const err: any = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e
  );
  if (err instanceof EcommerceValidationError) return err.errors.map((e: any) => ({ path: e.path, code: e.code }));
  if (err instanceof EcommerceBillingError) return [{ path: '', code: err.code }];
  throw err;
};
const codesOf = async (p: Promise<unknown>) => (await issuesOf(p)).map((i) => i.code);

const newOrder = async (c: Commerce, quantity = 2) => {
  const o = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'pt',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor, source: 'admin' }
  );
  return o.id as number;
};

/** 2 × 2000 + 500 = 4500, paid 4000 + 500: invoice A holds the line (4000), invoice B the shipping. */
const twoInvoices = async () => {
  const s = setup();
  const { c, inv } = s;
  const id = await newOrder(c);
  await c.payments.addManualPayment(id, { amount: 4000, idempotencyKey: 'p1' }, actor);
  await c.payments.addManualPayment(id, { amount: 500, idempotencyKey: 'p2' }, actor);
  const [p1] = paymentRows(c, id);
  const a = await inv.issue(
    id,
    {
      orderLineIds: [lineIdOf(c, id)],
      shippingLineIds: [],
      discountIds: [],
      paymentIds: [p1.id],
      expectedTotal: 4000,
      idempotencyKey: 'inv-a',
    },
    actor
  );
  const b = await testIssueAll(c, id, 'inv-b');
  return { ...s, id, a, b };
};

/** An ISSUED invoice row of the fake provider, seeded directly. */
const seedInvoice = (c: Commerce, orderId: number, id: number, lines: any[]) => {
  c.tables[UIDS.invoice].push({
    id,
    order: orderId,
    provider: 'fakebill',
    kind: 'INVOICE',
    status: 'ISSUED',
    creditedInvoice: null,
    number: `FR 2026/${id}`,
    externalId: `ext-inv-${id}`,
    total: lines.reduce((s, l) => s + l.total, 0),
    lines: { lines },
    metadata: null,
  });
};

const create = (c: Commerce, id: number, items: any[], extra: Record<string, unknown> = {}) =>
  c.refunds.create(
    id,
    {
      method: 'MANUAL_TRANSFER',
      scope: 'INVOICED',
      items,
      reason: 'GOODWILL',
      description: 'Lost in transit',
      idempotencyKey: `ref-${JSON.stringify(items)}`,
      ...extra,
    } as any,
    actor
  );

beforeEach(() => {
  __resetEventHandlersForTests();
  __resetBillingProvidersForTests();
  stripe.createRefund.mockReset();
  docSeq = 0;
});

describe('INVOICED refund create from items', () => {
  it('stores metadata.items with their values; the amount is their sum', async () => {
    const { c, id, a, b } = await twoInvoices();
    const [r] = await create(c, id, [
      { invoiceId: a.id, index: 0, quantity: 1 },
      { invoiceId: b.id, index: 0, quantity: 1 },
    ]);
    const items = [
      { invoiceId: a.id, index: 0, quantity: 1, value: 2000 },
      { invoiceId: b.id, index: 0, quantity: 1, value: 500 },
    ];
    expect(r).toMatchObject({ scope: 'INVOICED', status: 'COMPLETED', amount: 2500, items });
    expect(refundRow(c, r.id)).toMatchObject({ amount: 2500, metadata: { items } });
    expect(orderRow(c, id).total).toBe(2000);
    expect((await c.refunds.list(id))[0].items).toEqual(items);
  });

  it('a client amount equal to the sum is accepted; one that differs is REFUND_AMOUNT_DIFFERS', async () => {
    const { c, id, a } = await twoInvoices();
    const item = { invoiceId: a.id, index: 0, quantity: 1 };
    expect(await codesOf(create(c, id, [item], { amount: 1999 }))).toEqual(['REFUND_AMOUNT_DIFFERS']);
    expect(c.tables[UIDS.refund]).toHaveLength(0);
    const [r] = await create(c, id, [item], { amount: 2000 });
    expect(r.amount).toBe(2000);
  });

  it('refuses empty items, unknown elements, a DISCOUNT record, partial shipping, too many units and duplicates', async () => {
    const { c, id, a, b } = await twoInvoices();
    // A DISCOUNT record on invoice A (index 1): never an element.
    const rowA = c.tables[UIDS.invoice].find((r) => r.id === a.id);
    rowA.lines.lines.push({ orderLineId: null, kind: 'DISCOUNT', sku: '', name: 'Promo', quantity: 1, total: -100, tax: 23, partial: false });
    expect(await issuesOf(create(c, id, []))).toEqual([{ path: 'items', code: 'REFUND_ITEMS_INVALID' }]);
    expect(await issuesOf(create(c, id, undefined as any))).toEqual([{ path: 'items', code: 'REFUND_ITEMS_INVALID' }]);
    expect(await issuesOf(create(c, id, [{ invoiceId: 999, index: 0, quantity: 1 }]))).toEqual([
      { path: 'items.0', code: 'REFUND_ITEMS_INVALID' },
    ]);
    expect(await issuesOf(create(c, id, [{ invoiceId: a.id, index: 1, quantity: 1 }]))).toEqual([
      { path: 'items.0', code: 'REFUND_ITEMS_INVALID' },
    ]);
    expect(await issuesOf(create(c, id, [{ invoiceId: b.id, index: 0, quantity: 2 }]))).toEqual([
      { path: 'items.0', code: 'REFUND_ITEMS_INVALID' },
    ]);
    expect(
      await issuesOf(
        create(c, id, [
          { invoiceId: b.id, index: 0, quantity: 1 },
          { invoiceId: a.id, index: 0, quantity: 3 },
        ])
      )
    ).toEqual([{ path: 'items.1', code: 'REFUND_ITEMS_INVALID' }]);
    expect(
      await issuesOf(
        create(c, id, [
          { invoiceId: a.id, index: 0, quantity: 1 },
          { invoiceId: a.id, index: 0, quantity: 1 },
        ])
      )
    ).toEqual([{ path: 'items.1', code: 'REFUND_ITEMS_INVALID' }]);
    expect(c.tables[UIDS.refund]).toHaveLength(0);
    expect(orderRow(c, id).total).toBe(4500);
  });

  it('a second refund cannot reserve the same units; invoicedRefundable drops', async () => {
    const { c, id, a, b } = await twoInvoices();
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4500);
    await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }]);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2500);
    await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }], { idempotencyKey: 'second' });
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(500);
    expect(
      await codesOf(create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }], { idempotencyKey: 'third' }))
    ).toEqual(['REFUND_ITEMS_INVALID']);
    const [r3] = await create(c, id, [{ invoiceId: b.id, index: 0, quantity: 1 }], { idempotencyKey: 'ship' });
    expect(r3.amount).toBe(500);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(0);
  });

  it('a removed refund frees its elements', async () => {
    const { c, id, a } = await twoInvoices();
    const [r] = await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 2 }]);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(500);
    await c.refunds.remove(r.id, actor);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(4500);
  });
});

describe('INVOICED refund preview', () => {
  it('lists the available elements per invoice', async () => {
    const { c, id, a, b } = await twoInvoices();
    await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }]);
    const p = await c.refunds.preview(id);
    expect(p.invoicedElements).toEqual({
      invoices: [
        {
          invoiceId: a.id,
          number: a.number,
          lines: [{ index: 0, kind: 'ITEM', name: 'Shirt', quantityLeft: 1, unitValue: 2000, valueLeft: 2000 }],
        },
        {
          invoiceId: b.id,
          number: b.number,
          lines: [{ index: 0, kind: 'SHIPPING', name: expect.any(String), quantityLeft: 1, unitValue: 500, valueLeft: 500 }],
        },
      ],
    });
  });
});

describe('the credit note of a refund built from items', () => {
  it('options include its own elements, exclude other refunds, and select its items', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const [r1] = await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }]);
    await create(c, id, [{ invoiceId: b.id, index: 0, quantity: 1 }], { idempotencyKey: 'ship' });
    const options = await inv.refundCreditNoteOptions(r1.id);
    expect(options.selected).toEqual([{ invoiceId: a.id, index: 0, quantity: 1, value: 2000 }]);
    expect(options.invoices).toEqual([
      {
        invoiceId: a.id,
        number: a.number,
        lines: [{ index: 0, kind: 'ITEM', name: 'Shirt', quantityLeft: 2, unitValue: 2000, valueLeft: 4000 }],
      },
    ]);
  });

  it('equals the refund to the cent, even when the remainder cent sits with another refund (3 units, 1000)', async () => {
    const { c, inv } = setup();
    const id = await newOrder(c, 3);
    await c.payments.addManualPayment(id, { amount: orderRow(c, id).total, idempotencyKey: 'p1' }, actor);
    const shippingLineId = orderRow(c, id).shippingLines.lines[0].id;
    seedInvoice(c, id, 900, [
      { orderLineId: lineIdOf(c, id), kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 3, total: 1000, tax: 23, partial: false, discountShare: 0 },
      { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId },
    ]);
    const [rA] = await create(c, id, [{ invoiceId: 900, index: 0, quantity: 1 }]);
    const [rB] = await create(c, id, [{ invoiceId: 900, index: 0, quantity: 2 }], { idempotencyKey: 'b' });
    expect([rA.amount, rB.amount]).toEqual([333, 667]);

    const cnB = await inv.issueRefundCreditNote(
      rB.id,
      { items: [{ invoiceId: 900, index: 0, quantity: 2 }], idempotencyKey: 'cn-b' },
      actor
    );
    expect(cnB).toMatchObject({ status: 'ISSUED', total: 667 });
    const cnA = await inv.issueRefundCreditNote(
      rA.id,
      { items: [{ invoiceId: 900, index: 0, quantity: 1 }], idempotencyKey: 'cn-a' },
      actor
    );
    expect(cnA).toMatchObject({ status: 'ISSUED', total: 333 });
  });

  it('uses the stored values even when a re-valuation would differ by a cent', async () => {
    const { c, inv } = setup();
    const id = await newOrder(c, 3);
    await c.payments.addManualPayment(id, { amount: orderRow(c, id).total, idempotencyKey: 'p1' }, actor);
    const shippingLineId = orderRow(c, id).shippingLines.lines[0].id;
    seedInvoice(c, id, 900, [
      { orderLineId: lineIdOf(c, id), kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 3, total: 1000, tax: 23, partial: false, discountShare: 0 },
      { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId },
    ]);
    const [rA] = await create(c, id, [{ invoiceId: 900, index: 0, quantity: 1 }]);
    const [rB] = await create(c, id, [{ invoiceId: 900, index: 0, quantity: 2 }], { idempotencyKey: 'b' });
    expect([rA.amount, rB.amount]).toEqual([333, 667]);
    // rA goes away: 2 of the 3 units would now be valued 666, but rB gave back 667.
    await c.refunds.remove(rA.id, actor);
    const cnB = await inv.issueRefundCreditNote(
      rB.id,
      { items: [{ invoiceId: 900, index: 0, quantity: 2 }], idempotencyKey: 'cn-b' },
      actor
    );
    expect(cnB).toMatchObject({ status: 'ISSUED', total: 667 });
    const row = c.tables[UIDS.invoice].find((r) => r.id === cnB.id);
    expect(row.metadata.creditedLines).toEqual([{ invoiceId: 900, index: 0, value: 667, quantity: 2 }]);
    expect(row.lines.lines.map((l: any) => [l.quantity, l.total])).toEqual([[2, 667]]);
  });

  it('an element no longer creditable: REFUND_ELEMENTS_UNAVAILABLE; another set of the same total is issued', async () => {
    const { c, inv } = setup();
    const id = await newOrder(c, 2);
    await c.payments.addManualPayment(id, { amount: orderRow(c, id).total, idempotencyKey: 'p1' }, actor);
    const lineId = lineIdOf(c, id);
    const shippingLineId = orderRow(c, id).shippingLines.lines[0].id;
    seedInvoice(c, id, 900, [
      { orderLineId: lineId, kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 1, total: 2000, tax: 23, partial: false, discountShare: 0 },
      { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: 500, tax: 23, partial: false, shippingLineId },
    ]);
    seedInvoice(c, id, 901, [
      { orderLineId: lineId, kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 1, total: 2000, tax: 23, partial: false, discountShare: 0 },
    ]);
    const [r] = await create(c, id, [{ invoiceId: 900, index: 0, quantity: 1 }]);
    expect(r.amount).toBe(2000);
    // A return credit note took the unit of invoice 900.
    c.tables[UIDS.invoice].push({
      id: 950,
      order: id,
      provider: 'fakebill',
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      creditedInvoice: 900,
      number: 'NC 2026/950',
      total: 2000,
      lines: { lines: [{ orderLineId: lineId, kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 1, total: 2000, tax: 23, partial: false }] },
      metadata: { creditType: 'RETURN', creditedLines: [{ invoiceId: 900, index: 0, value: 2000, quantity: 1 }] },
    });
    expect(
      await codesOf(
        inv.issueRefundCreditNote(r.id, { items: [{ invoiceId: 900, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' }, actor)
      )
    ).toEqual(['REFUND_ELEMENTS_UNAVAILABLE']);
    const cn = await inv.issueRefundCreditNote(
      r.id,
      { items: [{ invoiceId: 901, index: 0, quantity: 1 }], idempotencyKey: 'cn-2' },
      actor
    );
    expect(cn).toMatchObject({ status: 'ISSUED', total: 2000 });
  });
});

describe('a legacy INVOICED refund (no metadata.items)', () => {
  it('reserves by amount; its credit note options select nothing', async () => {
    const { c, inv, id } = await twoInvoices();
    c.tables[UIDS.refund].push({
      id: 700,
      order: id,
      payment: null,
      method: 'MANUAL_TRANSFER',
      kind: 'MONEY',
      status: 'COMPLETED',
      scope: 'INVOICED',
      amount: 500,
      currency: 'EUR',
      reason: 'GOODWILL',
      idempotencyKey: 'legacy',
      storeCredit: null,
      metadata: null,
    });
    const p = await c.refunds.preview(id);
    expect(p.invoicedRefundable).toBe(4000);
    // Its elements are not known: none is reserved.
    expect(p.invoicedElements.invoices.flatMap((i: any) => i.lines)).toHaveLength(2);
    const options = await inv.refundCreditNoteOptions(700);
    expect(options.selected).toEqual([]);
    expect((await c.refunds.list(id))[0].items).toEqual([]);
  });
});

describe('fix round 1', () => {
  it('the preview and create offer only invoices of the active billing provider', async () => {
    const { c, id, a, b } = await twoInvoices();
    const shippingLineId = orderRow(c, id).shippingLines.lines[0].id;
    seedInvoice(c, id, 905, [
      { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: 100, tax: 23, partial: false, shippingLineId },
    ]);
    c.tables[UIDS.invoice].find((r) => r.id === 905).provider = 'otherbill';
    const p = await c.refunds.preview(id);
    expect(p.invoicedElements.invoices.map((i: any) => i.invoiceId)).toEqual([a.id, b.id]);
    expect(await codesOf(create(c, id, [{ invoiceId: 905, index: 0, quantity: 1 }]))).toEqual(['REFUND_ITEMS_INVALID']);
    // Billing not active: nothing to pick.
    c.services.EcommerceSettingsService.getActiveProviders = async () => [];
    expect((await c.refunds.preview(id)).invoicedElements).toEqual({ invoices: [] });
    expect(await codesOf(create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }]))).toEqual(['REFUND_ITEMS_INVALID']);
  });

  it('an invoice holding elements of an uncredited INVOICED refund refuses a CORRECTION', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const [r] = await create(c, id, [{ invoiceId: a.id, index: 0, quantity: 1 }]);
    const preview = await inv.creditNotePreview(a.id);
    expect(preview.correctionRefused).toBe('REFUND_CREDITED_INVOICE');
    expect(preview.correction).toEqual({ lines: [], total: 0 });
    expect(
      await codesOf(inv.issueCreditNote(a.id, { creditType: 'CORRECTION', reason: 'Wrong data', idempotencyKey: 'c1' }, actor))
    ).toEqual(['REFUND_CREDITED_INVOICE']);
    expect((await inv.creditNotePreview(b.id)).correctionRefused).toBeNull();
    // Removed, the refund reserves nothing: the CORRECTION is offered again.
    await c.refunds.remove(r.id, actor);
    expect((await inv.creditNotePreview(a.id)).correctionRefused).toBeNull();
  });
});
