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
  REFUND_DUE: 'danger',
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

export type BadgeColors = { background: string; border: string; text: string };

/**
 * Status badge colours, per theme. The design system's Badge puts the colour in a thin text on a
 * grey (dark theme) or pale (light theme) background, too faint to read; these pairs all keep
 * the text at a 4.5:1 contrast ratio or more against its background.
 */
export const BADGE_COLORS: Record<'light' | 'dark', Record<BadgeVariant, BadgeColors>> = {
  light: {
    primary: { background: '#f0f0ff', border: '#d9d8ff', text: '#271fe0' },
    secondary: { background: '#eaf5ff', border: '#b8e1ff', text: '#005a8c' },
    success: { background: '#eafbe7', border: '#c6f0c2', text: '#2f6846' },
    warning: { background: '#fdf4dc', border: '#fae7b9', text: '#8f4600' },
    danger: { background: '#fcecea', border: '#f5c0b8', text: '#b72b1a' },
    alternative: { background: '#f6ecfc', border: '#e0c1f4', text: '#8312d1' },
    neutral: { background: '#f6f6f9', border: '#dcdce4', text: '#4a4a6a' },
  },
  dark: {
    primary: { background: '#2a2960', border: '#4945ff', text: '#d9d8ff' },
    secondary: { background: '#173a54', border: '#2a79ad', text: '#b8e1ff' },
    success: { background: '#1e3b2a', border: '#3b8256', text: '#c6f0c2' },
    warning: { background: '#43311a', border: '#a8692a', text: '#fae7b9' },
    danger: { background: '#4a221f', border: '#b7443a', text: '#f5c0b8' },
    alternative: { background: '#38244f', border: '#8a52c4', text: '#e0c1f4' },
    neutral: { background: '#32324d', border: '#666687', text: '#eaeaef' },
  },
};

/** Strapi's dark theme has a dark `neutral0`; anything else is the light theme. */
export const isDarkColor = (hex: string | undefined) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const luminance = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance < 128;
};
