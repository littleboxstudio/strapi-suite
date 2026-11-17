import { MAX_MONEY_CENTS, type FinancialSummary, type PaymentRecordStatus } from './orders';
import { creditOptions, refundCreditOptions, refundStoredCreditLine } from './creditNotes';
import {
  refundCreditedUnits,
  type InvoiceDoc,
  type InvoicingPosition,
  type PositionOrder,
} from './invoiceSelection';

export const refundableAmount = (summary: FinancialSummary, inFlightRefunds: number): number =>
  Math.max(0, summary.excess - inFlightRefunds);

const MONEY_HOLDING = ['PENDING', 'PROCESSING', 'COMPLETED'];

/** Refund statuses that count for an INVOICED refund's credit adjustment (plan 15). */
const ADJUSTING = ['PENDING', 'PROCESSING', 'COMPLETED'];

/**
 * What the order's INVOICED refunds take off its total (plan 15): Σ of those PENDING, PROCESSING
 * or COMPLETED. Derived from the refunds, never stored: a FAILED or CANCELLED (removed) refund
 * gives its amount back at once. Pass it as `creditAdjustment` to `computeTotals`.
 */
export const invoicedRefundAdjustment = (
  refunds: { scope?: string | null; status: string; amount: unknown }[]
): number =>
  refunds
    .filter((r) => r.scope === 'INVOICED' && ADJUSTING.includes(r.status))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

/**
 * Design 4.7: value paid by store credit is never given back as money. Money refunds
 * (MANUAL_TRANSFER, STRIPE) are capped by the completed payments other than STORE_CREDIT minus
 * the money refunds that hold part of them (in flight or completed).
 */
export const moneyCapacity = (
  payments: { method: string; status: string; amount: number }[],
  refunds: { kind: string; status: string; amount: number }[]
): number => {
  const received = payments
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'STORE_CREDIT')
    .reduce((s, p) => s + p.amount, 0);
  const held = refunds
    .filter((r) => r.kind === 'MONEY' && MONEY_HOLDING.includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  return Math.max(0, received - held);
};

export type RefundSource = {
  paymentId: number;
  method: 'STRIPE' | 'MANUAL' | 'STORE_CREDIT';
  status: PaymentRecordStatus;
  amount: number;
  refundedOrInFlight: number;
  paymentIntentId: string | null;
  completedAt: string;
};

export type RefundAllocation = { paymentId: number; paymentIntentId: string; amount: number };

const stripeCapacity = (s: RefundSource): number =>
  s.method === 'STRIPE' && s.status === 'COMPLETED' && s.paymentIntentId
    ? Math.min(s.amount, Math.max(0, s.amount - s.refundedOrInFlight))
    : 0;

/** Allocates a Stripe refund newest payment first, capped per payment. Callers validate the amount first. */
export const allocateStripeRefund = (
  amount: number,
  sources: RefundSource[]
): { allocations: RefundAllocation[]; unallocated: number } => {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { allocations: [], unallocated: Math.max(0, Math.floor(amount) || 0) };
  }
  const ordered = sources
    .filter((s) => stripeCapacity(s) > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.completedAt) || 0;
      const tb = Date.parse(b.completedAt) || 0;
      if (ta !== tb) return tb - ta;
      return b.paymentId - a.paymentId;
    });
  const allocations: RefundAllocation[] = [];
  let remaining = amount;
  for (const s of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, stripeCapacity(s));
    allocations.push({ paymentId: s.paymentId, paymentIntentId: s.paymentIntentId as string, amount: take });
    remaining -= take;
  }
  return { allocations, unallocated: Math.max(0, remaining) };
};

export type RefundValidationIssue = { path: string; code: string };

export const validateRefundRequest = (
  input: { amount: number; method: string; reason: string | null | undefined },
  ctx: { refundable: number; stripeAvailable: number; moneyRefundable?: number }
): RefundValidationIssue[] => {
  const issues: RefundValidationIssue[] = [];
  const { amount } = input;
  const money = input.method === 'MANUAL_TRANSFER' || input.method === 'STRIPE';
  const moneyRefundable = ctx.moneyRefundable ?? Number.POSITIVE_INFINITY;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_MONEY_CENTS;
  let moneyExceeded = false;
  if (!validAmount) issues.push({ path: 'amount', code: 'invalid_amount' });
  else if (amount > ctx.refundable) issues.push({ path: 'amount', code: 'exceeds_refundable' });
  else if (money && amount > moneyRefundable) {
    moneyExceeded = true;
    issues.push({ path: 'amount', code: 'exceeds_money_refundable' });
  }
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    issues.push({ path: 'reason', code: 'required' });
  }
  if (
    input.method === 'STRIPE' &&
    validAmount &&
    (ctx.stripeAvailable <= 0 || (ctx.stripeAvailable < amount && !moneyExceeded))
  ) {
    issues.push({ path: 'method', code: 'stripe_unavailable' });
  }
  return issues;
};

