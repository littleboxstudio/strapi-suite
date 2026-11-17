import { describe, expect, it } from 'vitest';
import {
  defaultRefundScope,
  emptyRefundForm,
  previewForScope,
  refundScopes,
  switchRefundScope,
  validateRefundForm,
} from '../../../admin/src/ecommerce/utils/refundForm';
import {
  canIssueRefundCredit,
  refundCreditItems,
  refundCreditSummary,
  refundOptionValue,
  refundRowActions,
  selectionKey,
} from '../../../admin/src/ecommerce/utils/refundCreditNote';
import { API_ERROR_CODES, paymentsOverview } from '../../../admin/src/ecommerce/utils/orderDetail';
import type {
  FinancialSummary,
  InvoiceLine,
  OrderTotals,
  RefundCreditNoteOptions,
  RefundPreview,
  RefundView,
} from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const NOW = new Date(2026, 10, 17, 10, 0, 0);

const preview = (over: Partial<RefundPreview> = {}): RefundPreview => ({
  orderTotal: 5000,
  received: 5000,
  refunded: 0,
  inFlight: 0,
  excess: 300,
  invoicedRefundable: 4000,
  refundable: 300,
  moneyRefundable: 300,
  stripeRefundable: 300,
  hasStripe: true,
  limits: {
    EXCESS: { refundable: 300, moneyRefundable: 300, stripeRefundable: 300 },
    INVOICED: { refundable: 4000, moneyRefundable: 4000, stripeRefundable: 2500 },
  },
  ...over,
});

const noExcess = () =>
  preview({
    excess: 0,
    refundable: 0,
    moneyRefundable: 0,
    stripeRefundable: 0,
    limits: {
      EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
      INVOICED: { refundable: 4000, moneyRefundable: 4000, stripeRefundable: 2500 },
    },
  });

describe('refund scopes', () => {
  it('offers both scopes when there is an excess and invoiced value, EXCESS first', () => {
    expect(refundScopes(preview())).toEqual(['EXCESS', 'INVOICED']);
    expect(defaultRefundScope(preview())).toBe('EXCESS');
  });

  it('uses INVOICED directly when there is no excess', () => {
    expect(refundScopes(noExcess())).toEqual(['INVOICED']);
    expect(defaultRefundScope(noExcess())).toBe('INVOICED');
  });

  it('nothing to refund: no scope (EXCESS as the neutral default)', () => {
    const p = preview({
      excess: 0,
      invoicedRefundable: 0,
      refundable: 0,
      limits: {
        EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
        INVOICED: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
      },
    });
    expect(refundScopes(p)).toEqual([]);
    expect(defaultRefundScope(p)).toBe('EXCESS');
  });

  it('an older server without limits: EXCESS from the top-level fields only', () => {
    const p = preview({ limits: undefined, invoicedRefundable: undefined, excess: undefined });
    expect(refundScopes(p)).toEqual(['EXCESS']);
    expect(previewForScope(p, 'INVOICED').refundable).toBe(0);
  });

  it('previewForScope takes the scope limits', () => {
    expect(previewForScope(preview(), 'INVOICED')).toMatchObject({
      refundable: 4000,
      moneyRefundable: 4000,
      stripeRefundable: 2500,
      hasStripe: true,
    });
  });

  it('emptyRefundForm defaults to the scope and its maximum', () => {
    expect(emptyRefundForm(preview(), 'pt-PT', NOW)).toMatchObject({ scope: 'EXCESS', amount: '3,00' });
    expect(emptyRefundForm(noExcess(), 'pt-PT', NOW)).toMatchObject({
      scope: 'INVOICED',
      amount: '40,00',
      method: 'MANUAL_TRANSFER',
    });
    // The return hand-off amount is capped by the chosen scope.
    expect(emptyRefundForm(noExcess(), 'pt-PT', NOW, { reason: 'RETURN', amount: 9000 }).amount).toBe('40,00');
  });

  it('switching scope sets that scope maximum and keeps a method still allowed', () => {
    const form = { ...emptyRefundForm(preview(), 'pt-PT', NOW), method: 'STRIPE' as const };
    expect(switchRefundScope(form, preview(), 'INVOICED', 'pt-PT')).toMatchObject({
      scope: 'INVOICED',
      amount: '40,00',
      method: 'STRIPE',
    });
    // Stripe not possible for the new scope: back to the default method.
    const p = preview({
      limits: {
        EXCESS: { refundable: 300, moneyRefundable: 300, stripeRefundable: 300 },
        INVOICED: { refundable: 4000, moneyRefundable: 4000, stripeRefundable: 0 },
      },
    });
    expect(switchRefundScope(form, p, 'INVOICED', 'pt-PT').method).toBe('MANUAL_TRANSFER');
  });

  it('an INVOICED refund is its elements, never a free amount', () => {
    // The amount text is ignored: nothing chosen (no elements offered) is refused.
    const form = { ...emptyRefundForm(noExcess(), 'pt-PT', NOW), reason: 'OTHER' as const, amount: '25' };
    expect(validateRefundForm(form, noExcess(), NOW)).toEqual({
      errors: [{ path: 'items', code: 'required' }],
      input: null,
    });
  });

  it('an EXCESS refund is sent as before (no scope field)', () => {
    const form = { ...emptyRefundForm(preview(), 'pt-PT', NOW), reason: 'OTHER' as const };
    expect(validateRefundForm(form, preview(), NOW).input).toEqual({
      method: 'MANUAL_TRANSFER',
      amount: 300,
      reason: 'OTHER',
    });
  });
});

