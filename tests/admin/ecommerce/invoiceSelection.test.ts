import { describe, it, expect } from 'vitest';
import {
  buildIssueInvoiceInput,
  canIssueInvoice,
  defaultInvoiceSelectionForm,
  discountItemLabel,
  invoiceSelectionTotals,
  isSelectionChanged,
  selectionPayments,
  validateInvoiceSelection,
} from '../../../admin/src/ecommerce/utils/invoiceSelection';
import * as selectionModule from '../../../admin/src/ecommerce/utils/invoiceSelection';
import type { InvoiceSelectionView, OrderPayment } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

type SelectionLine = InvoiceSelectionView['lines'][number];
const line = (over: Partial<SelectionLine>): SelectionLine => ({
  orderLineId: 1,
  sku: 'A',
  name: 'A',
  option: null,
  tax: 23,
  isGift: false,
  units: 3,
  unitPrice: 1000,
  unitDiscount: 0,
  value: 3000,
  ...over,
});

// Lines 3000 + 1000, shipping 500, an order discount of 300 and a shipping discount of 200:
// 4000 + 500 − 500 = 4000, paid by payment 7.
const view = (over: Partial<InvoiceSelectionView> = {}): InvoiceSelectionView => ({
  lines: [
    line({}),
    line({ orderLineId: 2, sku: 'B', name: 'B', units: 1, unitPrice: 1200, unitDiscount: 200, value: 1000 }),
  ],
  shipping: [{ shippingLineId: 9, name: 'CTT', tax: 23, origin: 'CHECKOUT', createdAt: '2026-01-01', value: 500 }],
  discounts: [
    { id: 'm:4', kind: 'ORDER', label: 'Loyalty', amount: 300, manualKind: 'FIXED', percent: null },
    { id: 's:12', kind: 'SHIPPING', label: 'Free shipping', amount: 200 },
  ],
  payments: [{ paymentId: 7, amount: 4000, refunded: 0, net: 4000 }],
  excess: 0,
  overInvoiced: { shipping: 0 },
  ...over,
});

describe('whole-item selection helpers', () => {
  it('no longer offers quantities, unit values or stranded value', () => {
    expect(selectionModule).not.toHaveProperty('selectedValue');
    expect(selectionModule).not.toHaveProperty('unitValue');
    expect(selectionModule).not.toHaveProperty('quantityErrorMessage');
    expect(selectionModule).not.toHaveProperty('strandedValue');
  });
});

describe('defaultInvoiceSelectionForm', () => {
  it('selects every line, shipping line, discount and payment', () => {
    expect(defaultInvoiceSelectionForm(view())).toEqual({
      orderLineIds: [1, 2],
      shippingLineIds: [9],
      discountIds: ['m:4', 's:12'],
      paymentIds: [7],
    });
  });
});

describe('invoiceSelectionTotals', () => {
  it('lines + shipping − discounts against the selected payments', () => {
    const v = view();
    expect(invoiceSelectionTotals(v, defaultInvoiceSelectionForm(v))).toEqual({
      lines: 4000,
      shipping: 500,
      discounts: 500,
      total: 4000,
      payments: 4000,
      difference: 0,
    });
  });

  it('counts only the selected items; a credit shipping line is negative', () => {
    const v = view({
      shipping: [
        { shippingLineId: 9, name: 'CTT', tax: 23, origin: 'CHECKOUT', createdAt: '2026-01-01', value: 500 },
        { shippingLineId: 10, name: 'Credit', tax: 23, origin: 'MANUAL', createdAt: '2026-01-02', value: -100 },
      ],
    });
    const form = { orderLineIds: [2], shippingLineIds: [9, 10], discountIds: ['s:12'], paymentIds: [] };
    expect(invoiceSelectionTotals(v, form)).toEqual({
      lines: 1000,
      shipping: 400,
      discounts: 200,
      total: 1200,
      payments: 0,
      difference: 1200,
    });
  });
});

