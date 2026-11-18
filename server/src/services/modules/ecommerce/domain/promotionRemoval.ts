/**
 * Removing an applied promotion from an order (owner approved): the only way an applied
 * promotion leaves an order (Recalculate discounts never removes one). Pure domain: no I/O.
 * Money is integer cents, VAT included.
 *
 * Allowed while its effect is neither invoiced nor shipped: none of its discounted or gift units
 * is invoiced, shipped or in a shipment; its order discount is on no invoice; for a shipping
 * discount, no shipping charge (nor its discount) is invoiced. Removal takes its gift lines off,
 * puts its discounted units back at their price, and takes its order and shipping discounts off.
 */
import { EcommerceValidationError } from '../errors';
import type { DiscountLine, DiscountLineChange, DiscountSplit } from './discountRecalculation';
import type { ModificationTotals } from './orderModification';
import {
  computeTotals,
  financialSummary,
  type LineAmounts,
  type OrderTotals,
  type PaymentLike,
  type RefundLike,
} from './orders';
import type { AppliedPromotion } from './promotions';

export type PromotionRemovalBlock =
  | 'PROMOTION_NOT_APPLIED'
  | 'PROMOTION_INVOICED'
  | 'PROMOTION_SHIPPED';

export type PromotionRemovalContext = {
  lines: DiscountLine[];
  applied: AppliedPromotion[];
  orderDiscount: number;
  /** Σ shipping charges. */
  shippingGross: number;
  shippingDiscount: number;
  creditAdjustment?: number;
  /** Discount items an invoice reflects (`p:<id>:<index>`, `s:<id>`, see `discountItemsOf`). */
  invoicedDiscountIds: string[];
  /** A shipping charge is on an invoice. */
  shippingInvoiced: boolean;
  payments: PaymentLike[];
  refunds: RefundLike[];
};

export type PromotionRemoval = {
  promotion: AppliedPromotion;
  /** Changed lines (as Recalculate discounts writes them). */
  lines: DiscountLineChange[];
  removedGiftLines: { id: number; variantId: number; quantity: number }[];
  /** Gift units removed. */
  giftUnits: number;
  applied: AppliedPromotion[];
  orderDiscount: number;
  shippingDiscount: number;
  /** The promotion's stored amount. */
  discount: number;
  before: ModificationTotals;
  after: ModificationTotals;
  /** after.total − before.total. */
  difference: number;
};

const effective = (l: LineAmounts) => l.quantity - l.returnedQuantity;

const ownRefs = (l: DiscountLine, id: number) => l.refs.filter((r) => r.promotionId === id);

const benefitTotal = (a: AppliedPromotion, cls: string) =>
  (Array.isArray(a.benefits) ? a.benefits : [])
    .filter((b) => b?.class === cls)
    .reduce((s, b) => s + Math.max(0, Number(b.amount) || 0), 0);

/** Why the promotion cannot be removed, or null when it can. */
export function promotionRemovalBlock(
  ctx: Pick<PromotionRemovalContext, 'lines' | 'applied' | 'invoicedDiscountIds' | 'shippingInvoiced'>,
  promotionId: number
): PromotionRemovalBlock | null {
  const promotion = ctx.applied.find((a) => a.promotionId === promotionId);
  if (!promotion) return 'PROMOTION_NOT_APPLIED';
  const affected = ctx.lines.filter((l) => ownRefs(l, promotionId).length > 0);
  const invoicedIds = new Set(ctx.invoicedDiscountIds);
  const discountInvoiced =
    invoicedIds.has(`s:${promotionId}`) ||
    [...invoicedIds].some((id) => id.startsWith(`p:${promotionId}:`));
  const shippingDiscounted = benefitTotal(promotion, 'SHIPPING_DISCOUNT') > 0;
  if (
    affected.some((l) => (l.invoiced ?? 0) > 0) ||
    discountInvoiced ||
    (shippingDiscounted && ctx.shippingInvoiced)
  ) {
    return 'PROMOTION_INVOICED';
  }
  if (affected.some((l) => l.shipped > 0 || (l.reserved ?? 0) > 0)) return 'PROMOTION_SHIPPED';
  return null;
}

