import { describe, expect, it } from 'vitest';
import {
  REFUND_REASONS,
  addMonthsDate,
  dateInputToIso,
  defaultInstructionsText,
  emptyRefundForm,
  emptyStoreCreditForm,
  findNewNotification,
  isRefreshableStripeRefund,
  isStuckStripeRefund,
  storeCreditDisplayStatus,
  validateRefundForm,
  validateStoreCreditForm,
  type RefundForm,
} from '../../../admin/src/ecommerce/utils/refundForm';
import type { NotificationView, RefundPreview } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const NOW = new Date(2026, 10, 11, 10, 0, 0); // 11 Nov 2026, local time

const preview = (over: Partial<RefundPreview> = {}): RefundPreview => ({
  orderTotal: 5000,
  received: 8000,
  refunded: 1000,
  inFlight: 500,
  refundable: 1500,
  moneyRefundable: 1500,
  stripeRefundable: 1000,
  hasStripe: true,
  ...over,
});

const form = (over: Partial<RefundForm> = {}): RefundForm => ({
  ...emptyRefundForm(preview(), 'pt-PT', NOW),
  reason: 'RETURN',
  ...over,
});

describe('addMonthsDate / dateInputToIso', () => {
  it('adds months as a local YYYY-MM-DD date', () => {
    expect(addMonthsDate(NOW, 12)).toBe('2027-11-11');
    expect(addMonthsDate(new Date(2026, 0, 31), 1)).toBe('2026-02-28');
  });

  it('turns a date input into the end of that local day', () => {
    const iso = dateInputToIso('2027-11-11');
    expect(iso).not.toBeNull();
    const d = new Date(iso as string);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2027, 10, 11, 23, 59,
    ]);
  });

  it('rejects malformed or impossible dates', () => {
    expect(dateInputToIso('')).toBeNull();
    expect(dateInputToIso('2027-02-30')).toBeNull();
    expect(dateInputToIso('11/11/2027')).toBeNull();
  });
});

describe('emptyRefundForm', () => {
  it('defaults to the maximum refundable, a manual transfer and a 12-month validity', () => {
    expect(emptyRefundForm(preview(), 'pt-PT', NOW)).toEqual({
      amount: '15,00',
      reason: '',
      description: '',
      method: 'MANUAL_TRANSFER',
      reference: '',
      expiresAt: '2027-11-11',
      conditions: '',
    });
  });
});

describe('emptyRefundForm with an initial reason and amount (return hand-off)', () => {
  it('takes the reason and the amount, capped by the preview refundable', () => {
    expect(emptyRefundForm(preview(), 'pt-PT', NOW, { reason: 'RETURN', amount: 900 })).toMatchObject({
      amount: '9,00',
      reason: 'RETURN',
      method: 'MANUAL_TRANSFER',
    });
    expect(emptyRefundForm(preview(), 'pt-PT', NOW, { reason: 'RETURN', amount: 9900 }).amount).toBe('15,00');
  });

  it('respects the money cap of a store-credit-paid order', () => {
    expect(
      emptyRefundForm(preview({ moneyRefundable: 400 }), 'pt-PT', NOW, { reason: 'RETURN', amount: 1200 }).amount
    ).toBe('4,00');
    // Nothing goes back as money: the store credit default may use the whole refundable.
    expect(
      emptyRefundForm(preview({ moneyRefundable: 0 }), 'pt-PT', NOW, { reason: 'RETURN', amount: 1200 })
    ).toMatchObject({ amount: '12,00', method: 'STORE_CREDIT' });
  });

  it('without an amount, keeps the default maximum', () => {
    expect(emptyRefundForm(preview(), 'pt-PT', NOW, { reason: 'RETURN' })).toMatchObject({
      amount: '15,00',
      reason: 'RETURN',
    });
  });
});

