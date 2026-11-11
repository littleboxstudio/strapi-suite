import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

/** When set, the next `buildInvoiceLines` call throws `coverage_mismatch`. */
const mismatch = vi.hoisted(() => ({ next: false }));
vi.mock(
  '../../../server/src/services/modules/ecommerce/domain/invoicing',
  async (importOriginal) => {
    const original: any = await importOriginal();
    const errors = await import('../../../server/src/services/modules/ecommerce/errors');
    return {
      ...original,
      buildInvoiceLines: (...args: any[]) => {
        if (mismatch.next) {
          mismatch.next = false;
          throw new errors.EcommerceValidationError('mismatch', [
            { path: 'coverage', code: 'coverage_mismatch' },
          ]);
        }
        return original.buildInvoiceLines(...args);
      },
    };
  }
);

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
    shippingCountries: ['PT'],
    storefrontUrl: 'https://shop.example/',
    timezone: 'Europe/Lisbon',
  });
  // Variant 11: same price as 10 (Review Focus 3).
  c.tables[UIDS.variant].push({
    id: 11,
    product: 1,
    sku: 'SH-L',
    price: 2000,
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

/** 2 × 2000 + 500 shipping = 4500. `payments` are manual amounts (default: paid in full). */
const order = async (c: Commerce, payments: number[] = [4500], quantity = 2) => {
  const o = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'pt',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  for (const [i, amount] of payments.entries()) {
    await c.payments.addManualPayment(
      o.id,
      { amount, idempotencyKey: `pay-${o.id}-${i}` },
      'user:1'
    );
  }
  return o.id as number;
};

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

const paymentScope = (paymentId: number) => ({ type: 'PAYMENT' as const, paymentId });
const TOTAL = { type: 'TOTAL' as const };

beforeEach(() => {
  __resetEventHandlersForTests();
  __resetBillingProvidersForTests();
  docSeq = 0;
});

describe('EcommerceInvoiceService.activeProvider', () => {
  it('no active billing provider → BILLING_NOT_CONFIGURED and nothing written', async () => {
    const { c, inv, active } = setup();
    const id = await order(c);
    active.length = 0;
    expect(await codesOf(inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1'))).toEqual([
      'BILLING_NOT_CONFIGURED',
    ]);
    expect(invoiceRows(c)).toHaveLength(0);
    expect(allocations(c)).toHaveLength(0);
  });

  it('two active providers → BILLING_PROVIDER_AMBIGUOUS', async () => {
    const { c, inv, active } = setup();
    const id = await order(c);
    active.push('moloni');
    expect(await codesOf(inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1'))).toEqual([
      'BILLING_PROVIDER_AMBIGUOUS',
    ]);
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

describe('EcommerceInvoiceService.issue', () => {
  it('Review Focus 3: a paid line replaced by another of the same price is invoiced as the new line, total = paid', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c, [2500], 1); // 1 × 2000 + 500
    const paymentId = paymentRows(c, id)[0].id;
    await c.orders.applyModification(
      id,
      { lines: [{ variantId: 11, quantity: 1 }], shipping: { mode: 'KEEP' } },
      'user:1',
      'op-replace-01'
    );
    const newLine = lineIdOf(c, id, 11);

    const view = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1');
    expect(view.status).toBe('ISSUED');
    expect(view.total).toBe(2500);
    expect(view.lines).toEqual([
      expect.objectContaining({
        orderLineId: newLine,
        sku: 'SH-L',
        quantity: 1,
        total: 2000,
        partial: false,
      }),
      expect.objectContaining({ kind: 'SHIPPING', total: 500 }),
    ]);
    const draft: InvoiceDraft = provider.issue.mock.calls[0][0];
    expect(draft.lines.map((l) => l.sku)).not.toContain('SH-M');
    expect(draft.total).toBe(2500);
    expect(draft.payments).toEqual([
      { method: 'MANUAL', amount: 2500, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
  });

  it('issues a PENDING row with allocations before calling the provider, then ISSUED + history + event', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
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
          uniqueKey: `payment:${paymentId}`,
          amount: 4500,
          invoice: row.id,
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

    const view = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1');
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
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'INVOICE_ISSUED')).toBe(true);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toEqual([
      expect.objectContaining({ orderId: id, payload: { invoiceId: view.id, kind: 'INVOICE' } }),
    ]);
    const o = await c.orders.get(id);
    expect(o.invoices).toEqual([expect.objectContaining({ id: view.id, status: 'ISSUED' })]);
    expect(o.payments[0].invoice).toEqual({ invoiceable: 0, invoiceId: view.id, status: 'ISSUED' });
    expect(o.availableActions).not.toContain('INVOICE_TOTAL');
    expect(o.billing).toEqual({ active: true, providerId: 'fakebill' });
  });

  it('Review Focus 4: timeout → UNCERTAIN, the payment cannot be invoiced again, reconcile finds it → ISSUED', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );

    const view = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1');
    expect(view.status).toBe('UNCERTAIN');
    expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'INVOICE_UNCERTAIN')).toBe(true);
    expect((await c.orders.get(id)).payments[0].invoice).toEqual({
      invoiceable: 0,
      invoiceId: view.id,
      status: 'UNCERTAIN',
    });

    expect(
      await codesOf(inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k2' }, 'user:1'))
    ).toEqual(['PAYMENT_NOT_INVOICEABLE']);
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

  it('Review Focus 4: reconcile with no document → FAILED and the payment is invoiceable again', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(new Error('socket hang up'));
    const view = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1');
    expect(view.status).toBe('UNCERTAIN');

    const failed = await inv.reconcile(view.id, {}, 'user:2');
    expect(failed.status).toBe('FAILED');
    expect(allocations(c)[0].uniqueKey).toBeNull();
    expect((await c.orders.get(id)).payments[0].invoice.invoiceable).toBe(4500);

    const again = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k2' }, 'user:1');
    expect(again.status).toBe('ISSUED');
  });

  it('reconcile keeps the state when the provider cannot look up or errors', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
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
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
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
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    const row = invoiceRows(c)[0];
    row.status = 'PENDING';
    row.createdAt = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    expect(await codesOf(inv.reconcile(view.id, {}, 'user:1'))).toEqual(['ACTION_NOT_AVAILABLE']);
    row.createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect((await inv.reconcile(view.id, {}, 'user:1')).status).toBe('FAILED');
  });

  it('a definitive error → FAILED, allocations released, the error reaches the caller and the payment is invoiceable again', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    provider.issue.mockRejectedValueOnce(new EcommerceBillingError('BILLING_TAX_NOT_FOUND'));
    expect(
      await codesOf(inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1'))
    ).toEqual(['BILLING_TAX_NOT_FOUND']);
    expect(invoiceRows(c)[0]).toMatchObject({ status: 'FAILED', error: 'BILLING_TAX_NOT_FOUND' });
    expect(allocations(c)[0].uniqueKey).toBeNull();
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'INVOICE_FAILED')).toBe(true);
    const o = await c.orders.get(id);
    expect(o.payments[0].invoice).toEqual({ invoiceable: 4500, invoiceId: null, status: null });
    expect(o.availableActions).toContain('INVOICE_TOTAL');
    expect(o.invoices[0]).toMatchObject({ status: 'FAILED', error: 'BILLING_TAX_NOT_FOUND' });
  });

  it('total invoice with two payments, one already invoiced → only the other', async () => {
    const { c, inv } = setup();
    const id = await order(c, [2000, 2500]);
    const [p1, p2] = paymentRows(c, id);
    const first = await inv.issue(id, paymentScope(p1.id), { idempotencyKey: 'k1' }, 'user:1');
    expect(first.total).toBe(2000);

    const preview = await inv.preview(id, TOTAL);
    expect(preview).toMatchObject({ total: 2500, paymentIds: [p2.id] });
    const second = await inv.issue(id, TOTAL, { idempotencyKey: 'k2' }, 'user:1');
    expect(second).toMatchObject({ total: 2500, paymentIds: [p2.id] });
    expect(second.lines.reduce((s: number, l: any) => s + l.total, 0)).toBe(2500);

    expect(await codesOf(inv.issue(id, TOTAL, { idempotencyKey: 'k3' }, 'user:1'))).toEqual([
      'NOTHING_TO_INVOICE',
    ]);
    expect(await codesOf(inv.preview(id, TOTAL))).toEqual(['NOTHING_TO_INVOICE']);
  });

  it('a PARTIALLY_PAID order with one settled payment is invoiceable; INVOICE_TOTAL only with uninvoiced payments', async () => {
    const { c, inv } = setup();
    const id = await order(c, []);
    expect((await c.orders.get(id)).availableActions).not.toContain('INVOICE_TOTAL');
    await c.payments.addManualPayment(id, { amount: 1000, idempotencyKey: 'p-1' }, 'user:1');
    const o = await c.orders.get(id);
    expect(o.paymentStatus).toBe('PARTIALLY_PAID');
    expect(o.availableActions).toContain('INVOICE_TOTAL');
    expect(o.payments[0].invoice.invoiceable).toBe(1000);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    expect(view.total).toBe(1000);
    expect((await c.orders.get(id)).availableActions).not.toContain('INVOICE_TOTAL');
  });

  it('a cancelled order refuses new invoices but allows credit notes', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    await c.orders.cancel(id, 'user:1');
    expect(await codesOf(inv.issue(id, TOTAL, { idempotencyKey: 'k2' }, 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
    const preview = await inv.creditNotePreview(view.id);
    expect(preview.suggested).toEqual([4000, 500]);
    const cn = await inv.issueCreditNote(
      view.id,
      {
        lines: [
          { index: 0, value: 4000 },
          { index: 1, value: 500 },
        ],
        reason: 'Cancelled',
        idempotencyKey: 'cn1',
      },
      'user:1'
    );
    expect(cn).toMatchObject({
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      total: 4500,
      creditedInvoiceId: view.id,
    });
  });

  it('a payment that is not COMPLETED or does not belong to the order → PAYMENT_NOT_INVOICEABLE', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    expect(
      await codesOf(inv.issue(id, paymentScope(999), { idempotencyKey: 'k1' }, 'user:1'))
    ).toEqual(['PAYMENT_NOT_INVOICEABLE']);
    expect(invoiceRows(c)).toHaveLength(0);
  });

  it('repeating issue with the same idempotencyKey returns the same invoice and calls the provider once', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const a = await inv.issue(id, TOTAL, { idempotencyKey: 'same' }, 'user:1');
    const b = await inv.issue(id, TOTAL, { idempotencyKey: 'same' }, 'user:1');
    expect(b.id).toBe(a.id);
    expect(provider.issue).toHaveBeenCalledTimes(1);
    expect(invoiceRows(c)).toHaveLength(1);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED')).toHaveLength(1);
  });

  it('a coverage mismatch marks the invoice FAILED with that error, releases the allocation and never calls the provider', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const paymentId = paymentRows(c, id)[0].id;
    // Reconciled coverages always fit the lines; simulate the domain guard firing.
    mismatch.next = true;
    expect(
      await codesOf(inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1'))
    ).toEqual(['coverage_mismatch']);
    expect(provider.issue).not.toHaveBeenCalled();
    expect(invoiceRows(c)).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'coverage_mismatch' }),
    ]);
    expect(allocations(c).every((a) => a.uniqueKey === null)).toBe(true);
    expect((await c.orders.get(id)).payments[0].invoice.invoiceable).toBe(4500);
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
      amount: 1000,
    });
    const preview = await inv.preview(id, paymentScope(paymentId));
    expect(preview.total).toBe(4000);
  });

  it('a refund without a payment is attributed first to payments without an active invoice', async () => {
    const { c, inv } = setup();
    const id = await order(c, [2500, 2000]);
    const [p1, p2] = paymentRows(c, id);
    // p2 (the latest) is invoiced; an unlinked 500 refund belongs to p1's net.
    p1.completedAt = '2025-01-01T00:00:00.000Z';
    p2.completedAt = '2025-01-02T00:00:00.000Z';
    await inv.issue(id, paymentScope(p2.id), { idempotencyKey: 'k1' }, 'user:1');
    c.tables[UIDS.refund].push({
      id: 1,
      order: id,
      payment: null,
      method: 'MANUAL_TRANSFER',
      kind: 'MONEY',
      status: 'COMPLETED',
      amount: 500,
    });
    const state = await c.orders.computeOrderState(id);
    expect(state.invoicing.refunded.get(p1.id)).toBe(500);
    expect(state.invoicing.refunded.get(p2.id)).toBe(0);
  });

  it('logs and falls back to UTC on an invalid store time zone', async () => {
    const { c, inv, provider } = setup();
    c.services.EcommerceSettingsService.getStoreSettings = async () => ({
      shippingCountries: ['PT'],
      timezone: 'Mars/Olympus',
    });
    const id = await order(c);
    await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
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
      const view = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k1' }, 'user:1');
      expect(view.status).toBe('ISSUED');
      expect(view.warnings).toContain('ISSUED_AFTER_FAILED');
      expect(allocations(c)[0].uniqueKey).toBe(`payment:${paymentId}`);
      expect((await c.orders.get(id)).payments[0].invoice).toEqual({
        invoiceable: 0,
        invoiceId: view.id,
        status: 'ISSUED',
      });
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
        second = await inv.issue(id, paymentScope(paymentId), { idempotencyKey: 'k2' }, 'user:1');
        return issued(draft);
      });
      const first = await inv.issue(
        id,
        paymentScope(paymentId),
        { idempotencyKey: 'k1' },
        'user:1'
      );
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
});