/**
 * One element an INVOICED refund gave back (plan 15, owner decision): `quantity` whole units of an
 * ITEM line, or a whole SHIPPING line (quantity 1), of invoice `invoiceId`, valued `value` cents
 * when the refund was created (the refund credit note's rule). The refund amount is their sum.
 */
export type RefundItem = { invoiceId: number; index: number; quantity: number; value: number };

type RefundLike = { id?: unknown; scope?: string | null; status: string; amount: unknown; metadata?: unknown };

const metaOf = (r: { metadata?: unknown }): Record<string, any> =>
  r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, any>) : {};

const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** The refund's stored `metadata.items`, or null for a legacy refund (none, or not well formed). */
export const refundItemsOf = (refund: { metadata?: unknown }): RefundItem[] | null => {
  const raw = metaOf(refund).items;
  if (!Array.isArray(raw) || !raw.length) return null;
  const items: RefundItem[] = [];
  for (const i of raw) {
    if (!i || typeof i !== 'object') return null;
    const { invoiceId, index, quantity, value } = i as Record<string, unknown>;
    if (!isInt(invoiceId, 1) || !isInt(index, 0) || !isInt(quantity, 1) || !isInt(value, 0)) return null;
    items.push({ invoiceId, index, quantity, value });
  }
  return items;
};

/**
 * Whether the refund's credit note counts: `metadata.creditNoteId` names a credit note of `docs`
 * that did not fail. Each refund counts its elements once: through that credit note, or else
 * through its own items.
 */
