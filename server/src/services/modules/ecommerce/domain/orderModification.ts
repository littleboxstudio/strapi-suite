/**
 * Pure order modification simulation (no Strapi imports). Money is integer cents.
 * Design 4.8 and requirements 16.
 */
import {
  computeTotals,
  financialSummary,
  type Address,
  type LineAmounts,
  type OrderTotals,
  type PaymentLike,
  type RefundLike,
} from './orders';

export type ExistingLine = LineAmounts & {
  id: number;
  variantId: number;
  sku: string;
  name: string;
  option: string;
  tax: number;
  shipped: number;
  isGift: boolean;
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
  lines: { orderLineId?: number; variantId: number; quantity: number }[];
  shipping: ShippingModification;
  addresses?: { shipping?: Address; billing?: Address };
};

export type CatalogVariant = {
  variantId: number;
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
  | 'INVALID_AMOUNT';

export type ModificationTotals = OrderTotals & { paid: number; due: number; excess: number };

export type LineChange = {
  kind: 'ADDED' | 'REMOVED' | 'QUANTITY_CHANGED' | 'UNCHANGED';
  orderLineId?: number;
  variantId: number;
  previousQuantity: number;
  newQuantity: number;
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
  discountWarnings: { code: 'ORDER_DISCOUNT_CAPPED' }[];
  outcome: 'DUE' | 'REFUNDABLE' | 'NONE';
  difference: number;
};

export type ModificationCurrent = {
  lines: ExistingLine[];
  orderDiscount: number;
  shippingOriginal: number;
  shippingDiscount: number;
  payments: PaymentLike[];
  refunds: RefundLike[];
};

const isNonNegativeInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

const withMoney = (
  totals: OrderTotals,
  payments: PaymentLike[],
  refunds: RefundLike[],
): ModificationTotals => {
  const s = financialSummary(totals.total, payments, refunds);
  return { ...totals, paid: s.paid, due: s.due, excess: s.excess };
};

type AddedLine = { inputIndex: number; variant: CatalogVariant; quantity: number };

export const simulateModification = (
  current: ModificationCurrent,
  input: ModificationInput,
  catalog: Map<number, CatalogVariant>,
): ModificationResult => {
  const errors: ModificationResult['errors'] = [];
  const lineError = (index: number, code: ModificationErrorCode) =>
    errors.push({ path: `lines.${index}.quantity`, code });

  // --- Resolve input lines -------------------------------------------------
  const byId = new Map(current.lines.map((l) => [l.id, l]));
  /** Existing line id → requested quantity (only valid requests). */
  const requested = new Map<number, number>();
  /** Existing line id → input index that targeted it. */
  const claimedBy = new Map<number, number>();
  const added: AddedLine[] = [];
  const addedVariants = new Set<number>();

  input.lines.forEach((entry, index) => {
    let target: ExistingLine | undefined;
    if (entry.orderLineId !== undefined && entry.orderLineId !== null) {
      target = byId.get(entry.orderLineId);
      if (!target) {
        lineError(index, 'INVALID_QUANTITY');
        return;
      }
    } else {
      target = current.lines.find((l) => !l.isGift && l.variantId === entry.variantId);
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
    const variant = catalog.get(entry.variantId);
    if (!variant || !variant.active) {
      lineError(index, 'VARIANT_UNAVAILABLE');
      return;
    }
    added.push({ inputIndex: index, variant, quantity: entry.quantity });
  });

  // Existing lines omitted from the input are removed (gift lines are kept).
  const newQuantity = new Map<number, number>();
  for (const line of current.lines) {
    if (requested.has(line.id)) {
      newQuantity.set(line.id, requested.get(line.id)!);
    } else if (claimedBy.has(line.id) || line.isGift) {
      // Claimed by an invalid entry, or a gift line: unchanged.
      newQuantity.set(line.id, line.quantity);
    } else if (line.shipped > 0) {
      errors.push({ path: `removed.${line.id}`, code: 'QUANTITY_BELOW_SHIPPED' });
      newQuantity.set(line.id, line.quantity);
    } else {
      newQuantity.set(line.id, 0);
    }
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
    const kind: LineChange['kind'] =
      q === line.quantity ? 'UNCHANGED' : q === 0 ? 'REMOVED' : 'QUANTITY_CHANGED';
    return { kind, orderLineId: line.id, variantId: line.variantId, previousQuantity: line.quantity, newQuantity: q };
  });
  for (const a of added) {
    lineChanges.push({ kind: 'ADDED', variantId: a.variant.variantId, previousQuantity: 0, newQuantity: a.quantity });
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
    const quoteOk = isNonNegativeInt(quote);
    const costOk = isNonNegativeInt(previousShipmentsCost);
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
    if (isNonNegativeInt(amount)) {
      Object.assign(shipping, { newCharged: amount, shippingOriginal: amount, shippingDiscount: 0 });
    } else {
      errors.push({ path: 'shipping.amount', code: 'INVALID_AMOUNT' });
    }
  }

  // --- Totals --------------------------------------------------------------
  const beforeTotals = computeTotals(current.lines, current);
  const afterLines: LineAmounts[] = [
    ...current.lines.map((l) => ({
      unitPrice: l.unitPrice,
      unitDiscount: l.unitDiscount,
      quantity: newQuantity.get(l.id)!,
      returnedQuantity: l.returnedQuantity,
    })),
    ...added.map((a) => ({ unitPrice: a.variant.unitPrice, unitDiscount: 0, quantity: a.quantity, returnedQuantity: 0 })),
  ];
  const afterTotals = computeTotals(afterLines, {
    orderDiscount: current.orderDiscount,
    shippingOriginal: shipping.shippingOriginal,
    shippingDiscount: shipping.shippingDiscount,
  });

  const before = withMoney(beforeTotals, current.payments, current.refunds);
  const after = withMoney(afterTotals, current.payments, current.refunds);

  const discountWarnings: ModificationResult['discountWarnings'] =
    afterTotals.orderDiscount < current.orderDiscount ? [{ code: 'ORDER_DISCOUNT_CAPPED' }] : [];

  const outcome: ModificationResult['outcome'] =
    after.due > before.due
      ? 'DUE'
      : after.excess > 0 && after.excess > before.excess
        ? 'REFUNDABLE'
        : 'NONE';

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
