import { API_ERROR_CODES } from './orderDetail';
import { selectedValue } from './invoiceSelection';
import type { FormErrors } from './shipmentForm';
import type { BadgeVariant } from './statusBadges';
import type { CreditNoteInput, CreditNoteOptions, CreditType, InvoiceView } from '../orderTypes';

/** Mirrors the server limit of the credit note reason. */
export const MAX_CREDIT_NOTE_REASON = 500;

/**
 * A credit note: the reason (RETURN credits chosen returned units and whole shipping lines;
 * CORRECTION credits everything left), units per ITEM line index, ticked SHIPPING line indexes,
 * and the details text.
 */
export type CreditNoteForm = {
  creditType: CreditType;
  quantities: Record<number, number>;
  shipping: number[];
  reason: string;
};

/** A RETURN is possible: some line has returned units left to credit (lines with 0 are listed too). */
export const hasReturnable = (options: Pick<CreditNoteOptions, 'returnable'>): boolean =>
  options.returnable.some((r) => r.units > 0);

/** RETURN when something is returnable, else CORRECTION; nothing chosen. */
export function emptyCreditNoteForm(
  options: Pick<CreditNoteOptions, 'returnable'>
): CreditNoteForm {
  return {
    creditType: hasReturnable(options) ? 'RETURN' : 'CORRECTION',
    quantities: {},
    shipping: [],
    reason: '',
  };
}

const quantityOf = (form: CreditNoteForm, index: number): number => form.quantities[index] ?? 0;

/**
 * RETURN: each quantity ≤ its line's returnable units (`quantities.<index>`: exceeds_creditable)
 * and at least one unit or shipping line (`lines`: required). Both: a reason of at most 500
 * characters.
 */
export function validateCreditNoteForm(
  form: CreditNoteForm,
  options: CreditNoteOptions
): FormErrors {
  const errors: FormErrors = {};
  if (form.creditType === 'RETURN') {
    let chosen = form.shipping.some((index) => options.shipping.some((s) => s.index === index));
    for (const r of options.returnable) {
      const quantity = quantityOf(form, r.index);
      if (quantity > r.units) errors[`quantities.${r.index}`] = 'exceeds_creditable';
      else if (quantity > 0) chosen = true;
    }
    if (!chosen && !Object.keys(errors).length) errors.lines = 'required';
  }
  const reason = form.reason.trim();
  if (!reason) errors.reason = 'required';
  else if (reason.length > MAX_CREDIT_NOTE_REASON) errors.reason = 'too_long';
  return errors;
}

/** Value of `quantity` units of a returnable line (as the server); 0 when above its units. */
export const returnValue = (
  line: CreditNoteOptions['returnable'][number],
  quantity: number
): number =>
  quantity > 0 && quantity <= line.units
    ? selectedValue(line.valueLeft, line.unitsLeft, quantity)
    : 0;

/** Total in cents: RETURN Σ the chosen units and ticked shipping lines; CORRECTION all that is left. */
export function creditNoteTotal(form: CreditNoteForm, options: CreditNoteOptions): number {
  if (form.creditType === 'CORRECTION') return options.correction.total;
  const lines = options.returnable.reduce(
    (sum, r) => sum + returnValue(r, quantityOf(form, r.index)),
    0
  );
  const shipping = options.shipping
    .filter((s) => form.shipping.includes(s.index))
    .reduce((sum, s) => sum + s.value, 0);
  return lines + shipping;
}

/** The request body of a form `validateCreditNoteForm` accepted. */
export function buildCreditNoteInput(
  form: CreditNoteForm,
  idempotencyKey: string
): CreditNoteInput {
  const reason = form.reason.trim();
  if (form.creditType === 'CORRECTION') return { creditType: 'CORRECTION', reason, idempotencyKey };
  const lines = Object.entries(form.quantities)
    .map(([index, quantity]) => ({ index: Number(index), quantity }))
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.index - b.index);
  return {
    creditType: 'RETURN',
    lines,
    shippingIndexes: [...form.shipping],
    reason,
    idempotencyKey,
  };
}

