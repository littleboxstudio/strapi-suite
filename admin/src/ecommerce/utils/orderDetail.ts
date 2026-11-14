import { fulfillmentStatusBadge, orderStatusBadge, paymentStatusBadge, type StatusBadge } from './statusBadges';
import { formatLineDiscount } from './lineDiscount';
import type {
  Address,
  AppliedPromotion,
  DiscountClass,
  FinancialSummary,
  FulfillmentStatus,
  Order,
  OrderActionKey,
  OrderHistoryItem,
  OrderPromotion,
  OrderPromotionCode,
  OrderStatus,
  OrderTotals,
  PaymentStatus,
} from '../orderTypes';
import type { PromotionBenefit, PromotionMethod } from '../promotionTypes';

/** `id` is a plugin translation key (without the plugin prefix). */
export type Message = { id: string; values?: Record<string, string | number> };
export type Translate = (id: string, values?: Record<string, string | number>) => string;

/** "ordered / shipped", e.g. "10 / 3" (requirement 4.3). */
export function formatShippedProgress(quantity: number, shipped: number): string {
  return `${quantity} / ${shipped}`;
}

/** "7 units left to ship", or null when nothing is pending. */
export function pendingLabel(pending: number): Message | null {
  return pending > 0 ? { id: 'ecommerce.orders.detail.lines.pending', values: { count: pending } } : null;
}

/** `user:<id>` → "Admin #<id>"; `system`, `storefront` and `webhook:<provider>` translated. */
export function actorLabel(actor: string | null, t: Translate): string {
  if (!actor) return t('ecommerce.orders.history.actor.unknown');
  if (actor.startsWith('user:')) return t('ecommerce.orders.history.actor.user', { id: actor.slice(5) });
  if (actor.startsWith('webhook:')) {
    return t('ecommerce.orders.history.actor.webhook', { provider: actor.slice(8) });
  }
  if (actor === 'system' || actor === 'storefront') return t(`ecommerce.orders.history.actor.${actor}`);
  return actor;
}

