/**
 * Invoiceable whole items (plan 14; no Strapi imports). Money is integer cents, VAT included.
 * An invoice is built from whole items: order-line units, shipping lines and discounts.
 */
import { invoicingPosition, type InvoiceDoc, type PositionOrder } from './invoiceSelection';
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
    for (const b of p.benefits) {
      if (!(b.amount > 0)) continue;
      if (b.class === 'ORDER_DISCOUNT') {
        items.push({ id: `p:${p.promotionId}:${b.index}`, kind: 'ORDER', label: p.name, amount: b.amount });
      } else if (b.class === 'SHIPPING_DISCOUNT') {
        items.push({ id: `s:${p.promotionId}`, kind: 'SHIPPING', label: p.name, amount: b.amount });
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

  const shipping: ShippingItem[] = [...order.shippingLines]
    .filter((l) => l.editOf === undefined)
    .sort((a, b) => a.id - b.id)
    .map((l) => ({
      shippingLineId: l.id,
      value: l.amount + chargedShipping(correctionsOf(order.shippingLines, l.id)),
      invoiced: position.shipping.find((s) => s.shippingLineId === l.id)?.invoiced ?? false,
    }));

  const annulled = new Set(position.annulledInvoiceIds);
  const invoicedDiscounts = new Set<string>();
  for (const d of docs) {
    if (d.kind !== 'INVOICE' || d.status === 'FAILED' || annulled.has(d.id)) continue;
    for (const l of d.lines) if (l.kind === 'DISCOUNT' && l.discountId) invoicedDiscounts.add(l.discountId);
  }
  const discounts: DiscountItem[] = discountItemsOf(order).map((d) => ({
    ...d,
    invoiced: invoicedDiscounts.has(d.id),
  }));

  return { lines, shipping, discounts };
}