describe('validateInvoiceSelection', () => {
  it('accepts the default selection', () => {
    const v = view();
    expect(validateInvoiceSelection(v, defaultInvoiceSelectionForm(v))).toEqual({});
  });

  it('an order discount above the selected lines exceeds the selection', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), orderLineIds: [] };
    expect(validateInvoiceSelection(v, form)).toEqual({ discountIds: 'DISCOUNT_EXCEEDS_SELECTION' });
  });

  it('a shipping discount above the selected shipping exceeds the selection', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), shippingLineIds: [] };
    expect(validateInvoiceSelection(v, form)).toEqual({ discountIds: 'DISCOUNT_EXCEEDS_SELECTION' });
  });

  it('the shipping cap applies only when a shipping discount is selected', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), shippingLineIds: [], discountIds: ['m:4'] };
    expect(validateInvoiceSelection(v, form)).toEqual({});
  });

  it('nothing selected and no payment are required', () => {
    const v = view();
    const form = { orderLineIds: [], shippingLineIds: [], discountIds: [], paymentIds: [] };
    expect(validateInvoiceSelection(v, form)).toEqual({ orderLineIds: 'required', paymentIds: 'required' });
  });
});

describe('canIssueInvoice', () => {
  it('when the difference is 0, the total positive and there are no errors', () => {
    const v = view();
    expect(canIssueInvoice(v, defaultInvoiceSelectionForm(v))).toBe(true);
  });

  it('not with a difference', () => {
    const v = view();
    expect(canIssueInvoice(v, { ...defaultInvoiceSelectionForm(v), discountIds: ['m:4'] })).toBe(false);
  });

  it('not when a discount exceeds the selection, even with no difference', () => {
    const v = view({
      payments: [{ paymentId: 7, amount: 200, refunded: 0, net: 200 }],
    });
    // 0 lines + 500 shipping − 300 order − 0 = 200, but the order discount exceeds the lines.
    const form = { orderLineIds: [], shippingLineIds: [9], discountIds: ['m:4'], paymentIds: [7] };
    expect(invoiceSelectionTotals(v, form).difference).toBe(0);
    expect(canIssueInvoice(v, form)).toBe(false);
  });

  it('not with an excess to refund', () => {
    const v = view({ excess: 1000 });
    expect(canIssueInvoice(v, defaultInvoiceSelectionForm(v))).toBe(false);
  });

  it('not with a zero total', () => {
    const v = view({ payments: [] });
    expect(canIssueInvoice(v, { orderLineIds: [], shippingLineIds: [], discountIds: [], paymentIds: [] })).toBe(false);
  });
});

describe('buildIssueInvoiceInput', () => {
  it('sends the selected ids in view order and the expected total', () => {
    const v = view({
      payments: [
        { paymentId: 7, amount: 4000, refunded: 0, net: 4000 },
        { paymentId: 8, amount: 100, refunded: 0, net: 100 },
      ],
    });
    const form = { orderLineIds: [2, 1], shippingLineIds: [9], discountIds: ['s:12', 'm:4'], paymentIds: [7] };
    expect(buildIssueInvoiceInput(v, form, 'key')).toEqual({
      orderLineIds: [1, 2],
      shippingLineIds: [9],
      discountIds: ['m:4', 's:12'],
      paymentIds: [7],
      expectedTotal: 4000,
      idempotencyKey: 'key',
    });
  });
});

describe('discountItemLabel', () => {
  it('translates the unexplained-difference items by id', () => {
    expect(discountItemLabel({ id: 'adj:order', label: 'Order discount adjustment' })).toEqual({
      id: 'ecommerce.orders.invoices.issue.adjustment.order',
    });
    expect(discountItemLabel({ id: 'adj:shipping', label: 'Shipping discount adjustment' })).toEqual({
      id: 'ecommerce.orders.invoices.issue.adjustment.shipping',
    });
    expect(en[`${P}ecommerce.orders.invoices.issue.adjustment.order`]).toBe('Order discount adjustment');
    expect(pt[`${P}ecommerce.orders.invoices.issue.adjustment.order`]).toBe('Ajuste do desconto da encomenda');
    expect(en[`${P}ecommerce.orders.invoices.issue.adjustment.shipping`]).toBe('Shipping discount adjustment');
    expect(pt[`${P}ecommerce.orders.invoices.issue.adjustment.shipping`]).toBe('Ajuste do desconto de portes');
  });

  it('shows the server label of the other items', () => {
    expect(discountItemLabel({ id: 'm:4', label: 'Loyalty' })).toEqual({ text: 'Loyalty' });
    expect(discountItemLabel({ id: 'p:3:0', label: 'Summer' })).toEqual({ text: 'Summer' });
  });
});

