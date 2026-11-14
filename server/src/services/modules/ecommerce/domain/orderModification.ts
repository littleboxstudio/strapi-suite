/**
 * Pure order modification simulation (no Strapi imports). Money is integer cents.
 * Design 4.8 and requirements 16.
 */
import {
  MAX_MONEY_CENTS,
  computeTotals,
  financialSummary,
  type Address,
  type LineAmounts,
  type OrderTotals,
  type PaymentLike,
  type RefundLike,
} from './orders';
import {
  unmetAppliedPromotions,
  type AppliedPromotion,
  type EvaluationLine,
} from './promotions';
import { manualUnitDiscount, readDiscountPercent } from './lineDiscounts';

export type ExistingLine = LineAmounts & {
  id: number;
  variantId: number;
  productId: number;
  sku: string;
  name: string;
  option: string;
  tax: number;
  shipped: number;
  isGift: boolean;
  /** The manual discount percent (spec 4.1); absent/null = none. */
  manualDiscountPercent?: number | null;
  /** Promotions that discounted this line (absent = none). */
  promotionIds?: number[];
};

export type ShippingModification =
  | { mode: 'KEEP' }
  | {
      mode: 'RECALCULATE';
      /** New quote for the pending (not yet shipped) items only. */
      quote: number;
      previousShipmentsCost: number;
    }
  | { mode: 'MANUAL'; amount: number };

export type ModificationInput = {
  /**
   * `discountPercent` (spec 4.1): the line's manual discount; absent, null or '' = none (a line
   * that had one loses it). Only the admin editing flows pass it.
   */
  lines: { orderLineId?: number; variantId: number; quantity: number; discountPercent?: unknown }[];
  shipping: ShippingModification;
  addresses?: { shipping?: Address; billing?: Address };
  /**
   * Manual order discount (integer cents in [0, MAX_MONEY_CENTS]): replaces the stored one
   * before the cap at the new subtotal. Absent = keep the stored discount.
   */
  orderDiscount?: number;
};

export type CatalogVariant = {
  variantId: number;
  productId: number;
  sku: string;
  name: string;
  option: string;
  unitPrice: number;
  tax: number;
  imageUrl: string | null;
  stock: number;
  active: boolean;
};

export type ModificationErrorCode =
  | 'QUANTITY_BELOW_SHIPPED'
  | 'INSUFFICIENT_STOCK'
  | 'VARIANT_UNAVAILABLE'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'LINES_REQUIRED'
  | 'INVALID_PERCENT'
  | 'DISCOUNT_LINE_SHIPPED';

export type ModificationTotals = OrderTotals & { paid: number; due: number; excess: number };

/** A change that raises the debt is DUE; one that creates new excess is REFUNDABLE. */
export const modificationOutcome = (
  before: { due: number; excess: number },
  after: { due: number; excess: number }
): 'DUE' | 'REFUNDABLE' | 'NONE' =>
  after.due > before.due
    ? 'DUE'
    : after.excess > 0 && after.excess > before.excess
      ? 'REFUNDABLE'
      : 'NONE';

/** A line's manual discount set, changed or removed (spec 4.1). */
export type LineDiscountChange = {
  previousPercent: number | null;
  percent: number | null;
  /** The line's new unit discount: the manual one, or 0 when the percent is removed. */
  unitDiscount: number;
  /** The line had a promotion discount: its refs go and the discounts need a review. */
  replacedPromotion: boolean;
};

export type LineChange = {
  /** DISCOUNT_CHANGED: same quantity, only the manual discount changed. */
  kind: 'ADDED' | 'REMOVED' | 'QUANTITY_CHANGED' | 'DISCOUNT_CHANGED' | 'UNCHANGED';
  orderLineId?: number;
  variantId: number;
  previousQuantity: number;
  newQuantity: number;
  /**
   * ADDED only: the extra units asked for on this discounted line. They enter as a new line
   * at the source line's full price, snapshot and tax (design 4.8: no promotion for them).
   */
  sourceOrderLineId?: number;
  /** Present only when the manual discount changes (or an added line carries one). */
  discount?: LineDiscountChange;
};

