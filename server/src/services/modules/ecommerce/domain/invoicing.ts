/**
 * Pure invoicing domain rules (design 4.4; no Strapi imports). Money is integer cents.
 *
 * Each invoice covers what its payments paid at settlement (`payment.coverage`), reconciled with
 * the order's current lines: value on lines that were removed or reduced is reallocated to the
 * remaining capacity; what does not fit is excluded (refundable excess, never invoiced).
 */
import {
  allocateProportionally,
  coverageDues,
  type Address,
  type CoverageOrderState,
  type OrderStatus,
} from './orders';
import { EcommerceValidationError, type ValidationIssue } from '../errors';

export type InvoiceLine = {
  orderLineId: number | null;
  kind: 'ITEM' | 'SHIPPING';
  sku: string;
  name: string;
  quantity: number;
  /** Cents, VAT included. */
  total: number;
  tax: number;
  partial: boolean;
  /** SHIPPING lines of selection invoices: the shipping line they invoice. */
  shippingLineId?: number | null;
};

export type CoverageValue = { orderLineId: number; value: number };

export type ReconciledCoverage = {
  paymentId: number;
  lines: CoverageValue[];
  shipping: number;
  /** Σ lines + shipping. */
  value: number;
  /** Paid but not invoiceable on the current order (refundable excess). */
  excluded: number;
};

export type InvoicedCoverage = { lines: CoverageValue[]; shipping: number };

export type InvoiceCustomer = {
  name: string;
  nif: string | null;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
};

/** The coverage order state, with what an invoice line shows. */
export type InvoiceOrderState = Omit<CoverageOrderState, 'lines'> & {
  lines: (CoverageOrderState['lines'][number] & {
    sku: string;
    name: string;
    option: string | null;
  })[];
};

export type OverInvoiced = Map<number | 'SHIPPING', number>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Non-negative integer cents, or 0. */
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

const cents = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The stored `lines` JSON of an invoice row (`{ lines: [...] }`), malformed entries dropped. */
export const readInvoiceLines = (raw: unknown): InvoiceLine[] => {
  const list = isObject(raw) ? raw.lines : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(isObject).map((l) => {
    const shippingLineId = l.shippingLineId == null ? null : Number(l.shippingLineId);
    return {
      orderLineId: l.orderLineId == null ? null : Number(l.orderLineId),
      kind: l.kind === 'SHIPPING' ? 'SHIPPING' : 'ITEM',
      sku: typeof l.sku === 'string' ? l.sku : '',
      name: typeof l.name === 'string' ? l.name : '',
      quantity: num(l.quantity),
      total: num(l.total),
      tax: num(l.tax),
      partial: l.partial === true,
      ...(Number.isInteger(shippingLineId) ? { shippingLineId } : {}),
    };
  });
};

