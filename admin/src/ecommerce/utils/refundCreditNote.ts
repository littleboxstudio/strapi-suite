import { returnValue } from './invoiceForm';
import type {
  InvoiceLine,
  InvoiceView,
  RefundCreditLineOption,
  RefundCreditNoteInput,
  RefundCreditNoteOptions,
  RefundElementInvoice,
  RefundItem,
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
  // A promotional gift (invoiced at 0): its units are worth 0.
  if (option.kind === 'ITEM' && option.valueLeft === 0) return 0;
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

/** Σ of the chosen elements' values (the INVOICED refund amount), as the server values them. */
export function refundElementsTotal(
  invoices: RefundElementInvoice[],
  selection: RefundCreditSelection,
  lineOf?: InvoiceLineLookup
): number {
  let total = 0;
  for (const invoice of invoices) {
    for (const option of invoice.lines) {
      const quantity = quantityOf(selection, invoice.invoiceId, option.index);
      total += refundOptionValue(option, quantity, lineOf?.(invoice.invoiceId, option.index));
    }
  }
  return total;
}

/** Every chosen quantity is a whole number of units, at most what is left of its element. */
export function refundElementsFit(invoices: RefundElementInvoice[], selection: RefundCreditSelection): boolean {
  return invoices.every((invoice) =>
    invoice.lines.every((option) => {
      const quantity = quantityOf(selection, invoice.invoiceId, option.index);
      return Number.isInteger(quantity) && quantity >= 0 && quantity <= option.quantityLeft;
    })
  );
}

/** Selected (Σ of the chosen elements), Refund (its amount) and Difference (refund − selected). */
export function refundCreditSummary(
  options: RefundCreditNoteOptions,
  selection: RefundCreditSelection,
  lineOf?: InvoiceLineLookup
): { selected: number; refund: number; difference: number } {
  const selected = refundElementsTotal(options.invoices, selection, lineOf);
  const refund = options.refund.amount;
  return { selected, refund, difference: refund - selected };
}

/** The request items: chosen elements only, in invoice and line order. */
export function refundCreditItems(
  options: Pick<RefundCreditNoteOptions, 'invoices'>,
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
  return refundElementsFit(options.invoices, selection) && refundCreditSummary(options, selection, lineOf).difference === 0;
}

/** The selection of stored elements (`items`/`selected`), keyed by element. */
export function selectionFromItems(items: Pick<RefundItem, 'invoiceId' | 'index' | 'quantity'>[] | undefined): RefundCreditSelection {
  const selection: RefundCreditSelection = {};
  for (const item of items ?? []) selection[selectionKey(item.invoiceId, item.index)] = item.quantity;
  return selection;
}

/**
 * How the refund credit note picks its elements:
 * - STORED: the refund's own elements, all still offered with their units: fixed, stored values;
 * - FREE: a legacy refund (none stored): any elements adding up to the refund;
 * - UNAVAILABLE: a stored element is no longer creditable: any elements adding up to the refund.
 */
export function refundCreditMode(options: RefundCreditNoteOptions): 'STORED' | 'FREE' | 'UNAVAILABLE' {
  const selected = options.selected ?? [];
  if (!selected.length) return 'FREE';
  const offered = selected.every((item) => {
    const option = options.invoices
      .find((i) => i.invoiceId === item.invoiceId)
      ?.lines.find((l) => l.index === item.index);
    return !!option && item.quantity <= option.quantityLeft;
  });
  return offered ? 'STORED' : 'UNAVAILABLE';
}

/**
 * The mode after a refused Issue: STORED becomes UNAVAILABLE when the server answers that one of
 * the refund's elements is no longer creditable (`REFUND_ELEMENTS_UNAVAILABLE`); any other answer
 * (or mode) keeps it.
 */
export function refundCreditModeAfterError(
  mode: ReturnType<typeof refundCreditMode>,
  errors: { path?: string; code: string }[]
): ReturnType<typeof refundCreditMode> {
  return mode === 'STORED' && errors.some((e) => e.code === 'REFUND_ELEMENTS_UNAVAILABLE') ? 'UNAVAILABLE' : mode;
}

/** The request items of the STORED mode: exactly the refund's own elements. */
export function storedCreditItems(options: RefundCreditNoteOptions): RefundCreditNoteInput['items'] {
  return (options.selected ?? []).map(({ invoiceId, index, quantity }) => ({ invoiceId, index, quantity }));
}

/** Whether an element is a promotional gift's units (an ITEM invoiced at 0). */
export const isZeroValueElement = (option: RefundCreditLineOption): boolean =>
  option.kind === 'ITEM' && option.valueLeft === 0;

/** The ids of the order's gift lines: an element shows the gift badge by its `orderLineId`. */
export function giftOrderLineIds(lines: { id: number; isGift?: boolean | null }[]): Set<number> {
  return new Set(lines.filter((l) => l.isGift).map((l) => l.id));
}

export type RefundItemRow = {
  key: string;
  /** The invoice number, or `#id` while it has none (or is not listed). */
  invoice: string;
  kind: InvoiceLine['kind'];
  /** The order line the invoice line invoiced (the gift badge); null when unknown. */
  orderLineId: number | null;
  /** The invoice line's name; null when the line is not listed. */
  name: string | null;
  quantity: number;
  value: number;
};

/** A refund's elements for display, named from the order's invoices, in stored order. */
export function refundItemRows(items: RefundItem[], invoices: InvoiceView[]): RefundItemRow[] {
  return items.map((item) => {
    const invoice = invoices.find((i) => i.id === item.invoiceId);
    const line = invoice?.lines?.[item.index];
    return {
      key: selectionKey(item.invoiceId, item.index),
      invoice: invoice?.number || `#${item.invoiceId}`,
      kind: line?.kind ?? 'ITEM',
      orderLineId: line?.orderLineId ?? null,
      name: line?.name ?? null,
      quantity: item.quantity,
      value: item.value,
    };
  });
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
 * - Credit note: billing active, none yet, order not archived, refund COMPLETED, an amount above 0
 *   (a units-only refund of gifts has nothing to credit);
 * - PDF: its credit note issued;
 * - Remove: the server's `removable` (the remove rules, a used store credit included). An older
 *   server sends none: then no credit note, order not archived, refund COMPLETED, not STRIPE.
 */
export function refundRowActions(
  refund: Pick<RefundView, 'scope' | 'creditNoteId' | 'status' | 'method' | 'removable'> &
    Partial<Pick<RefundView, 'amount'>>,
  ctx: RefundRowContext
): { creditNote: boolean; pdf: boolean; remove: boolean } {
  const invoiced = refund.scope === 'INVOICED';
  const open = invoiced && refund.creditNoteId == null && !ctx.archived && refund.status === 'COMPLETED';
  const removable =
    typeof refund.removable === 'boolean' ? refund.removable : open && refund.method !== 'STRIPE';
  return {
    creditNote: open && ctx.billingActive && ctx.canInvoice && (refund.amount === undefined || refund.amount > 0),
    pdf: invoiced && refund.creditNoteId != null && ctx.creditNote?.status === 'ISSUED',
    remove: removable && ctx.canRefund,
  };
}