export function sortHistoryNewestFirst(list: OrderHistoryItem[]): OrderHistoryItem[] {
  return [...list].sort((a, b) => {
    const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return byDate || b.id - a.id;
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const field = (v: unknown, key: string): unknown => (isRecord(v) ? v[key] : undefined);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One-line address: "Name, Company, Line 1, Line 2, Postal code City, Country"; "—" when absent. */
export function formatAddressLine(address: Partial<Address> | null | undefined): string {
  if (!isRecord(address)) return '—';
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ');
  const place = [address.postalCode, address.city].filter(Boolean).join(' ');
  const parts = [name, address.company, address.line1, address.line2, place, address.country];
  const text = parts.filter((p) => typeof p === 'string' && p.trim()).join(', ');
  return text || '—';
}

export type HistoryText = {
  /** Translated operation type (falls back to the raw type). */
  title: string;
  /** Server text, kept as recorded. */
  description: string;
  actor: string;
  /** Compact before → after, when the entry has one. */
  change: { before: string; after: string } | null;
  /** Translated summary of the entry's values, when the type has one (e.g. a return). */
  detail: string | null;
};

const STATUS_CHANGES: Record<string, { key: string; badge: (s: string) => StatusBadge }> = {
  ORDER_STATUS_CHANGED: { key: 'orderStatus', badge: (s) => orderStatusBadge(s as OrderStatus) },
  PAYMENT_STATUS_CHANGED: { key: 'paymentStatus', badge: (s) => paymentStatusBadge(s as PaymentStatus) },
  FULFILLMENT_STATUS_CHANGED: {
    key: 'fulfillmentStatus',
    badge: (s) => fulfillmentStatusBadge(s as FulfillmentStatus),
  },
};

/** Σ of the shipping lines' signed amounts; null when the value is not a list of lines. */
function chargedOf(lines: unknown): number | null {
  if (!Array.isArray(lines)) return null;
  let sum = 0;
  for (const l of lines) {
    const amount = field(l, 'amount');
    if (!isNumber(amount)) return null;
    sum += amount;
  }
  return sum;
}

/**
 * A products change that only set, changed or removed manual line discounts (spec 4.1): the
 * percents per line ("Camisa Linho: −10 %" → "Camisa Linho: −15 %"); null for any other change.
 */
function discountOnlyChange(next: unknown, locale: string): HistoryText['change'] {
  const changed = field(next, 'changed');
  const added = field(next, 'added');
  const removed = field(next, 'removed');
  if (!Array.isArray(changed) || !changed.length) return null;
  if ((Array.isArray(added) && added.length) || (Array.isArray(removed) && removed.length)) return null;
  const only = changed.every(
    (c) => field(c, 'quantity') === field(c, 'previousQuantity') && field(c, 'discountPercent') !== undefined
  );
  if (!only) return null;
  const percent = (v: unknown) => (isNumber(v) ? formatLineDiscount(v, locale) : '—');
  const label = (c: unknown) => {
    const name = String(field(c, 'name') ?? '');
    const option = field(c, 'option');
    return typeof option === 'string' && option ? `${name} — ${option}` : name;
  };
  return {
    before: changed.map((c) => `${label(c)}: ${percent(field(c, 'previousDiscountPercent'))}`).join(' · '),
    after: changed.map((c) => `${label(c)}: ${percent(field(c, 'discountPercent'))}`).join(' · '),
  };
}

function historyChange(
  entry: OrderHistoryItem,
  t: Translate,
  money: (cents: number) => string,
  locale: string
): HistoryText['change'] {
  const { type, previousValue: prev, newValue: next } = entry;

  const status = STATUS_CHANGES[type];
  if (status) {
    const before = field(prev, status.key);
    const after = field(next, status.key);
    if (typeof before !== 'string' || typeof after !== 'string') return null;
    const label = (s: string) => {
      const badge = status.badge(s);
      return badge.labelKey ? t(badge.labelKey) : s;
    };
    return { before: label(before), after: label(after) };
  }

  if (type === 'LINE_QUANTITY_CHANGED' || type === 'LINE_ADDED' || type === 'LINE_REMOVED') {
    const before = type === 'LINE_ADDED' ? 0 : field(prev, 'quantity');
    const after = type === 'LINE_REMOVED' ? 0 : field(next, 'quantity');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: String(before), after: String(after) };
  }

  if (type === 'ADDRESS_CHANGED') {
    const key = ['shippingAddress', 'billingAddress'].find((k) => isRecord(next) && k in next);
    if (!key) return null;
    return {
      before: formatAddressLine(field(prev, key) as Address | null),
      after: formatAddressLine(field(next, key) as Address | null),
    };
  }

  if (type === 'SHIPPING_CHANGED') {
    const before = field(next, 'previousCharged') ?? field(prev, 'charged');
    const after = field(next, 'newCharged');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: money(before), after: money(after) };
  }

  if (type === 'LINES_CHANGED') {
    const discounts = discountOnlyChange(next, locale);
    if (discounts) return discounts;
  }

  if (type === 'LINES_CHANGED' || type === 'DISCOUNTS_RECALCULATED') {
    const before = field(field(prev, 'totals'), 'total');
    const after = field(field(next, 'totals'), 'total');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: money(before), after: money(after) };
  }

  if (type === 'SHIPPING_RECALCULATED' || type === 'SHIPPING_LINE_EDITED' || type === 'SHIPPING_LINE_ADDED') {
    const before = chargedOf(field(prev, 'lines'));
    const after = chargedOf(field(next, 'lines'));
    if (before === null || after === null) return null;
    return { before: money(before), after: money(after) };
  }

  if (type === 'MANUAL_DISCOUNT_ADDED' || type === 'MANUAL_DISCOUNT_REMOVED') {
    const amount = field(type === 'MANUAL_DISCOUNT_ADDED' ? next : prev, 'amount');
    if (!isNumber(amount)) return null;
    return type === 'MANUAL_DISCOUNT_ADDED'
      ? { before: money(0), after: money(amount) }
      : { before: money(amount), after: money(0) };
  }

  if (type === 'RETURN_REGISTERED') {
    const before = field(prev, 'total');
    const after = field(next, 'total');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: money(before), after: money(after) };
  }

  if (type === 'ORDER_DISCOUNT_CHANGED') {
    const before = field(prev, 'orderDiscount');
    const after = field(next, 'orderDiscount');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: money(before), after: money(after) };
  }

  return null;
}