const withMoney = (totals: OrderTotals, ctx: PromotionRemovalContext): ModificationTotals => {
  const s = financialSummary(totals.total, ctx.payments, ctx.refunds);
  return { ...totals, paid: s.paid, due: s.due, excess: s.excess };
};

/** The removal of `promotionId`; throws a validation error with the block code when refused. */
export function removePromotion(ctx: PromotionRemovalContext, promotionId: number): PromotionRemoval {
  const block = promotionRemovalBlock(ctx, promotionId);
  if (block) {
    throw new EcommerceValidationError(block, [{ path: 'promotionId', code: block }]);
  }
  const promotion = ctx.applied.find((a) => a.promotionId === promotionId) as AppliedPromotion;

  const removedGiftLines = ctx.lines
    .filter((l) => l.isGift && ownRefs(l, promotionId).length > 0 && effective(l) > 0)
    .map((l) => ({ id: l.id, variantId: l.variantId, quantity: effective(l) }));
  const removedIds = new Set(removedGiftLines.map((l) => l.id));

  // Its discounted units go back to their price. A line it shares with another promotion (same
  // unit discount, other units) is split: its units at 0, the others keep their discount.
  const lines: DiscountLineChange[] = [];
  const parts = new Map<number, DiscountSplit[]>();
  for (const l of ctx.lines) {
    if (l.isGift || removedIds.has(l.id)) continue;
    const own = ownRefs(l, promotionId);
    if (!own.length) continue;
    const others = l.refs.filter((r) => r.promotionId !== promotionId);
    const units = effective(l);
    const ownAmount = own.reduce((s, r) => s + r.amount, 0);
    const ownUnits =
      others.length && l.unitDiscount > 0
        ? Math.min(units, Math.max(0, Math.round(ownAmount / l.unitDiscount)))
        : units;
    if (ownUnits >= units || units <= 0) {
      lines.push({ id: l.id, unitDiscount: 0, refs: [] });
      parts.set(l.id, [{ quantity: units, unitDiscount: 0, refs: [] }]);
    } else if (ownUnits === 0) {
      lines.push({ id: l.id, unitDiscount: l.unitDiscount, refs: others });
    } else {
      const splits: DiscountSplit[] = [
        { quantity: ownUnits, unitDiscount: 0, refs: [] },
        { quantity: units - ownUnits, unitDiscount: l.unitDiscount, refs: others },
      ];
      lines.push({ id: l.id, unitDiscount: 0, refs: [], splits });
      parts.set(l.id, splits);
    }
  }

  const applied = ctx.applied.filter((a) => a.promotionId !== promotionId);
  const requestedOrderDiscount = Math.max(
    0,
    ctx.orderDiscount - benefitTotal(promotion, 'ORDER_DISCOUNT')
  );
  const shippingDiscount = Math.min(
    ctx.shippingGross,
    Math.max(0, ctx.shippingDiscount - benefitTotal(promotion, 'SHIPPING_DISCOUNT'))
  );

  const state = { shippingOriginal: ctx.shippingGross, creditAdjustment: ctx.creditAdjustment };
  const before = withMoney(
    computeTotals(ctx.lines, {
      ...state,
      orderDiscount: ctx.orderDiscount,
      shippingDiscount: ctx.shippingDiscount,
    }),
    ctx
  );
  const afterLines = ctx.lines
    .filter((l) => !removedIds.has(l.id))
    .flatMap((l): LineAmounts[] => {
      const p = parts.get(l.id);
      if (!p) return [l];
      const [first, ...rest] = p;
      return [
        { ...l, quantity: first.quantity + l.returnedQuantity, unitDiscount: first.unitDiscount },
        ...rest.map((x) => ({ ...l, quantity: x.quantity, returnedQuantity: 0, unitDiscount: x.unitDiscount })),
      ];
    });
  const after = withMoney(
    computeTotals(afterLines, { ...state, orderDiscount: requestedOrderDiscount, shippingDiscount }),
    ctx
  );

  return {
    promotion,
    lines,
    removedGiftLines,
    giftUnits: removedGiftLines.reduce((s, l) => s + l.quantity, 0),
    applied,
    // As the totals read it (clamped to the subtotal).
    orderDiscount: after.orderDiscount,
    shippingDiscount,
    discount: promotion.amount,
    before,
    after,
    difference: after.total - before.total,
  };
}
