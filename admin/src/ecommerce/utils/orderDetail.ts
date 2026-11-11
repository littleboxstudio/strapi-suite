import { fulfillmentStatusBadge, orderStatusBadge, paymentStatusBadge, type StatusBadge } from './statusBadges';
import type {
  Address,
  FinancialSummary,
  FulfillmentStatus,
  OrderActionKey,
  OrderHistoryItem,
  OrderStatus,
  OrderTotals,
  PaymentStatus,
} from '../orderTypes';

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

/** Actions this screen has a button for, in toolbar order. The others arrive with plan 4. */
export const TOOLBAR_ACTIONS = ['MODIFY', 'ADD_PAYMENT', 'CANCEL', 'ARCHIVE'] as const;
export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

export function toolbarActions(available: OrderActionKey[]): ToolbarAction[] {
  const set = new Set<string>(available);
  return TOOLBAR_ACTIONS.filter((a) => set.has(a));
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
};

const STATUS_CHANGES: Record<string, { key: string; badge: (s: string) => StatusBadge }> = {
  ORDER_STATUS_CHANGED: { key: 'orderStatus', badge: (s) => orderStatusBadge(s as OrderStatus) },
  PAYMENT_STATUS_CHANGED: { key: 'paymentStatus', badge: (s) => paymentStatusBadge(s as PaymentStatus) },
  FULFILLMENT_STATUS_CHANGED: {
    key: 'fulfillmentStatus',
    badge: (s) => fulfillmentStatusBadge(s as FulfillmentStatus),
  },
};

function historyChange(
  entry: OrderHistoryItem,
  t: Translate,
  money: (cents: number) => string
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

  if (type === 'ORDER_DISCOUNT_CHANGED') {
    const before = field(prev, 'orderDiscount');
    const after = field(next, 'orderDiscount');
    if (!isNumber(before) || !isNumber(after)) return null;
    return { before: money(before), after: money(after) };
  }

  return null;
}

/** Display text of one history entry (requirement 6.2). */
export function historyEntryText(
  entry: OrderHistoryItem,
  t: (id: string, values?: Record<string, string | number>, defaultMessage?: string) => string,
  money: (cents: number) => string
): HistoryText {
  return {
    title: t(`ecommerce.orders.history.type.${entry.type}`, undefined, entry.type),
    description: entry.description,
    actor: actorLabel(entry.actor, t),
    change: historyChange(entry, t, money),
  };
}

export type SummaryRowKey =
  | 'itemsOriginal'
  | 'productDiscount'
  | 'orderDiscount'
  | 'subtotal'
  | 'shippingOriginal'
  | 'shippingDiscount'
  | 'total'
  | 'paid'
  | 'pendingPayments'
  | 'refunded'
  | 'net'
  | 'due'
  | 'excess';

export type SummaryRow = { key: SummaryRowKey; amount: number; strong?: true };

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
  add('total', totals.total, { strong: true });
  add('paid', summary.paid);
  add('pendingPayments', summary.pendingPayments, { hideZero: true });
  add('refunded', summary.refunded, { hideZero: true });
  add('net', summary.net);
  add('due', summary.due, { strong: true });
  add('excess', summary.excess, { hideZero: true });
  return rows;
}

/** True when the server refused an action the order no longer allows (`ACTION_NOT_AVAILABLE`). */
export function isActionUnavailable(err: unknown): boolean {
  const errors = (err as any)?.response?.data?.error?.details?.errors;
  return Array.isArray(errors) && errors.some((e) => e?.code === 'ACTION_NOT_AVAILABLE');
}