/** "3 units returned · approved €14.00" for a registered return; null for other types. */
function historyDetail(entry: OrderHistoryItem, t: Translate, money: (cents: number) => string): string | null {
  if (entry.type !== 'RETURN_REGISTERED') return null;
  const lines = field(entry.newValue, 'lines');
  const amount = field(entry.newValue, 'refundableValue');
  if (!Array.isArray(lines) || !isNumber(amount)) return null;
  const units = lines.reduce((sum, l) => sum + (isNumber(field(l, 'quantity')) ? (field(l, 'quantity') as number) : 0), 0);
  return t('ecommerce.orders.history.return', { units, amount: money(amount) });
}

/** Display text of one history entry (requirement 6.2). */
export function historyEntryText(
  entry: OrderHistoryItem,
  t: (id: string, values?: Record<string, string | number>, defaultMessage?: string) => string,
  money: (cents: number) => string,
  /** Formats the percents of manual line discounts (spec 4.1). */
  locale = 'en'
): HistoryText {
  return {
    title: t(`ecommerce.orders.history.type.${entry.type}`, undefined, entry.type),
    description: entry.description,
    actor: actorLabel(entry.actor, t),
    change: historyChange(entry, t, money, locale),
    detail: historyDetail(entry, t, money),
  };
}

export type SummaryRowKey =
  | 'itemsOriginal'
  | 'productDiscount'
  | 'orderDiscount'
  | 'subtotal'
  | 'shippingOriginal'
  | 'shippingDiscount'
  | 'totalDiscount'
  | 'total'
  | 'paid'
  | 'pendingPayments'
  | 'refunded'
  | 'net'
  | 'due'
  | 'excess'
  | 'overRefunded';

export type SummaryRow = { key: SummaryRowKey; amount: number; strong?: true };

/** Product + order + shipping discounts of the order (promotions requirement 3.6). */
export function totalDiscount(totals: OrderTotals): number {
  return (totals.productDiscount || 0) + (totals.orderDiscount || 0) + (totals.shippingDiscount || 0);
}

/**
 * Rows of the financial summary (requirements 8.1 and promotions 3.6). Discounts are negative;
 * zero discounts, refunds, pending payments and refundable excess are left out.
 */
export function financialSummaryRows(totals: OrderTotals, summary: FinancialSummary): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const add = (key: SummaryRowKey, amount: number, opts: { hideZero?: boolean; strong?: boolean } = {}) => {
    if (opts.hideZero && !amount) return;
    rows.push(opts.strong ? { key, amount, strong: true } : { key, amount });
  };
  add('itemsOriginal', totals.itemsOriginal);
  add('productDiscount', -totals.productDiscount, { hideZero: true });
  add('orderDiscount', -totals.orderDiscount, { hideZero: true });
  add('subtotal', totals.subtotal - totals.orderDiscount);
  add('shippingOriginal', totals.shippingOriginal);
  add('shippingDiscount', -totals.shippingDiscount, { hideZero: true });
  add('totalDiscount', -totalDiscount(totals), { hideZero: true });
  add('total', totals.total, { strong: true });
  add('paid', summary.paid);
  add('pendingPayments', summary.pendingPayments, { hideZero: true });
  add('refunded', summary.refunded, { hideZero: true });
  add('net', summary.net);
  add('due', summary.due, { strong: true });
  add('excess', summary.excess, { hideZero: true });
  add('overRefunded', summary.overRefunded ?? 0, { hideZero: true });
  return rows;
}

export type OverviewNoteKey =
  | 'due'
  | 'paidInFull'
  | 'pendingPayments'
  | 'refunded'
  | 'excess'
  | 'overRefunded';

export type OverviewNote = { key: OverviewNoteKey; amount?: number; tone?: 'success' | 'warning' | 'danger' };

