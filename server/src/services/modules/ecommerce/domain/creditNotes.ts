/**
 * Credit notes by reason (plan 11, ruling 13; no Strapi imports). Money is integer cents.
 *
 * A RETURN credits units that came back and were invoiced past what the order still holds, plus
 * whole shipping lines. A CORRECTION credits everything an invoice has left. Credit notes that
 * are ISSUED, PENDING or UNCERTAIN count, so nothing is credited twice.
 *
 * Lines of whole-item invoices (plan 14) carry `discountShare`, already netted into `total`: a
 * returned unit credits what was effectively paid for it, its net value less its share of the
 * discounts, and the last unit takes the share left. DISCOUNT lines are never credited alone.
 */
import type { ValidationIssue } from '../errors';
import { isObject, num, withTotal, type InvoiceLine } from './invoicing';
import {
  creditsInvoice,
  entryInvoiceId,
  invoicingPosition,
  selectedValue,
  type CreditType,
  type InvoiceDoc,
  type PositionOrder,
} from './invoiceSelection';

export type CreditOptions = {
  /** Per line index of the invoice: cents still creditable. */
  creditable: number[];
  /** Per line index: whole units still creditable (0 for shipping and legacy partial lines). */
  unitsLeft: number[];
  returnable: { index: number; units: number; unitsLeft: number; valueLeft: number }[];
  shipping: { index: number; value: number }[];
  /**
   * SHIPPING: what this invoice's shipping lines credit of the shipping invoiced above what the
   * order now charges (latest line first); empty when there is none.
   */
  shippingAdjustment: { index: number; value: number }[];
  /** Cents the invoice still holds (its lines less what live credit notes took): no credit exceeds it. */
  held: number;
};

export type CreditRequest = {
  creditType: CreditType;
  lines: { index: number; quantity: number }[];
  shippingIndexes: number[];
};

export type CreditedLine = { index: number; value: number; quantity: number };

const LIVE: InvoiceDoc['status'][] = ['ISSUED', 'PENDING', 'UNCERTAIN'];

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);

/**
 * A credit-note line: the original line with `total = value`, keeping the quantity ratio when it
 * comes out whole (otherwise quantity 1, partial).
 */
export const creditLine = (line: InvoiceLine, value: number): InvoiceLine => {
  const scaled = line.quantity * value;
  const whole = line.total > 0 && scaled % line.total === 0 && scaled / line.total >= 1;
  return {
    ...withTotal(line, value),
    quantity: whole ? scaled / line.total : 1,
    partial: whole ? line.partial : true,
  };
};

const isWholeItem = (l: InvoiceLine): boolean =>
  l.kind === 'ITEM' && l.orderLineId !== null && !l.partial;

/**
 * The discount share `q` of the `u` units left of an invoice line take, of the `shareLeft` cents
 * of its `discountShare` not taken yet: the floor share, the last units taking all that is left.
 * One rule for the RETURN credit note (`sharedUnitsCredit`) and the return's refund
 * (`computeReturnShares`), so both are the same to the cent.
 */
export const unitsShare = (shareLeft: number, u: number, q: number): number =>
  q >= u ? shareLeft : Math.floor((shareLeft * q) / u);

/** A whole ITEM line of a whole-item invoice: it carries `discountShare`. */
export const isSharedLine = (line: InvoiceLine): boolean =>
  line.discountShare != null && isWholeItem(line) && line.quantity > 0;

/**
 * A whole ITEM line of a whole-item invoice (`discountShare` set), credited `q` of its `u` units
 * left with `valueLeft` cents left: `net_unit × q − unitsShare(shareLeft, u, q)`, where the share
 * left is `net_unit × u − valueLeft`. Null for a legacy line (no `discountShare`).
 */