const hasLiveCreditNote = (refund: RefundLike, docs: InvoiceDoc[]): boolean => {
  const id = Number(metaOf(refund).creditNoteId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return docs.some((d) => d.id === id && d.kind === 'CREDIT_NOTE' && d.status !== 'FAILED');
};

/** Active INVOICED refunds (PENDING, PROCESSING, COMPLETED) without a credit note that counts. */
const reservingRefunds = <R extends RefundLike>(refunds: R[], docs: InvoiceDoc[]): R[] =>
  refunds.filter(
    (r) => r.scope === 'INVOICED' && ADJUSTING.includes(r.status) && !hasLiveCreditNote(r, docs)
  );

/**
 * The elements reserved by active INVOICED refunds without a credit note, as REFUND credit notes
 * that exist only in memory (negative ids, never stored): passed to `creditOptions` with the order's
 * documents, other refunds cannot pick them, and passed to `refundCreditedUnits` their units are
 * never returnable. `exceptRefundId` leaves that refund's own reservation out (its credit note
 * options). Legacy refunds (no items) reserve by amount instead (`legacyReservedAmount`).
 */
export const refundReservationDocs = (
  refunds: RefundLike[],
  docs: InvoiceDoc[],
  exceptRefundId: number | null = null
): InvoiceDoc[] =>
  reservingRefunds(refunds, docs).flatMap((r): InvoiceDoc[] => {
    const id = Number(r.id);
    if (exceptRefundId !== null && id === exceptRefundId) return [];
    const items = refundItemsOf(r);
    if (!items) return [];
    return [
      {
        id: -(Number.isInteger(id) && id > 0 ? id : 0),
        kind: 'CREDIT_NOTE',
        status: 'ISSUED',
        creditType: 'REFUND',
        creditedInvoiceId: items[0].invoiceId,
        lines: [],
        paymentIds: [],
        creditedLines: items.map((i) => ({
          invoiceId: i.invoiceId,
          index: i.index,
          value: i.value,
          quantity: i.quantity,
        })),
      },
    ];
  });

/**
 * Whether an INVOICED refund that reserves its stored elements again (e.g. Stripe completed it after
 * we held it as failed) finds them taken meanwhile (plan 15): an element is no longer creditable at
 * its stored value once live credit notes and the other refunds' reservations are counted (its
 * invoice gone, annulled, credited, or picked by another refund), or an order line has more units
 * refunded than it keeps after its returns. `refunds` holds the order's refunds as stored now, this
 * one included. A legacy refund (no items) or one with a credit note that counts never conflicts.
 */
export const refundElementsConflict = (p: {
  refund: RefundLike;
  refunds: RefundLike[];
  docs: InvoiceDoc[];
  order: PositionOrder;
  annulledInvoiceIds: number[];
}): boolean => {
  const items = refundItemsOf(p.refund);
  if (!items || hasLiveCreditNote(p.refund, p.docs)) return false;
  const id = Number(p.refund.id);
  const others = refundReservationDocs(p.refunds, p.docs, id);
  const withOthers = [...p.docs, ...others];
  const annulled = new Set(p.annulledInvoiceIds);
  const taken = items.some((item) => {
    const invoice = p.docs.find(
      (d) => d.id === item.invoiceId && d.kind === 'INVOICE' && d.status === 'ISSUED' && !annulled.has(d.id)
    );
    if (!invoice) return true;
    return refundStoredCreditLine(invoice, creditOptions(invoice, withOthers, p.order), item) === null;
  });
  if (taken) return true;
  // Units refunds hold are never returned: a return registered meanwhile may have taken them.
  const own = refundReservationDocs([{ ...p.refund, status: 'COMPLETED' }], p.docs);
  const refunded = refundCreditedUnits([...withOthers, ...own]);
  return p.order.lines.some((l) => (refunded.get(l.id) ?? 0) > l.quantity - l.returnedQuantity);
};

/** Σ of the active legacy INVOICED refunds (no items) without a credit note: they reserve by amount. */
export const legacyReservedAmount = (refunds: RefundLike[], docs: InvoiceDoc[]): number =>
  reservingRefunds(refunds, docs)
    .filter((r) => !refundItemsOf(r))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

/**
 * Whether an invoice row offers elements to an INVOICED refund (plan 15): ISSUED, of the active
 * billing provider (`providerId`), or of any provider while billing is not active (`null`: the
 * refund can then only be removed, never get a credit note).
 */
export const offersRefundElements = (
  row: { kind?: unknown; status?: unknown; provider?: unknown },
  providerId: string | null
): boolean =>
  row.kind === 'INVOICE' &&
  row.status === 'ISSUED' &&
  (providerId === null || String(row.provider ?? '') === providerId);

/**
 * Invoiced value an INVOICED refund may still give back (plan 15): the Σ of the available values of
 * the elements an INVOICED refund may pick (`refundCreditOptions`, on the ISSUED invoices not
 * annulled, `invoiceIds` only when given (`offersRefundElements`), with live credit notes and other
 * refunds' reserved elements counted), never above what each invoice holds;
 * - less the value invoiced above what the order now charges (`position.overInvoiced`: e.g. a
 *   return or a discount not credited yet; that value already came back as an excess);
 * - less the active legacy INVOICED refunds (no items) without a credit note (they reserve by
 *   amount until their credit note credits it);
 * - never above what the order still holds of the money received (`held`).
 */
type OfferedElementsInput = {
  docs: InvoiceDoc[];
  order: PositionOrder;
  position: InvoicingPosition;
  refunds: RefundLike[];
  /** The invoices that offer elements (`offersRefundElements`); all ISSUED ones when absent. */
  invoiceIds?: number[] | null;
};

/**
 * The elements an INVOICED refund may pick, per ISSUED invoice not annulled (`invoiceIds` only when
 * given), with live credit notes and the refunds' reserved elements counted.
 */
const offeredElements = (p: OfferedElementsInput) => {
  const offered = p.invoiceIds ? new Set(p.invoiceIds) : null;
  const annulled = new Set(p.position.annulledInvoiceIds);
  const withReservations = [...p.docs, ...refundReservationDocs(p.refunds, p.docs)];
  return p.docs
    .filter(
      (invoice) =>
        invoice.kind === 'INVOICE' &&
        invoice.status === 'ISSUED' &&
        !annulled.has(invoice.id) &&
        (!offered || offered.has(invoice.id))
    )
    .map((invoice) => {
      const options = creditOptions(invoice, withReservations, p.order);
      return { options, lines: refundCreditOptions(invoice, options) };
    });
};

/**
 * Whether a units-only INVOICED refund is possible: some zero-value element (a promotional gift's
 * units) is still available. Such a refund moves no money, so the value limits do not apply.
 */
export const invoicedUnitsOnlyAvailable = (p: OfferedElementsInput): boolean =>
  offeredElements(p).some(({ lines }) => lines.some((o) => o.kind === 'ITEM' && o.valueLeft === 0));

export const invoicedRefundableAmount = (p: OfferedElementsInput & { held: number }): number => {
  let creditable = 0;
  for (const { options, lines } of offeredElements(p)) {
    creditable += Math.min(
      lines.reduce((s, o) => s + o.valueLeft, 0),
      options.held
    );
  }
  const overInvoiced = p.position.overInvoiced.products + p.position.overInvoiced.shipping;
  const pending = legacyReservedAmount(p.refunds, p.docs);
  return Math.max(0, Math.min(creditable - overInvoiced - pending, p.held));
};