export type OverviewTile = {
  key: 'total' | 'shipping' | 'discounts' | 'paid';
  amount: number;
  /** Paid: something still owed, or settled. */
  tone?: 'warning' | 'success';
  notes: OverviewNote[];
};

/**
 * The four figures at the top of the payments section: the order total, the shipping, the
 * discounts (products, order and shipping) and what was paid, with the amount still pending
 * below it (or "paid in full"), plus payments awaiting confirmation, refunds, an excess or an
 * over-refund when there are any.
 */
export function paymentsOverview(totals: OrderTotals, summary: FinancialSummary): OverviewTile[] {
  const discounts = totalDiscount(totals);
  const paidNotes: OverviewNote[] = [];
  if (summary.due > 0) paidNotes.push({ key: 'due', amount: summary.due, tone: 'warning' });
  if (summary.pendingPayments) paidNotes.push({ key: 'pendingPayments', amount: summary.pendingPayments });
  if (summary.refunded) paidNotes.push({ key: 'refunded', amount: summary.refunded });
  if (summary.excess) paidNotes.push({ key: 'excess', amount: summary.excess, tone: 'success' });
  if (summary.overRefunded) paidNotes.push({ key: 'overRefunded', amount: summary.overRefunded, tone: 'danger' });
  if (!summary.due && !summary.excess && !summary.overRefunded) {
    paidNotes.unshift({ key: 'paidInFull', tone: 'success' });
  }

  return [
    { key: 'total', amount: totals.total, notes: [] },
    { key: 'shipping', amount: totals.shippingOriginal, notes: [] },
    { key: 'discounts', amount: discounts ? -discounts : 0, notes: [] },
    { key: 'paid', amount: summary.paid, tone: summary.due > 0 ? 'warning' : 'success', notes: paidNotes },
  ];
}

// ---------------------------------------------------------------------------
// Promotions recorded on the order (promotions requirements 3.2–3.8)
// ---------------------------------------------------------------------------

const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The customer-facing name: the order's locale, then the default locale; null when neither has one. */
export function promotionDisplayName(
  p: Pick<AppliedPromotion, 'displayName'>,
  locale: string,
  defaultLocale?: string | null
): string | null {
  const names = isRecord(p.displayName) ? p.displayName : {};
  return nonBlank(names[locale]) ?? (defaultLocale ? nonBlank(names[defaultLocale]) : null);
}

export type PromotionLocales = { locale: string; defaultLocale?: string | null };

export type PromotionRow = {
  /** `<promotionId>-<benefit index>` */
  key: string;
  promotionId: number;
  /** Null: show the neutral "Promotion" label. */
  displayName: string | null;
  /** Internal name (admin only, secondary). */
  name: string;
  code: string | null;
  method: PromotionMethod;
  discountClass: DiscountClass;
  benefit: PromotionBenefit;
  amount: number;
  /** The redemption was released (the order was cancelled). */
  released: boolean;
};

/** One row per benefit of each applied promotion, read from the stored snapshot (never recomputed). */
export function promotionRows(promotions: OrderPromotion[], locales: PromotionLocales): PromotionRow[] {
  if (!Array.isArray(promotions)) return [];
  return promotions.flatMap((p) =>
    (Array.isArray(p.benefits) ? p.benefits : []).map((b) => ({
      key: `${p.promotionId}-${b.index}`,
      promotionId: p.promotionId,
      displayName: promotionDisplayName(p, locales.locale, locales.defaultLocale),
      name: p.name,
      code: p.code ?? null,
      method: p.method,
      discountClass: b.class,
      benefit: b.params,
      amount: b.amount,
      released: p.redemptionStatus === 'RELEASED',
    }))
  );
}

/** What the applied promotions gave, as stored on the order. */
export function promotionsDiscountTotal(promotions: Pick<AppliedPromotion, 'amount'>[]): number {
  return (Array.isArray(promotions) ? promotions : []).reduce(
    (sum, p) => sum + (isNumber(p.amount) ? p.amount : 0),
    0
  );
}