describe('validateRefundForm', () => {
  it('builds a manual transfer refund with trimmed text', () => {
    const r = validateRefundForm(
      form({ amount: '12,5', description: '  broken  ', reference: ' TRF-1 ' }),
      preview(),
      NOW
    );
    expect(r.errors).toEqual([]);
    expect(r.input).toEqual({
      method: 'MANUAL_TRANSFER',
      amount: 1250,
      reason: 'RETURN',
      description: 'broken',
      reference: 'TRF-1',
    });
  });

  it('refuses invalid, zero and too-high amounts', () => {
    expect(validateRefundForm(form({ amount: 'abc' }), preview(), NOW).errors).toEqual([
      { path: 'amount', code: 'invalid_amount' },
    ]);
    expect(validateRefundForm(form({ amount: '0' }), preview(), NOW).errors).toEqual([
      { path: 'amount', code: 'invalid_amount' },
    ]);
    expect(validateRefundForm(form({ amount: '15,01' }), preview(), NOW).errors).toEqual([
      { path: 'amount', code: 'exceeds_refundable' },
    ]);
    expect(validateRefundForm(form({ amount: '15,01' }), preview(), NOW).input).toBeNull();
  });

  it('requires a known reason', () => {
    expect(validateRefundForm(form({ reason: '' }), preview(), NOW).errors).toEqual([
      { path: 'reason', code: 'required' },
    ]);
    expect(REFUND_REASONS).toEqual([
      'CANCELLATION',
      'PRODUCT_REMOVED',
      'QUANTITY_REDUCED',
      'UNAVAILABLE',
      'RETURN',
      'OTHER',
    ]);
  });

  it('limits text lengths', () => {
    const r = validateRefundForm(
      form({ description: 'x'.repeat(5001), reference: 'y'.repeat(256) }),
      preview(),
      NOW
    );
    expect(r.errors).toEqual([
      { path: 'description', code: 'too_long' },
      { path: 'reference', code: 'too_long' },
    ]);
  });

  it('builds a store credit refund with its validity and conditions', () => {
    const r = validateRefundForm(
      form({ method: 'STORE_CREDIT', reference: 'ignored', conditions: ' Online only ' }),
      preview(),
      NOW
    );
    expect(r.errors).toEqual([]);
    expect(r.input).toEqual({
      method: 'STORE_CREDIT',
      amount: 1500,
      reason: 'RETURN',
      expiresAt: dateInputToIso('2027-11-11'),
      conditions: 'Online only',
    });
  });

  it('refuses a store credit validity in the past or malformed', () => {
    expect(
      validateRefundForm(form({ method: 'STORE_CREDIT', expiresAt: '2026-11-10' }), preview(), NOW).errors
    ).toEqual([{ path: 'expiresAt', code: 'invalid_date' }]);
    expect(
      validateRefundForm(form({ method: 'STORE_CREDIT', expiresAt: 'x' }), preview(), NOW).errors
    ).toEqual([{ path: 'expiresAt', code: 'invalid_date' }]);
  });

  it('only allows Stripe when available and within the Stripe refundable amount', () => {
    expect(validateRefundForm(form({ method: 'STRIPE', amount: '10' }), preview(), NOW)).toEqual({
      errors: [],
      input: { method: 'STRIPE', amount: 1000, reason: 'RETURN' },
    });
    expect(validateRefundForm(form({ method: 'STRIPE', amount: '10,01' }), preview(), NOW).errors).toEqual([
      { path: 'amount', code: 'exceeds_stripe_refundable' },
    ]);
    expect(
      validateRefundForm(form({ method: 'STRIPE', amount: '5' }), preview({ hasStripe: false }), NOW).errors
    ).toEqual([{ path: 'method', code: 'stripe_unavailable' }]);
  });
});

