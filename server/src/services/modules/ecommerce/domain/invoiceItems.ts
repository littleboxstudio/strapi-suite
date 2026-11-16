/**
 * Invoiceable whole items (plan 14; no Strapi imports). Money is integer cents, VAT included.
 * An invoice is built from whole items: order-line units, shipping lines and discounts.
 */
import { invoicingPosition, type InvoiceDoc, type PositionOrder } from './invoiceSelection';
import { allocateProportionally } from './orders';
import type { ValidationIssue } from '../errors';
import { chargedShipping, correctionsOf } from './shippingLines';
import type { ManualDiscount } from './manualDiscounts';
import type { AppliedPromotion } from './promotions';

export type DiscountItem = {
  id: string;
  kind: 'ORDER' | 'SHIPPING';
  label: string;
  amount: number;
  invoiced: boolean;
  manualKind?: 'FIXED' | 'PERCENT' | 'LEGACY';
  percent?: number | null;
};
export type LineItem = { orderLineId: number; units: number; value: number; invoiced: boolean };
export type ShippingItem = { shippingLineId: number; value: number; invoiced: boolean };
export type InvoiceItems = {
  lines: LineItem[];
  shipping: ShippingItem[];
  discounts: DiscountItem[];
};

/** The discounts an order carries, one item each; any unexplained difference is an `adj` item. */
export function discountItemsOf(order: {
  orderDiscount: number;
  shippingDiscount: number;
  manualDiscounts: ManualDiscount[];
  applied: AppliedPromotion[];
}): Omit<DiscountItem, 'invoiced'>[] {
  const items: Omit<DiscountItem, 'invoiced'>[] = [];
  for (const m of order.manualDiscounts) {
    items.push({
      id: `m:${m.id}`,
      kind: 'ORDER',
      label: m.reason,
      amount: m.amount,
      manualKind: m.kind,
      percent: m.percent,
    });
  }
  for (const p of order.applied) {
    // Older rows may store an applied promotion without `benefits`: it adds no item.
    for (const b of Array.isArray(p.benefits) ? p.benefits : []) {
      if (!(b?.amount > 0)) continue;
      if (b.class === 'ORDER_DISCOUNT') {
        items.push({ id: `p:${p.promotionId}:${b.index}`, kind: 'ORDER', label: p.name, amount: b.amount });
      } else if (b.class === 'SHIPPING_DISCOUNT') {
        // One item per promotion: its shipping benefits add up.
        const id = `s:${p.promotionId}`;
        const existing = items.find((i) => i.id === id);
        if (existing) existing.amount += b.amount;
        else items.push({ id, kind: 'SHIPPING', label: p.name, amount: b.amount });
      }
    }
  }
  const total = (kind: 'ORDER' | 'SHIPPING') =>
    items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amount, 0);
  const orderDiff = order.orderDiscount - total('ORDER');
  if (orderDiff !== 0) {
    items.push({ id: 'adj:order', kind: 'ORDER', label: 'Order discount adjustment', amount: orderDiff });
  }
  const shippingDiff = order.shippingDiscount - total('SHIPPING');
  if (shippingDiff !== 0) {
    items.push({ id: 'adj:shipping', kind: 'SHIPPING', label: 'Shipping discount adjustment', amount: shippingDiff });
  }
  return items;
}

/** What can still be invoiced, as whole items, given the invoice documents. */
export function invoiceItems(
  order: PositionOrder & {
    shippingDiscount: number;
    manualDiscounts: ManualDiscount[];
    applied: AppliedPromotion[];
  },
  docs: InvoiceDoc[]
): InvoiceItems {
  const position = invoicingPosition(order, docs);

  const lines: LineItem[] = order.lines.map((l) => {
    const held = position.lines.find((p) => p.orderLineId === l.id);
    const units = held?.remainingQuantity ?? 0;
    return {
      orderLineId: l.id,
      units,
      value: units * (l.unitPrice - l.unitDiscount),
      invoiced: units === 0,
    };
  });

  // Negative shipping lines settled by a SHIPPING credit note that counts (on an invoice that is
  // not annulled): the credit note already took their reduction off what was invoiced.
  const annulled = new Set(position.annulledInvoiceIds);
  // Shipping discount items they settled likewise (`settledDiscountIds`).
  const settled = new Set<number>();
  const settledDiscounts = new Set<string>();
  for (const d of docs) {
    if (d.kind !== 'CREDIT_NOTE' || d.status === 'FAILED' || d.creditType !== 'SHIPPING') continue;
    if (d.creditedInvoiceId !== null && annulled.has(d.creditedInvoiceId)) continue;
    for (const id of d.settledShippingLineIds ?? []) settled.add(id);
    for (const id of d.settledDiscountIds ?? []) settledDiscounts.add(id);
  }

  // Negative shipping lines are never created; legacy ones (old data) are never offered.
  const shipping: ShippingItem[] = [...order.shippingLines]
    .filter((l) => l.editOf === undefined)
    .sort((a, b) => a.id - b.id)
    .map((l) => {
      const value = l.amount + chargedShipping(correctionsOf(order.shippingLines, l.id));
      return {
        shippingLineId: l.id,
        value,
        invoiced:
          value < 0 ||
          settled.has(l.id) ||
          (position.shipping.find((s) => s.shippingLineId === l.id)?.invoiced ?? false),
      };
    });

  const invoicedDiscounts = new Set<string>();
  for (const d of docs) {
    if (d.kind !== 'INVOICE' || d.status === 'FAILED' || annulled.has(d.id)) continue;
    for (const l of d.lines) if (l.kind === 'DISCOUNT' && l.discountId) invoicedDiscounts.add(l.discountId);
  }
  const discounts: DiscountItem[] = discountItemsOf(order).map((d) => ({
    ...d,
    invoiced: invoicedDiscounts.has(d.id) || settledDiscounts.has(d.id),
  }));

  return { lines, shipping, discounts };
}