/** Labels of the promotions that discounted a line: display name, else the internal name (admin). */
export function linePromotionNames(
  promotionIds: number[],
  promotions: AppliedPromotion[],
  locales: PromotionLocales
): string[] {
  if (!Array.isArray(promotionIds) || !Array.isArray(promotions)) return [];
  return promotionIds.flatMap((id) => {
    const p = promotions.find((x) => x.promotionId === id);
    if (!p) return [];
    return [promotionDisplayName(p, locales.locale, locales.defaultLocale) ?? p.name];
  });
}

/** Badge colour of a code status (applied, waiting, refused). */
export function codeStatusBadgeVariant(status: string): 'success' | 'secondary' | 'warning' | 'danger' {
  if (status === 'APPLIED') return 'success';
  if (status === 'AWAITING_SHIPPING') return 'secondary';
  if (status === 'CONFLICT' || status === 'NO_BENEFIT' || status === 'CONDITIONS_NOT_MET') return 'warning';
  return 'danger';
}

/** Entered codes that did not apply (the applied ones show in the promotion rows). */
export function unappliedPromotionCodes(codes: OrderPromotionCode[] | undefined): OrderPromotionCode[] {
  return (Array.isArray(codes) ? codes : []).filter((c) => c && c.status !== 'APPLIED');
}

/** True when the server refused an action the order no longer allows (`ACTION_NOT_AVAILABLE`). */
export function isActionUnavailable(err: unknown): boolean {
  const errors = (err as any)?.response?.data?.error?.details?.errors;
  return Array.isArray(errors) && errors.some((e) => e?.code === 'ACTION_NOT_AVAILABLE');
}

/** Toolbar actions in display order, with the permission each one needs. */
const ACTION_PERMISSION: { action: OrderActionKey; needs: 'canManage' | 'canPay' | 'canRefund' }[] = [
  { action: 'SHIP', needs: 'canManage' },
  { action: 'ADD_PAYMENT', needs: 'canManage' },
  { action: 'SEND_PAYMENT_INSTRUCTIONS', needs: 'canPay' },
  { action: 'REFUND', needs: 'canRefund' },
  { action: 'REGISTER_RETURN', needs: 'canManage' },
  { action: 'CANCEL', needs: 'canManage' },
  { action: 'ARCHIVE', needs: 'canManage' },
];

export type OrderActionPermissions = { canManage: boolean; canPay: boolean; canRefund: boolean };
/** Toolbar actions. ISSUE_INVOICE is a button of the invoices section, not of the toolbar. */
export type ToolbarAction =
  | 'SHIP'
  | 'ADD_PAYMENT'
  | 'SEND_PAYMENT_INSTRUCTIONS'
  | 'REFUND'
  | 'REGISTER_RETURN'
  | 'CANCEL'
  | 'ARCHIVE';

/**
 * Editing is closed because a carrier shipment is still PENDING (the server answers
 * ORDER_NOT_EDITABLE): the header says why.
 */
export function editBlockedByShipment(order: Pick<Order, 'editing'>): boolean {
  return order.editing.blockedBy === 'SHIPMENT_PENDING';
}

/**
 * The toolbar buttons: actions the order allows and the admin may run (`orders.manage`,
 * `payments.manage` for instructions, `refunds.manage` for refunds).
 */
export function allowedToolbarActions(
  available: OrderActionKey[],
  perms: OrderActionPermissions
): ToolbarAction[] {
  const set = new Set<string>(available);
  return ACTION_PERMISSION.filter((a) => set.has(a.action) && perms[a.needs]).map(
    (a) => a.action as ToolbarAction
  );
}

/** Actions shown in the Payments section instead of the top bar (same availability rules). */
export const PAYMENT_SECTION_ACTIONS: ToolbarAction[] = ['ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS', 'REFUND'];

/** Actions shown in the Refunds and credits section (also in Payments; same rules). */
export const REFUND_SECTION_ACTIONS: ToolbarAction[] = ['REFUND'];