describe('EcommerceInvoiceService.getPdf', () => {
  it('works with the provider deactivated; filename sanitized; not ISSUED → error', async () => {
    const { c, inv, provider, active, runtimes } = setup();
    const id = await order(c);
    provider.issue.mockImplementationOnce(async (draft: InvoiceDraft) => ({
      ...issued(draft),
      number: 'FR 2025/1',
    }));
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
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
  it('a credit note above the creditable value → exceeds_creditable', async () => {
    const { c, inv } = setup();
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    expect(
      await codesOf(
        inv.issueCreditNote(
          view.id,
          { lines: [{ index: 0, value: 4001 }], reason: 'x', idempotencyKey: 'cn1' },
          'user:1'
        )
      )
    ).toEqual(['exceeds_creditable']);
    expect(invoiceRows(c)).toHaveLength(1);
  });

  it('the draft reuses the original customerData and locale, payments [] and the original; lines keep the quantity ratio', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    // The billing address changes later: the credit note keeps the invoiced customer.
    orderRow(c, id).billingAddress = { ...address, firstName: 'Other', nif: '999' };
    orderRow(c, id).locale = 'en';

    const cn = await inv.issueCreditNote(
      view.id,
      {
        lines: [
          { index: 0, value: 2000 },
          { index: 1, value: 250 },
        ],
        reason: 'Damaged',
        idempotencyKey: 'cn1',
      },
      'user:1'
    );
    const draft: InvoiceDraft = provider.issue.mock.calls[1][0];
    expect(draft).toMatchObject({
      kind: 'CREDIT_NOTE',
      ourReference: `LB-INV-${cn.id}`,
      locale: 'pt',
      customer: { name: 'Ana Silva', nif: '123456789' },
      payments: [],
      original: { externalId: 'ext-1', total: 4500 },
      reason: 'Damaged',
      total: 2250,
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({ quantity: 1, total: 2000, partial: false }),
      expect.objectContaining({ kind: 'SHIPPING', quantity: 1, total: 250, partial: true }),
    ]);
    expect(cn).toMatchObject({ status: 'ISSUED', kind: 'CREDIT_NOTE', creditedInvoiceId: view.id });
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'CREDIT_NOTE_ISSUED')).toBe(true);
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').map((e) => e.payload)).toEqual([
      { invoiceId: view.id, kind: 'INVOICE' },
      { invoiceId: cn.id, kind: 'CREDIT_NOTE' },
    ]);
    const list = await inv.listForOrder(id);
    expect(list.find((v: any) => v.id === view.id).credited).toBe(2250);
    const preview = await inv.creditNotePreview(view.id);
    expect(preview.creditable).toEqual([2000, 250]);
  });

  it('repeating issueCreditNote with the same key returns the same credit note and calls the provider once', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    const body = { lines: [{ index: 0, value: 100 }], reason: 'x', idempotencyKey: 'cn1' };
    const a = await inv.issueCreditNote(view.id, body, 'user:1');
    const b = await inv.issueCreditNote(view.id, body, 'user:1');
    expect(b.id).toBe(a.id);
    expect(provider.issue).toHaveBeenCalledTimes(2);
  });

  it('credit note on an invoice that is not ISSUED → ACTION_NOT_AVAILABLE; provider without creditNotes → NOT_SUPPORTED', async () => {
    const { c, inv, provider } = setup({ caps: { creditNotes: false, findByReference: true } });
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    const body = { lines: [{ index: 0, value: 100 }], reason: 'x', idempotencyKey: 'cn1' };
    expect(await codesOf(inv.issueCreditNote(view.id, body, 'user:1'))).toEqual(['NOT_SUPPORTED']);
    provider.capabilities.creditNotes = true;
    invoiceRows(c)[0].status = 'UNCERTAIN';
    expect(await codesOf(inv.issueCreditNote(view.id, body, 'user:1'))).toEqual([
      'ACTION_NOT_AVAILABLE',
    ]);
  });

  it('reconcile of a credit note found → INVOICE_ISSUED with kind CREDIT_NOTE', async () => {
    const { c, inv, provider } = setup();
    const id = await order(c);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    provider.issue.mockRejectedValueOnce(
      new EcommerceBillingError('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE', true)
    );
    const cn = await inv.issueCreditNote(
      view.id,
      { lines: [{ index: 0, value: 100 }], reason: 'x', idempotencyKey: 'cn1' },
      'user:1'
    );
    expect(cn.status).toBe('UNCERTAIN');
    // An uncertain credit note already counts against the creditable value.
    expect((await inv.creditNotePreview(view.id)).creditable).toEqual([3900, 500]);

    provider.findByReference.mockResolvedValueOnce({
      ...issued({ kind: 'CREDIT_NOTE', total: 100 } as any),
    });
    const done = await inv.reconcile(cn.id, {}, 'user:1');
    expect(done.status).toBe('ISSUED');
    expect(c.events.filter((e) => e.type === 'INVOICE_ISSUED').at(-1).payload).toEqual({
      invoiceId: cn.id,
      kind: 'CREDIT_NOTE',
    });
    expect(c.tables[UIDS.orderHistory].some((h) => h.type === 'CREDIT_NOTE_ISSUED')).toBe(true);
  });

  it('a return after invoicing is suggested from the stored return, once', async () => {
    const { c, inv } = setup();
    const id = await order(c, [7000], 3); // 3 × 2000 + 500 = 6500, 500 over
    const lineId = lineIdOf(c, id);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    expect(view.total).toBe(6500);
    await c.services.EcommerceShipmentService.create(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 3 }],
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: 's1',
      },
      'user:1'
    );
    const r = await c.services.EcommerceReturnService.register(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 1, restock: true }],
        reason: 'Damaged',
        idempotencyKey: 'r1',
      },
      'user:1'
    );
    const preview = await inv.creditNotePreview(view.id);
    expect(preview.suggested).toEqual([r.return.refundableValue, 0]);

    const cn = await inv.issueCreditNote(
      view.id,
      { lines: [{ index: 0, value: 2000 }], reason: 'Return', idempotencyKey: 'cn1' },
      'user:1'
    );
    expect(invoiceRows(c).find((x) => x.id === cn.id).metadata.returnIds).toEqual([r.return.id]);
    expect((await inv.creditNotePreview(view.id)).suggested).toEqual([0, 0]);
  });

  it('a return on an order with an order discount: the suggestion equals the return refundable value even when per-line dues differ by a cent', async () => {
    const { c, inv } = setup();
    c.tables[UIDS.variant].push({
      id: 12,
      product: 1,
      sku: 'SH-S',
      price: 1000,
      tax: 23,
      stock: 50,
      active: true,
    });
    c.tables[UIDS.variant].push({
      id: 13,
      product: 1,
      sku: 'SH-XS',
      price: 1000,
      tax: 23,
      stock: 50,
      active: true,
    });
    c.tables[UIDS.variant].push({
      id: 14,
      product: 1,
      sku: 'SH-XXS',
      price: 1000,
      tax: 23,
      stock: 50,
      active: true,
    });
    const o = await c.orders.create(
      {
        customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
        shippingAddress: address,
        billingAddress: address,
        locale: 'pt',
        lines: [
          { variantId: 12, quantity: 1 },
          { variantId: 13, quantity: 1 },
          { variantId: 14, quantity: 1 },
        ],
        shipping: { providerId: 'manual', serviceId: 'express' },
      },
      { actor: 'user:1', source: 'admin' }
    );
    const row = orderRow(c, o.id);
    row.orderDiscount = 100;
    row.total -= 100;
    await c.payments.addManualPayment(o.id, { amount: row.total, idempotencyKey: 'pd' }, 'user:1');
    const view = await inv.issue(o.id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    const lineId = lineIdOf(c, o.id, 12);
    await c.services.EcommerceShipmentService.create(
      o.id,
      {
        lines: c.tables[UIDS.orderLine]
          .filter((l) => l.order === o.id)
          .map((l) => ({ orderLineId: l.id, quantity: 1 })),
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: 's1',
      },
      'user:1'
    );
    const r = await c.services.EcommerceReturnService.register(
      o.id,
      {
        lines: [{ orderLineId: lineId, quantity: 1, restock: true }],
        reason: 'Damaged',
        idempotencyKey: 'r1',
      },
      'user:1'
    );
    const preview = await inv.creditNotePreview(view.id);
    const sum = preview.suggested.reduce((s: number, v: number) => s + v, 0);
    expect(sum).toBe(r.return.refundableValue);
    // 967 refundable; the first line was invoiced at 966 (largest remainder), the cent spills over.
    expect(preview.suggested).toEqual([966, 1, 0, 0]);
    preview.suggested.forEach((v: number, i: number) =>
      expect(v).toBeLessThanOrEqual(preview.creditable[i])
    );
  });

  it('units returned on a cancelled order are not credited twice by the cancel credit note', async () => {
    const { c, inv } = setup();
    const id = await order(c, [6500], 3);
    const lineId = lineIdOf(c, id);
    const view = await inv.issue(id, TOTAL, { idempotencyKey: 'k1' }, 'user:1');
    await c.services.EcommerceShipmentService.create(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 3 }],
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        shippingCost: 0,
        notifyCustomer: false,
        idempotencyKey: 's1',
      },
      'user:1'
    );
    await c.services.EcommerceReturnService.register(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 1, restock: false }],
        reason: 'Damaged',
        idempotencyKey: 'r1',
      },
      'user:1'
    );
    // The return is credited first.
    await inv.issueCreditNote(
      view.id,
      { lines: [{ index: 0, value: 2000 }], reason: 'Return', idempotencyKey: 'cn1' },
      'user:1'
    );
    await c.orders.cancel(id, 'user:1');
    // A second return on the cancelled order.
    await c.services.EcommerceReturnService.register(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 1, restock: false }],
        reason: 'Late',
        idempotencyKey: 'r2',
      },
      'user:1'
    );
    const preview = await inv.creditNotePreview(view.id);
    expect(preview.suggested).toEqual([4000, 500]);
    expect(preview.suggested.reduce((s: number, v: number) => s + v, 0)).toBe(6500 - 2000);
  });

  it('suggestions over two invoices on the same line are not doubled', async () => {
    const { c, inv } = setup();
    const id = await order(c, [2000, 2500]);
    const [p1, p2] = paymentRows(c, id);
    const a = await inv.issue(id, paymentScope(p1.id), { idempotencyKey: 'k1' }, 'user:1');
    const b = await inv.issue(id, paymentScope(p2.id), { idempotencyKey: 'k2' }, 'user:1');
    await c.orders.cancel(id, 'user:1');
    const pa = await inv.creditNotePreview(a.id);
    const pb = await inv.creditNotePreview(b.id);
    const sum = [...pa.suggested, ...pb.suggested].reduce((s: number, v: number) => s + v, 0);
    expect(sum).toBe(4500);
  });
});
