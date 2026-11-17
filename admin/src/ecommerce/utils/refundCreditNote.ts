import { returnValue } from './invoiceForm';
import type {
  InvoiceLine,
  InvoiceView,
  RefundCreditLineOption,
  RefundCreditNoteInput,
  RefundCreditNoteOptions,
  RefundView,
} from '../orderTypes';

/** The units chosen per element, keyed by `selectionKey(invoiceId, index)`. */
export type RefundCreditSelection = Record<string, number>;

export const selectionKey = (invoiceId: number, index: number): string => `${invoiceId}:${index}`;

/** The invoice line an option credits, to value its units as the server does (its discount share). */
export type InvoiceLineLookup = (invoiceId: number, index: number) => InvoiceLine | undefined;

/**
 * Value of `quantity` of an element, as the server values it: 0 for none or more than left; a
 * shipping line whole; all the units left take the whole value left; otherwise the RETURN share
 * rule (`invoiceLine` gives the discount share), or one unit's value when the line is unknown.
 */
export function refundOptionValue(
  option: RefundCreditLineOption,
  quantity: number,
  invoiceLine?: InvoiceLine
): number {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > option.quantityLeft) return 0;
  if (option.kind === 'SHIPPING' || quantity === option.quantityLeft) return option.valueLeft;
  if (!invoiceLine && quantity === 1) return option.unitValue;
  return returnValue(
    { index: option.index, units: option.quantityLeft, unitsLeft: option.quantityLeft, valueLeft: option.valueLeft },
    quantity,
    invoiceLine
  );
}

const quantityOf = (selection: RefundCreditSelection, invoiceId: number, index: number): number =>
  selection[selectionKey(invoiceId, index)] ?? 0;

/** Selected (Σ of the chosen elements), Refund (its amount) and Difference (refund − selected). */
export function refundCreditSummary(
  options: RefundCreditNoteOptions,
  selection: RefundCreditSelection,
  lineOf?: InvoiceLineLookup
): { selected: number; refund: number; difference: number } {
  let selected = 0;
  for (const invoice of options.invoices) {
    for (const option of invoice.lines) {
      const quantity = quantityOf(selection, invoice.invoiceId, option.index);
      selected += refundOptionValue(option, quantity, lineOf?.(invoice.invoiceId, option.index));
    }
  }
  const refund = options.refund.amount;
  return { selected, refund, difference: refund - selected };
}

/** The request items: chosen elements only, in invoice and line order. */
export function refundCreditItems(
  options: RefundCreditNoteOptions,
  selection: RefundCreditSelection
): RefundCreditNoteInput['items'] {
  return options.invoices.flatMap((invoice) =>
    invoice.lines
      .map((option) => ({
        invoiceId: invoice.invoiceId,
        index: option.index,
        quantity: quantityOf(selection, invoice.invoiceId, option.index),
      }))
      .filter((item) => item.quantity > 0)
  );
}

/** Issue: the refund is creditable, something is chosen, every quantity fits and Σ = the refund. */
export function canIssueRefundCredit(
  options: RefundCreditNoteOptions,
  selection: RefundCreditSelection,
  lineOf?: InvoiceLineLookup
): boolean {
  if (!options.creditable) return false;
  const items = refundCreditItems(options, selection);
  if (!items.length) return false;
  const fits = options.invoices.every((invoice) =>
    invoice.lines.every((option) => {
      const quantity = quantityOf(selection, invoice.invoiceId, option.index);
      return Number.isInteger(quantity) && quantity >= 0 && quantity <= option.quantityLeft;
    })
  );
  return fits && refundCreditSummary(options, selection, lineOf).difference === 0;
}

export type RefundRowContext = {
  /** A billing provider (Moloni) is active. */
  billingActive: boolean;
  archived: boolean;
  /** `refunds.manage`: Remove. */
  canRefund: boolean;
  /** `invoicing.manage`: Credit note. */
  canInvoice: boolean;
  /** The refund's credit note, when the order lists it. */
  creditNote: Pick<InvoiceView, 'status'> | null;
};

/**
 * The actions of a refund (plan 15), only for INVOICED ones:
 * - Credit note: billing active, none yet, order not archived, refund COMPLETED;
 * - PDF: its credit note issued;
 * - Remove: no credit note, order not archived, refund COMPLETED, not STRIPE (a used store credit
 *   is refused by the server).
 */
export function refundRowActions(
  refund: Pick<RefundView, 'scope' | 'creditNoteId' | 'status' | 'method'>,
  ctx: RefundRowContext
): { creditNote: boolean; pdf: boolean; remove: boolean } {
  const invoiced = refund.scope === 'INVOICED';
  const open = invoiced && refund.creditNoteId == null && !ctx.archived && refund.status === 'COMPLETED';
  return {
    creditNote: open && ctx.billingActive && ctx.canInvoice,
    pdf: invoiced && refund.creditNoteId != null && ctx.creditNote?.status === 'ISSUED',
    remove: open && refund.method !== 'STRIPE' && ctx.canRefund,
  };
}