/** The allowed actions that belong to the Refunds and credits section. */
export function refundSectionActions(allowed: ToolbarAction[]): ToolbarAction[] {
  return allowed.filter((a) => REFUND_SECTION_ACTIONS.includes(a));
}

/** The allowed actions that belong to the Payments section, in toolbar order. */
export function paymentSectionActions(allowed: ToolbarAction[]): ToolbarAction[] {
  return allowed.filter((a) => PAYMENT_SECTION_ACTIONS.includes(a));
}

/** The allowed actions that stay in the top bar. */
export function headerActions(allowed: ToolbarAction[]): ToolbarAction[] {
  return allowed.filter((a) => !PAYMENT_SECTION_ACTIONS.includes(a));
}

/**
 * Error codes of the payment, refund, store credit, notification, shipment, return and invoice
 * endpoints that have a message under `ecommerce.orders.errors.<code>`.
 */
export const API_ERROR_CODES = [
  'ACTION_NOT_AVAILABLE',
  'NOTHING_DUE',
  'PAYMENT_PENDING',
  'STOREFRONT_URL_MISSING',
  'STRIPE_NOT_CONFIGURED',
  'STRIPE_REQUEST_FAILED',
  'STRIPE_UNREACHABLE',
  'STRIPE_SESSION_MISMATCH',
  'IDEMPOTENCY_KEY_CONFLICT',
  'STORE_CREDIT_CONFLICT',
  'STORE_CREDIT_NOT_FOUND',
  'STORE_CREDIT_EMAIL_MISMATCH',
  'STORE_CREDIT_EMPTY',
  'STORE_CREDIT_EXPIRED',
  'STORE_CREDIT_INSUFFICIENT',
  'STORE_CREDIT_VOID',
  'REFUND_NOT_RESUMABLE',
  'REFUND_NOT_MARKABLE',
  'EMAIL_NOT_CONFIGURED',
  'EMAIL_SEND_FAILED',
  'ENCRYPTION_KEY_MISSING',
  'SECRET_UNREADABLE',
  'exceeds_refundable',
  'exceeds_payment',
  'exceeds_stripe_refundable',
  'incompatible_payment',
  'invalid_payment',
  'stripe_unavailable',
  'customer_not_found',
  'invalid_method',
  'invalid_amount',
  'invalid_date',
  'too_long',
  'reserved',
  'required',
  'invalid',
  // Shipments, deliveries and returns (plan 5)
  'QUANTITY_EXCEEDS_PENDING',
  'QUANTITY_EXCEEDS_RETURNABLE',
  'ALREADY_DELIVERED',
  'SHIPMENT_PENDING',
  'SHIPMENT_UNCERTAIN',
  'SHIPMENT_HAS_RETURNS',
  'ORDER_CHANGED',
  'SHIPMENT_STATE_CHANGED',
  'LABEL_NOT_AVAILABLE',
  'NOT_SUPPORTED',
  'NOT_IMPLEMENTED',
  'CARRIER_NOT_CONFIGURED',
  'CARRIER_REQUEST_FAILED',
  'CARRIER_UNREACHABLE',
  'TIMEOUT',
  'INVALID_QUOTE',
  'INVALID_AMOUNT',
  'invalid_url',
  'invalid_mode',
  'invalid_line',
  'duplicate_line',
  'unknown_line',
  'invalid_quantity',
  'invalid_restock',
  'invalid_shipped_at',
  'before_shipment',
  'in_future',
  // Invoices and credit notes (plan 5)
  'BILLING_NOT_CONFIGURED',
  'BILLING_PROVIDER_AMBIGUOUS',
  'BILLING_CONFIG_MISSING',
  'BILLING_AUTH_FAILED',
  'BILLING_UNREACHABLE',
  'BILLING_REQUEST_FAILED',
  'BILLING_TAX_NOT_FOUND',
  'BILLING_EXEMPTION_REASON_MISSING',
  'INVOICE_PDF_UNAVAILABLE',
  'PAYMENT_NOT_INVOICEABLE',
  'INVOICE_EXCESS_UNRESOLVED',
  'INVOICE_TOTALS_DIFFER',
  'QUANTITY_EXCEEDS_UNINVOICED',
  'SHIPPING_LINE_NOT_INVOICEABLE',
  'QUANTITY_EXCEEDS_CREDITABLE',
  'SHIPPING_NOT_CREDITABLE',
  'CREDIT_NOTE_IN_PROGRESS',
  'exceeds_creditable',
  'coverage_mismatch',
  // Promotions on orders (plan 6)
  'PROMOTION_UNAVAILABLE',
  'PROMOTION_CODE_INVALID',
  'TOTAL_CHANGED',
  'too_many',
  'invalid_email',
  'invalid_country',
  // Order editing by section (plan 10)
  'OPERATION_ID_CONFLICT',
  'ORDER_NOT_EDITABLE',
  'ORDER_HAS_SHIPMENTS',
  'REVIEW_FLAG_NOT_DISMISSABLE',
  'PROMOTIONS_NOT_COMBINABLE',
  'PROMOTION_GIFT_SHIPPED',
  'COUNTRY_NOT_SERVED',
  'SHIPPING_METHOD_UNAVAILABLE',
  'SHIPPING_QUOTE_FAILED',
  'DISCOUNT_EXCEEDS_PRODUCTS',
  'SHIPPING_LINE_NOT_FOUND',
  'SHIPPING_LINE_PAID',
  'BILLING_ADDRESS_LOCKED',
  'MANUAL_DISCOUNT_NOT_FOUND',
  'INVALID_PERCENT',
] as const;

