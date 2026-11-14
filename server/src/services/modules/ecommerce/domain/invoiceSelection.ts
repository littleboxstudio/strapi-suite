/**
 * Invoicing by selection (plan 11; no Strapi imports). Money is integer cents, VAT included.
 *
 * The position says what each order line and shipping line still has to invoice, from the order
 * and its invoice documents (legacy per-payment invoices included). A selection of units,
 * shipping lines and payments is priced against it: the selected total must equal the payments'
 * net values.
 */
import { allocateProportionally, coverageDues } from './orders';
import { isObject, num, readInvoiceLines, type InvoiceLine } from './invoicing';
import type { ShippingLine } from './shippingLines';
import type { ValidationIssue } from '../errors';

export type CreditType = 'RETURN' | 'CORRECTION';

export type InvoiceDoc = {
  id: number;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  status: 'PENDING' | 'ISSUED' | 'FAILED' | 'UNCERTAIN';
  creditedInvoiceId: number | null;
  /** Credit notes only; null on invoices and on legacy credit notes (read as RETURN). */
  creditType: CreditType | null;
  lines: InvoiceLine[];
  /** Payments of the document's active allocations. */
  paymentIds: number[];
  /** Credit notes: what was credited per line index of the credited invoice. */
  creditedLines: { index: number; value: number; quantity: number }[];
};

export type PositionOrder = {
  lines: {
    id: number;
    unitPrice: number;
    unitDiscount: number;
    quantity: number;
    returnedQuantity: number;
    tax: number;
  }[];
  orderDiscount: number;
  shippingTotal: number;
  shippingTax: number;
  shippingLines: ShippingLine[];
};

export type PositionLine = {
  orderLineId: number;
  invoicedUnits: number;
  returnCreditedUnits: number;
  remainingQuantity: number;
  remainingValue: number;
};

export type PositionShipping = {
  shippingLineId: number;
  amount: number;
  invoiced: boolean;
  available: boolean;
  remainingValue: number;
};

export type PoolPosition = { due: number; invoiced: number; remaining: number };

export type InvoicingPosition = {
  /** In order-line order. */
  lines: PositionLine[];
  /** By shipping line id. */
  shipping: PositionShipping[];
  products: PoolPosition;
  shippingPool: PoolPosition;
  /**
   * Cents (≥ 0) of each pool that no remaining unit or available shipping line can carry (e.g. a
   * discount lowered after every unit was invoiced, or invoiced shipping credited by a RETURN).
   * Never selectable; settled with a CORRECTION credit note and a new invoice.
   */
  stranded: { products: number; shipping: number };
  annulledInvoiceIds: number[];
};

export type SelectionRequest = {
  lines: { orderLineId: number; quantity: number }[];
  shippingLineIds: number[];
  paymentIds: number[];
};

export type PricedSelection = {
  lines: { orderLineId: number; quantity: number; value: number }[];
  shipping: { shippingLineId: number; value: number }[];
  payments: { paymentId: number; value: number }[];
  total: number;
  paymentsTotal: number;
};

const COUNTED_INVOICE: InvoiceDoc['status'][] = ['ISSUED', 'PENDING', 'UNCERTAIN'];
const HELD_REFUND = ['COMPLETED', 'PROCESSING', 'PENDING'];

/** A non-negative whole number of units. */
const units = (v: number): number => Math.max(0, Math.floor(num(v)));

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

