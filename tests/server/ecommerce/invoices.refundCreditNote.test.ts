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
  const active = ['fakebill'];
  const settings = c.services.EcommerceSettingsService;
  settings.getActiveProviders = async (category: string) => (category === 'billing' ? active : []);
  const baseRuntime = settings.getRuntime;
  settings.getRuntime = async (id: string) =>
    id === 'fakebill' ? { config: {}, secrets: {}, active: true } : baseRuntime(id);
  settings.getStoreSettings = async () => ({ markets: ['PT'], timezone: 'Europe/Lisbon' });
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  return { c, inv: c.services.EcommerceInvoiceService, provider, active };
}

const actor = 'user:1';
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);
const lineIdOf = (c: Commerce, id: number) =>
  c.tables[UIDS.orderLine].find((l) => l.order === id && l.variantId === 10).id as number;
const paymentRows = (c: Commerce, id: number) =>
  c.tables[UIDS.payment].filter((p) => p.order === id).sort((a, b) => a.id - b.id);
const invoiceRow = (c: Commerce, id: number) => c.tables[UIDS.invoice].find((r) => r.id === id);
const refundRow = (c: Commerce, id: number) => c.tables[UIDS.refund].find((r) => r.id === id);

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

/**
 * 2 × 2000 + 500 shipping = 4500, paid 4000 + 500: invoice A holds the line (4000), invoice B
 * the shipping (500).
 */
const twoInvoices = async () => {
  const s = setup();
  const { c, inv } = s;
  const o = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'pt',
      lines: [{ variantId: 10, quantity: 2 }],
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor, source: 'admin' }
  );
  const id = o.id as number;
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
  expect([a.total, b.total]).toEqual([4000, 500]);
  return { ...s, id, a, b };
};

const refund = async (c: Commerce, id: number, amount: number, scope: 'INVOICED' | 'EXCESS' = 'INVOICED') => {
  const [r] = await c.refunds.create(
    id,
    {
      method: 'MANUAL_TRANSFER',
      scope,
      amount,
      reason: 'GOODWILL',
      description: 'Lost in transit',
      idempotencyKey: `ref-${amount}-${scope}`,
    },
    actor
  );
  return r;
};

beforeEach(() => {
  __resetEventHandlersForTests();
  __resetBillingProvidersForTests();
  stripe.createRefund.mockReset();
  docSeq = 0;
});

describe('EcommerceInvoiceService.refundCreditNoteOptions', () => {
  it('lists, per invoice, the invoiced and not yet credited elements; never DISCOUNT records', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const options = await inv.refundCreditNoteOptions(r.id);
    expect(options).toEqual({
      refund: { id: r.id, amount: 2500 },
      creditable: true,
      reason: null,
      invoices: [
        {
          invoiceId: a.id,
          number: a.number,
          lines: [{ index: 0, kind: 'ITEM', name: 'Shirt', quantityLeft: 2, unitValue: 2000, valueLeft: 4000 }],
        },
        {
          invoiceId: b.id,
          number: b.number,
          lines: [{ index: 0, kind: 'SHIPPING', name: expect.any(String), quantityLeft: 1, unitValue: 500, valueLeft: 500 }],
        },
      ],
    });
  });

  it('leaves out what a credit note already credited', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const first = await refund(c, id, 2000);
    await inv.issueRefundCreditNote(first.id, { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' }, actor);
    const second = await refund(c, id, 500);
    const options = await inv.refundCreditNoteOptions(second.id);
    expect(options.invoices.map((i: any) => [i.invoiceId, i.lines.map((l: any) => [l.index, l.quantityLeft, l.valueLeft])])).toEqual([
      [a.id, [[0, 1, 2000]]],
      [b.id, [[0, 1, 500]]],
    ]);
  });
});

