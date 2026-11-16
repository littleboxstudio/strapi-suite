import type { AppliedPromotion, InvoiceSelectionView, IssueInvoiceInput, OrderLine, OrderPayment } from '../orderTypes';
import type { FormErrors } from './shipmentForm';
import { apiErrorCode, linePromotionNames, type PromotionLocales } from './orderDetail';

/** The whole items ticked: order lines, shipping lines, discounts and payments. */
export type InvoiceSelectionForm = {
  orderLineIds: number[];
  shippingLineIds: number[];
  discountIds: string[];
  paymentIds: number[];
};

/** Everything the selection offers is ticked. */
export function defaultInvoiceSelectionForm(view: InvoiceSelectionView): InvoiceSelectionForm {
  return {
    orderLineIds: view.lines.map((l) => l.orderLineId),
    shippingLineIds: view.shipping.map((s) => s.shippingLineId),
    discountIds: view.discounts.map((d) => d.id),
    paymentIds: view.payments.map((p) => p.paymentId),
  };
}

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);

/** The ticked items of the view, in its order (ids the view does not offer are ignored). */
function selected(view: InvoiceSelectionView, form: InvoiceSelectionForm) {
  return {
    lines: view.lines.filter((l) => form.orderLineIds.includes(l.orderLineId)),
    shipping: view.shipping.filter((s) => form.shippingLineIds.includes(s.shippingLineId)),
    discounts: view.discounts.filter((d) => form.discountIds.includes(d.id)),
    payments: view.payments.filter((p) => form.paymentIds.includes(p.paymentId)),
  };
}

/** Selected products + shipping − discounts (the invoice total) against the ticked payments' net. */
export function invoiceSelectionTotals(
  view: InvoiceSelectionView,
  form: InvoiceSelectionForm
): { lines: number; shipping: number; discounts: number; total: number; payments: number; difference: number } {
  const s = selected(view, form);
  const lines = sum(s.lines.map((l) => l.value));
  const shipping = sum(s.shipping.map((l) => l.value));
  const discounts = sum(s.discounts.map((d) => d.amount));
  const total = lines + shipping - discounts;
  const payments = sum(s.payments.map((p) => p.net));
  return { lines, shipping, discounts, total, payments, difference: total - payments };
}

/**
 * As the server: something to invoice (`orderLineIds`: required) and a payment (`paymentIds`:
 * required); the ORDER discounts at most the selected lines and, when a SHIPPING discount is
 * ticked, the SHIPPING discounts at most the selected shipping (`discountIds`:
 * DISCOUNT_EXCEEDS_SELECTION).
 */
export function validateInvoiceSelection(view: InvoiceSelectionView, form: InvoiceSelectionForm): FormErrors {
  const errors: FormErrors = {};
  const s = selected(view, form);
  if (!s.lines.length && !s.shipping.length && !s.discounts.length) errors.orderLineIds = 'required';
  if (!s.payments.length) errors.paymentIds = 'required';
  const pool = (kind: 'ORDER' | 'SHIPPING') => sum(s.discounts.filter((d) => d.kind === kind).map((d) => d.amount));
  const orderDiscounts = pool('ORDER');
  const shippingDiscounts = pool('SHIPPING');
  if (
    orderDiscounts > sum(s.lines.map((l) => l.value)) ||
    (shippingDiscounts > 0 && shippingDiscounts > sum(s.shipping.map((l) => l.value)))
  ) {
    errors.discountIds = 'DISCOUNT_EXCEEDS_SELECTION';
  }
  return errors;
}

/** No errors, no excess to refund, a positive total equal to the ticked payments. */
export function canIssueInvoice(view: InvoiceSelectionView, form: InvoiceSelectionForm): boolean {
  const totals = invoiceSelectionTotals(view, form);
  return (
    Object.keys(validateInvoiceSelection(view, form)).length === 0 &&
    view.excess === 0 &&
    totals.difference === 0 &&
    totals.total > 0
  );
}

/** The request body of a selection the server will price again; ids in the view's order. */
export function buildIssueInvoiceInput(
  view: InvoiceSelectionView,
  form: InvoiceSelectionForm,
  idempotencyKey: string
): IssueInvoiceInput {
  const s = selected(view, form);
  return {
    orderLineIds: s.lines.map((l) => l.orderLineId),
    shippingLineIds: s.shipping.map((l) => l.shippingLineId),
    discountIds: s.discounts.map((d) => d.id),
    paymentIds: s.payments.map((p) => p.paymentId),
    expectedTotal: invoiceSelectionTotals(view, form).total,
    idempotencyKey,
  };
}

/** Items of an unexplained difference: their server label is a placeholder, translated by id. */
const ADJUSTMENT_IDS: Record<string, string> = {
  'adj:order': 'ecommerce.orders.invoices.issue.adjustment.order',
  'adj:shipping': 'ecommerce.orders.invoices.issue.adjustment.shipping',
};

/** A discount item's label: a translation id (no plugin prefix) for an adjustment, else its text. */
export function discountItemLabel(item: { id: string; label: string }): { id: string } | { text: string } {
  const id = ADJUSTMENT_IDS[item.id];
  return id ? { id } : { text: item.label };
}

/** What discounted a selection line: its promotions' names and the admin's manual percent. */
export function selectionLineDiscount(
  orderLineId: number,
  orderLines: Pick<OrderLine, 'id' | 'promotionIds' | 'manualDiscountPercent'>[],
  promotions: AppliedPromotion[],
  locales: PromotionLocales
): { promotionNames: string[]; manualPercent: number | null } {
  const line = orderLines.find((l) => l.id === orderLineId);
  if (!line) return { promotionNames: [], manualPercent: null };
  return {
    promotionNames: linePromotionNames(line.promotionIds, promotions, locales),
    manualPercent: line.manualDiscountPercent ?? null,
  };
}

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

/** Refusals that mean the order changed since the selection was fetched: fetch it again. */
const SELECTION_CHANGED_CODES = [
  'TOTAL_CHANGED',
  'LINE_ALREADY_INVOICED',
  'SHIPPING_LINE_NOT_INVOICEABLE',
  'DISCOUNT_NOT_INVOICEABLE',
  'PAYMENT_NOT_INVOICEABLE',
];

export function isSelectionChanged(err: unknown): boolean {
  const code = apiErrorCode(err);
  return code !== null && SELECTION_CHANGED_CODES.includes(code);
}