describe('F2 money cap', () => {
  it('defaults to store credit when nothing can go back as money', () => {
    expect(emptyRefundForm(preview(), 'pt-PT', NOW).method).toBe('MANUAL_TRANSFER');
    expect(emptyRefundForm(preview({ moneyRefundable: 0 }), 'pt-PT', NOW).method).toBe('STORE_CREDIT');
  });

  it('money methods are validated against moneyRefundable; store credit against refundable', () => {
    const p = preview({ moneyRefundable: 500, stripeRefundable: 500 });
    const manual = validateRefundForm(form({ method: 'MANUAL_TRANSFER', amount: '6,00' }), p, NOW);
    expect(manual.errors).toEqual([{ path: 'amount', code: 'exceeds_money_refundable' }]);
    const stripe = validateRefundForm(form({ method: 'STRIPE', amount: '6,00' }), p, NOW);
    expect(stripe.errors).toEqual([{ path: 'amount', code: 'exceeds_money_refundable' }]);
    expect(validateRefundForm(form({ method: 'MANUAL_TRANSFER', amount: '5,00' }), p, NOW).errors).toEqual([]);
    expect(validateRefundForm(form({ method: 'STORE_CREDIT', amount: '15,00' }), p, NOW).errors).toEqual([]);
  });

  it('has en + pt messages', () => {
    for (const k of [
      'ecommerce.orders.errors.exceeds_money_refundable',
      'ecommerce.orders.refund.summary.moneyRefundable',
      'ecommerce.orders.refund.moneyOnlyCredit',
      'ecommerce.orders.refunds.refresh',
      'ecommerce.orders.refunds.refreshed',
      'ecommerce.orders.refunds.refreshError',
      'ecommerce.orders.history.type.REFUND_OVER_REFUNDED',
      'ecommerce.orders.detail.summary.overRefunded',
    ]) {
      expect(en[P + k], k).toBeTruthy();
      expect(pt[P + k], k).toBeTruthy();
    }
  });
});

describe('isRefreshableStripeRefund (F5)', () => {
  it('is true only for a PROCESSING Stripe refund with a Stripe id', () => {
    expect(isRefreshableStripeRefund({ method: 'STRIPE', status: 'PROCESSING', externalId: 're_1' })).toBe(true);
    expect(isRefreshableStripeRefund({ method: 'STRIPE', status: 'PROCESSING', externalId: null })).toBe(false);
    expect(isRefreshableStripeRefund({ method: 'STRIPE', status: 'COMPLETED', externalId: 're_1' })).toBe(false);
    expect(isRefreshableStripeRefund({ method: 'MANUAL_TRANSFER', status: 'PROCESSING', externalId: 're_1' })).toBe(
      false
    );
  });
});

describe('isStuckStripeRefund', () => {
  it('is true only for a PROCESSING Stripe refund without a Stripe id', () => {
    expect(isStuckStripeRefund({ method: 'STRIPE', status: 'PROCESSING', externalId: null })).toBe(true);
    expect(isStuckStripeRefund({ method: 'STRIPE', status: 'PROCESSING', externalId: 're_1' })).toBe(false);
    expect(isStuckStripeRefund({ method: 'STRIPE', status: 'FAILED', externalId: null })).toBe(false);
    expect(isStuckStripeRefund({ method: 'MANUAL_TRANSFER', status: 'PROCESSING', externalId: null })).toBe(
      false
    );
  });
});

describe('defaultInstructionsText', () => {
  it('fills the translated example with the reference and the amount in the order locale', () => {
    const t = (id: string, values?: Record<string, string | number>) => `${id}${JSON.stringify(values)}`;
    expect(defaultInstructionsText(t, { reference: 1042, due: 1750, locale: 'pt-PT' })).toBe(
      `ecommerce.orders.instructions.defaultText${JSON.stringify({ reference: 1042, amount: '17,50 €' })}`
    );
  });

  it('has the example text in en and pt with both placeholders', () => {
    const key = `${P}ecommerce.orders.instructions.defaultText`;
    [en, pt].forEach((dict) => {
      expect(dict[key]).toContain('{reference}');
      expect(dict[key]).toContain('{amount}');
    });
  });
});