describe('refundCreditNoteOptions for a refund that cannot get a credit note', () => {
  it('returns no invoices and the reason issuing would give', async () => {
    const { c, inv, active, id, a } = await twoInvoices();
    const r = await refund(c, id, 2000);
    const options = () => inv.refundCreditNoteOptions(r.id);
    active.length = 0;
    expect(await options()).toMatchObject({ creditable: false, reason: 'BILLING_NOT_CONFIGURED', invoices: [] });
    active.push('fakebill');
    orderRow(c, id).orderStatus = 'ARCHIVED';
    expect(await options()).toMatchObject({ creditable: false, reason: 'ACTION_NOT_AVAILABLE', invoices: [] });
    orderRow(c, id).orderStatus = 'OPEN';
    await inv.issueRefundCreditNote(r.id, { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' }, actor);
    expect(await options()).toEqual({
      refund: { id: r.id, amount: 2000 },
      creditable: false,
      reason: 'REFUND_HAS_CREDIT_NOTE',
      invoices: [],
    });
    refundRow(c, r.id).metadata = { removed: true };
    expect(await options()).toMatchObject({ creditable: false, reason: 'REFUND_NOT_CREDITABLE', invoices: [] });
    refundRow(c, r.id).metadata = null;
    refundRow(c, r.id).scope = 'EXCESS';
    expect(await options()).toMatchObject({ creditable: false, reason: 'REFUND_NOT_CREDITABLE', invoices: [] });
    refundRow(c, r.id).scope = 'INVOICED';
    refundRow(c, r.id).status = 'PROCESSING';
    expect(await options()).toMatchObject({ creditable: false, reason: 'REFUND_NOT_CREDITABLE', invoices: [] });
  });

  it('the refund view never reads an empty creditNoteId as an id', async () => {
    const { c, id } = await twoInvoices();
    const r = await refund(c, id, 2000);
    refundRow(c, r.id).metadata = { creditNoteId: '' };
    expect((await c.refunds.list(id)).find((v: any) => v.id === r.id).creditNoteId).toBeNull();
  });
});

describe('EcommerceInvoiceService.issueRefundCreditNote', () => {
  it('issues one credit note across two invoices, each entry on its own invoice', async () => {
    const { c, inv, provider, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    expect(orderRow(c, id).total).toBe(2000);
    const cn = await inv.issueRefundCreditNote(
      r.id,
      {
        items: [
          { invoiceId: a.id, index: 0, quantity: 1 },
          { invoiceId: b.id, index: 0, quantity: 1 },
        ],
        idempotencyKey: 'cn-1',
      },
      actor
    );
    expect(cn).toMatchObject({ kind: 'CREDIT_NOTE', status: 'ISSUED', total: 2500, creditedInvoiceId: a.id });
    const row = invoiceRow(c, cn.id);
    expect(row.metadata).toMatchObject({
      creditType: 'REFUND',
      refundId: r.id,
      creditedLines: [
        { invoiceId: a.id, index: 0, value: 2000, quantity: 1 },
        { invoiceId: b.id, index: 0, value: 500, quantity: 1 },
      ],
    });
    expect(refundRow(c, r.id).metadata).toMatchObject({ creditNoteId: cn.id });
    expect((await c.refunds.list(id)).find((v: any) => v.id === r.id).creditNoteId).toBe(cn.id);

    const draft: InvoiceDraft = provider.issue.mock.calls.at(-1)![0];
    expect(draft).toMatchObject({
      kind: 'CREDIT_NOTE',
      total: 2500,
      payments: [],
      originals: [
        { externalId: invoiceRow(c, a.id).externalId, value: 2000 },
        { externalId: invoiceRow(c, b.id).externalId, value: 500 },
      ],
      lineOriginals: [0, 1],
    });
    expect(draft.lines.map((l) => [l.kind, l.quantity, l.total])).toEqual([
      ['ITEM', 1, 2000],
      ['SHIPPING', 1, 500],
    ]);
    // Each invoice reports what was credited of it; the order total is unchanged by the credit note.
    const views = await inv.listForOrder(id);
    expect(views.find((v: any) => v.id === a.id).credited).toBe(2000);
    expect(views.find((v: any) => v.id === b.id).credited).toBe(500);
    expect(orderRow(c, id).total).toBe(2000);
    expect((await c.refunds.preview(id)).invoicedRefundable).toBe(2000);
    // A repeated key returns the same credit note.
    const again = await inv.issueRefundCreditNote(
      r.id,
      { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' },
      actor
    );
    expect(again.id).toBe(cn.id);
    expect(provider.issue).toHaveBeenCalledTimes(3);
  });

  it('a key already used for the credit note of another refund is IDEMPOTENCY_KEY_CONFLICT', async () => {
    const { c, inv, id, a } = await twoInvoices();
    const r1 = await refund(c, id, 2000);
    const r2 = await refund(c, id, 500);
    const cn = await inv.issueRefundCreditNote(
      r1.id,
      { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-shared' },
      actor
    );
    expect(cn.status).toBe('ISSUED');
    expect(
      await codesOf(
        inv.issueRefundCreditNote(
          r2.id,
          { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-shared' },
          actor
        )
      )
    ).toEqual(['IDEMPOTENCY_KEY_CONFLICT']);
    expect(refundRow(c, r2.id).metadata?.creditNoteId).toBeUndefined();
    // The same refund with the same key still replays its own credit note.
    const again = await inv.issueRefundCreditNote(
      r1.id,
      { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-shared' },
      actor
    );
    expect(again.id).toBe(cn.id);
  });

  it('the locked replay also refuses a key that another refund claimed meanwhile', async () => {
    const { c, inv, id, a } = await twoInvoices();
    const r1 = await refund(c, id, 2000);
    const r2 = await refund(c, id, 500);
    const cn = await inv.issueRefundCreditNote(
      r1.id,
      { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-first' },
      actor
    );
    // Between the unlocked lookup and the locked one, r1's credit note takes the key.
    const settings = c.services.EcommerceSettingsService;
    const base = settings.getActiveProviders;
    settings.getActiveProviders = async (category: string) => {
      invoiceRow(c, cn.id).idempotencyKey = 'cn-race';
      return base(category);
    };
    expect(
      await codesOf(
        inv.issueRefundCreditNote(
          r2.id,
          { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-race' },
          actor
        )
      )
    ).toEqual(['IDEMPOTENCY_KEY_CONFLICT']);
    expect(refundRow(c, r2.id).metadata?.creditNoteId).toBeUndefined();
  });

  it('refuses a total that differs from the refund amount; nothing is written', async () => {
    const { c, inv, id, a } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const before = c.tables[UIDS.invoice].length;
    expect(
      await codesOf(
        inv.issueRefundCreditNote(r.id, { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' }, actor)
      )
    ).toEqual(['CREDIT_TOTAL_DIFFERS']);
    expect(c.tables[UIDS.invoice]).toHaveLength(before);
    expect(refundRow(c, r.id).metadata?.creditNoteId ?? null).toBeNull();
  });

  it('refuses units above what is left, unknown lines and an empty selection', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const issue = (items: any[]) => inv.issueRefundCreditNote(r.id, { items, idempotencyKey: `k-${JSON.stringify(items)}` }, actor);
    expect(await codesOf(issue([{ invoiceId: a.id, index: 0, quantity: 3 }]))).toEqual(['QUANTITY_EXCEEDS_CREDITABLE']);
    expect(await codesOf(issue([{ invoiceId: b.id, index: 5, quantity: 1 }]))).toEqual(['invalid']);
    expect(await codesOf(issue([{ invoiceId: 999, index: 0, quantity: 1 }]))).toEqual(['invalid']);
    expect(await codesOf(issue([]))).toEqual(['required']);
  });

  it('refuses an EXCESS refund, a refund that has a credit note, an archived order and billing not active', async () => {
    const { c, inv, active, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const items = [
      { invoiceId: a.id, index: 0, quantity: 1 },
      { invoiceId: b.id, index: 0, quantity: 1 },
    ];
    active.length = 0;
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k0' }, actor))).toEqual([
      'BILLING_NOT_CONFIGURED',
    ]);
    active.push('fakebill');
    orderRow(c, id).orderStatus = 'ARCHIVED';
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k1' }, actor))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    orderRow(c, id).orderStatus = 'OPEN';
    await inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k2' }, actor);
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k3' }, actor))).toEqual([
      'REFUND_HAS_CREDIT_NOTE',
    ]);
    refundRow(c, r.id).scope = 'EXCESS';
    refundRow(c, r.id).metadata = null;
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k4' }, actor))).toEqual([
      'REFUND_NOT_CREDITABLE',
    ]);
  });

  it('a credit note the provider refuses frees the refund for a new one', async () => {
    const { c, inv, provider, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const items = [
      { invoiceId: a.id, index: 0, quantity: 1 },
      { invoiceId: b.id, index: 0, quantity: 1 },
    ];
    provider.issue.mockRejectedValueOnce(new EcommerceBillingError('BILLING_REQUEST_FAILED', 'refused', false));
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k1' }, actor))).toEqual([
      'BILLING_REQUEST_FAILED',
    ]);
    expect(refundRow(c, r.id).metadata?.creditNoteId ?? null).toBeNull();
    const cn = await inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k2' }, actor);
    expect(cn.status).toBe('ISSUED');
    expect(refundRow(c, r.id).metadata.creditNoteId).toBe(cn.id);
  });

  it('an uncertain outcome keeps the credit note on the refund; marked failed frees it', async () => {
    const { c, inv, provider, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const items = [
      { invoiceId: a.id, index: 0, quantity: 1 },
      { invoiceId: b.id, index: 0, quantity: 1 },
    ];
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const cn = await inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k1' }, actor);
    expect(cn.status).toBe('UNCERTAIN');
    expect(refundRow(c, r.id).metadata.creditNoteId).toBe(cn.id);
    expect(await codesOf(inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k2' }, actor))).toEqual([
      'REFUND_HAS_CREDIT_NOTE',
    ]);
    await inv.reconcile(cn.id, { markFailed: true }, actor);
    expect(refundRow(c, r.id).metadata?.creditNoteId ?? null).toBeNull();
    expect((await inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k3' }, actor)).status).toBe('ISSUED');
  });
});

describe('a late REFUND credit note after its refund was removed', () => {
  it('is recorded ISSUED but flagged DUPLICATE_CREDIT_NOTE and never re-attached to the removed refund', async () => {
    const { c, inv, provider, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2500);
    const items = [
      { invoiceId: a.id, index: 0, quantity: 1 },
      { invoiceId: b.id, index: 0, quantity: 1 },
    ];
    const issuedLate = provider.issue.getMockImplementation()!;
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => {
      // While the provider is still working, the admin marks the credit note failed (stale) and
      // removes the refund: its adjustment comes off, the total goes back up.
      const row = c.tables[UIDS.invoice].find((x) => x.kind === 'CREDIT_NOTE');
      row.createdAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(((await inv.reconcile(row.id, { markFailed: true }, actor)) as any).status).toBe('FAILED');
      expect(refundRow(c, r.id).metadata?.creditNoteId ?? null).toBeNull();
      await c.refunds.remove(r.id, actor);
      expect(refundRow(c, r.id)).toMatchObject({ status: 'CANCELLED', metadata: { removed: true } });
      expect(orderRow(c, id).total).toBe(4500);
      return issuedLate(draft);
    });
    const late = await inv.issueRefundCreditNote(r.id, { items, idempotencyKey: 'k1' }, actor);
    expect(late.status).toBe('ISSUED');
    expect(late.warnings).toEqual(['ISSUED_AFTER_FAILED', 'DUPLICATE_CREDIT_NOTE']);
    expect(refundRow(c, r.id).metadata.creditNoteId).toBeUndefined();
    expect(c.events.filter((e: any) => e.type === 'INVOICE_ISSUED' && e.payload.invoiceId === late.id)).toHaveLength(0);
  });
});

describe('a CORRECTION on an invoice a REFUND credit note credited', () => {
  it('is refused in the preview and on issue (REFUND_CREDITED_INVOICE)', async () => {
    const { c, inv, id, a, b } = await twoInvoices();
    const r = await refund(c, id, 2000);
    expect((await inv.creditNotePreview(a.id)).correctionRefused).toBeNull();
    await inv.issueRefundCreditNote(r.id, { items: [{ invoiceId: a.id, index: 0, quantity: 1 }], idempotencyKey: 'cn-1' }, actor);
    const preview = await inv.creditNotePreview(a.id);
    expect(preview.correctionRefused).toBe('REFUND_CREDITED_INVOICE');
    expect(preview.correction).toEqual({ lines: [], total: 0 });
    expect(
      await codesOf(inv.issueCreditNote(a.id, { creditType: 'CORRECTION', reason: 'Wrong data', idempotencyKey: 'c1' }, actor))
    ).toEqual(['REFUND_CREDITED_INVOICE']);
    // The other invoice is untouched.
    expect((await inv.creditNotePreview(b.id)).correctionRefused).toBeNull();
  });
});