export type ModificationResult = {
  errors: { path: string; code: ModificationErrorCode }[];
  before: ModificationTotals;
  after: ModificationTotals;
  lineChanges: LineChange[];
  /** Signed: negative = deduct from stock, positive = restock. */
  stockMovements: { variantId: number; quantity: number }[];
  shipping: {
    mode: ShippingModification['mode'];
    previousCharged: number;
    newCharged: number;
    previousShipmentsCost?: number;
    quote?: number;
    /** Values to persist on the order. */
    shippingOriginal: number;
    shippingDiscount: number;
  };
  discountWarnings: DiscountWarning[];
  outcome: 'DUE' | 'REFUNDABLE' | 'NONE';
  difference: number;
};

export type DiscountWarning =
  | { code: 'ORDER_DISCOUNT_CAPPED' }
  | { code: 'PROMOTION_CONDITION_UNMET'; promotionId: number; name: string }
  | { code: 'SHIPPING_PROMOTION_DROPPED'; promotionId: number; name: string };

export type ModificationCurrent = {
  lines: ExistingLine[];
  orderDiscount: number;
  shippingOriginal: number;
  shippingDiscount: number;
  payments: PaymentLike[];
  refunds: RefundLike[];
  /** The promotions the order stored (absent = none). Never re-evaluated or re-priced. */
  promotions?: AppliedPromotion[];
  /** The customer e-mail, for e-mail conditions (absent = null). */
  email?: string | null;
};

export type ModificationOptions = {
  /**
   * Which stored promotions no longer hold for the modified order. Defaults to the pure,
   * fail-closed check; the order service passes the promotion service's (which logs errors).
   */
  unmet?: (
    applied: AppliedPromotion[],
    ctx: { lines: EvaluationLine[]; email: string | null }
  ) => { promotionId: number; name: string }[];
};

const isNonNegativeInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Integer cents in [0, MAX_MONEY_CENTS]. */
const isMoneyAmount = (n: unknown): n is number => isNonNegativeInt(n) && n <= MAX_MONEY_CENTS;

const withMoney = (
  totals: OrderTotals,
  payments: PaymentLike[],
  refunds: RefundLike[],
): ModificationTotals => {
  const s = financialSummary(totals.total, payments, refunds);
  return { ...totals, paid: s.paid, due: s.due, excess: s.excess };
};

type AddedLine = {
  inputIndex: number;
  variant: CatalogVariant;
  quantity: number;
  /** Extra units of a discounted existing line (see `LineChange.sourceOrderLineId`). */
  sourceOrderLineId?: number;
  discount?: LineDiscountChange;
};