/** An invoice row (with `creditedInvoice` populated or as an id) as a domain document. */
export function readInvoiceDoc(row: unknown, paymentIds: number[]): InvoiceDoc {
  const r = isObject(row) ? row : {};
  const credited = isObject(r.creditedInvoice) ? r.creditedInvoice.id : r.creditedInvoice;
  const creditedInvoiceId = credited == null ? null : Number(credited);
  const metadata = isObject(r.metadata) ? r.metadata : {};
  const creditType: CreditType | null =
    metadata.creditType === 'RETURN' || metadata.creditType === 'CORRECTION'
      ? metadata.creditType
      : null;
  // An unknown status never counts.
  const status = COUNTED_INVOICE.find((s) => s === r.status) ?? 'FAILED';
  const rawCredited = Array.isArray(metadata.creditedLines) ? metadata.creditedLines : [];
  return {
    id: Number(r.id),
    kind: r.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
    status,
    creditedInvoiceId: Number.isInteger(creditedInvoiceId) ? creditedInvoiceId : null,
    creditType,
    lines: readInvoiceLines(r.lines),
    paymentIds: [...paymentIds],
    creditedLines: rawCredited.filter(isObject).flatMap((e) => {
      const { index, quantity } = e;
      if (typeof index !== 'number' || !Number.isInteger(index)) return [];
      if (!Number.isFinite(Number(e.value))) return [];
      // Legacy entries have no quantity: they credited no units (ruling 13).
      const units = typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0;
      return [{ index, value: num(e.value), quantity: units ? quantity : 0 }];
    }),
  };
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/** Legacy SHIPPING lines without an id invoice the CHECKOUT line, or the lowest id (ruling 4). */
const legacyShippingTarget = (shippingLines: ShippingLine[]): number | null => {
  const checkout = shippingLines.find((l) => l.origin === 'CHECKOUT');
  if (checkout) return checkout.id;
  return shippingLines.length ? Math.min(...shippingLines.map((l) => l.id)) : null;
};

/** Units of an invoice ITEM line on its order line (ruling 4 for legacy partial lines). */
const itemUnits = (
  line: InvoiceLine,
  order: PositionOrder,
  lineDue: Map<number, number>
): number => {
  if (!line.partial) return units(line.quantity);
  const orderLine = order.lines.find((l) => l.id === line.orderLineId);
  const due = lineDue.get(line.orderLineId ?? -1) ?? 0;
  if (!orderLine || due <= 0) return 0;
  const effective = orderLine.quantity - orderLine.returnedQuantity;
  const whole = Math.floor((num(line.total) * effective) / due);
  return Math.max(0, Math.min(orderLine.quantity, whole));
};

const shippingTargetOf = (line: InvoiceLine, legacyTarget: number | null): number | null =>
  line.shippingLineId != null ? line.shippingLineId : legacyTarget;

const duesOf = (order: PositionOrder): Map<number, number> => {
  const { lineDue } = coverageDues(order);
  return new Map(order.lines.map((l, i) => [l.id, lineDue[i]]));
};

/**
 * What is invoiced and left to invoice (rulings 1–4, 6). Invoices count while ISSUED, PENDING or
 * UNCERTAIN; an invoice with an ISSUED CORRECTION credit note is annulled and left out with its
 * credit notes; ISSUED RETURN credit notes (legacy ones included) reduce the invoiced value and
 * units. Each pool's remaining value is split over what is left, so already invoiced parts stay
 * fixed. Value no remaining unit or available shipping line can carry is `stranded`, never put
 * on a line: Σ invoiced + Σ remainingValue + stranded equals the order total.
 */
export function invoicingPosition(order: PositionOrder, docs: InvoiceDoc[]): InvoicingPosition {
  const lineDue = duesOf(order);
  const legacyTarget = legacyShippingTarget(order.shippingLines);

  const annulled = new Set<number>();
  for (const d of docs) {
    if (d.kind !== 'CREDIT_NOTE' || d.status !== 'ISSUED' || d.creditType !== 'CORRECTION')
      continue;
    if (d.creditedInvoiceId !== null) annulled.add(d.creditedInvoiceId);
  }
  const invoices = docs.filter((d) => d.kind === 'INVOICE' && COUNTED_INVOICE.includes(d.status));
  const annulledInvoiceIds = invoices.filter((d) => annulled.has(d.id)).map((d) => d.id);
  const counted = new Map(invoices.filter((d) => !annulled.has(d.id)).map((d) => [d.id, d]));
  const credits = docs.filter(
    (d) =>
      d.kind === 'CREDIT_NOTE' &&
      d.status === 'ISSUED' &&
      d.creditType !== 'CORRECTION' &&
      d.creditedInvoiceId !== null &&
      counted.has(d.creditedInvoiceId)
  );

  const invoicedUnits = new Map<number, number>();
  const creditedUnits = new Map<number, number>();
  const add = (map: Map<number, number>, id: number, n: number) =>
    map.set(id, (map.get(id) ?? 0) + n);
  const invoicedShipping = new Set<number>();
  let productsInvoiced = 0;
  let shippingInvoiced = 0;

  for (const doc of counted.values()) {
    for (const l of doc.lines) {
      if (l.kind === 'SHIPPING') {
        shippingInvoiced += num(l.total);
        const target = shippingTargetOf(l, legacyTarget);
        if (target !== null) invoicedShipping.add(target);
      } else {
        productsInvoiced += num(l.total);
        if (l.orderLineId !== null) add(invoicedUnits, l.orderLineId, itemUnits(l, order, lineDue));
      }
    }
  }

  for (const cn of credits) {
    for (const l of cn.lines) {
      if (l.kind === 'SHIPPING') shippingInvoiced -= num(l.total);
      else productsInvoiced -= num(l.total);
    }
    if (cn.creditType === 'RETURN') {
      const original = counted.get(cn.creditedInvoiceId!)!;
      for (const e of cn.creditedLines) {
        const target = original.lines[e.index];
        if (target?.kind === 'ITEM' && target.orderLineId !== null) {
          add(creditedUnits, target.orderLineId, e.quantity);
        }
      }
    } else {
      // Legacy credit note: read as RETURN, its own whole ITEM lines are the units (ruling 4).
      for (const l of cn.lines) {
        if (l.kind === 'ITEM' && l.orderLineId !== null && !l.partial) {
          add(creditedUnits, l.orderLineId, units(l.quantity));
        }
      }
    }
  }

  const productsDue = sum([...lineDue.values()]);
  const products: PoolPosition = {
    due: productsDue,
    invoiced: productsInvoiced,
    remaining: Math.max(0, productsDue - productsInvoiced),
  };
  const shippingDue = Math.max(0, num(order.shippingTotal));
  const shippingPool: PoolPosition = {
    due: shippingDue,
    invoiced: shippingInvoiced,
    remaining: Math.max(0, shippingDue - shippingInvoiced),
  };

  const lineParts = order.lines.map((l) => {
    const invoiced = invoicedUnits.get(l.id) ?? 0;
    const credited = creditedUnits.get(l.id) ?? 0;
    const remainingQuantity = Math.max(0, l.quantity - l.returnedQuantity - (invoiced - credited));
    return {
      orderLineId: l.id,
      invoicedUnits: invoiced,
      returnCreditedUnits: credited,
      remainingQuantity,
      weight: remainingQuantity * Math.max(0, l.unitPrice - l.unitDiscount),
    };
  });
  const weights = lineParts.map((p) => p.weight);
  const split = allocateProportionally(
    products.remaining,
    weights.some((w) => w > 0) ? weights : lineParts.map((p) => p.remainingQuantity)
  );
  const lines: PositionLine[] = lineParts.map(({ weight: _weight, ...p }, i) => ({
    ...p,
    remainingValue: split[i],
  }));

  const shippingLines = [...order.shippingLines].sort((a, b) => a.id - b.id);
  const shippingParts = shippingLines.map((l) => {
    const invoiced = invoicedShipping.has(l.id);
    return {
      shippingLineId: l.id,
      amount: l.amount,
      invoiced,
      available: l.amount > 0 && !invoiced,
    };
  });
  const shippingSplit = allocateProportionally(
    shippingPool.remaining,
    shippingParts.map((s) => (s.available ? s.amount : 0))
  );
  const shipping: PositionShipping[] = shippingParts.map((s, i) => ({
    ...s,
    remainingValue: shippingSplit[i],
  }));

  const stranded = {
    products: products.remaining - sum(split),
    shipping: shippingPool.remaining - sum(shippingSplit),
  };

  return { lines, shipping, products, shippingPool, stranded, annulledInvoiceIds };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Net value of each COMPLETED payment (`payments`, in settlement order; ruling 8): its amount
 * minus the held refunds (COMPLETED, PROCESSING, PENDING) attributed to it. A refund linked to one
 * of these payments counts on it up to its amount; refunds without a payment and any overflow go
 * to a pool, attributed latest payment first: payments not invoiced, then invoiced ones. Refunds
 * linked to any other payment are ignored.
 */
export function paymentNets(
  payments: { id: number; amount: number }[],
  refunds: { status: string; amount: number; paymentId: number | null }[],
  invoicedPaymentIds: Set<number>
): Map<number, number> {
  const nets = new Map(payments.map((p) => [p.id, Math.max(0, num(p.amount))]));
  let pool = 0;
  for (const r of refunds) {
    if (!HELD_REFUND.includes(r.status)) continue;
    const amount = Math.max(0, num(r.amount));
    if (r.paymentId == null) {
      pool += amount;
      continue;
    }
    const net = nets.get(r.paymentId);
    if (net === undefined) continue;
    const taken = Math.min(net, amount);
    nets.set(r.paymentId, net - taken);
    pool += amount - taken;
  }
  const latestFirst = [...payments].reverse();
  const order = [
    ...latestFirst.filter((p) => !invoicedPaymentIds.has(p.id)),
    ...latestFirst.filter((p) => invoicedPaymentIds.has(p.id)),
  ];
  for (const p of order) {
    if (pool <= 0) break;
    const net = nets.get(p.id)!;
    const taken = Math.min(net, pool);
    nets.set(p.id, net - taken);
    pool -= taken;
  }
  return nets;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Value of `quantity` of the `remainingQuantity` units worth `remainingValue` (ruling 7). */
export const selectedValue = (
  remainingValue: number,
  remainingQuantity: number,
  quantity: number
): number => {
  if (remainingQuantity <= 0) return 0;
  if (quantity === remainingQuantity) return remainingValue;
  return Math.floor((remainingValue * quantity) / remainingQuantity);
};

const list = <T>(v: T[] | unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Prices a selection against the position (ruling 11.3). Issues are path-indexed by request
 * position; a repeated id is a `duplicate` at its later position. The totals check
 * (`INVOICE_TOTALS_DIFFER`) only runs when every entry is valid. `selection` is null when there
 * are issues.
 */
export function priceSelection(
  position: InvoicingPosition,
  payments: { id: number; net: number; available: boolean }[],
  request: SelectionRequest
): { selection: PricedSelection | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const reqLines = list(request?.lines);
  const reqShipping = list(request?.shippingLineIds);
  const reqPayments = list(request?.paymentIds);

  const lines: PricedSelection['lines'] = [];
  const seenLines = new Set<number>();
  reqLines.forEach((entry, i) => {
    const e = isObject(entry) ? entry : {};
    const line = position.lines.find((l) => l.orderLineId === e.orderLineId);
    if (!line) {
      issues.push({ path: `lines.${i}.orderLineId`, code: 'unknown_line' });
      return;
    }
    if (seenLines.has(line.orderLineId)) {
      issues.push({ path: `lines.${i}.orderLineId`, code: 'duplicate' });
      return;
    }
    seenLines.add(line.orderLineId);
    const quantity = e.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      issues.push({ path: `lines.${i}.quantity`, code: 'invalid' });
      return;
    }
    if (quantity > line.remainingQuantity) {
      issues.push({ path: `lines.${i}.quantity`, code: 'QUANTITY_EXCEEDS_UNINVOICED' });
      return;
    }
    lines.push({
      orderLineId: line.orderLineId,
      quantity,
      value: selectedValue(line.remainingValue, line.remainingQuantity, quantity),
    });
  });

  const shipping: PricedSelection['shipping'] = [];
  const seenShipping = new Set<unknown>();
  reqShipping.forEach((id, i) => {
    if (seenShipping.has(id)) {
      issues.push({ path: `shippingLineIds.${i}`, code: 'duplicate' });
      return;
    }
    seenShipping.add(id);
    const line = position.shipping.find((s) => s.shippingLineId === id);
    if (!line?.available) {
      issues.push({ path: `shippingLineIds.${i}`, code: 'SHIPPING_LINE_NOT_INVOICEABLE' });
      return;
    }
    shipping.push({ shippingLineId: line.shippingLineId, value: line.remainingValue });
  });

  const priced: PricedSelection['payments'] = [];
  const seenPayments = new Set<unknown>();
  reqPayments.forEach((id, i) => {
    if (seenPayments.has(id)) {
      issues.push({ path: `paymentIds.${i}`, code: 'duplicate' });
      return;
    }
    seenPayments.add(id);
    const payment = payments.find((p) => p.id === id);
    if (!payment?.available || !(payment.net > 0)) {
      issues.push({ path: `paymentIds.${i}`, code: 'PAYMENT_NOT_INVOICEABLE' });
      return;
    }
    priced.push({ paymentId: payment.id, value: payment.net });
  });

  if (reqLines.length === 0 && reqShipping.length === 0) {
    issues.push({ path: 'lines', code: 'required' });
  }
  if (reqPayments.length === 0) issues.push({ path: 'paymentIds', code: 'required' });

  const total = sum(lines.map((l) => l.value)) + sum(shipping.map((s) => s.value));
  const paymentsTotal = sum(priced.map((p) => p.value));
  if (!issues.length && (total !== paymentsTotal || total <= 0)) {
    issues.push({ path: 'paymentIds', code: 'INVOICE_TOTALS_DIFFER' });
  }
  if (issues.length) return { selection: null, issues };
  return { selection: { lines, shipping, payments: priced, total, paymentsTotal }, issues };
}

/**
 * Whether a document (left out of `position`) still fits it (ruling 14): none of its ITEM lines
 * takes more units than its order line has left, and none of its SHIPPING lines targets a
 * shipping line that is already invoiced.
 */
export function fitsPosition(
  position: InvoicingPosition,
  doc: InvoiceDoc,
  order: PositionOrder
): boolean {
  const lineDue = duesOf(order);
  const legacyTarget = legacyShippingTarget(order.shippingLines);
  const taken = new Map<number, number>();
  for (const l of doc.lines) {
    if (l.kind === 'SHIPPING') {
      const target = shippingTargetOf(l, legacyTarget);
      if (position.shipping.some((s) => s.shippingLineId === target && s.invoiced)) return false;
    } else if (l.orderLineId !== null) {
      taken.set(l.orderLineId, (taken.get(l.orderLineId) ?? 0) + itemUnits(l, order, lineDue));
    }
  }
  for (const [orderLineId, n] of taken) {
    if (n <= 0) continue;
    const line = position.lines.find((l) => l.orderLineId === orderLineId);
    if (!line || n > line.remainingQuantity) return false;
  }
  return true;
}