// ---------------------------------------------------------------------------
// Refund credit note
// ---------------------------------------------------------------------------

const options = (over: Partial<RefundCreditNoteOptions> = {}): RefundCreditNoteOptions => ({
  refund: { id: 9, amount: 1500 },
  creditable: true,
  reason: null,
  invoices: [
    {
      invoiceId: 6,
      number: 'FT X/6',
      lines: [
        { index: 0, kind: 'ITEM', name: 'Shirt', quantityLeft: 3, unitValue: 1000, valueLeft: 3000 },
        { index: 1, kind: 'SHIPPING', name: 'CTT', quantityLeft: 1, unitValue: 500, valueLeft: 500 },
      ],
    },
    {
      invoiceId: 7,
      number: 'FT X/7',
      lines: [{ index: 0, kind: 'ITEM', name: 'Mug', quantityLeft: 2, unitValue: 333, valueLeft: 667 }],
    },
  ],
  ...over,
});

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  orderLineId: 1,
  kind: 'ITEM',
  sku: 'S',
  name: 'Shirt',
  quantity: 3,
  total: 2700,
  tax: 23,
  partial: false,
  discountShare: 300,
  ...over,
});

describe('refundOptionValue', () => {
  const item = options().invoices[0].lines[0];
  const shipping = options().invoices[0].lines[1];
  const mug = options().invoices[1].lines[0];

  it('nothing selected, or more than left, is worth 0', () => {
    expect(refundOptionValue(item, 0)).toBe(0);
    expect(refundOptionValue(item, 4)).toBe(0);
    expect(refundOptionValue(item, -1)).toBe(0);
  });

  it('all the units left take the whole value left', () => {
    expect(refundOptionValue(mug, 2)).toBe(667);
  });

  it('one unit is the unit value; a shipping line is whole', () => {
    expect(refundOptionValue(mug, 1)).toBe(333);
    expect(refundOptionValue(shipping, 1)).toBe(500);
  });

  it('k units of a line with a discount share follow the server share rule', () => {
    // net unit = (2700 + 300) / 3 = 1000; share left = 3000 − 3000 = 0.
    expect(refundOptionValue(item, 2, line())).toBe(2000);
    const uneven = { ...item, valueLeft: 2900 };
    // share left = 3000 − 2900 = 100: 2 units = 2000 − floor(100 × 2 / 3) = 1934.
    expect(refundOptionValue(uneven, 2, line())).toBe(1934);
  });

  it('a legacy line (no share) splits the value left by units', () => {
    expect(refundOptionValue({ ...item, valueLeft: 2900 }, 2, line({ discountShare: null }))).toBe(1933);
    expect(refundOptionValue({ ...item, valueLeft: 2900 }, 2)).toBe(1933);
  });
});

