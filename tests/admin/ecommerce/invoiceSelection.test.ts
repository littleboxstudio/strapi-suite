import { describe, it, expect } from 'vitest';
import {
  buildIssueInvoiceInput,
  defaultInvoiceSelectionForm,
  invoiceSelectionTotals,
  isSelectionChanged,
  quantityErrorMessage,
  selectedValue,
  selectionPayments,
  strandedValue,
  unitValue,
  validateInvoiceSelection,
} from '../../../admin/src/ecommerce/utils/invoiceSelection';
import type { InvoiceSelectionView, OrderPayment } from '../../../admin/src/ecommerce/orderTypes';

const view = (over: Partial<InvoiceSelectionView> = {}): InvoiceSelectionView => ({
  lines: [
    { orderLineId: 1, sku: 'A', name: 'A', option: null, tax: 23, isGift: false, remainingQuantity: 3, remainingValue: 3000 },
    { orderLineId: 2, sku: 'B', name: 'B', option: null, tax: 23, isGift: false, remainingQuantity: 1, remainingValue: 1000 },
  ],
  shipping: [{ shippingLineId: 9, name: 'CTT', tax: 23, origin: 'CHECKOUT', createdAt: '2026-01-01', value: 500 }],
  payments: [{ paymentId: 7, amount: 4500, refunded: 0, net: 4500 }],
  excess: 0,
  stranded: { products: 0, shipping: 0 },
  ...over,
});

describe('selectedValue', () => {
  it('matches the server vectors', () => {
    expect(selectedValue(1000, 3, 1)).toBe(333);
    expect(selectedValue(1000, 3, 3)).toBe(1000);
    expect(selectedValue(1000, 3, 2)).toBe(666);
    expect(selectedValue(1000, 3, 0)).toBe(0);
    expect(selectedValue(0, 0, 0)).toBe(0);
  });
});

describe('unitValue', () => {
  it('rounds remainingValue / remainingQuantity', () => {
    expect(unitValue(view().lines[0])).toBe(1000);
    expect(unitValue({ ...view().lines[0], remainingValue: 1000, remainingQuantity: 3 })).toBe(333);
  });
});

describe('defaultInvoiceSelectionForm', () => {
  it('selects everything', () => {
    expect(defaultInvoiceSelectionForm(view())).toEqual({ quantities: { 1: 3, 2: 1 }, shipping: [9], payments: [7] });
  });
});

describe('invoiceSelectionTotals', () => {
  it('can issue when selection equals the payments', () => {
    const v = view();
    expect(invoiceSelectionTotals(v, defaultInvoiceSelectionForm(v))).toEqual({
      selected: 4500,
      payments: 4500,
      difference: 0,
      canIssue: true,
    });
  });

  it('unticking the payment blocks', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), payments: [] };
    expect(invoiceSelectionTotals(v, form)).toEqual({ selected: 4500, payments: 0, difference: 4500, canIssue: false });
  });

  it('excess blocks even when equal', () => {
    const v = view({ excess: 1000 });
    expect(invoiceSelectionTotals(v, defaultInvoiceSelectionForm(v)).canIssue).toBe(false);
  });

  it('a quantity above the remaining is an error and blocks', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), quantities: { 1: 4, 2: 1 } };
    expect(validateInvoiceSelection(v, form)).toEqual({ 'quantities.1': 'exceeds_remaining' });
    expect(invoiceSelectionTotals(v, form).canIssue).toBe(false);
  });

  it('a partial quantity uses the shared formula', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), quantities: { 1: 1, 2: 0 }, shipping: [] };
    expect(invoiceSelectionTotals(v, form).selected).toBe(1000);
  });
});

describe('buildIssueInvoiceInput', () => {
  it('leaves quantity 0 out and sets expectedTotal', () => {
    const v = view();
    const form = { ...defaultInvoiceSelectionForm(v), quantities: { 1: 2, 2: 0 } };
    expect(buildIssueInvoiceInput(v, form, 'key')).toEqual({
      lines: [{ orderLineId: 1, quantity: 2 }],
      shippingLineIds: [9],
      paymentIds: [7],
      expectedTotal: 2500,
      idempotencyKey: 'key',
    });
  });
});

describe('strandedValue', () => {
  it('adds the product and shipping value no line can carry', () => {
    expect(strandedValue(view())).toBe(0);
    expect(strandedValue(view({ stranded: { products: 300, shipping: 200 } }))).toBe(500);
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
      { paymentId: 7, amount: 4500, refunded: 0, net: 4500, method: null, methodLabel: null, date: null },
    ]);
  });
});

describe('quantityErrorMessage', () => {
  it('says "at most" only above the remaining units; an invalid quantity says so', () => {
    expect(quantityErrorMessage('exceeds_remaining', 3)).toEqual({
      id: 'ecommerce.orders.invoices.issue.atMost',
      values: { max: 3 },
    });
    expect(quantityErrorMessage('invalid', 3)).toEqual({ id: 'ecommerce.orders.errors.invalid' });
    expect(quantityErrorMessage(undefined, 3)).toBeNull();
  });
});

describe('isSelectionChanged', () => {
  const conflict = (code: string, status = 409) => ({
    response: { data: { error: { status, details: { code, errors: [{ path: 'p', code }] } } } },
  });

  it.each(['TOTAL_CHANGED', 'QUANTITY_EXCEEDS_UNINVOICED', 'SHIPPING_LINE_NOT_INVOICEABLE', 'PAYMENT_NOT_INVOICEABLE'])(
    '%s means the order changed: the selection is fetched again',
    (code) => {
      expect(isSelectionChanged(conflict(code))).toBe(true);
    }
  );

  it('other refusals and failures do not', () => {
    expect(isSelectionChanged(conflict('INVOICE_EXCESS_UNRESOLVED'))).toBe(false);
    expect(isSelectionChanged(conflict('BILLING_REQUEST_FAILED', 502))).toBe(false);
    expect(isSelectionChanged(new Error('network'))).toBe(false);
  });
});
