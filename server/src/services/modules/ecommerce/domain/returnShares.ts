/**
 * Discount shares of returns (plan 14 final fixes, C1; no Strapi imports). Money is integer
 * cents, VAT included.
 *
 * A returned unit gives back what was effectively paid for it: its net value less its share of
 * the order discounts.
 * - A line held by a whole-item invoice (an ITEM line with `discountShare`): the share is the
 *   invoice line's, by `unitsShare` (the rule of the RETURN credit note), so the refund and the
 *   credit note are the same to the cent. It is recorded against the invoice's ORDER DISCOUNT
 *   records it came from.
 * - Any other line (not invoiced, or on a legacy invoice): the pro-rata rule of the order
 *   discount (round half-up of discount × returned net / subtotal, capped), over the ORDER discount items not invoiced and the
 *   lines no whole-item invoice holds. It is recorded against those discount items.
 *
 * The recorded shares (on the return row) lower each discount item's effective amount, so the
 * discount items always add up to the stored order discount: a return never leaves an `adj` item.
 */
import { allocateProportionally } from './orders';
import { isSharedLine, unitsShare } from './creditNotes';
import { isObject, num } from './invoicing';
import type { InvoiceDoc } from './invoiceSelection';

/** One discount item's part of a return's share; `invoiceId` when it came from that invoice. */
export type ReturnAllocation = { id: string; amount: number; invoiceId: number | null };

/** What a return took of an invoice line: units and share (index in the invoice's lines). */
export type ReturnInvoiceShare = { invoiceId: number; index: number; quantity: number; share: number };

export type ReturnShareRecord = {
  discounts: ReturnAllocation[];
  invoiceShares: ReturnInvoiceShare[];
};

const COUNTED: InvoiceDoc['status'][] = ['ISSUED', 'PENDING', 'UNCERTAIN'];

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/** The shares stored in a return row's `items` JSON; rows written before C1 have none. */
export function readReturnShares(items: unknown): ReturnShareRecord {
  const r = isObject(items) ? items : {};
  const discounts = (Array.isArray(r.discounts) ? r.discounts : []).filter(isObject).flatMap((d) => {
    const amount = int(d.amount);
    if (typeof d.id !== 'string' || !d.id || amount === null) return [];
    const invoiceId = d.invoiceId == null ? null : int(d.invoiceId);
    return [{ id: d.id, amount, invoiceId }];
  });
  const invoiceShares = (Array.isArray(r.invoiceShares) ? r.invoiceShares : []).filter(isObject).flatMap((e) => {
    const invoiceId = int(e.invoiceId);
    const index = int(e.index);
    const quantity = int(e.quantity);
    const share = int(e.share);
    if (invoiceId === null || index === null || quantity === null || share === null) return [];
    return [{ invoiceId, index, quantity, share }];
  });
  return { discounts, invoiceShares };
}

/** `s:<id>` and `adj:shipping` are SHIPPING discount items; every other id is an ORDER one. */
export const discountKindOf = (id: string): 'ORDER' | 'SHIPPING' =>
  id.startsWith('s:') || id === 'adj:shipping' ? 'SHIPPING' : 'ORDER';

/** Cents of each discount item the returns took (an `adj` item reads it from the order). */
export function returnedDiscountAmounts(records: ReturnShareRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    for (const d of r.discounts) {
      if (d.id.startsWith('adj:')) continue;
      out.set(d.id, (out.get(d.id) ?? 0) + d.amount);
    }
  }
  return out;
}

export type ReturnLine = {
  id: number;
  unitPrice: number;
  unitDiscount: number;
  quantity: number;
  returnedQuantity: number;
};

export type ReturnSharesInput = {
  /** The order lines before this return. */
  lines: ReturnLine[];
  request: { orderLineId: number; quantity: number }[];
  /** The order's documents and the annulled invoices (the invoicing position). */
  docs: InvoiceDoc[];
  annulledInvoiceIds: number[];
  /** The stored order discount before this return (caps the shares taken from the pool). */
  orderDiscount: number;
  /** The discount items now (effective amounts, `invoiced`), as `invoiceItems` gives them. */
  discounts: { id: string; kind: 'ORDER' | 'SHIPPING'; amount: number; invoiced: boolean }[];
  /** The shares earlier returns recorded. */
  previous: ReturnShareRecord[];
};

export type ReturnShares = {
  items: { orderLineId: number; quantity: number; value: number; share: number }[];
  grossValue: number;
  discountShare: number;
  refundableValue: number;
  record: ReturnShareRecord;
};

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);

