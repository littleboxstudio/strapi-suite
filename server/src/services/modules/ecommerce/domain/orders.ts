/**
 * Pure order domain rules (no Strapi imports). Money is always integer cents.
 */

export const ORDER_STATUSES = ['OPEN', 'ARCHIVED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** Upper bound for any money amount an admin enters (10 million in major units, in cents). */
export const MAX_MONEY_CENTS = 1_000_000_000;

export const PAYMENT_RECORD_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export type Address = {
  firstName: string;
  lastName: string;
  company?: string;
  nif?: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: string;
  phone?: string;
};

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type LineAmounts = {
  unitPrice: number;
  unitDiscount: number;
  quantity: number;
  returnedQuantity: number;
};

export type OrderTotals = {
  itemsOriginal: number;
  productDiscount: number;
  subtotal: number;
  orderDiscount: number;
  shippingTotal: number;
  total: number;
};

export const computeTotals = (
  lines: LineAmounts[],
  order: { orderDiscount: number; shippingOriginal: number; shippingDiscount: number },
): OrderTotals => {
  let itemsOriginal = 0;
  let productDiscount = 0;
  for (const l of lines) {
    const effectiveQty = l.quantity - l.returnedQuantity;
    itemsOriginal += l.unitPrice * effectiveQty;
    productDiscount += l.unitDiscount * effectiveQty;
  }
  const subtotal = itemsOriginal - productDiscount;
  // The stored order discount keeps its euro value; it is only clamped to the
  // subtotal. Returns reduce the stored value via `orderDiscountShareForReturn`.
  const orderDiscount = Math.max(0, Math.min(order.orderDiscount, subtotal));
  const shippingTotal = order.shippingOriginal - order.shippingDiscount;
  const total = subtotal - orderDiscount + shippingTotal;
  return { itemsOriginal, productDiscount, subtotal, orderDiscount, shippingTotal, total };
};

/**
 * Share of the order discount that a return takes back (design 4.5):
 * round half-up of `orderDiscount × returnedNet / subtotalBeforeThisReturn`,
 * capped at `orderDiscount`; 0 when the subtotal is 0. `lines` reflect the
 * state before this return. The caller subtracts it from the stored discount.
 */
export const orderDiscountShareForReturn = (
  lines: (LineAmounts & { id: number })[],
  orderDiscount: number,
  returned: { orderLineId: number; quantity: number }[],
): number => {
  let subtotal = 0;
  const byId = new Map<number, LineAmounts & { id: number }>();
  for (const l of lines) {
    subtotal += (l.unitPrice - l.unitDiscount) * (l.quantity - l.returnedQuantity);
    byId.set(l.id, l);
  }
  let returnedNet = 0;
  for (const r of returned) {
    const l = byId.get(r.orderLineId);
    if (l) returnedNet += (l.unitPrice - l.unitDiscount) * r.quantity;
  }
  if (subtotal <= 0 || returnedNet <= 0 || orderDiscount <= 0) return 0;
  const share = Math.floor((2 * orderDiscount * returnedNet + subtotal) / (2 * subtotal));
  return Math.min(share, orderDiscount);
};

// ---------------------------------------------------------------------------
// Financial summary & payment status
// ---------------------------------------------------------------------------

export type PaymentLike = { status: PaymentRecordStatus; amount: number };
export type RefundLike = {
  status: 'COMPLETED' | string;
  amount: number;
  kind: 'MONEY' | 'STORE_CREDIT';
};

export type FinancialSummary = {
  /** The order's actual total. */
  orderTotal: number;
  /** Effective total used for due/excess (0 when the order is cancelled). */
  total: number;
  paid: number;
  pendingPayments: number;
  refunded: number;
  net: number;
  due: number;
  excess: number;
};

export const financialSummary = (
  total: number,
  payments: PaymentLike[],
  refunds: RefundLike[],
  opts: { orderCancelled?: boolean } = {},
): FinancialSummary => {
  let paid = 0;
  let pendingPayments = 0;
  for (const p of payments) {
    if (p.status === 'COMPLETED') paid += p.amount;
    else if (p.status === 'PENDING') pendingPayments += p.amount;
  }
  let refunded = 0;
  for (const r of refunds) {
    if (r.status === 'COMPLETED') refunded += r.amount;
  }
  const net = paid - refunded;
  const effectiveTotal = opts.orderCancelled ? 0 : total;
  return {
    orderTotal: total,
    total: effectiveTotal,
    paid,
    pendingPayments,
    refunded,
    net,
    due: Math.max(0, effectiveTotal - net),
    excess: Math.max(0, net - effectiveTotal),
  };
};

/** Rules 4/5 compare against the real `orderTotal` (not the effective total),
 * so a cancelled, partially paid order stays PARTIALLY_PAID. */
export const derivePaymentStatus = (
  summary: Pick<FinancialSummary, 'paid' | 'refunded' | 'net' | 'orderTotal'>,
): PaymentStatus => {
  const { paid, refunded, net, orderTotal: total } = summary;
  if (refunded > 0 && net <= 0) return 'REFUNDED';
  if (refunded > 0) return 'PARTIALLY_REFUNDED';
  // A zero-total order (e.g. fully discounted) has nothing to pay.
  if (total === 0) return 'PAID';
  if (paid === 0) return 'PENDING';
  if (net < total) return 'PARTIALLY_PAID';
  return 'PAID';
};

// ---------------------------------------------------------------------------
// Fulfillment
// ---------------------------------------------------------------------------

export type ShipmentLike = {
  status: 'ACTIVE' | 'CANCELLED';
  items: { orderLineId: number; quantity: number }[];
  delivered: boolean;
};

export const shippedQuantities = (shipments: ShipmentLike[]): Map<number, number> => {
  const shipped = new Map<number, number>();
  for (const s of shipments) {
    if (s.status === 'CANCELLED') continue;
    for (const item of s.items) {
      shipped.set(item.orderLineId, (shipped.get(item.orderLineId) ?? 0) + item.quantity);
    }
  }
  return shipped;
};

export const deriveFulfillmentStatus = (
  lines: { id: number; quantity: number }[],
  shipped: Map<number, number>,
): FulfillmentStatus => {
  const relevant = lines.filter((l) => l.quantity > 0);
  if (relevant.length === 0) return 'UNFULFILLED';
  let anyShipped = false;
  let allShipped = true;
  for (const l of relevant) {
    const q = shipped.get(l.id) ?? 0;
    if (q > 0) anyShipped = true;
    if (q < l.quantity) allShipped = false;
  }
  if (allShipped) return 'FULFILLED';
  return anyShipped ? 'PARTIALLY_FULFILLED' : 'UNFULFILLED';
};

// ---------------------------------------------------------------------------
// Transitions & actions
// ---------------------------------------------------------------------------

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  from === 'OPEN' && (to === 'CANCELLED' || to === 'ARCHIVED');

export type OrderActionKey =
  | 'SHIP'
  | 'MODIFY'
  | 'CANCEL'
  | 'REFUND'
  | 'ADD_PAYMENT'
  | 'SEND_PAYMENT_INSTRUCTIONS'
  | 'ARCHIVE'
  | 'REGISTER_RETURN'
  | 'INVOICE_TOTAL';

export type AvailableActionsInput = {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** For cancelled orders, pass the summary computed with `orderCancelled: true`. */
  summary: Pick<FinancialSummary, 'due' | 'excess' | 'paid' | 'orderTotal'>;
  hasUnshippedQuantity: boolean;
  hasShippedUnreturned: boolean;
  allShipmentsDelivered: boolean;
  hasPendingPayments: boolean;
  hasPendingRefunds: boolean;
  hasUninvoicedCompletedPayments: boolean;
};

/** Returns actions in a stable order: SHIP, MODIFY, CANCEL, REFUND, ADD_PAYMENT,
 * SEND_PAYMENT_INSTRUCTIONS, ARCHIVE, REGISTER_RETURN, INVOICE_TOTAL. */
export const availableActions = (input: AvailableActionsInput): OrderActionKey[] => {
  const open = input.orderStatus === 'OPEN';
  const { due, excess } = input.summary;
  const actions: OrderActionKey[] = [];
  // Shipping is gated on the settled balance, not on the PAID label (which a
  // partial refund or a zero-total order would never reach).
  const settled = due === 0 && (input.summary.paid > 0 || input.summary.orderTotal === 0);
  if (open && settled && input.hasUnshippedQuantity) actions.push('SHIP');
  if (open && input.fulfillmentStatus !== 'FULFILLED') actions.push('MODIFY');
  if (open) actions.push('CANCEL');
  if (excess > 0) actions.push('REFUND');
  if (open && due > 0) actions.push('ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS');
  if (
    open &&
    input.fulfillmentStatus === 'FULFILLED' &&
    input.allShipmentsDelivered &&
    due === 0 &&
    excess === 0 &&
    !input.hasPendingPayments &&
    !input.hasPendingRefunds
  ) {
    actions.push('ARCHIVE');
  }
  if (input.hasShippedUnreturned && input.orderStatus !== 'ARCHIVED') actions.push('REGISTER_RETURN');
  if (open && input.hasUninvoicedCompletedPayments) actions.push('INVOICE_TOTAL');
  return actions;
};

// ---------------------------------------------------------------------------
// Payment coverage (design 4.4)
// ---------------------------------------------------------------------------

export type CoverageLine = {
  orderLineId: number;
  /** Cents of this line this payment covers. */
  value: number;
  unitPrice: number;
  unitDiscount: number;
  tax: number;
};

export type PaymentCoverage = {
  /** Lines with a non-zero covered value, in line order. */
  lines: CoverageLine[];
  /** Always present; `value` is 0 when the payment covers no shipping. */
  shipping: { value: number; tax: number };
  /** The amount the payment actually paid. */
  amount: number;
  /** min(amount, outstanding value): the uncovered excess stays uncovered. */
  coveredValue: number;
};

export type CoverageOrderState = {
  /** In display (position) order; the order breaks allocation ties. */
  lines: (LineAmounts & { id: number; tax: number })[];
  orderDiscount: number;
  shippingTotal: number;
  shippingTax: number;
};

const finiteOr0 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Splits the integer `total` across non-negative integer `weights` proportionally, with the
 * largest-remainder method; ties go to the lower index. Σ result === total when Σ weights > 0.
 */
export const allocateProportionally = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const parts = weights.map((w, index) => ({
    index,
    base: Math.floor((total * w) / sum),
    rest: (total * w) % sum,
  }));
  let left = total - parts.reduce((s, p) => s + p.base, 0);
  const byRest = [...parts].sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const p of byRest) {
    if (left <= 0) break;
    p.base += 1;
    left -= 1;
  }
  return parts.map((p) => p.base);
};