const sharedUnitsCredit = (
  line: InvoiceLine,
  valueLeft: number,
  u: number,
  q: number
): InvoiceLine | null => {
  if (!isSharedLine(line) || u <= 0) return null;
  const netUnit = Math.round((num(line.total) + line.discountShare!) / line.quantity);
  const shareLeft = Math.max(0, netUnit * u - valueLeft);
  const share = unitsShare(shareLeft, u, q);
  const value = q === u ? valueLeft : netUnit * q - share;
  const grossUnit = line.grossTotal == null ? null : line.grossTotal / line.quantity;
  return {
    ...line,
    quantity: q,
    total: value,
    partial: false,
    discountShare: share,
    ...(grossUnit != null && Number.isInteger(grossUnit) ? { grossTotal: grossUnit * q } : {}),
  };
};

/**
 * SHIPPING credit notes: the negative shipping lines (not invoiced or settled yet) whose
 * reduction `credited` covers, oldest first. They explain the over-invoiced shipping the credit
 * note credits, so they are never invoiced again while it counts.
 */
export function settledShippingLineIds(
  shipping: { shippingLineId: number; value: number; invoiced: boolean }[],
  credited: number
): number[] {
  let left = credited;
  const ids: number[] = [];
  for (const s of [...shipping].sort((a, b) => a.shippingLineId - b.shippingLineId)) {
    if (s.invoiced || s.value >= 0) continue;
    if (-s.value > left) break;
    ids.push(s.shippingLineId);
    left += s.value;
  }
  return ids;
}

/**
 * SHIPPING credit notes: the uninvoiced SHIPPING discount items (`s:<id>`, `adj:shipping`) whose
 * reduction `credited` covers, in item order, only whole ones. A shipping discount granted after
 * the shipping was invoiced is what the over-invoice comes from: the credit note settles it, so it
 * is never invoiced again while the credit note counts.
 */
export function settledDiscountIds(
  discounts: { id: string; kind: 'ORDER' | 'SHIPPING'; amount: number; invoiced: boolean }[],
  credited: number
): string[] {
  let left = credited;
  const ids: string[] = [];
  for (const d of discounts) {
    if (d.kind !== 'SHIPPING' || d.invoiced || !(d.amount > 0)) continue;
    if (d.amount > left) break;
    ids.push(d.id);
    left -= d.amount;
  }
  return ids;
}

/**
 * Units of each order line credited by live RETURN credit notes (legacy ones read as RETURN),
 * each entry on its own invoice. REFUND credit notes credit no units of the order.
 */
const liveCreditedUnits = (docs: InvoiceDoc[], counted: Map<number, InvoiceDoc>) => {
  const byLine = new Map<number, number>();
  const add = (id: number, n: number) => byLine.set(id, (byLine.get(id) ?? 0) + n);
  for (const cn of docs) {
    if (cn.kind !== 'CREDIT_NOTE' || !LIVE.includes(cn.status)) continue;
    if (cn.creditType === 'CORRECTION' || cn.creditType === 'REFUND') continue;
    if (cn.creditType === 'RETURN') {
      for (const e of cn.creditedLines) {
        const invoiceId = entryInvoiceId(cn, e);
        const target = invoiceId === null ? undefined : counted.get(invoiceId)?.lines[e.index];
        if (target?.kind === 'ITEM' && target.orderLineId !== null)
          add(target.orderLineId, e.quantity);
      }
    } else {
      const original = cn.creditedInvoiceId === null ? undefined : counted.get(cn.creditedInvoiceId);
      if (!original) continue;
      for (const l of cn.lines) {
        if (isWholeItem(l)) add(l.orderLineId!, Math.max(0, Math.floor(num(l.quantity))));
      }
    }
  }
  return byLine;
};

/** The entries of `creditNote` on `invoiceId` (old entries are on its credited invoice). */
const entriesOn = (creditNote: InvoiceDoc, invoiceId: number) =>
  creditNote.creditedLines.filter((e) => entryInvoiceId(creditNote, e) === invoiceId);

