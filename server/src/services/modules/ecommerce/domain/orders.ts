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

export const PAYMENT_RECORD_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

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
  const orderDiscount = Math.max(0, Math.min(order.orderDiscount, subtotal));
  const shippingTotal = order.shippingOriginal - order.shippingDiscount;
  const total = subtotal - orderDiscount + shippingTotal;
  return { itemsOriginal, productDiscount, subtotal, orderDiscount, shippingTotal, total };
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

export const derivePaymentStatus = (
  summary: Pick<FinancialSummary, 'paid' | 'refunded' | 'net' | 'total'>,
): PaymentStatus => {
  const { paid, refunded, net, total } = summary;
  if (refunded > 0 && net <= 0) return 'REFUNDED';
  if (refunded > 0) return 'PARTIALLY_REFUNDED';
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
  if (lines.length === 0) return 'UNFULFILLED';
  let anyShipped = false;
  let allShipped = true;
  for (const l of lines) {
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
  summary: Pick<FinancialSummary, 'due' | 'excess'>;
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
  if (open && input.paymentStatus === 'PAID' && input.hasUnshippedQuantity) actions.push('SHIP');
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