describe('store credit form', () => {
  it('defaults to a 12-month validity and builds the input', () => {
    const f = { ...emptyStoreCreditForm(NOW), amount: '20' };
    expect(f.expiresAt).toBe('2027-11-11');
    expect(validateStoreCreditForm(f, NOW)).toEqual({
      errors: [],
      input: { amount: 2000, expiresAt: dateInputToIso('2027-11-11') },
    });
  });

  it('refuses a missing amount, a past date and long conditions', () => {
    const r = validateStoreCreditForm(
      { amount: '', expiresAt: '2020-01-01', conditions: 'c'.repeat(5001) },
      NOW
    );
    expect(r.input).toBeNull();
    expect(r.errors).toEqual([
      { path: 'amount', code: 'invalid_amount' },
      { path: 'expiresAt', code: 'invalid_date' },
      { path: 'conditions', code: 'too_long' },
    ]);
  });
});

describe('storeCreditDisplayStatus', () => {
  const credit = { status: 'ACTIVE' as const, balance: 500, expiresAt: '2027-01-01T00:00:00.000Z' };
  it('shows VOID, EXPIRED, USED or ACTIVE', () => {
    expect(storeCreditDisplayStatus({ ...credit, status: 'VOID' }, NOW)).toBe('VOID');
    expect(storeCreditDisplayStatus({ ...credit, expiresAt: '2026-01-01T00:00:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(storeCreditDisplayStatus({ ...credit, balance: 0 }, NOW)).toBe('USED');
    expect(storeCreditDisplayStatus(credit, NOW)).toBe('ACTIVE');
    expect(storeCreditDisplayStatus({ ...credit, expiresAt: null }, NOW)).toBe('ACTIVE');
  });
});

describe('findNewNotification', () => {
  const n = (id: number, type: string): NotificationView => ({
    id,
    orderId: 1,
    type,
    eventId: null,
    recipient: null,
    locale: null,
    status: 'SENT',
    providerMessageId: null,
    error: null,
    attempts: 1,
    sentAt: null,
    createdAt: null,
  });
  it('returns the newest notification of the given types created after an id', () => {
    const list = [n(9, 'PAYMENT_INSTRUCTIONS'), n(8, 'SUPPLEMENTARY_PAYMENT'), n(3, 'PAYMENT_INSTRUCTIONS')];
    expect(findNewNotification(list, 5, ['PAYMENT_INSTRUCTIONS', 'SUPPLEMENTARY_PAYMENT'])?.id).toBe(9);
    expect(findNewNotification(list, 9, ['PAYMENT_INSTRUCTIONS'])).toBeNull();
    expect(findNewNotification(list, 0, ['ORDER_CONFIRMATION'])).toBeNull();
  });
});

describe('new UI strings', () => {
  it('every en key of the plan-4 order and customer UI exists in pt', () => {
    const prefixes = [
      `${P}ecommerce.orders.instructions.`,
      `${P}ecommerce.orders.refund.`,
      `${P}ecommerce.orders.refunds.`,
      `${P}ecommerce.orders.notifications.`,
      `${P}ecommerce.customers.storeCredits.`,
      `${P}ecommerce.settings.stripeWebhook.`,
    ];
    const keys = Object.keys(en).filter((k) => prefixes.some((p) => k.startsWith(p)));
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((k) => typeof pt[k] !== 'string')).toEqual([]);
  });

  it('the stuck-refund warning is translated', () => {
    expect(en[`${P}ecommerce.orders.refunds.stuck.warning`]).toBe(
      'Check the Stripe dashboard first. If this refund is older than 24 hours and already exists in Stripe, resuming it may refund the customer twice.'
    );
    expect(pt[`${P}ecommerce.orders.refunds.stuck.warning`]).toEqual(expect.any(String));
  });
});
