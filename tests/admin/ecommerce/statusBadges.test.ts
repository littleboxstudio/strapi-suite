import { describe, it, expect } from 'vitest';
import {
  FULFILLMENT_STATUS_BADGES,
  ORDER_STATUS_BADGES,
  PAYMENT_STATUS_BADGES,
  fulfillmentStatusBadge,
  orderStatusBadge,
  paymentStatusBadge,
} from '../../../admin/src/ecommerce/utils/statusBadges';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

describe('order status badges', () => {
  it('maps each order status to its colour variant and i18n key', () => {
    expect(orderStatusBadge('OPEN')).toEqual({ variant: 'primary', labelKey: 'ecommerce.orders.status.order.OPEN' });
    expect(orderStatusBadge('ARCHIVED')).toEqual({ variant: 'secondary', labelKey: 'ecommerce.orders.status.order.ARCHIVED' });
    expect(orderStatusBadge('CANCELLED')).toEqual({ variant: 'danger', labelKey: 'ecommerce.orders.status.order.CANCELLED' });
  });

  it('maps each payment status to its colour variant and i18n key', () => {
    expect(paymentStatusBadge('PENDING')).toEqual({ variant: 'warning', labelKey: 'ecommerce.orders.status.payment.PENDING' });
    expect(paymentStatusBadge('PARTIALLY_PAID')).toEqual({ variant: 'alternative', labelKey: 'ecommerce.orders.status.payment.PARTIALLY_PAID' });
    expect(paymentStatusBadge('PAID')).toEqual({ variant: 'success', labelKey: 'ecommerce.orders.status.payment.PAID' });
    expect(paymentStatusBadge('PARTIALLY_REFUNDED')).toEqual({ variant: 'secondary', labelKey: 'ecommerce.orders.status.payment.PARTIALLY_REFUNDED' });
    expect(paymentStatusBadge('REFUNDED')).toEqual({ variant: 'neutral', labelKey: 'ecommerce.orders.status.payment.REFUNDED' });
  });

  it('maps each fulfillment status to its colour variant and i18n key', () => {
    expect(fulfillmentStatusBadge('UNFULFILLED')).toEqual({ variant: 'warning', labelKey: 'ecommerce.orders.status.fulfillment.UNFULFILLED' });
    expect(fulfillmentStatusBadge('PARTIALLY_FULFILLED')).toEqual({ variant: 'alternative', labelKey: 'ecommerce.orders.status.fulfillment.PARTIALLY_FULFILLED' });
    expect(fulfillmentStatusBadge('FULFILLED')).toEqual({ variant: 'success', labelKey: 'ecommerce.orders.status.fulfillment.FULFILLED' });
  });

  it.each([
    ['order', ORDER_STATUS_BADGES],
    ['payment', PAYMENT_STATUS_BADGES],
    ['fulfillment', FULFILLMENT_STATUS_BADGES],
  ])('gives every %s status a distinct colour', (_name, map) => {
    const variants = Object.values(map).map((b) => b.variant);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('falls back to neutral with the raw status for an unknown value', () => {
    expect(orderStatusBadge('WHATEVER' as any)).toEqual({ variant: 'neutral', labelKey: null });
    expect(paymentStatusBadge(undefined as any)).toEqual({ variant: 'neutral', labelKey: null });
  });

  it('has every label translated in en and pt', () => {
    const keys = [ORDER_STATUS_BADGES, PAYMENT_STATUS_BADGES, FULFILLMENT_STATUS_BADGES].flatMap((m) =>
      Object.values(m).map((b) => `littlebox-strapi-suite.${b.labelKey}`)
    );
    expect(keys).toHaveLength(11);
    for (const key of keys) {
      expect(en[key], key).toEqual(expect.any(String));
      expect(pt[key], key).toEqual(expect.any(String));
    }
  });
});
