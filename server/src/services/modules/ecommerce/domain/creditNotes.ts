/**
 * Credit notes by reason (plan 11, ruling 13; no Strapi imports). Money is integer cents.
 *
 * A RETURN credits units that came back and were invoiced past what the order still holds, plus
 * whole shipping lines. A CORRECTION credits everything an invoice has left. Credit notes that
 * are ISSUED, PENDING or UNCERTAIN count, so nothing is credited twice.
 */
import type { ValidationIssue } from '../errors';
import { isObject, num, withTotal, type InvoiceLine } from './invoicing';
import {
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

/** Units of each order line credited by live RETURN credit notes (legacy ones read as RETURN). */
const liveCreditedUnits = (docs: InvoiceDoc[], counted: Map<number, InvoiceDoc>) => {
  const byLine = new Map<number, number>();
  const add = (id: number, n: number) => byLine.set(id, (byLine.get(id) ?? 0) + n);
  for (const cn of docs) {
    if (cn.kind !== 'CREDIT_NOTE' || !LIVE.includes(cn.status) || cn.creditType === 'CORRECTION')
      continue;
    const original = cn.creditedInvoiceId === null ? undefined : counted.get(cn.creditedInvoiceId);
    if (!original) continue;
    if (cn.creditType === 'RETURN') {
      for (const e of cn.creditedLines) {
        const target = original.lines[e.index];
        if (target?.kind === 'ITEM' && target.orderLineId !== null)
          add(target.orderLineId, e.quantity);
      }
    } else {
      for (const l of cn.lines) {
        if (isWholeItem(l)) add(l.orderLineId!, Math.max(0, Math.floor(num(l.quantity))));
      }
    }
  }
  return byLine;
};

/** What can still be credited on `invoice` (ruling 13). `docs` holds the order's documents. */
export function creditOptions(
  invoice: InvoiceDoc,
  docs: InvoiceDoc[],
  order: PositionOrder
): CreditOptions {
  const all = docs.some((d) => d.id === invoice.id) ? docs : [...docs, invoice];
  const live = all.filter(
    (d) => d.kind === 'CREDIT_NOTE' && d.creditedInvoiceId === invoice.id && LIVE.includes(d.status)
  );

  const creditable = invoice.lines.map((l, i) => {
    const credited = sum(
      live.flatMap((cn) => cn.creditedLines.filter((e) => e.index === i).map((e) => e.value))
    );
    return Math.max(0, num(l.total) - credited);
  });
  const unitsLeft = invoice.lines.map((l, i) => {
    if (!isWholeItem(l) || creditable[i] <= 0) return 0;
    const credited = sum(
      live.flatMap((cn) => cn.creditedLines.filter((e) => e.index === i).map((e) => e.quantity))
    );
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

  return { creditable, unitsLeft, returnable, shipping };
}

/**
 * Whether `creditNote` (left out of `options`, e.g. a FAILED row a late success turns ISSUED)
 * credits more than `invoice` still has: a line's value above its creditable value, a whole ITEM
 * line's units above its units left, or (RETURN) units above the returnable ones.
 */
export function exceedsCreditable(creditNote: InvoiceDoc, invoice: InvoiceDoc, options: CreditOptions): boolean {
  return creditNote.creditedLines.some((e) => {
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
      const whole = options.unitsLeft[index] > 0;
      const line = whole
        ? { ...l, quantity: options.unitsLeft[index], total: value }
        : creditLine(l, value);
      entries.push({ index, line, value, quantity: line.quantity });
    });
    if (!entries.length) return failed([{ path: 'lines', code: 'required' }]);
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
      const value = selectedValue(option.valueLeft, option.unitsLeft, quantity);
      entries.push({
        index: option.index,
        line: { ...withTotal(invoice.lines[option.index], value), quantity, partial: false },
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
  return {
    lines: entries.map((e) => e.line),
    creditedLines: entries.map((e) => ({ index: e.index, value: e.value, quantity: e.quantity })),
    total: sum(entries.map((e) => e.value)),
    issues: [],
  };
}
