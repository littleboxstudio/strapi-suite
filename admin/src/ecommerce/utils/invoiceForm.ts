import { formatAmountInput, parseMoneyToCents } from './money';
import { API_ERROR_CODES } from './orderDetail';
import type { FormErrors } from './shipmentForm';
import type { BadgeVariant } from './statusBadges';
import type { CreditNoteInput, CreditNotePreview, InvoiceView } from '../orderTypes';

/** Mirrors the server limit of the credit note reason. */
export const MAX_CREDIT_NOTE_REASON = 500;

/** One amount per invoice line (`index` is the line's position in the invoice). */
export type CreditNoteLineDraft = { index: number; amount: string };
export type CreditNoteForm = { lines: CreditNoteLineDraft[]; reason: string };

/** Every invoice line, prefilled with the server suggestion (capped by what is creditable). */
export function emptyCreditNoteForm(
  preview: Pick<CreditNotePreview, 'lines' | 'creditable' | 'suggested'>,
  locale: string
): CreditNoteForm {
  return {
    lines: preview.lines.map((_, index) => {
      const value = Math.min(preview.suggested[index] ?? 0, preview.creditable[index] ?? 0);
      return { index, amount: value > 0 ? formatAmountInput(value, locale) : '' };
    }),
    reason: '',
  };
}

/** An empty amount counts as 0; null when the text is not an amount. */
const amountOf = (text: string): number | null => (text.trim() ? parseMoneyToCents(text) : 0);

/**
 * Each amount ≤ the creditable value of its line (`lines.<index>`: invalid_amount /
 * exceeds_creditable), a total above 0 (`lines: required`) and a reason of at most 500 characters.
 */
export function validateCreditNoteForm(form: CreditNoteForm, creditable: number[]): FormErrors {
  const errors: FormErrors = {};
  let total = 0;
  for (const line of form.lines) {
    const value = amountOf(line.amount);
    if (value === null) errors[`lines.${line.index}`] = 'invalid_amount';
    else if (value > (creditable[line.index] ?? 0)) errors[`lines.${line.index}`] = 'exceeds_creditable';
    else total += value;
  }
  if (!total && !Object.keys(errors).length) errors.lines = 'required';
  const reason = form.reason.trim();
  if (!reason) errors.reason = 'required';
  else if (reason.length > MAX_CREDIT_NOTE_REASON) errors.reason = 'too_long';
  return errors;
}

/** Σ of the valid amounts, in cents. */
export function creditNoteTotal(form: CreditNoteForm): number {
  return form.lines.reduce((sum, line) => sum + (amountOf(line.amount) ?? 0), 0);
}

/** The request body of a form `validateCreditNoteForm` accepted. */
export function buildCreditNoteInput(form: CreditNoteForm, idempotencyKey: string): CreditNoteInput {
  return {
    lines: form.lines
      .map((l) => ({ index: l.index, value: amountOf(l.amount) ?? 0 }))
      .filter((l) => l.value > 0),
    reason: form.reason.trim(),
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

/** Some payment still has an amount to invoice (archiving does not require it). */
export function hasUninvoicedPayments(payments: { invoice?: { invoiceable: number } | null }[]): boolean {
  return payments.some((p) => (p.invoice?.invoiceable ?? 0) > 0);
}

/** `error` values the server stores on a FAILED invoice that are not API error codes. */
const FAILURE_CODES = ['MARKED_FAILED', 'NOT_FOUND_AT_PROVIDER'];

/** Translation id (without the plugin prefix) of an invoice's stored error; null when unknown. */
export function invoiceFailureMessageId(code: string): string | null {
  if (FAILURE_CODES.includes(code)) return `ecommerce.orders.invoices.failure.${code}`;
  if ((API_ERROR_CODES as readonly string[]).includes(code)) return `ecommerce.orders.errors.${code}`;
  return null;
}