/** Badge variant of an invoice status. */
export function invoiceStatusTone(status: string): BadgeVariant {
  switch (status) {
    case 'ISSUED':
      return 'success';
    case 'PENDING':
      return 'secondary';
    case 'UNCERTAIN':
      return 'warning';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export type InvoiceAction = 'PDF' | 'RECONCILE' | 'MARK_FAILED' | 'CREDIT_NOTE';

/**
 * Row actions: the PDF of an issued document (orders.read); with invoicing.manage, Reconcile and
 * Mark as failed when the server says the row is reconcilable, and a credit note on an issued
 * invoice that still has something to credit.
 */
export function invoiceActions(
  invoice: Pick<InvoiceView, 'kind' | 'status' | 'total' | 'credited' | 'reconcilable'>,
  canInvoice: boolean
): InvoiceAction[] {
  const actions: InvoiceAction[] = [];
  if (invoice.status === 'ISSUED') actions.push('PDF');
  if (!canInvoice) return actions;
  if (invoice.reconcilable && (invoice.status === 'UNCERTAIN' || invoice.status === 'PENDING')) {
    actions.push('RECONCILE', 'MARK_FAILED');
  }
  if (invoice.kind === 'INVOICE' && invoice.status === 'ISSUED' && invoice.total - invoice.credited > 0) {
    actions.push('CREDIT_NOTE');
  }
  return actions;
}

/** Actions that live in the document's detail modal, next to the explanation, not in the row. */
const DETAIL_ACTIONS: InvoiceAction[] = ['RECONCILE', 'MARK_FAILED'];

export const isDetailAction = (action: InvoiceAction) => DETAIL_ACTIONS.includes(action);

/**
 * The row has more than its badge to tell (an explanation of the status, a warning, or the
 * Reconcile / Mark as failed actions): the row opens a modal with it.
 */
export function invoiceHasDetails(
  invoice: Pick<InvoiceView, 'status' | 'error' | 'warnings'>,
  actions: InvoiceAction[]
): boolean {
  return (
    invoice.status === 'UNCERTAIN' ||
    invoice.status === 'PENDING' ||
    (invoice.status === 'FAILED' && !!invoice.error) ||
    invoice.warnings.length > 0 ||
    actions.some(isDetailAction)
  );
}

/** `error` values the server stores on a FAILED invoice that are not API error codes. */
const FAILURE_CODES = ['MARKED_FAILED', 'NOT_FOUND_AT_PROVIDER'];

/** Translation id (without the plugin prefix) of an invoice's stored error; null when unknown. */
export function invoiceFailureMessageId(code: string): string | null {
  if (FAILURE_CODES.includes(code)) return `ecommerce.orders.invoices.failure.${code}`;
  if ((API_ERROR_CODES as readonly string[]).includes(code)) return `ecommerce.orders.errors.${code}`;
  return null;
}

/** A replayed key returned the stored row of an attempt the provider refused. */
export function isFailedReplay(doc: Pick<InvoiceView, 'status'>): boolean {
  return doc.status === 'FAILED';
}

/** The provider did not confirm the document: it must be reconciled, never re-issued by hand. */
export function isUncertainResult(doc: Pick<InvoiceView, 'status'>): boolean {
  return doc.status === 'UNCERTAIN' || doc.status === 'PENDING';
}

/** Warnings of a just-issued document the admin has to act on at the provider. */
const ISSUE_WARNINGS = ['TOTAL_MISMATCH', 'RECEIPT_FAILED'];
export function issuedWarnings(doc: Pick<InvoiceView, 'warnings'>): string[] {
  return doc.warnings.filter((w) => ISSUE_WARNINGS.includes(w));
}

/** "Mark as failed" is sent only for a row the server reconciles, after the explicit confirmation. */
export function canMarkFailed(
  invoice: Pick<InvoiceView, 'status' | 'reconcilable'>,
  confirmed: boolean
): boolean {
  return (
    confirmed && invoice.reconcilable && (invoice.status === 'UNCERTAIN' || invoice.status === 'PENDING')
  );
}