/**
 * What can still be credited on `invoice` (ruling 13). `docs` holds the order's documents. Every
 * live credit note counts with its entries on this invoice, REFUND ones included: their value and
 * units are credited, so never credited twice.
 */
export function creditOptions(
  invoice: InvoiceDoc,
  docs: InvoiceDoc[],
  order: PositionOrder
): CreditOptions {
  const all = docs.some((d) => d.id === invoice.id) ? docs : [...docs, invoice];
  const live = all.filter(
    (d) => d.kind === 'CREDIT_NOTE' && LIVE.includes(d.status) && creditsInvoice(d, invoice.id)
  );
  const entries = live.flatMap((cn) => entriesOn(cn, invoice.id));

  const creditable = invoice.lines.map((l, i) => {
    const credited = sum(entries.filter((e) => e.index === i).map((e) => e.value));
    return Math.max(0, num(l.total) - credited);
  });
  // Legacy invoices may hold a negative shipping line (never creditable by itself): it comes off
  // the positive shipping lines, latest first, so no credit exceeds the shipping invoiced.
  let negative = -sum(
    invoice.lines.filter((l) => l.kind === 'SHIPPING' && num(l.total) < 0).map((l) => num(l.total))
  );
  for (let i = invoice.lines.length - 1; i >= 0 && negative > 0; i--) {
    if (invoice.lines[i].kind !== 'SHIPPING' || creditable[i] <= 0) continue;
    const take = Math.min(negative, creditable[i]);
    creditable[i] -= take;
    negative -= take;
  }
  const held = Math.max(
    0,
    sum(invoice.lines.filter((l) => l.kind !== 'DISCOUNT').map((l) => num(l.total))) -
      sum(entries.map((e) => e.value))
  );
  const unitsLeft = invoice.lines.map((l, i) => {
    if (!isWholeItem(l) || creditable[i] <= 0) return 0;
    const credited = sum(entries.filter((e) => e.index === i).map((e) => e.quantity));
    return Math.max(0, Math.floor(num(l.quantity)) - credited);
  });

  // Counted invoices: the position leaves out annulled ones. Units of the order lines they hold.
  const position = invoicingPosition(order, all);
  const annulled = new Set(position.annulledInvoiceIds);
  const counted = new Map(
    all
      .filter((d) => d.kind === 'INVOICE' && LIVE.includes(d.status) && !annulled.has(d.id))
      .map((d) => [d.id, d])
  );
  const creditedUnits = liveCreditedUnits(all, counted);

  const returnable: CreditOptions['returnable'] = [];
  invoice.lines.forEach((l, index) => {
    if (unitsLeft[index] <= 0) return;
    const orderLine = order.lines.find((o) => o.id === l.orderLineId);
    const entry = position.lines.find((p) => p.orderLineId === l.orderLineId);
    if (!orderLine || !entry) return;
    const liveInvoiced = entry.invoicedUnits;
    const liveCredited = creditedUnits.get(orderLine.id) ?? 0;
    const overInvoiced = Math.max(
      0,
      liveInvoiced - liveCredited - (orderLine.quantity - orderLine.returnedQuantity)
    );
    const returnedLeft = Math.max(0, orderLine.returnedQuantity - liveCredited);
    returnable.push({
      index,
      units: Math.min(unitsLeft[index], overInvoiced, returnedLeft),
      unitsLeft: unitsLeft[index],
      valueLeft: creditable[index],
    });
  });

  const shipping = invoice.lines.flatMap((l, index) =>
    l.kind === 'SHIPPING' && creditable[index] > 0 ? [{ index, value: creditable[index] }] : []
  );

  // Only what live credit notes (any status that counts) have not credited yet. REFUND credit
  // notes never touch the over-invoiced shipping (the position leaves them out).
  const pendingShippingCredit = sum(
    all
      .filter(
        (d) =>
          d.kind === 'CREDIT_NOTE' &&
          d.creditType !== 'REFUND' &&
          (d.status === 'PENDING' || d.status === 'UNCERTAIN')
      )
      .flatMap((d) => d.lines.filter((l) => l.kind === 'SHIPPING').map((l) => num(l.total)))
  );
  let left = Math.max(0, position.overInvoiced.shipping - pendingShippingCredit);
  const shippingAdjustment: CreditOptions['shippingAdjustment'] = [];
  [...shipping].reverse().forEach((s) => {
    const value = Math.min(left, s.value);
    if (value <= 0) return;
    shippingAdjustment.unshift({ index: s.index, value });
    left -= value;
  });

  return { creditable, unitsLeft, returnable, shipping, shippingAdjustment, held };
}