describe('refund credit note totals and items', () => {
  it('sums the selection across invoices; difference = refund − selected', () => {
    const sel = { [selectionKey(6, 0)]: 1, [selectionKey(6, 1)]: 1 };
    expect(refundCreditSummary(options(), sel)).toEqual({ selected: 1500, refund: 1500, difference: 0 });
    expect(refundCreditSummary(options(), { [selectionKey(7, 0)]: 1 })).toEqual({
      selected: 333,
      refund: 1500,
      difference: 1167,
    });
    expect(refundCreditSummary(options(), {})).toEqual({ selected: 0, refund: 1500, difference: 1500 });
  });

  it('builds the items in invoice and line order, without zero quantities', () => {
    const sel = { [selectionKey(7, 0)]: 2, [selectionKey(6, 1)]: 1, [selectionKey(6, 0)]: 0 };
    expect(refundCreditItems(options(), sel)).toEqual([
      { invoiceId: 6, index: 1, quantity: 1 },
      { invoiceId: 7, index: 0, quantity: 2 },
    ]);
  });

  it('issue only at difference 0, with something selected and every quantity within its units', () => {
    expect(canIssueRefundCredit(options(), { [selectionKey(6, 0)]: 1, [selectionKey(6, 1)]: 1 })).toBe(true);
    expect(canIssueRefundCredit(options(), { [selectionKey(6, 0)]: 1 })).toBe(false);
    expect(canIssueRefundCredit(options({ refund: { id: 9, amount: 0 } }), {})).toBe(false);
    expect(
      canIssueRefundCredit(options({ refund: { id: 9, amount: 1500 } }), {
        [selectionKey(6, 0)]: 1,
        [selectionKey(6, 1)]: 1,
        [selectionKey(7, 0)]: 5,
      })
    ).toBe(false);
    expect(
      canIssueRefundCredit(options({ creditable: false, reason: 'REFUND_HAS_CREDIT_NOTE' }), {
        [selectionKey(6, 0)]: 1,
        [selectionKey(6, 1)]: 1,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-refund actions
// ---------------------------------------------------------------------------

const refund = (over: Partial<RefundView> = {}): RefundView => ({
  id: 9,
  method: 'MANUAL_TRANSFER',
  kind: 'MONEY',
  scope: 'INVOICED',
  creditNoteId: null,
  status: 'COMPLETED',
  amount: 1500,
  currency: 'EUR',
  reason: 'OTHER',
  description: null,
  reference: null,
  externalId: null,
  actor: null,
  createdAt: null,
  completedAt: null,
  payment: null,
  storeCredit: null,
  ...over,
});

const ctx = {
  billingActive: true,
  archived: false,
  canRefund: true,
  canInvoice: true,
  creditNote: null,
};

describe('refundRowActions', () => {
  it('an INVOICED refund without a credit note: Credit note and Remove', () => {
    expect(refundRowActions(refund(), ctx)).toEqual({ creditNote: true, pdf: false, remove: true });
  });

  it('an EXCESS refund has none of them', () => {
    expect(refundRowActions(refund({ scope: 'EXCESS' }), ctx)).toEqual({
      creditNote: false,
      pdf: false,
      remove: false,
    });
  });

  it('with its credit note issued: PDF only', () => {
    expect(
      refundRowActions(refund({ creditNoteId: 44 }), { ...ctx, creditNote: { status: 'ISSUED' } })
    ).toEqual({ creditNote: false, pdf: true, remove: false });
    // Still pending at the provider: no PDF yet, still not removable.
    expect(
      refundRowActions(refund({ creditNoteId: 44 }), { ...ctx, creditNote: { status: 'UNCERTAIN' } })
    ).toEqual({ creditNote: false, pdf: false, remove: false });
  });

  it('billing not active: only Remove', () => {
    expect(refundRowActions(refund(), { ...ctx, billingActive: false })).toEqual({
      creditNote: false,
      pdf: false,
      remove: true,
    });
  });

  it('archived order: nothing but the PDF', () => {
    expect(refundRowActions(refund(), { ...ctx, archived: true })).toEqual({
      creditNote: false,
      pdf: false,
      remove: false,
    });
    expect(
      refundRowActions(refund({ creditNoteId: 44 }), { ...ctx, archived: true, creditNote: { status: 'ISSUED' } })
        .pdf
    ).toBe(true);
  });

  it('a STRIPE refund is never removable; a refund not completed is neither creditable nor removable', () => {
    expect(refundRowActions(refund({ method: 'STRIPE' }), ctx)).toEqual({
      creditNote: true,
      pdf: false,
      remove: false,
    });
    expect(refundRowActions(refund({ status: 'PROCESSING' }), ctx)).toEqual({
      creditNote: false,
      pdf: false,
      remove: false,
    });
  });

  it("the server's removable flag decides Remove; the local rules only for an older server", () => {
    // A used store credit: the server says no, though the local rules would offer it.
    expect(refundRowActions(refund({ method: 'STORE_CREDIT', removable: false }), ctx).remove).toBe(false);
    expect(refundRowActions(refund({ method: 'STORE_CREDIT', removable: true }), ctx).remove).toBe(true);
    // Still behind the permission.
    expect(refundRowActions(refund({ removable: true }), { ...ctx, canRefund: false }).remove).toBe(false);
    // No flag (older server): the local rules.
    expect(refundRowActions(refund({ removable: undefined }), ctx).remove).toBe(true);
    expect(refundRowActions(refund({ removable: undefined, method: 'STRIPE' }), ctx).remove).toBe(false);
  });

  it('permissions: Credit note needs invoicing, Remove needs refunds', () => {
    expect(refundRowActions(refund(), { ...ctx, canInvoice: false })).toMatchObject({
      creditNote: false,
      remove: true,
    });
    expect(refundRowActions(refund(), { ...ctx, canRefund: false })).toMatchObject({
      creditNote: true,
      remove: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Order total explained
// ---------------------------------------------------------------------------

describe('paymentsOverview with refunds of invoiced value', () => {
  const totals: OrderTotals = {
    itemsOriginal: 5000,
    productDiscount: 0,
    subtotal: 5000,
    orderDiscount: 0,
    shippingOriginal: 500,
    shippingDiscount: 0,
    shippingTotal: 500,
    creditAdjustment: 1500,
    total: 4000,
  };
  const summary: FinancialSummary = {
    orderTotal: 4000,
    total: 4000,
    paid: 5500,
    pendingPayments: 0,
    refunded: 1500,
    net: 4000,
    due: 0,
    excess: 0,
    overRefunded: 0,
  };

  it('adds a tile for the refunds of invoiced value only when above 0', () => {
    expect(paymentsOverview(totals, summary).map((t) => [t.key, t.amount])).toEqual([
      ['total', 5000],
      ['shipping', 500],
      ['discounts', 0],
      ['creditAdjustment', -1500],
      ['paid', 5500],
    ]);
    expect(paymentsOverview({ ...totals, creditAdjustment: 0 }, summary).map((t) => t.key)).toEqual([
      'total',
      'shipping',
      'discounts',
      'paid',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

describe('invoiced refunds translations', () => {
  it('the reversed-with-credit-note flag reads as the store owner asked (pt)', () => {
    expect(pt[P + 'ecommerce.orders.review.REFUND_REVIEW']).toBe(
      'Um reembolso com nota de crédito foi revertido pelo Stripe: a nota de crédito já não corresponde a dinheiro devolvido.'
    );
  });

  it('a late Stripe success whose elements were used reads as the store owner asked (pt)', () => {
    expect(pt[P + 'ecommerce.orders.review.REFUND_ELEMENTS_CONFLICT']).toBe(
      'Um reembolso confirmado tardiamente pelo Stripe reserva elementos que já foram usados: reveja os reembolsos e notas de crédito.'
    );
  });

  it('maps the new refusal codes to messages', () => {
    for (const code of [
      'REFUND_NOT_REMOVABLE',
      'REFUND_HAS_CREDIT_NOTE',
      'REFUND_NOT_CREDITABLE',
      'STORE_CREDIT_USED',
      'CREDIT_TOTAL_DIFFERS',
      'REFUND_CREDITED_INVOICE',
      'UNITS_REFUND_CREDITED',
    ]) {
      expect(API_ERROR_CODES, code).toContain(code);
    }
  });

  it.each([
    'ecommerce.orders.history.type.REFUND_REMOVED',
    'ecommerce.orders.refund.scope',
    'ecommerce.orders.refund.scopes.EXCESS',
    'ecommerce.orders.refund.scopes.INVOICED',
    'ecommerce.orders.refund.reviewNote.INVOICED',
    'ecommerce.orders.detail.summary.creditAdjustment',
    'ecommerce.orders.refunds.creditNote.title',
    'ecommerce.orders.refunds.creditNote.invoice',
    'ecommerce.orders.refunds.remove.title',
    'ecommerce.orders.invoices.creditNote.correctionRefused',
    'ecommerce.orders.history.type.REFUND_REVERSED_WITH_CREDIT_NOTE',
    'ecommerce.orders.review.REFUND_REVIEW',
    'ecommerce.orders.review.reason.REFUND_REVERSED_WITH_CREDIT_NOTE',
    'ecommerce.orders.review.reasonNoDate.REFUND_REVERSED_WITH_CREDIT_NOTE',
    'ecommerce.orders.history.type.REFUND_ELEMENTS_CONFLICT',
    'ecommerce.orders.review.REFUND_ELEMENTS_CONFLICT',
    'ecommerce.orders.review.reason.REFUND_ELEMENTS_CONFLICT',
    'ecommerce.orders.review.reasonNoDate.REFUND_ELEMENTS_CONFLICT',
    'ecommerce.orders.errors.UNITS_REFUND_CREDITED',
    'ecommerce.orders.returns.refundCredited',
  ])('%s has en and pt', (key) => {
    expect(en[P + key], key).toBeTruthy();
    expect(pt[P + key], key).toBeTruthy();
  });
});
