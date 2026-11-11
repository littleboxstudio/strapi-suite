/**
 * Admin-side shapes of the customers and orders API (server routes admin-customers / admin-orders).
 * Money is always integer cents.
 */
import type {
  PromotionBenefit,
  PromotionConditionGroup,
  PromotionEligibility,
  PromotionMethod,
  PromotionStacking,
} from './promotionTypes';

export type OrderStatus = 'OPEN' | 'ARCHIVED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type FulfillmentStatus = 'UNFULFILLED' | 'PARTIALLY_FULFILLED' | 'FULFILLED';

export type Pagination = { page: number; pageSize: number; total: number; pageCount: number };
export type Paginated<T> = { results: T[]; pagination: Pagination };

export type FieldError = { path: string; code: string };

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
// Customers
// ---------------------------------------------------------------------------

export type CustomerListParams = { page?: number; search?: string };

export type CustomerListItem = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  ordersCount: number;
};

export type Customer = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

export type CustomerOrderListParams = { page?: number; search?: string };

export type CustomerOrderListItem = {
  id: number;
  reference: number;
  createdAt: string;
  total: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
};

export type CustomerLastAddresses = {
  shippingAddress: Address | null;
  billingAddress: Address | null;
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderListParams = {
  page?: number;
  search?: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

export type OrderListItem = {
  id: number;
  reference: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: number;
  createdAt: string;
  customerName: string;
};

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

export type OrderLine = {
  id: number;
  variantId: number;
  productId: number;
  sku: string;
  name: string;
  option: string | null;
  imageUrl: string | null;
  unitPrice: number;
  unitDiscount: number;
  quantity: number;
  returnedQuantity: number;
  tax: number;
  isGift: boolean;
  /** Promotions that discounted this line (ids of `Order.promotions`). */
  promotionIds: number[];
  /** Units in ACTIVE shipments. */
  shipped: number;
  /** Units in ACTIVE and PENDING shipments: they cannot be shipped again. */
  reserved: number;
  /** quantity − reserved */
  pending: number;
  /** shipped − returnedQuantity */
  returnable: number;
};

export type OrderPayment = {
  id: number;
  method: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  amount: number;
  currency: string;
  /** Masked (`••••ABCD`) for a store credit payment. */
  reference: string | null;
  storeCreditId?: number | null;
  externalId: string | null;
  coverage: unknown;
  methodLabel: string | null;
  completedAt: string | null;
  actor: string | null;
  createdAt: string;
  /** Its active invoice, and what is still left to invoice (0 when the order is not OPEN). */
  invoice?: PaymentInvoiceInfo;
};

export type InvoiceStatus = 'PENDING' | 'ISSUED' | 'FAILED' | 'UNCERTAIN';
export type InvoiceKind = 'INVOICE' | 'CREDIT_NOTE';

export type PaymentInvoiceInfo = {
  invoiceable: number;
  invoiceId: number | null;
  status: InvoiceStatus | null;
};

export type InvoiceLine = {
  orderLineId: number | null;
  kind: 'ITEM' | 'SHIPPING';
  sku: string;
  name: string;
  quantity: number;
  /** Cents, VAT included. */
  total: number;
  /** VAT rate (%). */
  tax: number;
  /** Only part of the line's value is covered by this document. */
  partial: boolean;
};

export type InvoiceView = {
  id: number;
  kind: InvoiceKind;
  documentType: string | null;
  status: InvoiceStatus;
  provider: string;
  number: string | null;
  series: string | null;
  total: number;
  lines: InvoiceLine[];
  creditedInvoiceId: number | null;
  /** Total of the ISSUED credit notes on this invoice. */
  credited: number;
  paymentIds: number[];
  error: string | null;
  /** TOTAL_MISMATCH, RECEIPT_FAILED, ISSUED_AFTER_FAILED, DUPLICATE_INVOICE, … */
  warnings: string[];
  issuedAt: string | null;
  createdAt: string | null;
  /** The server allows Reconcile / Mark as failed (UNCERTAIN, or PENDING past the provider's limit). */
  reconcilable: boolean;
};

export type OrderBilling = { active: boolean; providerId: string | null };

export type InvoiceScopeInput = { scope: 'PAYMENT'; paymentId: number } | { scope: 'TOTAL' };

export type InvoicePreview = { lines: InvoiceLine[]; total: number; paymentIds: number[] };

export type IssueInvoiceInput = InvoiceScopeInput & { idempotencyKey: string };

export type CreditNotePreview = {
  lines: InvoiceLine[];
  /** Per line index: what can still be credited. */
  creditable: number[];
  /** Per line index: the server's suggestion (returns, then over-invoiced value). */
  suggested: number[];
};

export type CreditNoteInput = {
  lines: { index: number; value: number }[];
  reason: string;
  idempotencyKey: string;
};

export type OrderHistoryItem = {
  id: number;
  type: string;
  description: string;
  previousValue: unknown;
  newValue: unknown;
  actor: string | null;
  operationId: string | null;
  createdAt: string;
};

export type FinancialSummary = {
  orderTotal: number;
  total: number;
  paid: number;
  pendingPayments: number;
  refunded: number;
  net: number;
  due: number;
  excess: number;
  /** Refunded beyond the excess (a refund Stripe completed after it was held failed). */
  overRefunded: number;
};

export type OrderTotals = {
  itemsOriginal: number;
  productDiscount: number;
  subtotal: number;
  orderDiscount: number;
  shippingOriginal: number;
  shippingDiscount: number;
  shippingTotal: number;
  total: number;
};

export type OrderCustomer = {
  id: number | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
} & Record<string, unknown>;

export type Order = {
  id: number;
  reference: number;
  publicId: string;
  locale: string;
  source: 'admin' | 'storefront' | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  createdAt: string;
  cancelledAt: string | null;
  archivedAt: string | null;
  customer: OrderCustomer;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  shippingMethod: Record<string, unknown> | null;
  notes: string | null;
  totals: OrderTotals;
  lines: OrderLine[];
  payments: OrderPayment[];
  /** Newest first. */
  refunds: OrderRefund[];
  notificationsSummary?: { sent: number; failed: number; skipped: number };
  /** Invoices and credit notes, oldest first. */
  invoices: InvoiceView[];
  billing: OrderBilling;
  /** Oldest first. */
  shipments: ShipmentView[];
  /** Oldest first. */
  returns: ReturnView[];
  shipping: OrderShipping;
  promotions: OrderPromotion[];
  summary: FinancialSummary;
  availableActions: OrderActionKey[];
  history: OrderHistoryItem[];
};

// ---------------------------------------------------------------------------
// Promotions on orders (plan 6)
// ---------------------------------------------------------------------------

export type DiscountClass = 'PRODUCT_DISCOUNT' | 'ORDER_DISCOUNT' | 'SHIPPING_DISCOUNT';

/** One benefit of an applied promotion: what it gave on the order (`amount`) and its definition. */
export type AppliedBenefit = {
  index: number;
  type: PromotionBenefit['type'];
  class: DiscountClass;
  amount: number;
  params: PromotionBenefit;
};

/** A promotion as the order (or a quote) recorded it: a snapshot, never re-evaluated. */
export type AppliedPromotion = {
  promotionId: number;
  version: number;
  /** Internal name (admin only). */
  name: string;
  /** Customer-facing name per locale. */
  displayName: Record<string, string>;
  code: string | null;
  method: PromotionMethod;
  classes: DiscountClass[];
  amount: number;
  benefits: AppliedBenefit[];
  snapshot: {
    eligibility: PromotionEligibility;
    conditions: PromotionConditionGroup;
    stacking: PromotionStacking;
    priority: number;
    perOrderLimit: number | null;
  };
};

/** An applied promotion with the state of its redemption (RELEASED after a cancellation). */
export type OrderPromotion = AppliedPromotion & {
  redemptionStatus: 'RESERVED' | 'RELEASED' | null;
};

export type PromotionCodeStatus =
  | 'APPLIED'
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'EMAIL_NOT_ELIGIBLE'
  | 'CONDITIONS_NOT_MET'
  | 'CONFLICT'
  | 'NO_BENEFIT'
  | 'AWAITING_SHIPPING';

export const PROMOTION_CODE_STATUSES: PromotionCodeStatus[] = [
  'APPLIED',
  'NOT_FOUND',
  'INACTIVE',
  'SCHEDULED',
  'EXPIRED',
  'USAGE_LIMIT_REACHED',
  'CUSTOMER_LIMIT_REACHED',
  'EMAIL_NOT_ELIGIBLE',
  'CONDITIONS_NOT_MET',
  'CONFLICT',
  'NO_BENEFIT',
  'AWAITING_SHIPPING',
];

/** At most this many codes per order (server `MAX_PROMOTION_CODES`). */
export const MAX_PROMOTION_CODES = 5;

/** `POST orders/quote`: prices a cart with promotions, writes nothing. */
export type OrderQuoteInput = {
  lines: { variantId: number; quantity: number }[];
  locale: string;
  email?: string | null;
  promotionCodes?: string[];
  /** Per promotion id, the chosen gift variant. */
  giftChoices?: Record<number, number>;
  shipping?: { country: string; postalCode?: string; providerId: string; serviceId: string } | null;
};

export type OrderQuoteLine = {
  /** Cart line index; null for gift lines. */
  sourceIndex: number | null;
  variantId: number;
  productId: number;
  unitPrice: number;
  quantity: number;
  unitDiscount: number;
  isGift: boolean;
  refs: { promotionId: number; benefitIndex: number; amount: number }[];
  sku: string;
  name: string;
  option: string | null;
  imageUrl: string | null;
};

export type OrderQuote = {
  lines: OrderQuoteLine[];
  promotions: AppliedPromotion[];
  codes: { code: string; status: PromotionCodeStatus; promotionId: number | null }[];
  rejected: { promotionId: number; reason: string }[];
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    /** Null without a shipping destination and method. */
    shippingOriginal: number | null;
    shippingDiscount: number;
    shippingTotal: number | null;
    total: number;
    totalDiscount: number;
  };
  shippingOption: ShippingOption | null;
  /** False when the best combination was searched greedily (too many candidates). */
  exhaustive: boolean;
};

export type CreateOrderInput = {
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: Address;
  billingAddress: Address;
  locale: string;
  lines: { variantId: number; quantity: number }[];
  shipping: { providerId: string; serviceId: string };
  notes?: string;
  /** Required by the server: a repeated key returns the order created first. */
  idempotencyKey: string;
  /** Normalized, at most MAX_PROMOTION_CODES. */
  promotionCodes?: string[];
  /** The total of the last quote: a different total → 409 TOTAL_CHANGED. */
  expectedTotal?: number;
  /** Per promotion id, the chosen gift variant. */
  giftChoices?: Record<number, number>;
};

export type CreatedOrder = { id: number; reference: number; publicId: string };

export type OrderLocales = {
  defaultLocale: string;
  locales: { code: string; name: string }[];
  aiAvailable: boolean;
};

export type ShippingQuoteInput = {
  country: string;
  postalCode?: string;
  lines: { variantId: number; quantity: number }[];
  locale?: string;
};

export type ShippingOption = {
  providerId: string;
  serviceId: string;
  name: string;
  price: number;
  tax: number;
  estimatedDays?: number;
};

/** `failures` lists the carriers whose quote failed; their options are missing. */
export type ShippingQuote = {
  options: ShippingOption[];
  failures: { providerId: string; code: string }[];
};

export type VariantSearchResult = {
  variantId: number;
  productId: number;
  name: string;
  option: string | null;
  sku: string;
  price: number;
  stock: number;
  imageUrl: string | null;
};

export type ManualPaymentInput = {
  /** Integer cents > 0. */
  amount: number;
  reference?: string;
  methodLabel?: string;
  /** Required: a repeated key returns the payment stored first. */
  idempotencyKey: string;
};

export type PaymentView = {
  id: number;
  method: string;
  status: string;
  amount: number;
  reference: string | null;
  externalId: string | null;
  completedAt: string | null;
  createdAt: string | null;
  methodLabel: string | null;
};

export type ModificationShipping =
  | { mode: 'KEEP' }
  | { mode: 'RECALCULATE' }
  | { mode: 'MANUAL'; amount: number; name?: string };

export type OrderModificationInput = {
  lines: { orderLineId?: number; variantId: number; quantity: number }[];
  shipping: ModificationShipping;
  addresses?: { shipping?: Address; billing?: Address };
  /** Manual order discount (cents). Omitted = keep the stored discount (capped at the subtotal). */
  orderDiscount?: number;
};

/** Discount notices of a modification preview: nothing is re-priced, the admin is told. */
export type DiscountWarning =
  | { code: 'ORDER_DISCOUNT_CAPPED' }
  | { code: 'PROMOTION_CONDITION_UNMET'; promotionId: number; name: string }
  | { code: 'SHIPPING_PROMOTION_DROPPED'; promotionId: number; name: string };

export type ModificationErrorCode =
  | 'QUANTITY_BELOW_SHIPPED'
  | 'INSUFFICIENT_STOCK'
  | 'VARIANT_UNAVAILABLE'
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'LINES_REQUIRED'
  | string;

export type ModificationTotals = {
  itemsOriginal: number;
  productDiscount: number;
  subtotal: number;
  orderDiscount: number;
  shippingTotal: number;
  total: number;
  paid: number;
  due: number;
  excess: number;
};

export type ModificationOutcome = 'DUE' | 'REFUNDABLE' | 'NONE';

export type ModificationPreview = {
  errors: { path: string; code: ModificationErrorCode }[];
  before: ModificationTotals;
  after: ModificationTotals;
  lineChanges: {
    kind: 'ADDED' | 'REMOVED' | 'QUANTITY_CHANGED' | 'UNCHANGED';
    orderLineId?: number;
    variantId: number;
    previousQuantity: number;
    newQuantity: number;
  }[];
  /** Signed: negative = deduct from stock, positive = restock. */
  stockMovements: { variantId: number; quantity: number }[];
  shipping: {
    mode: ModificationShipping['mode'];
    previousCharged: number;
    newCharged: number;
    previousShipmentsCost?: number;
    quote?: number;
    shippingOriginal: number;
    shippingDiscount: number;
  };
  discountWarnings: DiscountWarning[];
  outcome: ModificationOutcome;
  difference: number;
};

export type ApplyModificationInput = OrderModificationInput & {
  /** 8–64 characters; a repeated id returns the outcome of the first application. */
  operationId: string;
};

export type ModificationApplied = { order: Order; outcome: ModificationOutcome; difference: number };

// ---------------------------------------------------------------------------
// Payment links and instructions (plan 4)
// ---------------------------------------------------------------------------

export type PaymentLink = { url: string; expiresAt: string; amount: number; reused: boolean };

export type PaymentInstructionsInput =
  | { mode: 'MANUAL'; instructions: string; methodLabel?: string }
  | { mode: 'STRIPE' };

/** STRIPE: the link sent to the customer. MANUAL: empty. */
export type PaymentInstructionsResult = { url?: string; expiresAt?: string };

export type StoreCreditPaymentInput = {
  code: string;
  /** Required: a repeated key returns the payment stored first. */
  idempotencyKey: string;
};

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundMethod = 'MANUAL_TRANSFER' | 'STORE_CREDIT' | 'STRIPE';
export type RefundStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** A refund as the order shows it. No Stripe id nor voucher code. */
export type OrderRefund = {
  id: number;
  status: RefundStatus;
  method: RefundMethod;
  kind: 'MONEY' | 'STORE_CREDIT';
  amount: number;
  reason: string | null;
  hasStripeRefundId: boolean;
  /** Only for FAILED refunds: Stripe's `failure_reason`, or `MARKED_FAILED`. */
  failureReason: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

export type RefundView = {
  id: number;
  method: RefundMethod;
  kind: 'MONEY' | 'STORE_CREDIT';
  status: RefundStatus;
  amount: number;
  currency: string;
  reason: string | null;
  description: string | null;
  /** MANUAL_TRANSFER: the transfer reference. */
  reference: string | null;
  /** STRIPE: the Stripe refund id once Stripe answered. */
  externalId: string | null;
  actor: string | null;
  createdAt: string | null;
  completedAt: string | null;
  payment: {
    id: number;
    method: string;
    status: string;
    amount: number;
    reference: string | null;
    externalId: string | null;
  } | null;
  storeCredit: { id: number } | null;
};

export type RefundPreview = {
  orderTotal: number;
  received: number;
  refunded: number;
  inFlight: number;
  refundable: number;
  /** At most `refundable`: what may go back as money (store-credit value never does). */
  moneyRefundable: number;
  stripeRefundable: number;
  hasStripe: boolean;
};

export type CreateRefundInput = {
  method: RefundMethod;
  /** Integer cents > 0, at most the refundable amount. */
  amount: number;
  reason: string;
  description?: string;
  /** MANUAL_TRANSFER. */
  reference?: string;
  /** STORE_CREDIT: ISO date-time (defaults to +12 months on the server). */
  expiresAt?: string;
  /** STORE_CREDIT. */
  conditions?: string;
  /** One per opening of the refund modal. */
  idempotencyKey: string;
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export type NotificationView = {
  id: number;
  orderId: number | null;
  /** E-mail template type (ORDER_CONFIRMATION, PAYMENT_INSTRUCTIONS, …). */
  type: string;
  eventId: string | null;
  recipient: string | null;
  locale: string | null;
  status: NotificationStatus | null;
  providerMessageId: string | null;
  /** Error code (EMAIL_NOT_CONFIGURED, NO_RECIPIENT, …) or error class. */
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string | null;
};

// ---------------------------------------------------------------------------
// Store credit
// ---------------------------------------------------------------------------

export type StoreCredit = {
  id: number;
  /** Full code (`XXXX-XXXX-XXXX`): only the store credit endpoints return it. */
  code: string;
  customerId: number | null;
  email: string | null;
  initialAmount: number;
  balance: number;
  currency: string;
  expiresAt: string | null;
  status: 'ACTIVE' | 'VOID';
  sourceOrderId: number | null;
  sourceRefundId: number | null;
  conditions: string | null;
  actor: string | null;
  createdAt: string | null;
};

export type IssueStoreCreditInput = {
  customerId: number;
  /** Integer cents > 0. */
  amount: number;
  /** ISO date-time; the server defaults to +12 months. */
  expiresAt?: string;
  conditions?: string;
  /** One per opening of the issue modal. */
  idempotencyKey: string;
};

// ---------------------------------------------------------------------------
// Shipments, deliveries and returns (plan 5)
// ---------------------------------------------------------------------------

export type ShipmentStatus = 'PENDING' | 'ACTIVE' | 'FAILED' | 'CANCELLED';
export type DeliveryStatus = 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION';
export type OrderDeliveryStatus = 'NONE' | 'IN_TRANSIT' | 'PARTIALLY_DELIVERED' | 'DELIVERED';

export type OrderShipping = {
  /** Shipping charged not yet attributed to an ACTIVE shipment: the next shipment's default cost. */
  remainingCost: number;
  deliveryStatus: OrderDeliveryStatus;
};

export type ShipmentItem = {
  orderLineId: number;
  sku: string;
  name: string;
  option: string | null;
  quantity: number;
};

export type ShipmentEvent = {
  type: string;
  description: string | null;
  occurredAt: string | null;
  source: string | null;
};

export type ShipmentView = {
  id: number;
  status: ShipmentStatus;
  /** `manual` or a carrier id. */
  providerId: string;
  serviceId: string | null;
  carrierName: string;
  items: ShipmentItem[];
  trackingCode: string | null;
  trackingUrl: string | null;
  shippingCost: number;
  labelAvailable: boolean;
  deliveryStatus: DeliveryStatus | null;
  deliverySource: 'MANUAL' | 'CARRIER' | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  /** `UNCERTAIN` on a PENDING shipment the carrier may have created; else a failure code. */
  error: string | null;
  createdAt: string | null;
  /** "Retry" is available (uncertain, or stuck PENDING), decided by the server clock. */
  retryable: boolean;
  /** Oldest first. */
  events: ShipmentEvent[];
};

export type CreateShipmentInput = {
  lines: { orderLineId: number; quantity: number }[];
  method:
    | { mode: 'MANUAL'; carrierName: string; trackingCode?: string; trackingUrl?: string }
    | { mode: 'CARRIER' };
  /** Integer cents ≥ 0. */
  shippingCost: number;
  notifyCustomer: boolean;
  /** One per opening of the ship modal. */
  idempotencyKey: string;
};

export type DeliveryInput = {
  /** ISO date-time, not before the shipment nor in the future. */
  deliveredAt: string;
  notifyCustomer: boolean;
};

/** `null` clears the field. */
export type TrackingInput = { trackingCode: string | null; trackingUrl: string | null };

export type ReturnItemView = {
  orderLineId: number;
  sku: string;
  name: string;
  option: string | null;
  quantity: number;
  restock: boolean;
  value: number;
};

export type ReturnView = {
  id: number;
  items: ReturnItemView[];
  grossValue: number;
  /** The order discount share taken back by the return. */
  discountShare: number;
  /** grossValue − discountShare: what the return entitles the customer to. */
  refundableValue: number;
  reason: string | null;
  notes: string | null;
  actor: string | null;
  createdAt: string | null;
};

export type RegisterReturnInput = {
  lines: { orderLineId: number; quantity: number; restock: boolean }[];
  /** 1–200 characters. */
  reason: string;
  /** Up to 2000 characters. */
  notes?: string;
  /** One per opening of the return modal. */
  idempotencyKey: string;
};

/** `refundable`: what the order can refund now (in-flight refunds counted). */
export type ReturnRegistered = { return: ReturnView; refundable: number };
