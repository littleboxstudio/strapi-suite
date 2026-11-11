import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '../orderTypes';

export type BadgeVariant =
  | 'alternative'
  | 'danger'
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning';

/** `labelKey` is null for a status this admin build does not know (shown raw, neutral). */
export type StatusBadge = { variant: BadgeVariant; labelKey: string | null };

const badges = <S extends string>(group: string, variants: Record<S, BadgeVariant>) =>
  Object.fromEntries(
    Object.entries(variants).map(([status, variant]) => [
      status,
      { variant, labelKey: `ecommerce.orders.status.${group}.${status}` },
    ])
  ) as Record<S, StatusBadge>;

export const ORDER_STATUS_BADGES = badges<OrderStatus>('order', {
  OPEN: 'primary',
  ARCHIVED: 'secondary',
  CANCELLED: 'danger',
});

export const PAYMENT_STATUS_BADGES = badges<PaymentStatus>('payment', {
  PENDING: 'warning',
  PARTIALLY_PAID: 'alternative',
  PAID: 'success',
  PARTIALLY_REFUNDED: 'secondary',
  REFUNDED: 'neutral',
});

export const FULFILLMENT_STATUS_BADGES = badges<FulfillmentStatus>('fulfillment', {
  UNFULFILLED: 'warning',
  PARTIALLY_FULFILLED: 'alternative',
  FULFILLED: 'success',
});

const UNKNOWN: StatusBadge = { variant: 'neutral', labelKey: null };

const lookup = <S extends string>(map: Record<S, StatusBadge>, status: S): StatusBadge =>
  Object.prototype.hasOwnProperty.call(map, status) ? map[status] : UNKNOWN;

export const orderStatusBadge = (status: OrderStatus) => lookup(ORDER_STATUS_BADGES, status);
export const paymentStatusBadge = (status: PaymentStatus) => lookup(PAYMENT_STATUS_BADGES, status);
export const fulfillmentStatusBadge = (status: FulfillmentStatus) =>
  lookup(FULFILLMENT_STATUS_BADGES, status);