/**
 * What a new payment covers, by value (design 4.4). Each line is worth its net amount minus
 * its share of the (clamped) order discount, so Σ lines + shipping === order total. The payment
 * covers min(amount, outstanding) spread over the outstanding items in proportion; shipping is
 * one item, last in the tie-break. Malformed previous coverages are ignored.
 */
export const computeCoverage = (
  order: CoverageOrderState,
  previousPayments: { coverage?: unknown }[],
  amount: number
): PaymentCoverage => {
  const nets = order.lines.map((l) =>
    Math.max(0, (l.quantity - l.returnedQuantity) * (l.unitPrice - l.unitDiscount))
  );
  const subtotal = nets.reduce((s, n) => s + n, 0);
  const discount = Math.max(0, Math.min(finiteOr0(order.orderDiscount), subtotal));
  const shares = allocateProportionally(discount, nets);
  const lineDue = nets.map((n, i) => n - shares[i]);
  const shippingDue = Math.max(0, finiteOr0(order.shippingTotal));

  const coveredLine = new Map<number, number>();
  let coveredShipping = 0;
  for (const p of previousPayments) {
    const c = p?.coverage as Partial<PaymentCoverage> | null | undefined;
    if (!c || typeof c !== 'object') continue;
    if (Array.isArray(c.lines)) {
      for (const l of c.lines) {
        const id = Number(l?.orderLineId);
        if (!Number.isFinite(id)) continue;
        coveredLine.set(id, (coveredLine.get(id) ?? 0) + finiteOr0(l?.value));
      }
    }
    if (c.shipping && typeof c.shipping === 'object') coveredShipping += finiteOr0(c.shipping.value);
  }

  const outstanding = [
    ...order.lines.map((l, i) => Math.max(0, lineDue[i] - (coveredLine.get(l.id) ?? 0))),
    Math.max(0, shippingDue - coveredShipping),
  ];
  const totalOutstanding = outstanding.reduce((s, o) => s + o, 0);
  const coveredValue = Math.max(0, Math.min(Math.floor(finiteOr0(amount)), totalOutstanding));
  const alloc = allocateProportionally(coveredValue, outstanding);

  const lines: CoverageLine[] = [];
  order.lines.forEach((l, i) => {
    if (alloc[i] > 0) {
      lines.push({
        orderLineId: l.id,
        value: alloc[i],
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        tax: l.tax,
      });
    }
  });
  return {
    lines,
    shipping: { value: alloc[order.lines.length], tax: order.shippingTax },
    amount,
    coveredValue,
  };
};
