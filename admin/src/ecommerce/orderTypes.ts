/**
 * Admin-side shapes of the customers and orders API (server routes admin-customers / admin-orders).
 * Money is always integer cents.
 */

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
  shipped: number;
  pending: number;
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
  refunds: unknown[];
  invoices: unknown[];
  shipments: unknown[];
  promotions: unknown[];
  summary: FinancialSummary;
  availableActions: OrderActionKey[];
  history: OrderHistoryItem[];
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
};

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
  discountWarnings: { code: 'ORDER_DISCOUNT_CAPPED' }[];
  outcome: ModificationOutcome;
  difference: number;
};

export type ApplyModificationInput = OrderModificationInput & {
  /** 8–64 characters; a repeated id returns the outcome of the first application. */
  operationId: string;
};

export type ModificationApplied = { order: Order; outcome: ModificationOutcome; difference: number };