export const simulateModification = (
  current: ModificationCurrent,
  input: ModificationInput,
  catalog: Map<number, CatalogVariant>,
  options: ModificationOptions = {},
): ModificationResult => {
  const errors: ModificationResult['errors'] = [];
  const lineError = (index: number, code: ModificationErrorCode) =>
    errors.push({ path: `lines.${index}.quantity`, code });
  const percentError = (index: number, code: ModificationErrorCode) =>
    errors.push({ path: `lines.${index}.discountPercent`, code });

  // --- Resolve input lines -------------------------------------------------
  const byId = new Map(current.lines.map((l) => [l.id, l]));
  /** Existing line id → requested quantity (only valid requests). */
  const requested = new Map<number, number>();
  /** Existing line id → input index that targeted it. */
  const claimedBy = new Map<number, number>();
  const added: AddedLine[] = [];
  const addedVariants = new Set<number>();
  /** Lines of an ambiguous entry (see below): kept unchanged, not claimed. */
  const keptUnchanged = new Set<number>();
  /** Existing line id → its manual discount change (spec 4.1). */
  const discounts = new Map<number, LineDiscountChange>();

  input.lines.forEach((entry, index) => {
    let target: ExistingLine | undefined;
    if (entry.orderLineId !== undefined && entry.orderLineId !== null) {
      target = byId.get(entry.orderLineId);
      if (!target) {
        lineError(index, 'INVALID_QUANTITY');
        return;
      }
    } else {
      const matches = current.lines.filter((l) => !l.isGift && l.variantId === entry.variantId);
      // A variant split over several lines (promotions) needs the line id: resolving to the
      // first line would silently remove the others.
      if (matches.length > 1) {
        errors.push({ path: `lines.${index}.orderLineId`, code: 'INVALID_QUANTITY' });
        matches.forEach((l) => keptUnchanged.add(l.id));
        return;
      }
      target = matches[0];
    }

    if (target && claimedBy.has(target.id)) {
      lineError(index, 'INVALID_QUANTITY'); // the same line twice
      return;
    }
    if (target) claimedBy.set(target.id, index);

    if (!isNonNegativeInt(entry.quantity)) {
      lineError(index, 'INVALID_QUANTITY');
      return;
    }

    if (target) {
      if (target.isGift && entry.quantity !== target.quantity) {
        lineError(index, 'INVALID_QUANTITY');
        return;
      }
      if (entry.quantity < target.shipped) {
        lineError(index, 'QUANTITY_BELOW_SHIPPED');
        return;
      }
      // Spec 4.1: the manual discount is set, changed or removed only on a line with nothing
      // shipped (a removed line ignores it). It replaces a promotion discount.
      const previousPercent = target.manualDiscountPercent ?? null;
      let discount: LineDiscountChange | undefined;
      if (entry.quantity > 0) {
        const parsed = readDiscountPercent(entry.discountPercent);
        if (!parsed.ok) {
          percentError(index, 'INVALID_PERCENT');
          return;
        }
        if (parsed.value !== previousPercent) {
          if (target.isGift) {
            percentError(index, 'INVALID_PERCENT');
            return;
          }
          if (target.shipped > 0) {
            percentError(index, 'DISCOUNT_LINE_SHIPPED');
            return;
          }
          discount = {
            previousPercent,
            percent: parsed.value,
            unitDiscount:
              parsed.value === null ? 0 : manualUnitDiscount(target.unitPrice, parsed.value),
            replacedPromotion: (target.promotionIds?.length ?? 0) > 0,
          };
          discounts.set(target.id, discount);
        }
      }
      const percentAfter = discount ? discount.percent : previousPercent;
      const unitDiscountAfter = discount ? discount.unitDiscount : target.unitDiscount;
      // Design 4.8: units added by a modification enter without promotion. A discounted line
      // (promotion prize, split line) keeps its discount for the units it has; the extra units
      // become a separate line at that line's full price. A line with a manual percent keeps it
      // on every unit (spec 4.1: no split).
      if (unitDiscountAfter > 0 && percentAfter === null && entry.quantity > target.quantity) {
        requested.set(target.id, target.quantity);
        added.push({
          inputIndex: index,
          variant: {
            variantId: target.variantId,
            productId: target.productId,
            sku: target.sku,
            name: target.name,
            option: target.option,
            unitPrice: target.unitPrice,
            tax: target.tax,
            imageUrl: null,
            stock: catalog.get(target.variantId)?.stock ?? 0,
            active: true,
          },
          quantity: entry.quantity - target.quantity,
          sourceOrderLineId: target.id,
        });
        return;
      }
      requested.set(target.id, entry.quantity);
      return;
    }

    // New line.
    if (addedVariants.has(entry.variantId)) {
      lineError(index, 'INVALID_QUANTITY'); // the same new variant twice
      return;
    }
    addedVariants.add(entry.variantId);
    if (entry.quantity === 0) return;
    const parsed = readDiscountPercent(entry.discountPercent);
    if (!parsed.ok) {
      percentError(index, 'INVALID_PERCENT');
      return;
    }
    const variant = catalog.get(entry.variantId);
    if (!variant || !variant.active) {
      lineError(index, 'VARIANT_UNAVAILABLE');
      return;
    }
    added.push({
      inputIndex: index,
      variant,
      quantity: entry.quantity,
      ...(parsed.value !== null
        ? {
            discount: {
              previousPercent: null,
              percent: parsed.value,
              unitDiscount: manualUnitDiscount(variant.unitPrice, parsed.value),
              replacedPromotion: false,
            },
          }
        : {}),
    });
  });

  // Existing lines omitted from the input are removed (gift lines are kept).
  const newQuantity = new Map<number, number>();
  for (const line of current.lines) {
    if (requested.has(line.id)) {
      newQuantity.set(line.id, requested.get(line.id)!);
    } else if (claimedBy.has(line.id) || line.isGift || keptUnchanged.has(line.id)) {
      // Claimed by an invalid entry, a gift line, or targeted ambiguously: unchanged.
      newQuantity.set(line.id, line.quantity);
    } else if (line.shipped > 0) {
      errors.push({ path: `removed.${line.id}`, code: 'QUANTITY_BELOW_SHIPPED' });
      newQuantity.set(line.id, line.quantity);
    } else {
      newQuantity.set(line.id, 0);
    }
  }

  // An order keeps at least one line: emptying it is a cancellation, not a modification.
  // Line errors (e.g. an unavailable new variant) already say why nothing is left.
  if (!errors.length && !added.length && [...newQuantity.values()].every((q) => q === 0)) {
    errors.push({ path: 'lines', code: 'LINES_REQUIRED' });
  }

  // --- Stock ---------------------------------------------------------------
  const netByVariant = new Map<number, number>(); // positive = extra units ordered
  const bump = (variantId: number, delta: number) =>
    netByVariant.set(variantId, (netByVariant.get(variantId) ?? 0) + delta);
  for (const line of current.lines) bump(line.variantId, newQuantity.get(line.id)! - line.quantity);
  for (const a of added) bump(a.variant.variantId, a.quantity);

  const increasingIndexes = new Map<number, number[]>(); // variantId → input indexes increasing it
  for (const line of current.lines) {
    const index = requested.has(line.id) ? claimedBy.get(line.id) : undefined;
    if (index !== undefined && newQuantity.get(line.id)! > line.quantity) {
      increasingIndexes.set(line.variantId, [...(increasingIndexes.get(line.variantId) ?? []), index]);
    }
  }
  for (const a of added) {
    const id = a.variant.variantId;
    increasingIndexes.set(id, [...(increasingIndexes.get(id) ?? []), a.inputIndex]);
  }
  const stockErrorIndexes: number[] = [];
  for (const [variantId, indexes] of increasingIndexes) {
    const increase = netByVariant.get(variantId) ?? 0;
    const stock = catalog.get(variantId)?.stock ?? 0;
    if (increase > 0 && stock < increase) stockErrorIndexes.push(...indexes);
  }
  stockErrorIndexes.sort((a, b) => a - b).forEach((i) => lineError(i, 'INSUFFICIENT_STOCK'));

  const stockMovements: ModificationResult['stockMovements'] = [];
  for (const [variantId, net] of netByVariant) {
    if (net !== 0) stockMovements.push({ variantId, quantity: -net });
  }

  // --- Line changes --------------------------------------------------------
  const lineChanges: LineChange[] = current.lines.map((line) => {
    const q = newQuantity.get(line.id)!;
    const discount = q > 0 ? discounts.get(line.id) : undefined;
    const kind: LineChange['kind'] =
      q === line.quantity
        ? discount
          ? 'DISCOUNT_CHANGED'
          : 'UNCHANGED'
        : q === 0
          ? 'REMOVED'
          : 'QUANTITY_CHANGED';
    return {
      kind,
      orderLineId: line.id,
      variantId: line.variantId,
      previousQuantity: line.quantity,
      newQuantity: q,
      ...(discount ? { discount } : {}),
    };
  });
  for (const a of added) {
    lineChanges.push({
      kind: 'ADDED',
      variantId: a.variant.variantId,
      previousQuantity: 0,
      newQuantity: a.quantity,
      ...(a.sourceOrderLineId !== undefined ? { sourceOrderLineId: a.sourceOrderLineId } : {}),
      ...(a.discount ? { discount: a.discount } : {}),
    });
  }

  // --- Shipping ------------------------------------------------------------
  const previousCharged = current.shippingOriginal - current.shippingDiscount;
  const shipping: ModificationResult['shipping'] = {
    mode: input.shipping.mode,
    previousCharged,
    newCharged: previousCharged,
    shippingOriginal: current.shippingOriginal,
    shippingDiscount: current.shippingDiscount,
  };
  if (input.shipping.mode === 'RECALCULATE') {
    const { quote, previousShipmentsCost } = input.shipping;
    const quoteOk = isMoneyAmount(quote);
    const costOk = isMoneyAmount(previousShipmentsCost);
    if (!quoteOk) errors.push({ path: 'shipping.quote', code: 'INVALID_AMOUNT' });
    if (!costOk) errors.push({ path: 'shipping.previousShipmentsCost', code: 'INVALID_AMOUNT' });
    shipping.previousShipmentsCost = previousShipmentsCost;
    shipping.quote = quote;
    if (quoteOk && costOk) {
      const newCharged = previousShipmentsCost + quote;
      Object.assign(shipping, { newCharged, shippingOriginal: newCharged, shippingDiscount: 0 });
    }
  } else if (input.shipping.mode === 'MANUAL') {
    const { amount } = input.shipping;
    if (isMoneyAmount(amount)) {
      Object.assign(shipping, { newCharged: amount, shippingOriginal: amount, shippingDiscount: 0 });
    } else {
      errors.push({ path: 'shipping.amount', code: 'INVALID_AMOUNT' });
    }
  }

  // --- Order discount ------------------------------------------------------
  const manualDiscount = input.orderDiscount !== undefined;
  if (manualDiscount && !isMoneyAmount(input.orderDiscount)) {
    errors.push({ path: 'orderDiscount', code: 'INVALID_AMOUNT' });
  }
  /** The discount asked for, before the cap at the new subtotal. */
  const requestedDiscount =
    manualDiscount && isMoneyAmount(input.orderDiscount) ? input.orderDiscount : current.orderDiscount;

  // --- Totals --------------------------------------------------------------
  const beforeTotals = computeTotals(current.lines, current);
  const afterLines: LineAmounts[] = [
    ...current.lines.map((l) => ({
      unitPrice: l.unitPrice,
      unitDiscount: discounts.get(l.id)?.unitDiscount ?? l.unitDiscount,
      quantity: newQuantity.get(l.id)!,
      returnedQuantity: l.returnedQuantity,
    })),
    ...added.map((a) => ({
      unitPrice: a.variant.unitPrice,
      unitDiscount: a.discount?.unitDiscount ?? 0,
      quantity: a.quantity,
      returnedQuantity: 0,
    })),
  ];
  const afterTotals = computeTotals(afterLines, {
    orderDiscount: requestedDiscount,
    shippingOriginal: shipping.shippingOriginal,
    shippingDiscount: shipping.shippingDiscount,
  });

  const before = withMoney(beforeTotals, current.payments, current.refunds);
  const after = withMoney(afterTotals, current.payments, current.refunds);

  // --- Warnings (nothing is re-priced: design 4.8) ---------------------------
  const discountWarnings: DiscountWarning[] =
    afterTotals.orderDiscount < requestedDiscount ? [{ code: 'ORDER_DISCOUNT_CAPPED' }] : [];

  const promotions = current.promotions ?? [];
  if (promotions.length) {
    // Customer lines after the modification at original price (no gifts), net of returns. A
    // line with a manual percent counts at its net price, frozen (spec 4.1).
    const conditionLines: EvaluationLine[] = [
      ...current.lines
        .filter((l) => !l.isGift)
        .map((l) => {
          const d = discounts.get(l.id);
          const percent = d ? d.percent : (l.manualDiscountPercent ?? null);
          const unitDiscount = d ? d.unitDiscount : l.unitDiscount;
          return {
            variantId: l.variantId,
            productId: l.productId,
            unitPrice: percent === null ? l.unitPrice : l.unitPrice - unitDiscount,
            quantity: newQuantity.get(l.id)! - l.returnedQuantity,
            ...(percent === null ? {} : { frozen: true }),
          };
        }),
      ...added.map((a) => ({
        variantId: a.variant.variantId,
        productId: a.variant.productId,
        unitPrice: a.variant.unitPrice - (a.discount?.unitDiscount ?? 0),
        quantity: a.quantity,
        ...(a.discount ? { frozen: true } : {}),
      })),
    ].filter((l) => l.quantity > 0);
    const unmet = options.unmet ?? ((a, c) => unmetAppliedPromotions(a, c));
    for (const p of unmet(promotions, { lines: conditionLines, email: current.email ?? null })) {
      discountWarnings.push({ code: 'PROMOTION_CONDITION_UNMET', promotionId: p.promotionId, name: p.name });
    }

    // Recalculated or manual shipping clears the shipping discount: the shipping promotions
    // stop applying (the stored promotions keep them as history, spec 3.8).
    if (input.shipping.mode !== 'KEEP' && current.shippingDiscount > 0 && shipping.shippingDiscount === 0) {
      for (const p of promotions) {
        if (Array.isArray(p.classes) && p.classes.includes('SHIPPING_DISCOUNT')) {
          discountWarnings.push({
            code: 'SHIPPING_PROMOTION_DROPPED',
            promotionId: p.promotionId,
            name: p.name,
          });
        }
      }
    }
  }

  const outcome = modificationOutcome(before, after);

  return {
    errors,
    before,
    after,
    lineChanges,
    stockMovements,
    shipping,
    discountWarnings,
    outcome,
    difference: after.total - before.total,
  };
};
