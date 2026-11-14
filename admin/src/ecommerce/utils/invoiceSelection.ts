import type { InvoiceSelectionView, IssueInvoiceSelectionInput, OrderPayment } from '../orderTypes';
import type { FormErrors } from './shipmentForm';

type SelectionLine = InvoiceSelectionView['lines'][number];

/** One quantity per order line (0 = not invoiced), the shipping lines and payments ticked. */
export type InvoiceSelectionForm = {
  quantities: Record<number, number>;
  shipping: number[];
  payments: number[];
};

/** Value of `quantity` of the `remainingQuantity` units worth `remainingValue` (same as the server). */
export const selectedValue = (remainingValue: number, remainingQuantity: number, quantity: number): number => {
  if (remainingQuantity <= 0) return 0;
  if (quantity === remainingQuantity) return remainingValue;
  return Math.floor((remainingValue * quantity) / remainingQuantity);
};

/** Display only: the average value of a remaining unit. */
export function unitValue(line: SelectionLine): number {
  return line.remainingQuantity > 0 ? Math.round(line.remainingValue / line.remainingQuantity) : 0;
}

/** Everything the selection offers is ticked, every product at its full remaining quantity. */
export function defaultInvoiceSelectionForm(view: InvoiceSelectionView): InvoiceSelectionForm {
  return {
    quantities: Object.fromEntries(view.lines.map((l) => [l.orderLineId, l.remainingQuantity])),
    shipping: view.shipping.map((s) => s.shippingLineId),
    payments: view.payments.map((p) => p.paymentId),
  };
}

const quantityOf = (form: InvoiceSelectionForm, line: SelectionLine): number =>
  form.quantities[line.orderLineId] ?? 0;

/** `quantities.<orderLineId>`: exceeds_remaining (or invalid for a non-integer / negative one). */
export function validateInvoiceSelection(view: InvoiceSelectionView, form: InvoiceSelectionForm): FormErrors {
  const errors: FormErrors = {};
  for (const line of view.lines) {
    const q = quantityOf(form, line);
    if (!Number.isInteger(q) || q < 0) errors[`quantities.${line.orderLineId}`] = 'invalid';
    else if (q > line.remainingQuantity) errors[`quantities.${line.orderLineId}`] = 'exceeds_remaining';
  }
  return errors;
}

/** Selected products + shipping, the ticked payments' net, and whether the invoice can be issued. */
export function invoiceSelectionTotals(
  view: InvoiceSelectionView,
  form: InvoiceSelectionForm
): { selected: number; payments: number; difference: number; canIssue: boolean } {
  const lines = view.lines.reduce((sum, l) => {
    const q = quantityOf(form, l);
    return Number.isInteger(q) && q > 0 && q <= l.remainingQuantity
      ? sum + selectedValue(l.remainingValue, l.remainingQuantity, q)
      : sum;
  }, 0);
  const shipping = view.shipping.filter((s) => form.shipping.includes(s.shippingLineId)).reduce((a, s) => a + s.value, 0);
  const payments = view.payments.filter((p) => form.payments.includes(p.paymentId)).reduce((a, p) => a + p.net, 0);
  const selected = lines + shipping;
  const noErrors = Object.keys(validateInvoiceSelection(view, form)).length === 0;
  return {
    selected,
    payments,
    difference: selected - payments,
    canIssue: noErrors && view.excess === 0 && selected === payments && payments > 0,
  };
}

/** The request body of a selection the server will price again; quantity-0 lines are left out. */
export function buildIssueInvoiceInput(
  view: InvoiceSelectionView,
  form: InvoiceSelectionForm,
  idempotencyKey: string
): IssueInvoiceSelectionInput {
  return {
    lines: view.lines
      .map((l) => ({ orderLineId: l.orderLineId, quantity: quantityOf(form, l) }))
      .filter((l) => l.quantity > 0),
    shippingLineIds: view.shipping.map((s) => s.shippingLineId).filter((id) => form.shipping.includes(id)),
    paymentIds: view.payments.map((p) => p.paymentId).filter((id) => form.payments.includes(id)),
    expectedTotal: invoiceSelectionTotals(view, form).selected,
    idempotencyKey,
  };
}

/**
 * Value of the order no remaining unit or shipping line can carry (it changed after it was
 * invoiced): never selectable, a Correction credit note and a new invoice take it up.
 */
export const strandedValue = (view: InvoiceSelectionView): number =>
  view.stranded.products + view.stranded.shipping;

export type SelectionPaymentRow = InvoiceSelectionView['payments'][number] & {
  method: string | null;
  methodLabel: string | null;
  /** Completed, else created; null when the order does not list the payment. */
  date: string | null;
};

/** The selectable payments, each joined with the order's payment for its method and date. */
export function selectionPayments(view: InvoiceSelectionView, payments: OrderPayment[]): SelectionPaymentRow[] {
  const byId = new Map(payments.map((p) => [p.id, p]));
  return view.payments.map((row) => {
    const payment = byId.get(row.paymentId);
    return {
      ...row,
      method: payment?.method ?? null,
      methodLabel: payment?.methodLabel ?? null,
      date: payment ? (payment.completedAt ?? payment.createdAt) : null,
    };
  });
}