const parseLines = (raw: unknown[]): CoverageValue[] => {
  const lines: CoverageValue[] = [];
  for (const l of raw) {
    if (!isObject(l)) continue;
    const id = Number(l.orderLineId);
    if (!Number.isInteger(id)) continue;
    lines.push({ orderLineId: id, value: cents(l.value) });
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Coverage mappers
// ---------------------------------------------------------------------------

/** The coverage stored on an `invoice-allocation` (a ReconciledCoverage). Malformed → empty. */
export const toInvoicedCoverage = (allocationCoverage: unknown): InvoicedCoverage => {
  if (!isObject(allocationCoverage) || !Array.isArray(allocationCoverage.lines)) {
    return { lines: [], shipping: 0 };
  }
  return {
    lines: parseLines(allocationCoverage.lines),
    shipping: cents(allocationCoverage.shipping),
  };
};

/**
 * The plan 3 `payment.coverage` (PaymentCoverage, `shipping: { value, tax }`) as plain values.
 * Missing or malformed → null. Already-converted input (numeric `shipping`) is accepted as is.
 */
export const toPaymentCoverage = (coverage: unknown): InvoicedCoverage | null => {
  if (!isObject(coverage) || !Array.isArray(coverage.lines)) return null;
  const shipping = isObject(coverage.shipping) ? coverage.shipping.value : coverage.shipping;
  return { lines: parseLines(coverage.lines), shipping: cents(shipping) };
};

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles each COMPLETED payment's coverage (in settlement order) with the current lines.
 *
 * - Payments with an active allocation (`invoiced`) keep their stored coverage as is (no clamp,
 *   no reallocation); they consume capacity first, only so others see what is left. Their
 *   excess over the current lines shows in `overInvoiced` and is settled with a credit note.
 * - Other payments consume min(value, capacity) on lines that still exist; the rest is orphan
 *   (removed/reduced lines, a missing coverage, or value uncovered at settlement), then
 *   reallocated proportionally over the remaining capacity in a second pass. What does not fit
 *   goes to `excluded`.
 *
 * Invoiced coverages are processed first (every entry of `invoiced`, whether or not its payment
 * is in `payments`) so a new invoice never claims capacity an issued invoice already covers.
 *
 * Each payment counts for its NET amount: `amount − refunded` (refunds COMPLETED, PROCESSING or
 * PENDING, any method; required), capped at 0, so refunded money is never invoiced.
 * `value + excluded = net` for payments without an active allocation. A negative, NaN or
 * non-integer `amount`/`refunded` is a domain error.
 */
export const reconcileCoverages = (
  order: CoverageOrderState,
  payments: { id: number; amount: number; refunded: number; coverage: unknown }[],
  invoiced: Map<number, InvoicedCoverage>
): Map<number, ReconciledCoverage> => {
  const issues: ValidationIssue[] = [];
  const net = new Map<number, number>();
  payments.forEach((p, i) => {
    const amount = p.amount;
    const refunded = p.refunded;
    if (!isCents(amount)) issues.push({ path: `payments.${i}.amount`, code: 'invalid_amount' });
    if (!isCents(refunded)) issues.push({ path: `payments.${i}.refunded`, code: 'invalid_amount' });
    net.set(p.id, Math.max(0, amount - refunded));
  });
  if (issues.length) throw new EcommerceValidationError('Invalid payment amounts', issues);

  const { lineDue, shippingDue } = coverageDues(order);
  const lineIds = order.lines.map((l) => l.id);
  const index = new Map(lineIds.map((id, i) => [id, i]));
  // Capacity per line (line order), then shipping last.
  const capacity = [...lineDue, shippingDue];
  const shippingSlot = lineIds.length;

  const consume = (slot: number, value: number): number => {
    const taken = Math.min(value, capacity[slot]);
    capacity[slot] -= taken;
    return taken;
  };

  const result = new Map<number, ReconciledCoverage>();
  const pending: { id: number; amount: number; taken: number[]; orphan: number }[] = [];

  for (const fixed of invoiced.values()) {
    for (const l of fixed.lines) {
      const slot = index.get(l.orderLineId);
      if (slot !== undefined) consume(slot, l.value);
    }
    consume(shippingSlot, fixed.shipping);
  }

  for (const p of payments) {
    const fixed = invoiced.get(p.id);
    if (!fixed) continue;
    const value = fixed.lines.reduce((s, l) => s + l.value, 0) + fixed.shipping;
    result.set(p.id, {
      paymentId: p.id,
      lines: fixed.lines.map((l) => ({ ...l })),
      shipping: fixed.shipping,
      value,
      excluded: Math.max(0, net.get(p.id)! - value),
    });
  }

  for (const p of payments) {
    if (invoiced.has(p.id)) continue;
    const amount = net.get(p.id)!;
    const source = toPaymentCoverage(p.coverage);
    const taken = capacity.map(() => 0);
    let budget = amount;
    if (source) {
      const claims = [
        ...source.lines.map((l) => ({ slot: index.get(l.orderLineId), value: l.value })),
        { slot: shippingSlot, value: source.shipping },
      ];
      for (const c of claims) {
        if (c.slot === undefined) continue;
        const t = consume(c.slot, Math.min(c.value, budget));
        taken[c.slot] += t;
        budget -= t;
      }
    }
    pending.push({ id: p.id, amount, taken, orphan: budget });
  }

  for (const p of pending) {
    const room = capacity.reduce((s, c) => s + c, 0);
    const extra = allocateProportionally(Math.min(p.orphan, room), capacity);
    extra.forEach((e, slot) => {
      p.taken[slot] += e;
      capacity[slot] -= e;
    });
    const lines: CoverageValue[] = [];
    lineIds.forEach((id, slot) => {
      if (p.taken[slot] > 0) lines.push({ orderLineId: id, value: p.taken[slot] });
    });
    const shipping = p.taken[shippingSlot];
    const value = lines.reduce((s, l) => s + l.value, 0) + shipping;
    result.set(p.id, { paymentId: p.id, lines, shipping, value, excluded: p.amount - value });
  }

  // Keep the caller's (settlement) order.
  return new Map(payments.filter((p) => result.has(p.id)).map((p) => [p.id, result.get(p.id)!]));
};

/** What is left to invoice per payment: 0 when it already has an active allocation. */
export const invoiceableByPayment = (
  reconciled: Map<number, ReconciledCoverage>,
  allocatedPaymentIds: Set<number>
): Map<number, number> => {
  const out = new Map<number, number>();
  for (const [id, c] of reconciled) out.set(id, allocatedPaymentIds.has(id) ? 0 : c.value);
  return out;
};

// ---------------------------------------------------------------------------
// Invoice lines and customer
// ---------------------------------------------------------------------------

/**
 * Invoice lines for the given coverages, in line order, shipping last. Coverage value on a line
 * that is missing or has lineDue 0 is a domain error (`coverage_mismatch`): Σ totals always equals
 * Σ coverage value.
 */
export const buildInvoiceLines = (
  coverages: ReconciledCoverage[],
  order: InvoiceOrderState,
  shipping: { reference: string; rates: { tax: number; weight: number; name: string }[] }
): InvoiceLine[] => {
  const { lineDue, shippingDue } = coverageDues(order);
  const byLine = new Map<number, number>();
  let shippingValue = 0;
  for (const c of coverages) {
    for (const l of c.lines) byLine.set(l.orderLineId, (byLine.get(l.orderLineId) ?? 0) + l.value);
    shippingValue += c.shipping;
  }

  const mismatch = () =>
    new EcommerceValidationError('Invoice coverage does not match the order lines', [
      { path: 'coverage', code: 'coverage_mismatch' },
    ]);
  const known = new Set(order.lines.map((l) => l.id));
  for (const [id, value] of byLine) if (value > 0 && !known.has(id)) throw mismatch();

  const out: InvoiceLine[] = [];
  order.lines.forEach((l, i) => {
    const due = lineDue[i];
    const value = byLine.get(l.id) ?? 0;
    if (value <= 0) return;
    if (due <= 0) throw mismatch();
    const effectiveQty = l.quantity - l.returnedQuantity;
    const scaled = effectiveQty * value;
    const whole = scaled % due === 0 && scaled / due >= 1;
    out.push({
      orderLineId: l.id,
      kind: 'ITEM',
      sku: l.sku,
      name: l.option ? `${l.name} - ${l.option}` : l.name,
      quantity: whole ? scaled / due : 1,
      total: value,
      tax: l.tax,
      partial: !whole,
    });
  });
  if (shippingValue > 0) {
    const { rates } = shipping;
    const weights = rates.map((r) => r.weight);
    const split =
      rates.length && weights.some((w) => w > 0)
        ? allocateProportionally(shippingValue, weights)
        : [shippingValue];
    split.forEach((total, i) => {
      if (total <= 0) return;
      const rate = rates[i];
      out.push({
        orderLineId: null,
        kind: 'SHIPPING',
        sku: shipping.reference,
        name: rate?.name ?? 'Shipping',
        quantity: 1,
        total,
        tax: rate?.tax ?? 0,
        partial: shippingValue !== shippingDue,
      });
    });
  }
  return out;
};

/** Never invents a NIF: `nif` is null when the billing address has none. */
export const invoiceCustomer = (
  billing: Address | null,
  customer: { firstName: string; lastName: string; email: string }
): InvoiceCustomer => {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const person = billing && (str(billing.firstName) || str(billing.lastName)) ? billing : customer;
  const name =
    str(billing?.company) ||
    [str(person.firstName), str(person.lastName)].filter(Boolean).join(' ');
  return {
    name,
    nif: str(billing?.nif) || null,
    address: [str(billing?.line1), str(billing?.line2)].filter(Boolean).join(', '),
    postalCode: str(billing?.postalCode),
    city: str(billing?.city),
    country: str(billing?.country),
    email: str(customer.email),
  };
};

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

const lineKey = (l: Pick<InvoiceLine, 'kind' | 'orderLineId'>): number | 'SHIPPING' =>
  l.kind === 'SHIPPING' || l.orderLineId === null ? 'SHIPPING' : l.orderLineId;

/**
 * Per line (and 'SHIPPING'): max(0, invoiced − credited − current due). On a cancelled order
 * every due is 0. Only positive entries are returned.
 */
export const overInvoiced = (
  order: CoverageOrderState & { status: OrderStatus },
  issued: { kind: 'INVOICE' | 'CREDIT_NOTE'; lines: InvoiceLine[] }[]
): OverInvoiced => {
  const cancelled = order.status === 'CANCELLED';
  const { lineDue, shippingDue } = coverageDues(order);
  const due = new Map<number | 'SHIPPING', number>();
  if (!cancelled) {
    order.lines.forEach((l, i) => due.set(l.id, lineDue[i]));
    due.set('SHIPPING', shippingDue);
  }

  const net = new Map<number | 'SHIPPING', number>();
  for (const doc of issued) {
    const sign = doc.kind === 'CREDIT_NOTE' ? -1 : 1;
    for (const l of doc.lines) {
      const key = lineKey(l);
      net.set(key, (net.get(key) ?? 0) + sign * cents(l.total));
    }
  }

  const out: OverInvoiced = new Map();
  for (const [key, value] of net) {
    const over = value - (due.get(key) ?? 0);
    if (over > 0) out.set(key, over);
  }
  return out;
};

/**
 * Per payment with an active allocation (`invoiced`): the part of its amount that its invoice does
 * not keep invoiced once every over-invoiced value is credited — value excluded at issue, value
 * already credited, and over-invoiced value still to credit. Per line (and shipping), what the
 * invoices lose (`invoiced − min(invoiced − credited, due)`; everything on a cancelled order) is
 * shared among the payments that invoiced it in proportion to their value.
 *
 * Held refunds are attributed here first (`refundedByPayment`): money a credit note takes off an
 * invoice is then never also taken off a payment not invoiced yet.
 */
export const uninvoicedByPayment = (
  order: CoverageOrderState & { status: OrderStatus },
  payments: { id: number; amount: number }[],
  invoiced: Map<number, InvoicedCoverage>,
  creditNoteLines: Pick<InvoiceLine, 'orderLineId' | 'kind' | 'total'>[]
): Map<number, number> => {
  const { lineDue, shippingDue } = coverageDues(order);
  const due = new Map<number | 'SHIPPING', number>();
  if (order.status !== 'CANCELLED') {
    order.lines.forEach((l, i) => due.set(l.id, lineDue[i]));
    due.set('SHIPPING', shippingDue);
  }
  const credited = new Map<number | 'SHIPPING', number>();
  for (const l of creditNoteLines) {
    const key = lineKey(l);
    credited.set(key, (credited.get(key) ?? 0) + cents(l.total));
  }

  // key → [paymentId, value][]
  const byKey = new Map<number | 'SHIPPING', [number, number][]>();
  const add = (key: number | 'SHIPPING', paymentId: number, value: number) => {
    if (value <= 0) return;
    const list = byKey.get(key) ?? [];
    list.push([paymentId, value]);
    byKey.set(key, list);
  };
  for (const [paymentId, c] of invoiced) {
    for (const l of c.lines) add(l.orderLineId, paymentId, l.value);
    add('SHIPPING', paymentId, c.shipping);
  }

  const kept = new Map<number, number>();
  for (const [key, list] of byKey) {
    const total = list.reduce((s, [, v]) => s + v, 0);
    const final = Math.max(0, Math.min(total - (credited.get(key) ?? 0), due.get(key) ?? 0));
    const lost = allocateProportionally(
      total - final,
      list.map(([, v]) => v)
    );
    list.forEach(([paymentId, v], i) =>
      kept.set(paymentId, (kept.get(paymentId) ?? 0) + v - lost[i])
    );
  }

  const out = new Map<number, number>();
  for (const p of payments) {
    if (!invoiced.has(p.id)) continue;
    out.set(p.id, Math.max(0, p.amount - (kept.get(p.id) ?? 0)));
  }
  return out;
};

/**
 * The most the credit-note suggestions may take off the order's invoices, so that what stays
 * invoiced plus what is still to invoice never falls below what the order keeps for its current
 * lines: max(0, invoiced − credited + invoiceable − min(kept, Σ due)), where `kept` is paid minus
 * held refunds. Every due is 0 on a cancelled order. Line-level over-invoicing whose value a
 * refund already removed from a payment's invoiceable value is not suggested again.
 */
export const creditNoteBudget = (
  order: CoverageOrderState & { status: OrderStatus },
  totals: { invoiced: number; credited: number; invoiceable: number; kept: number }
): number => {
  const { lineDue, shippingDue } = coverageDues(order);
  const due = order.status === 'CANCELLED' ? 0 : lineDue.reduce((s, d) => s + d, 0) + shippingDue;
  const keeps = Math.min(Math.max(0, totals.kept), due);
  return Math.max(0, totals.invoiced - totals.credited + totals.invoiceable - keeps);
};

/** Suggested credit per invoice line: min(total − credited, remaining over-invoiced). */
export const suggestCreditNote = (
  invoice: { lines: InvoiceLine[] },
  alreadyCredited: number[],
  over: OverInvoiced
): number[] => {
  const left = new Map(over);
  return invoice.lines.map((l, i) => {
    const key = lineKey(l);
    const creditable = Math.max(0, l.total - (alreadyCredited[i] ?? 0));
    const s = Math.min(creditable, left.get(key) ?? 0);
    if (s > 0) left.set(key, (left.get(key) ?? 0) - s);
    return s;
  });
};

export const validateCreditNoteRequest = (
  invoice: { lines: InvoiceLine[] },
  alreadyCredited: number[],
  request: { lines: { index: number; value: number }[]; reason: string }
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const lines = Array.isArray(request?.lines) ? request.lines : [];
  if (lines.length === 0) issues.push({ path: 'lines', code: 'required' });
  if (typeof request?.reason !== 'string' || !request.reason.trim()) {
    issues.push({ path: 'reason', code: 'required' });
  }

  const requested = new Map<number, number>();
  lines.forEach((entry, j) => {
    const idx = (entry as { index?: unknown } | null)?.index;
    const value = (entry as { value?: unknown } | null)?.value;
    if (
      typeof idx !== 'number' ||
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= invoice.lines.length
    ) {
      issues.push({ path: `lines.${j}.index`, code: 'unknown_line' });
      return;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      issues.push({ path: `lines.${j}.value`, code: 'invalid_amount' });
      return;
    }
    const total = (requested.get(idx) ?? 0) + value;
    requested.set(idx, total);
    const creditable = invoice.lines[idx].total - (alreadyCredited[idx] ?? 0);
    if (total > creditable) issues.push({ path: `lines.${j}.value`, code: 'exceeds_creditable' });
  });
  return issues;
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in the store time zone (UTC when the zone is invalid). */
export const issueDate = (now: Date, timeZone: string): string => {
  const format = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
};