/**
 * Whether `creditNote` (left out of `options`, e.g. a FAILED row a late success turns ISSUED)
 * credits more than `invoice` still has: a line's value above its creditable value, a whole ITEM
 * line's units above its units left, or (RETURN) units above the returnable ones. Only its
 * entries on `invoice` are weighed: call it once per invoice it credits.
 */
export function exceedsCreditable(creditNote: InvoiceDoc, invoice: InvoiceDoc, options: CreditOptions): boolean {
  return entriesOn(creditNote, invoice.id).some((e) => {
    const line = invoice.lines[e.index];
    if (!line || e.value > (options.creditable[e.index] ?? 0)) return true;
    if (!isWholeItem(line) || e.quantity <= 0) return false;
    if (e.quantity > (options.unitsLeft[e.index] ?? 0)) return true;
    if (creditNote.creditType !== 'RETURN') return false;
    return e.quantity > (options.returnable.find((r) => r.index === e.index)?.units ?? 0);
  });
}

type Built = {
  lines: InvoiceLine[];
  creditedLines: CreditedLine[];
  total: number;
  issues: ValidationIssue[];
};

const failed = (issues: ValidationIssue[]): Built => ({
  lines: [],
  creditedLines: [],
  total: 0,
  issues,
});

/** The credit-note lines of a request against the options (ruling 13). */
export function buildCreditLines(
  invoice: InvoiceDoc,
  options: CreditOptions,
  request: CreditRequest
): Built {
  const reqLines = Array.isArray(request?.lines) ? request.lines : [];
  const reqShipping = Array.isArray(request?.shippingIndexes) ? request.shippingIndexes : [];
  const entries: { index: number; line: InvoiceLine; value: number; quantity: number }[] = [];
  const issues: ValidationIssue[] = [];

  if (request?.creditType === 'CORRECTION') {
    if (reqLines.length) issues.push({ path: 'lines', code: 'invalid' });
    if (reqShipping.length) issues.push({ path: 'shippingIndexes', code: 'invalid' });
    if (issues.length) return failed(issues);
    invoice.lines.forEach((l, index) => {
      const value = options.creditable[index];
      if (!(value > 0)) return;
      const units = options.unitsLeft[index];
      const whole = units > 0;
      const line = whole
        ? (sharedUnitsCredit(l, value, units, units) ?? { ...l, quantity: units, total: value })
        : creditLine(l, value);
      entries.push({ index, line, value, quantity: line.quantity });
    });
    if (!entries.length) return failed([{ path: 'lines', code: 'required' }]);
    // DISCOUNT lines are already netted into the lines' totals: kept as a record, crediting 0.
    invoice.lines.forEach((l, index) => {
      if (l.kind === 'DISCOUNT') entries.push({ index, line: l, value: 0, quantity: 0 });
    });
  } else if (request?.creditType === 'SHIPPING') {
    if (reqLines.length) issues.push({ path: 'lines', code: 'invalid' });
    if (reqShipping.length) issues.push({ path: 'shippingIndexes', code: 'invalid' });
    if (issues.length) return failed(issues);
    for (const s of options.shippingAdjustment) {
      const line = creditLine(invoice.lines[s.index], s.value);
      entries.push({ index: s.index, line, value: s.value, quantity: line.quantity });
    }
    if (!entries.length) return failed([{ path: 'creditType', code: 'NOTHING_TO_CREDIT' }]);
  } else if (request?.creditType === 'RETURN') {
    const seen = new Set<unknown>();
    reqLines.forEach((entry, i) => {
      const e: Record<string, unknown> = isObject(entry) ? entry : {};
      const option = options.returnable.find((r) => r.index === e.index);
      if (!option) {
        issues.push({ path: `lines.${i}.index`, code: 'invalid' });
        return;
      }
      if (seen.has(option.index)) {
        issues.push({ path: `lines.${i}.index`, code: 'duplicate' });
        return;
      }
      seen.add(option.index);
      const quantity = e.quantity;
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
        issues.push({ path: `lines.${i}.quantity`, code: 'invalid' });
        return;
      }
      if (quantity > option.units) {
        issues.push({ path: `lines.${i}.quantity`, code: 'QUANTITY_EXCEEDS_CREDITABLE' });
        return;
      }
      const original = invoice.lines[option.index];
      const shared = sharedUnitsCredit(original, option.valueLeft, option.unitsLeft, quantity);
      const value = shared ? shared.total : selectedValue(option.valueLeft, option.unitsLeft, quantity);
      entries.push({
        index: option.index,
        line: shared ?? { ...withTotal(original, value), quantity, partial: false },
        value,
        quantity,
      });
    });
    const seenShipping = new Set<unknown>();
    reqShipping.forEach((index, i) => {
      const option = options.shipping.find((s) => s.index === index);
      if (!option) {
        issues.push({ path: `shippingIndexes.${i}`, code: 'SHIPPING_NOT_CREDITABLE' });
        return;
      }
      if (seenShipping.has(index)) {
        issues.push({ path: `shippingIndexes.${i}`, code: 'duplicate' });
        return;
      }
      seenShipping.add(index);
      const line = creditLine(invoice.lines[option.index], option.value);
      entries.push({ index: option.index, line, value: option.value, quantity: line.quantity });
    });
    if (!reqLines.length && !reqShipping.length) issues.push({ path: 'lines', code: 'required' });
    if (issues.length) return failed(issues);
  } else {
    return failed([{ path: 'creditType', code: 'invalid' }]);
  }

  entries.sort((a, b) => a.index - b.index);
  const total = sum(entries.map((e) => e.value));
  if (options.held !== undefined && total > options.held) {
    return failed([{ path: 'lines', code: 'CREDIT_EXCEEDS_INVOICE' }]);
  }
  return {
    lines: entries.map((e) => e.line),
    creditedLines: entries.map((e) => ({ index: e.index, value: e.value, quantity: e.quantity })),
    total,
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// REFUND credit notes (plan 15)
// ---------------------------------------------------------------------------

/** What a REFUND credit note may credit of one invoice line: whole units, or a whole shipping line. */
export type RefundCreditLineOption = {
  index: number;
  kind: 'ITEM' | 'SHIPPING';
  name: string;
  quantityLeft: number;
  /** The value of one unit (the first one credited), by the RETURN share rule. */
  unitValue: number;
  valueLeft: number;
};

/**
 * `q` units of an ITEM line credited exactly `value` cents (a value fixed earlier by
 * `unitsCredit`): a whole-item line keeps the discount share that value implies.
 */
const fixedUnitsCredit = (line: InvoiceLine, q: number, value: number): InvoiceLine => {
  if (!isSharedLine(line)) return { ...withTotal(line, value), quantity: q, partial: false };
  const netUnit = Math.round((num(line.total) + line.discountShare!) / line.quantity);
  const grossUnit = line.grossTotal == null ? null : line.grossTotal / line.quantity;
  return {
    ...line,
    quantity: q,
    total: value,
    partial: false,
    discountShare: Math.max(0, netUnit * q - value),
    ...(grossUnit != null && Number.isInteger(grossUnit) ? { grossTotal: grossUnit * q } : {}),
  };
};

/** `q` of the `u` units left of an ITEM line, valued the RETURN way (`sharedUnitsCredit`). */
const unitsCredit = (line: InvoiceLine, valueLeft: number, u: number, q: number): InvoiceLine => {
  const shared = sharedUnitsCredit(line, valueLeft, u, q);
  if (shared) return shared;
  return { ...withTotal(line, selectedValue(valueLeft, u, q)), quantity: q, partial: false };
};

/**
 * The elements of `invoice` an INVOICED refund's credit note may credit (plan 15): ITEM lines with
 * whole units left (valued by the RETURN share rule) and whole SHIPPING lines, as `options` (live
 * credit notes counted) leaves them. DISCOUNT records are never listed.
 */
export function refundCreditOptions(invoice: InvoiceDoc, options: CreditOptions): RefundCreditLineOption[] {
  return invoice.lines.flatMap((l, index): RefundCreditLineOption[] => {
    if (l.kind === 'ITEM') {
      const units = options.unitsLeft[index] ?? 0;
      const valueLeft = options.creditable[index] ?? 0;
      if (units <= 0 || valueLeft <= 0) return [];
      const unitValue = num(unitsCredit(l, valueLeft, units, 1).total);
      return [{ index, kind: 'ITEM', name: l.name, quantityLeft: units, unitValue, valueLeft }];
    }
    if (l.kind === 'SHIPPING') {
      const s = options.shipping.find((o) => o.index === index);
      if (!s) return [];
      return [{ index, kind: 'SHIPPING', name: l.name, quantityLeft: 1, unitValue: s.value, valueLeft: s.value }];
    }
    return [];
  });
}

/**
 * The credit-note line for `quantity` of option `index` of `invoice` (a whole shipping line takes
 * quantity 1), or the issue that refuses it.
 */
export function refundCreditLine(
  invoice: InvoiceDoc,
  options: CreditOptions,
  index: unknown,
  quantity: unknown
): { line: InvoiceLine; value: number; quantity: number } | { issue: 'index' | 'quantity'; code: string } {
  const option = refundCreditOptions(invoice, options).find((o) => o.index === index);
  if (!option) return { issue: 'index', code: 'invalid' };
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return { issue: 'quantity', code: 'invalid' };
  }
  if (quantity > option.quantityLeft) return { issue: 'quantity', code: 'QUANTITY_EXCEEDS_CREDITABLE' };
  const original = invoice.lines[option.index];
  if (option.kind === 'SHIPPING') {
    const line = creditLine(original, option.valueLeft);
    return { line, value: option.valueLeft, quantity: line.quantity };
  }
  const line = unitsCredit(original, option.valueLeft, option.quantityLeft, quantity);
  return { line, value: num(line.total), quantity };
}

/**
 * The credit-note line of an element an INVOICED refund stored (plan 15), at its stored value: no
 * re-valuation, so the credit note equals the refund to the cent. Null when the element is no
 * longer creditable as stored: the line is gone, fewer units are left, less value is left, or a
 * shipping line is no longer whole.
 */
export function refundStoredCreditLine(
  invoice: InvoiceDoc,
  options: CreditOptions,
  item: { index: number; quantity: number; value: number }
): { line: InvoiceLine; value: number; quantity: number } | null {
  const option = refundCreditOptions(invoice, options).find((o) => o.index === item.index);
  if (!option || item.quantity > option.quantityLeft || !(item.value > 0) || item.value > option.valueLeft) {
    return null;
  }
  const original = invoice.lines[option.index];
  if (option.kind === 'SHIPPING') {
    if (item.quantity !== 1 || item.value !== option.valueLeft) return null;
    const line = creditLine(original, item.value);
    return { line, value: item.value, quantity: line.quantity };
  }
  return { line: fixedUnitsCredit(original, item.quantity, item.value), value: item.value, quantity: item.quantity };
}
