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
import { setupCommerce, UIDS, type Commerce } from './helpers/commerceSetup';

/**
 * Promotional gifts (zero-value invoiced lines) as INVOICED refund elements: valued 0, their units
 * stop shipping. A refund of gift units only moves no money (a units-only refund).
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

const fakeProvider = () => {
  let seq = 0;
  const p = {
    id: 'fakebill',
    capabilities: { creditNotes: true, findByReference: true },
    maxIssueDurationMs: 5 * 60 * 1000,
    issue: vi.fn(async (draft: InvoiceDraft) => {
      seq += 1;
      return {
        externalId: `ext-${seq}`,
        number: `NC 2026/${seq}`,
        series: '2026',
        documentType: 'NC',
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

const actor = 'user:1';
const INVOICE = 900;

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

/**
 * Buy 1 Shirt (2000), get 1 Cream (3100) as a gift; shipping; paid in full and invoiced on one
 * invoice: line 0 the shirt, line 1 the gift (0, grossTotal 3100, 100% discount), line 2 shipping.
 */
const giftOrder = async () => {
  const c = setupCommerce();
  const provider = fakeProvider();
  registerBillingProvider(provider);
  const settings = c.services.EcommerceSettingsService;
  settings.getActiveProviders = async (category: string) => (category === 'billing' ? ['fakebill'] : []);
  const baseRuntime = settings.getRuntime;
  settings.getRuntime = async (id: string) =>
    id === 'fakebill' ? { config: {}, secrets: {}, active: true } : baseRuntime(id);
  settings.getStoreSettings = async () => ({ markets: ['PT'], timezone: 'Europe/Lisbon' });
  const t = c.tables;
  t[UIDS.variant].find((v) => v.id === 10).stock = 50;
  t[UIDS.product].push({ id: 3, active: true });
  t[UIDS.productTranslation].push({ id: 103, product: 3, locale: 'en', name: 'Cream' });
  t[UIDS.variant].push({ id: 30, product: 3, sku: 'CR-1', price: 3100, tax: 23, stock: 50, active: true });
  t[UIDS.promotion].push({
    id: 1,
    name: 'Gift',
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
    benefits: {
      items: [
        {
          type: 'BUY_X_GET_Y',
          buy: { target: { productIds: [], variantIds: [10] }, quantity: 1, minAmount: null },
          get: { mode: 'GIFT', variantIds: [30], quantity: 1 },
          reward: { kind: 'FREE' },
        },
      ],
    },
    stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
    usageLimit: null,
    perCustomerLimit: null,
    perOrderLimit: null,
    redemptions: 0,
    version: 1,
  });
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity: 1 }],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor, source: 'admin' }
  );
  const id = order.id as number;
  const row = t[UIDS.order].find((o) => o.id === id);
  await c.payments.addManualPayment(id, { amount: row.total, idempotencyKey: 'pay-1' }, actor);
  const lines = t[UIDS.orderLine].filter((l) => l.order === id);
  const paidLine = lines.find((l) => !l.isGift);
  const giftLine = lines.find((l) => l.isGift);
  expect(giftLine).toMatchObject({ variantId: 30, quantity: 1 });
  t[UIDS.invoice].push({
    id: INVOICE,
    order: id,
    provider: 'fakebill',
    kind: 'INVOICE',
    status: 'ISSUED',
    creditedInvoice: null,
    number: 'FR 2026/900',
    externalId: 'ext-inv-900',
    total: row.total,
    lines: {
      lines: [
        { orderLineId: paidLine.id, kind: 'ITEM', sku: 'SH-M', name: 'Shirt', quantity: 1, total: 2000, grossTotal: 2000, tax: 23, partial: false, discountShare: 0 },
        { orderLineId: giftLine.id, kind: 'ITEM', sku: 'CR-1', name: 'Cream', quantity: 1, total: 0, grossTotal: 3100, tax: 23, partial: false, discountShare: 0 },
        { orderLineId: null, kind: 'SHIPPING', sku: '', name: 'Shipping', quantity: 1, total: row.total - 2000, tax: 23, partial: false, shippingLineId: row.shippingLines.lines[0].id },
      ],
    },
    metadata: null,
  });
  return { c, id, provider, paidLineId: paidLine.id as number, giftLineId: giftLine.id as number };
};

const refundItems = (c: Commerce, id: number, items: any[], extra: Record<string, unknown> = {}) =>
  c.refunds.create(
    id,
    {
      method: 'MANUAL_TRANSFER',
      scope: 'INVOICED',
      items: items.map((i) => ({ invoiceId: INVOICE, ...i })),
      reason: 'GOODWILL',
      idempotencyKey: `ref-${JSON.stringify(items)}`,
      ...extra,
    } as any,
    actor
  );

const lineState = async (c: Commerce, id: number, lineId: number) =>
  (await c.orders.computeOrderState(id)).lines.find((l) => l.id === lineId)!;

beforeEach(() => {
  __resetEventHandlersForTests();
  __resetBillingProvidersForTests();
  stripe.createRefund.mockReset();
});