/**
 * The error code of a failed admin request: `error.details.code` (400/409 answers of the
 * plan-4 endpoints), else the first `error.details.errors[].code`; null when there is none.
 */
export function apiErrorCode(err: unknown): string | null {
  const error = (err as any)?.response?.data?.error;
  const code = error?.details?.code;
  if (typeof code === 'string' && code) return code;
  const errors = error?.details?.errors;
  if (Array.isArray(errors)) {
    const first = errors.find((e) => typeof e?.code === 'string');
    if (first) return first.code;
  }
  return null;
}

/**
 * The billing provider's own message of a refused request (Moloni: the rejected fields and
 * rules), or null when the server only sent the code.
 */
export function apiErrorDetail(err: unknown): string | null {
  const error = (err as any)?.response?.data?.error;
  const code = error?.details?.code;
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (typeof code !== 'string' || !code.startsWith('BILLING_')) return null;
  return message && message !== code ? message : null;
}

/** Translation id (without the plugin prefix) for a failed request: its code's message, or `fallback`. */
export function apiErrorMessageId(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return code && (API_ERROR_CODES as readonly string[]).includes(code)
    ? `ecommerce.orders.errors.${code}`
    : fallback;
}

/**
 * Whether the next attempt of a keyed request needs a new idempotency key: only after a 4xx answer
 * (the server refused or recorded a definitive failure). 408 / 429, any 5xx (a proxy may hide a
 * recorded document) and no answer at all keep the key, so a retry replays the first request.
 */
export function shouldRenewIdempotencyKey(err: unknown): boolean {
  const e = err as any;
  const status = typeof e?.status === 'number' ? e.status : e?.response?.data?.error?.status;
  if (typeof status !== 'number') return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * A notification's stored error, `CODE` or `CODE: detail` (the provider's reason), split so the
 * code is translated and the detail shown as it came.
 */
export function notificationErrorParts(error: string | null): { code: string; detail: string | null } | null {
  if (!error) return null;
  const match = /^([A-Z][A-Z_]*)(?::\s*(.+))?$/s.exec(error.trim());
  if (!match) return { code: '', detail: error.trim() };
  return { code: match[1], detail: match[2]?.trim() || null };
}

/**
 * The payment awaiting confirmation (e.g. a Stripe link already sent) asks for a different amount
 * than the order now owes, more or less: the order changed after the link was made, so the
 * customer needs a new one.
 */
export function paymentLinkOutdated(summary: Pick<FinancialSummary, 'pendingPayments' | 'due'>): boolean {
  return summary.pendingPayments > 0 && summary.pendingPayments !== summary.due;
}