export type WholeSelectionRequest = {
  orderLineIds: number[];
  shippingLineIds: number[];
  discountIds: string[];
  paymentIds: number[];
};

export type PricedWholeSelection = {
  lines: { orderLineId: number; units: number; value: number; discountShare: number }[];
  shipping: { shippingLineId: number; value: number; discountShare: number }[];
  discounts: { id: string; kind: 'ORDER' | 'SHIPPING'; amount: number }[];
  payments: { paymentId: number; value: number }[];
  total: number;
  paymentsTotal: number;
};

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Prices a whole-item selection: lines + shipping - discounts must equal the payments' net values.
 * Issues are path-indexed by request position; a repeated id is a `duplicate` at its later
 * position. The totals check only runs when there is no other issue. `selection` is null when
 * there are issues. The ORDER discounts are spread over the selected lines by value, the SHIPPING
 * discounts over the selected shipping lines with a positive value; each pool's shares add up
 * exactly to its discounts.
 */
export function priceWholeSelection(
  items: InvoiceItems,
  payments: { id: number; net: number; available: boolean }[],
  request: WholeSelectionRequest
): { selection: PricedWholeSelection | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const reqLines = list(request?.orderLineIds);
  const reqShipping = list(request?.shippingLineIds);
  const reqDiscounts = list(request?.discountIds);
  const reqPayments = list(request?.paymentIds);

  const lines: { orderLineId: number; units: number; value: number }[] = [];
  const seenLines = new Set<unknown>();
  reqLines.forEach((id, i) => {
    const line = items.lines.find((l) => l.orderLineId === id);
    if (!line) {
      issues.push({ path: `orderLineIds.${i}`, code: 'unknown_line' });
      return;
    }
    if (seenLines.has(id)) {
      issues.push({ path: `orderLineIds.${i}`, code: 'duplicate' });
      return;
    }
    seenLines.add(id);
    if (line.invoiced || !(line.units > 0)) {
      issues.push({ path: `orderLineIds.${i}`, code: 'LINE_ALREADY_INVOICED' });
      return;
    }
    lines.push({ orderLineId: line.orderLineId, units: line.units, value: line.value });
  });

  const shipping: { shippingLineId: number; value: number }[] = [];
  const seenShipping = new Set<unknown>();
  reqShipping.forEach((id, i) => {
    if (seenShipping.has(id)) {
      issues.push({ path: `shippingLineIds.${i}`, code: 'duplicate' });
      return;
    }
    seenShipping.add(id);
    const line = items.shipping.find((s) => s.shippingLineId === id);
    if (!line || line.invoiced || line.value < 0) {
      issues.push({ path: `shippingLineIds.${i}`, code: 'SHIPPING_LINE_NOT_INVOICEABLE' });
      return;
    }
    shipping.push({ shippingLineId: line.shippingLineId, value: line.value });
  });

  const discounts: PricedWholeSelection['discounts'] = [];
  const seenDiscounts = new Set<unknown>();
  reqDiscounts.forEach((id, i) => {
    if (seenDiscounts.has(id)) {
      issues.push({ path: `discountIds.${i}`, code: 'duplicate' });
      return;
    }
    seenDiscounts.add(id);
    const d = items.discounts.find((x) => x.id === id);
    if (!d || d.invoiced) {
      issues.push({ path: `discountIds.${i}`, code: 'DISCOUNT_NOT_INVOICEABLE' });
      return;
    }
    discounts.push({ id: d.id, kind: d.kind, amount: d.amount });
  });

  const priced: PricedWholeSelection['payments'] = [];
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

  if (reqLines.length === 0 && reqShipping.length === 0 && reqDiscounts.length === 0) {
    issues.push({ path: 'orderLineIds', code: 'required' });
  }
  if (reqPayments.length === 0) issues.push({ path: 'paymentIds', code: 'required' });

  const poolOf = (kind: 'ORDER' | 'SHIPPING') =>
    sum(discounts.filter((d) => d.kind === kind).map((d) => d.amount));
  const linesValue = sum(lines.map((l) => l.value));
  const shippingValue = sum(shipping.map((s) => s.value));
  const orderDiscounts = poolOf('ORDER');
  const shippingDiscounts = poolOf('SHIPPING');
  if (orderDiscounts > linesValue || (shippingDiscounts > 0 && shippingDiscounts > shippingValue)) {
    issues.push({ path: 'discountIds', code: 'DISCOUNT_EXCEEDS_SELECTION' });
  }

  const total = linesValue + shippingValue - orderDiscounts - shippingDiscounts;
  const paymentsTotal = sum(priced.map((p) => p.value));
  if (!issues.length && (total !== paymentsTotal || total <= 0)) {
    issues.push({ path: 'paymentIds', code: 'INVOICE_TOTALS_DIFFER' });
  }
  if (issues.length) return { selection: null, issues };

  const lineShares = allocateProportionally(orderDiscounts, lines.map((l) => Math.max(0, l.value)));
  const shippingShares = allocateProportionally(shippingDiscounts, shipping.map((s) => Math.max(0, s.value)));
  return {
    selection: {
      lines: lines.map((l, i) => ({ ...l, discountShare: lineShares[i] })),
      shipping: shipping.map((s, i) => ({ ...s, discountShare: shippingShares[i] })),
      discounts,
      payments: priced,
      total,
      paymentsTotal,
    },
    issues,
  };
}