describe('Generate invoice texts', () => {
  it.each([
    ['discounts', 'Discounts', 'Descontos'],
    ['discountKind.ORDER', 'Order discount', 'Desconto da encomenda'],
    ['discountKind.SHIPPING', 'Shipping discount', 'Desconto de portes'],
    ['columns.lineDiscount', 'Line discount', 'Desconto da linha'],
  ])('%s', (key, enText, ptText) => {
    expect(en[`${P}ecommerce.orders.invoices.issue.${key}`]).toBe(enText);
    expect(pt[`${P}ecommerce.orders.invoices.issue.${key}`]).toBe(ptText);
  });

  it('DISCOUNT_EXCEEDS_SELECTION, LINE_ALREADY_INVOICED and DISCOUNT_NOT_INVOICEABLE have messages', () => {
    for (const code of ['DISCOUNT_EXCEEDS_SELECTION', 'LINE_ALREADY_INVOICED', 'DISCOUNT_NOT_INVOICEABLE']) {
      expect(en[`${P}ecommerce.orders.errors.${code}`]).toEqual(expect.any(String));
      expect(pt[`${P}ecommerce.orders.errors.${code}`]).toEqual(expect.any(String));
    }
  });
});

describe('selectionPayments', () => {
  const payment = (over: Partial<OrderPayment>): OrderPayment => ({
    id: 7,
    method: 'MANUAL',
    status: 'COMPLETED',
    amount: 4500,
    currency: 'EUR',
    reference: null,
    externalId: null,
    coverage: null,
    methodLabel: 'MB Way',
    completedAt: '2026-02-01T10:00:00.000Z',
    actor: null,
    createdAt: '2026-01-31T10:00:00.000Z',
    ...over,
  });

  it('joins each selectable payment with its method and date (completed, else created)', () => {
    const v = view({
      payments: [
        { paymentId: 7, amount: 4500, refunded: 500, net: 4000 },
        { paymentId: 8, amount: 1000, refunded: 0, net: 1000 },
      ],
    });
    const rows = selectionPayments(v, [
      payment({ id: 8, method: 'STRIPE', methodLabel: null, completedAt: null }),
      payment({}),
    ]);
    expect(rows).toEqual([
      { paymentId: 7, amount: 4500, refunded: 500, net: 4000, method: 'MANUAL', methodLabel: 'MB Way', date: '2026-02-01T10:00:00.000Z' },
      { paymentId: 8, amount: 1000, refunded: 0, net: 1000, method: 'STRIPE', methodLabel: null, date: '2026-01-31T10:00:00.000Z' },
    ]);
  });

  it('keeps a payment the order does not list, without method or date', () => {
    expect(selectionPayments(view(), [])).toEqual([
      { paymentId: 7, amount: 4000, refunded: 0, net: 4000, method: null, methodLabel: null, date: null },
    ]);
  });
});

describe('isSelectionChanged', () => {
  const conflict = (code: string, status = 409) => ({
    response: { data: { error: { status, details: { code, errors: [{ path: 'p', code }] } } } },
  });

  it.each([
    'TOTAL_CHANGED',
    'LINE_ALREADY_INVOICED',
    'SHIPPING_LINE_NOT_INVOICEABLE',
    'DISCOUNT_NOT_INVOICEABLE',
    'PAYMENT_NOT_INVOICEABLE',
  ])('%s means the order changed: the selection is fetched again', (code) => {
    expect(isSelectionChanged(conflict(code))).toBe(true);
  });

  it('other refusals and failures do not', () => {
    expect(isSelectionChanged(conflict('INVOICE_EXCESS_UNRESOLVED'))).toBe(false);
    expect(isSelectionChanged(conflict('DISCOUNT_EXCEEDS_SELECTION'))).toBe(false);
    expect(isSelectionChanged(conflict('BILLING_REQUEST_FAILED', 502))).toBe(false);
    expect(isSelectionChanged(new Error('network'))).toBe(false);
  });
});