/** The discount shares of a return (see the module comment). Unknown lines are skipped. */
export function computeReturnShares(input: ReturnSharesInput): ReturnShares {
  const annulled = new Set(input.annulledInvoiceIds);
  const invoices = input.docs.filter(
    (d) => d.kind === 'INVOICE' && COUNTED.includes(d.status) && !annulled.has(d.id)
  );
  /** The whole-item invoice line holding an order line, if any. */
  const heldBy = (orderLineId: number) => {
    for (const doc of invoices) {
      const index = doc.lines.findIndex((l) => l.orderLineId === orderLineId && isSharedLine(l));
      if (index >= 0) return { doc, index, line: doc.lines[index] };
    }
    return null;
  };
  const previousShares = input.previous.flatMap((r) => r.invoiceShares);
  const previousAllocations = input.previous.flatMap((r) => r.discounts);
  const taken = (invoiceId: number, index: number) => {
    const entries = previousShares.filter((e) => e.invoiceId === invoiceId && e.index === index);
    return { units: sum(entries.map((e) => e.quantity)), share: sum(entries.map((e) => e.share)) };
  };

  const byId = new Map(input.lines.map((l) => [l.id, l]));
  const net = (l: ReturnLine) => l.unitPrice - l.unitDiscount;
  const items: ReturnShares['items'] = [];
  const invoiceShares: ReturnInvoiceShare[] = [];
  const allocations: ReturnAllocation[] = [];
  /** Units of each held line still on its invoice (before this return). */
  const unitsOnInvoice = new Map<number, number>();
  const uninvoiced: { orderLineId: number; units: number }[] = [];

  for (const r of input.request) {
    const l = byId.get(r.orderLineId);
    if (!l) continue;
    const held = heldBy(l.id);
    let share = 0;
    let fromInvoice = 0;
    if (held) {
      const before = taken(held.doc.id, held.index);
      const thisReturn = invoiceShares.filter((e) => e.invoiceId === held.doc.id && e.index === held.index);
      const uLeft = Math.max(
        0,
        held.line.quantity - before.units - sum(thisReturn.map((e) => e.quantity))
      );
      unitsOnInvoice.set(l.id, uLeft);
      fromInvoice = Math.min(r.quantity, uLeft);
      if (fromInvoice > 0) {
        const shareLeft = Math.max(
          0,
          held.line.discountShare! - before.share - sum(thisReturn.map((e) => e.share))
        );
        share = unitsShare(shareLeft, uLeft, fromInvoice);
        invoiceShares.push({ invoiceId: held.doc.id, index: held.index, quantity: fromInvoice, share });
        // Against the invoice's ORDER discount records, by what each has left.
        const records = held.doc.lines.filter(
          (x) => x.kind === 'DISCOUNT' && !!x.discountId && discountKindOf(x.discountId) === 'ORDER'
        );
        const left = records.map((x) => {
          const used = sum(
            [...previousAllocations, ...allocations]
              .filter((a) => a.invoiceId === held.doc.id && a.id === x.discountId)
              .map((a) => a.amount)
          );
          return Math.max(0, -num(x.total) - used);
        });
        if (share > 0 && sum(left) >= share) {
          allocateProportionally(share, left).forEach((amount, i) => {
            if (amount > 0) allocations.push({ id: records[i].discountId!, amount, invoiceId: held.doc.id });
          });
        } else if (share > 0) {
          allocations.push({ id: 'adj:order', amount: share, invoiceId: held.doc.id });
        }
      }
    }
    if (r.quantity > fromInvoice) uninvoiced.push({ orderLineId: l.id, units: r.quantity - fromInvoice });
    items.push({ orderLineId: l.id, quantity: r.quantity, value: net(l) * r.quantity, share });
  }

  // Units no whole-item invoice holds: the pro-rata share of the ORDER discounts not invoiced.
  if (uninvoiced.length) {
    const pool = input.discounts.filter((d) => d.kind === 'ORDER' && !d.invoiced && d.amount > 0);
    const poolTotal = sum(pool.map((d) => d.amount));
    let subtotal = 0;
    for (const l of input.lines) {
      const held = heldBy(l.id);
      const onInvoice = held
        ? (unitsOnInvoice.get(l.id) ??
          Math.max(0, held.line.quantity - taken(held.doc.id, held.index).units))
        : 0;
      subtotal += net(l) * Math.max(0, l.quantity - l.returnedQuantity - onInvoice);
    }
    const returnedNet = sum(uninvoiced.map((u) => net(byId.get(u.orderLineId)!) * u.units));
    // Round half-up of pool × returnedNet / subtotal, capped at the pool and at the order
    // discount before this return less the invoice shares this return already took.
    const cap = Math.max(0, Math.min(poolTotal, input.orderDiscount - sum(invoiceShares.map((e) => e.share))));
    const share =
      subtotal <= 0 || returnedNet <= 0 || cap <= 0
        ? 0
        : Math.min(cap, Math.floor((2 * poolTotal * returnedNet + subtotal) / (2 * subtotal)));
    if (share > 0) {
      // Spread over the returned lines by value, then recorded against the discount items.
      const perLine = allocateProportionally(
        share,
        uninvoiced.map((u) => net(byId.get(u.orderLineId)!) * u.units)
      );
      uninvoiced.forEach((u, i) => {
        const item = items.find((x) => x.orderLineId === u.orderLineId)!;
        item.share += perLine[i];
      });
      allocateProportionally(share, pool.map((d) => d.amount)).forEach((amount, i) => {
        if (amount > 0) allocations.push({ id: pool[i].id, amount, invoiceId: null });
      });
    }
  }

  const grossValue = sum(items.map((i) => i.value));
  const discountShare = sum(items.map((i) => i.share));
  return {
    items,
    grossValue,
    discountShare,
    refundableValue: grossValue - discountShare,
    record: { discounts: allocations, invoiceShares },
  };
}