describe('gift lines as INVOICED refund elements', () => {
  it('the preview offers the gift line with value 0 and its order line', async () => {
    const { c, id, giftLineId } = await giftOrder();
    const [invoice] = (await c.refunds.preview(id)).invoicedElements.invoices;
    expect(invoice.lines[1]).toEqual({
      index: 1,
      kind: 'ITEM',
      orderLineId: giftLineId,
      name: 'Cream',
      quantityLeft: 1,
      unitValue: 0,
      valueLeft: 0,
    });
  });

  it('a paid unit plus the gift: the amount is the paid value, and the gift no longer ships', async () => {
    const { c, id, giftLineId } = await giftOrder();
    const [r] = await refundItems(c, id, [
      { index: 0, quantity: 1 },
      { index: 1, quantity: 1 },
    ]);
    expect(r).toMatchObject({ amount: 2000, status: 'COMPLETED', method: 'MANUAL_TRANSFER' });
    expect(r.items).toEqual([
      { invoiceId: INVOICE, index: 0, quantity: 1, value: 2000 },
      { invoiceId: INVOICE, index: 1, quantity: 1, value: 0 },
    ]);
    expect(await lineState(c, id, giftLineId)).toMatchObject({ refundCredited: 1, pending: 0, shippable: 0, returnable: 0 });
    // Not offered again.
    const [invoice] = (await c.refunds.preview(id)).invoicedElements.invoices;
    expect(invoice.lines.map((l) => l.index)).toEqual([2]);
  });
});

describe('a units-only INVOICED refund (gift units only)', () => {
  it('amount 0, MANUAL_TRANSFER without reference, no money, no e-mail, REFUND_CREATED; removable', async () => {
    const { c, id, giftLineId } = await giftOrder();
    const before = c.tables[UIDS.order].find((o) => o.id === id).total;
    const [r] = await refundItems(c, id, [{ index: 1, quantity: 1 }], { method: 'STRIPE', reference: 'ignored' });
    expect(r).toMatchObject({ amount: 0, status: 'COMPLETED', method: 'MANUAL_TRANSFER', reference: null, kind: 'MONEY' });
    expect(r.storeCredit).toBeNull();
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(c.tables[UIDS.storeCredit] ?? []).toHaveLength(0);
    expect(c.events.filter((e) => e.type === 'REFUND_COMPLETED')).toHaveLength(0);
    const history = c.tables[UIDS.orderHistory].filter((h) => h.order === id).map((h) => h.type);
    expect(history).toContain('REFUND_CREATED');
    expect(history).not.toContain('REFUND_COMPLETED');
    expect(c.tables[UIDS.order].find((o) => o.id === id).total).toBe(before);
    expect(await lineState(c, id, giftLineId)).toMatchObject({ refundCredited: 1, pending: 0, shippable: 0 });

    // Nothing to credit: no credit note is offered.
    const inv = c.services.EcommerceInvoiceService;
    expect(await inv.refundCreditNoteOptions(r.id)).toMatchObject({
      creditable: false,
      reason: 'REFUND_NOT_CREDITABLE',
      invoices: [],
    });
    expect(
      await issuesOf(inv.issueRefundCreditNote(r.id, { items: [{ invoiceId: INVOICE, index: 1, quantity: 1 }], idempotencyKey: 'cn' }, actor))
    ).toEqual([{ path: 'refund', code: 'REFUND_NOT_CREDITABLE' }]);

    const [listed] = await c.refunds.list(id);
    expect(listed.removable).toBe(true);
    await c.refunds.remove(r.id, actor);
    expect(await lineState(c, id, giftLineId)).toMatchObject({ refundCredited: 0, pending: 1, shippable: 1 });
  });

  it('still needs a reason', async () => {
    const { c, id } = await giftOrder();
    expect(await issuesOf(refundItems(c, id, [{ index: 1, quantity: 1 }], { reason: '' }))).toEqual([
      { path: 'reason', code: 'required' },
    ]);
    expect(c.tables[UIDS.refund]).toHaveLength(0);
  });

  it('is offered when only gift units are left to refund', async () => {
    const { c, id } = await giftOrder();
    await refundItems(c, id, [
      { index: 0, quantity: 1 },
      { index: 2, quantity: 1 },
    ]);
    const state = await c.orders.computeOrderState(id);
    expect(state.invoicedRefundable).toBe(0);
    expect(state.actions).toContain('REFUND');
    const [r] = await refundItems(c, id, [{ index: 1, quantity: 1 }]);
    expect(r.amount).toBe(0);
    expect((await c.orders.computeOrderState(id)).actions).not.toContain('REFUND');
  });
});

describe('the credit note of a refund with a gift', () => {
  it('credits the gift line at 0 with its price before discounts, next to the paid element', async () => {
    const { c, id, provider } = await giftOrder();
    const [r] = await refundItems(c, id, [
      { index: 0, quantity: 1 },
      { index: 1, quantity: 1 },
    ]);
    const inv = c.services.EcommerceInvoiceService;
    const options = await inv.refundCreditNoteOptions(r.id);
    expect(options.creditable).toBe(true);
    await inv.issueRefundCreditNote(
      r.id,
      {
        items: [
          { invoiceId: INVOICE, index: 0, quantity: 1 },
          { invoiceId: INVOICE, index: 1, quantity: 1 },
        ],
        idempotencyKey: 'cn-1',
      },
      actor
    );
    const draft = provider.issue.mock.calls[0][0] as InvoiceDraft;
    expect(draft.total).toBe(2000);
    expect(draft.lines.map((l) => [l.name, l.quantity, l.total, l.grossTotal])).toEqual([
      ['Shirt', 1, 2000, 2000],
      ['Cream', 1, 0, 3100],
    ]);
    expect(draft.lineOriginals).toEqual([0, 0]);
    const note = c.tables[UIDS.invoice].find((d) => d.kind === 'CREDIT_NOTE');
    expect(note.metadata.creditedLines).toEqual([
      { invoiceId: INVOICE, index: 0, value: 2000, quantity: 1 },
      { invoiceId: INVOICE, index: 1, value: 0, quantity: 1 },
    ]);
  });
});
