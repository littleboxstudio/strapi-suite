import { describe, it, expect } from 'vitest';
import {
  apiErrorDetail,
  actorLabel,
  financialSummaryRows,
  formatAddressLine,
  formatShippedProgress,
  historyEntryText,
  isActionUnavailable,
  pendingLabel,
  sortHistoryNewestFirst,
  API_ERROR_CODES,
  allowedToolbarActions,
  apiErrorCode,
  apiErrorMessageId,
  modifyBlockedByShipment,
  shouldRenewIdempotencyKey,
  linePromotionNames,
  promotionDisplayName,
  promotionRows,
  promotionsDiscountTotal,
  totalDiscount,
  unappliedPromotionCodes,
} from '../../../admin/src/ecommerce/utils/orderDetail';
import type {
  FinancialSummary,
  OrderHistoryItem,
  OrderPromotion,
  OrderTotals,
} from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

// Fake translator: `id` or `id{"k":v}` so assertions see both the key and the values.
const t = (id: string, values?: Record<string, unknown>) =>
  values ? `${id}${JSON.stringify(values)}` : id;
const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;

const entry = (overrides: Partial<OrderHistoryItem>): OrderHistoryItem => ({
  id: 1,
  type: 'ORDER_CREATED',
  description: 'Order created with 2 items',
  previousValue: null,
  newValue: null,
  actor: 'system',
  operationId: null,
  createdAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

describe('formatShippedProgress', () => {
  it('renders "ordered / shipped"', () => {
    expect(formatShippedProgress(10, 0)).toBe('10 / 0');
    expect(formatShippedProgress(10, 3)).toBe('10 / 3');
    expect(formatShippedProgress(10, 10)).toBe('10 / 10');
  });
});

describe('pendingLabel', () => {
  it('returns the pending message with the count when units are left to ship', () => {
    expect(pendingLabel(7)).toEqual({ id: 'ecommerce.orders.detail.lines.pending', values: { count: 7 } });
    expect(pendingLabel(1)).toEqual({ id: 'ecommerce.orders.detail.lines.pending', values: { count: 1 } });
  });

  it('returns null when nothing is pending', () => {
    expect(pendingLabel(0)).toBeNull();
    expect(pendingLabel(-1)).toBeNull();
  });

  it('is translated as "7 units left to ship" / "Faltam enviar 7 unidades"', () => {
    const key = 'littlebox-strapi-suite.ecommerce.orders.detail.lines.pending';
    expect(en[key].replace(/\{count, plural, one \{# unit\} other \{# units\}\}/, '7 units')).toBe(
      '7 units left to ship'
    );
    expect(pt[key].replace(/\{count, plural, one \{# unidade\} other \{# unidades\}\}/, '7 unidades')).toBe(
      'Faltam enviar 7 unidades'
    );
  });
});

describe('actorLabel', () => {
  it('shows an admin user as "Admin #<id>"', () => {
    expect(actorLabel('user:12', t)).toBe('ecommerce.orders.history.actor.user{"id":"12"}');
  });

  it('translates system, storefront and webhook actors', () => {
    expect(actorLabel('system', t)).toBe('ecommerce.orders.history.actor.system');
    expect(actorLabel('storefront', t)).toBe('ecommerce.orders.history.actor.storefront');
    expect(actorLabel('webhook:stripe', t)).toBe('ecommerce.orders.history.actor.webhook{"provider":"stripe"}');
  });

  it('falls back for a missing or unknown actor', () => {
    expect(actorLabel(null, t)).toBe('ecommerce.orders.history.actor.unknown');
    expect(actorLabel('cron', t)).toBe('cron');
  });

  it('has en + pt translations for every actor key', () => {
    ['user', 'system', 'storefront', 'webhook', 'unknown'].forEach((k) => {
      const key = `littlebox-strapi-suite.ecommerce.orders.history.actor.${k}`;
      expect(en[key]).toBeTruthy();
      expect(pt[key]).toBeTruthy();
    });
    expect(en['littlebox-strapi-suite.ecommerce.orders.history.actor.user']).toBe('Admin #{id}');
  });
});

describe('sortHistoryNewestFirst', () => {
  it('orders by date descending, then id descending, without mutating the input', () => {
    const list = [
      entry({ id: 1, createdAt: '2026-11-10T10:00:00.000Z' }),
      entry({ id: 3, createdAt: '2026-11-11T10:00:00.000Z' }),
      entry({ id: 2, createdAt: '2026-11-11T10:00:00.000Z' }),
    ];
    expect(sortHistoryNewestFirst(list).map((e) => e.id)).toEqual([3, 2, 1]);
    expect(list.map((e) => e.id)).toEqual([1, 3, 2]);
  });
});

describe('historyEntryText', () => {
  it('returns the translated type, the description and the actor', () => {
    const text = historyEntryText(entry({ actor: 'user:4' }), t, money);
    expect(text.title).toBe('ecommerce.orders.history.type.ORDER_CREATED');
    expect(text.description).toBe('Order created with 2 items');
    expect(text.actor).toBe('ecommerce.orders.history.actor.user{"id":"4"}');
    expect(text.change).toBeNull();
  });

  it('shows translated before/after for status changes', () => {
    expect(
      historyEntryText(
        entry({
          type: 'ORDER_STATUS_CHANGED',
          previousValue: { orderStatus: 'OPEN' },
          newValue: { orderStatus: 'CANCELLED' },
        }),
        t,
        money
      ).change
    ).toEqual({ before: 'ecommerce.orders.status.order.OPEN', after: 'ecommerce.orders.status.order.CANCELLED' });
    expect(
      historyEntryText(
        entry({
          type: 'PAYMENT_STATUS_CHANGED',
          previousValue: { paymentStatus: 'PENDING' },
          newValue: { paymentStatus: 'PAID' },
        }),
        t,
        money
      ).change
    ).toEqual({ before: 'ecommerce.orders.status.payment.PENDING', after: 'ecommerce.orders.status.payment.PAID' });
    expect(
      historyEntryText(
        entry({
          type: 'FULFILLMENT_STATUS_CHANGED',
          previousValue: { fulfillmentStatus: 'UNFULFILLED' },
          newValue: { fulfillmentStatus: 'FULFILLED' },
        }),
        t,
        money
      ).change
    ).toEqual({
      before: 'ecommerce.orders.status.fulfillment.UNFULFILLED',
      after: 'ecommerce.orders.status.fulfillment.FULFILLED',
    });
  });

  it('shows quantities for line changes (0 for an added or removed line)', () => {
    expect(
      historyEntryText(
        entry({ type: 'LINE_QUANTITY_CHANGED', previousValue: { quantity: 2 }, newValue: { quantity: 5 } }),
        t,
        money
      ).change
    ).toEqual({ before: '2', after: '5' });
    expect(
      historyEntryText(entry({ type: 'LINE_ADDED', previousValue: null, newValue: { quantity: 3 } }), t, money)
        .change
    ).toEqual({ before: '0', after: '3' });
    expect(
      historyEntryText(entry({ type: 'LINE_REMOVED', previousValue: { quantity: 4 }, newValue: null }), t, money)
        .change
    ).toEqual({ before: '4', after: '0' });
  });

  it('shows addresses on one line', () => {
    const a = {
      firstName: 'Ana',
      lastName: 'Silva',
      line1: 'Rua A 1',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
    };
    const b = { ...a, line1: 'Rua B 2', line2: '3º Esq', city: 'Porto', postalCode: '4000-001' };
    expect(
      historyEntryText(
        entry({
          type: 'ADDRESS_CHANGED',
          previousValue: { shippingAddress: a },
          newValue: { shippingAddress: b },
        }),
        t,
        money
      ).change
    ).toEqual({
      before: 'Ana Silva, Rua A 1, 1000-001 Lisboa, PT',
      after: 'Ana Silva, Rua B 2, 3º Esq, 4000-001 Porto, PT',
    });
    expect(
      historyEntryText(
        entry({ type: 'ADDRESS_CHANGED', previousValue: { billingAddress: null }, newValue: { billingAddress: a } }),
        t,
        money
      ).change
    ).toEqual({ before: '—', after: 'Ana Silva, Rua A 1, 1000-001 Lisboa, PT' });
  });

  it('shows money for shipping and order discount changes', () => {
    expect(
      historyEntryText(
        entry({
          type: 'SHIPPING_CHANGED',
          previousValue: { charged: 500, shippingOriginal: 500, shippingDiscount: 0 },
          newValue: { mode: 'MANUAL', previousCharged: 500, newCharged: 750 },
        }),
        t,
        money
      ).change
    ).toEqual({ before: '€5.00', after: '€7.50' });
    expect(
      historyEntryText(
        entry({
          type: 'ORDER_DISCOUNT_CHANGED',
          previousValue: { orderDiscount: 1000 },
          newValue: { orderDiscount: 400 },
        }),
        t,
        money
      ).change
    ).toEqual({ before: '€10.00', after: '€4.00' });
  });

  it('formats a registered return: units and approved value, total before → after', () => {
    const text = historyEntryText(
      entry({
        type: 'RETURN_REGISTERED',
        description: 'Return #3 registered: 900 cents',
        previousValue: { orderDiscount: 200, total: 5500 },
        newValue: {
          returnId: 3,
          lines: [
            { orderLineId: 1, quantity: 2, restock: true, value: 1000 },
            { orderLineId: 2, quantity: 1, restock: false, value: 500 },
          ],
          refundableValue: 1400,
          total: 4100,
        },
      }),
      t,
      money
    );
    expect(text.title).toBe('ecommerce.orders.history.type.RETURN_REGISTERED');
    expect(text.detail).toBe('ecommerce.orders.history.return{"units":3,"amount":"€14.00"}');
    expect(text.change).toEqual({ before: '€55.00', after: '€41.00' });
    expect(historyEntryText(entry({ type: 'RETURN_REGISTERED', newValue: { lines: 'x' } }), t, money).detail).toBeNull();
    expect(historyEntryText(entry({ type: 'ORDER_CREATED' }), t, money).detail).toBeNull();
  });

  it('has no change for malformed or other values', () => {
    expect(
      historyEntryText(entry({ type: 'ORDER_STATUS_CHANGED', previousValue: 'x', newValue: null }), t, money).change
    ).toBeNull();
    expect(
      historyEntryText(entry({ type: 'PAYMENT_CREATED', newValue: { amount: 100 } }), t, money).change
    ).toBeNull();
  });

  it('has en + pt titles for every history type the server records', () => {
    // Read from the server's OrderHistoryType union, so a new type cannot ship without a title.
    const source: string = require('fs').readFileSync(
      require('path').join(__dirname, '../../../server/src/services/modules/ecommerce/orderHistory.ts'),
      'utf8'
    );
    const union = source.slice(source.indexOf('export type OrderHistoryType'));
    const types = [...union.slice(0, union.indexOf(';')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(types).toContain('CREDIT_NOTE_ISSUED');
    types.forEach((type) => {
      const key = `littlebox-strapi-suite.ecommerce.orders.history.type.${type}`;
      expect(en[key], key).toBeTruthy();
      expect(pt[key], key).toBeTruthy();
    });
  });
});

describe('formatAddressLine', () => {
  it('joins the filled parts and returns a dash for no address', () => {
    expect(formatAddressLine(null)).toBe('—');
    expect(
      formatAddressLine({
        firstName: 'Ana',
        lastName: 'Silva',
        company: 'ACME',
        line1: 'Rua A 1',
        postalCode: '1000-001',
        city: 'Lisboa',
        country: 'PT',
      })
    ).toBe('Ana Silva, ACME, Rua A 1, 1000-001 Lisboa, PT');
  });
});

describe('financialSummaryRows', () => {
  const totals: OrderTotals = {
    itemsOriginal: 15000,
    productDiscount: 2000,
    subtotal: 13000,
    orderDiscount: 1300,
    shippingOriginal: 800,
    shippingDiscount: 800,
    shippingTotal: 0,
    total: 11700,
  };
  const summary: FinancialSummary = {
    orderTotal: 11700,
    total: 11700,
    paid: 10000,
    pendingPayments: 0,
    refunded: 0,
    net: 10000,
    due: 1700,
    excess: 0,
    overRefunded: 0,
  };

  it('F4: shows an over-refunded row only when > 0', () => {
    expect(financialSummaryRows(totals, summary).some((r) => r.key === 'overRefunded')).toBe(false);
    const rows = financialSummaryRows(totals, { ...summary, refunded: 2000, net: 8000, due: 0, overRefunded: 1000 });
    expect(rows.find((r) => r.key === 'overRefunded')).toEqual({ key: 'overRefunded', amount: 1000 });
  });

  it('lists every amount of the requirement example, discounts as negatives', () => {
    expect(financialSummaryRows(totals, summary)).toEqual([
      { key: 'itemsOriginal', amount: 15000 },
      { key: 'productDiscount', amount: -2000 },
      { key: 'orderDiscount', amount: -1300 },
      { key: 'subtotal', amount: 11700 },
      { key: 'shippingOriginal', amount: 800 },
      { key: 'shippingDiscount', amount: -800 },
      { key: 'totalDiscount', amount: -4100 },
      { key: 'total', amount: 11700, strong: true },
      { key: 'paid', amount: 10000 },
      { key: 'net', amount: 10000 },
      { key: 'due', amount: 1700, strong: true },
    ]);
  });

  it('hides zero discount and refund rows; shows refunds, pending payments and the refundable excess when present', () => {
    const rows = financialSummaryRows(
      { ...totals, productDiscount: 0, orderDiscount: 0, shippingDiscount: 0, subtotal: 15000, total: 15800 },
      { ...summary, refunded: 500, pendingPayments: 300, excess: 200, due: 0 }
    ).map((r) => r.key);
    expect(rows).toEqual([
      'itemsOriginal',
      'subtotal',
      'shippingOriginal',
      'total',
      'paid',
      'pendingPayments',
      'refunded',
      'net',
      'due',
      'excess',
    ]);
  });

  it('has en + pt labels for every row', () => {
    [
      'itemsOriginal',
      'productDiscount',
      'orderDiscount',
      'subtotal',
      'shippingOriginal',
      'shippingDiscount',
      'totalDiscount',
      'total',
      'paid',
      'pendingPayments',
      'refunded',
      'net',
      'due',
      'excess',
    ].forEach((k) => {
      const key = `littlebox-strapi-suite.ecommerce.orders.detail.summary.${k}`;
      expect(en[key], key).toBeTruthy();
      expect(pt[key], key).toBeTruthy();
    });
  });
});

describe('isActionUnavailable', () => {
  it('detects the ACTION_NOT_AVAILABLE validation error', () => {
    const err = (code: string) => ({ response: { data: { error: { details: { errors: [{ path: 'action', code }] } } } } });
    expect(isActionUnavailable(err('ACTION_NOT_AVAILABLE'))).toBe(true);
    expect(isActionUnavailable(err('required'))).toBe(false);
    expect(isActionUnavailable(new Error('network'))).toBe(false);
  });
});

describe('apiErrorCode / apiErrorMessageId', () => {
  const httpError = (status: number, error: unknown) => ({ response: { status, data: { error } } });

  it('reads details.code, then the first details.errors code', () => {
    expect(apiErrorCode(httpError(400, { details: { code: 'NOTHING_DUE' } }))).toBe('NOTHING_DUE');
    expect(
      apiErrorCode(httpError(409, { details: { code: 'IDEMPOTENCY_KEY_CONFLICT', errors: [] } }))
    ).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(apiErrorCode(httpError(400, { details: { errors: [{ path: 'code', code: 'STORE_CREDIT_VOID' }] } }))).toBe(
      'STORE_CREDIT_VOID'
    );
    expect(apiErrorCode(new Error('network'))).toBeNull();
  });

  it('maps known codes to a translation id and others to the fallback', () => {
    expect(apiErrorMessageId(httpError(400, { details: { code: 'STRIPE_NOT_CONFIGURED' } }), 'x.fallback')).toBe(
      'ecommerce.orders.errors.STRIPE_NOT_CONFIGURED'
    );
    expect(apiErrorMessageId(httpError(400, { details: { code: 'WHATEVER' } }), 'x.fallback')).toBe('x.fallback');
    expect(apiErrorMessageId(null, 'x.fallback')).toBe('x.fallback');
  });

  it('covers every code the plan-4 admin endpoints return', () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });

  it('covers every code the shipment and return endpoints return', () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });

  it('covers every code the invoicing endpoints return', () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining([
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
        'NOTHING_TO_INVOICE',
        'exceeds_creditable',
        'coverage_mismatch',
      ])
    );
  });

  it('points BILLING_NOT_CONFIGURED to Settings → Billing', () => {
    expect(en[`${P}ecommerce.orders.errors.BILLING_NOT_CONFIGURED`]).toMatch(/Settings → Billing/);
    expect(pt[`${P}ecommerce.orders.errors.BILLING_NOT_CONFIGURED`]).toMatch(/Configurações → Faturação/);
  });

  it.each(API_ERROR_CODES)('%s has an en and a pt message', (code) => {
    const key = `${P}ecommerce.orders.errors.${code}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });

  it('points EMAIL_NOT_CONFIGURED to Settings → E-mail', () => {
    expect(en[`${P}ecommerce.orders.errors.EMAIL_NOT_CONFIGURED`]).toMatch(/Settings/);
    expect(pt[`${P}ecommerce.orders.errors.EMAIL_NOT_CONFIGURED`]).toMatch(/Configurações/);
  });
});

describe('allowedToolbarActions', () => {
  const all = ['SHIP', 'MODIFY', 'CANCEL', 'REFUND', 'ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS', 'ARCHIVE'] as const;
  it('orders the actions and keeps each one behind its permission', () => {
    expect(allowedToolbarActions([...all], { canManage: true, canPay: true, canRefund: true })).toEqual([
      'SHIP',
      'MODIFY',
      'ADD_PAYMENT',
      'SEND_PAYMENT_INSTRUCTIONS',
      'REFUND',
      'CANCEL',
      'ARCHIVE',
    ]);
    expect(allowedToolbarActions([...all], { canManage: false, canPay: true, canRefund: false })).toEqual([
      'SEND_PAYMENT_INSTRUCTIONS',
    ]);
    expect(allowedToolbarActions([...all], { canManage: false, canPay: false, canRefund: true })).toEqual([
      'REFUND',
    ]);
    expect(allowedToolbarActions(['REFUND'], { canManage: true, canPay: true, canRefund: false })).toEqual([]);
  });

  it('offers SHIP and REGISTER_RETURN only with orders.manage', () => {
    const available = ['SHIP', 'REFUND', 'REGISTER_RETURN', 'INVOICE_TOTAL'] as const;
    expect(allowedToolbarActions([...available], { canManage: true, canPay: false, canRefund: true })).toEqual([
      'SHIP',
      'REFUND',
      'REGISTER_RETURN',
    ]);
    expect(allowedToolbarActions([...available], { canManage: false, canPay: true, canRefund: false })).toEqual([]);
  });
});

describe('modifyBlockedByShipment', () => {
  it('is true for an open order with a PENDING shipment', () => {
    expect(modifyBlockedByShipment({ orderStatus: 'OPEN', shipments: [{ status: 'PENDING' }] })).toBe(true);
    expect(modifyBlockedByShipment({ orderStatus: 'OPEN', shipments: [{ status: 'ACTIVE' }] })).toBe(false);
    expect(modifyBlockedByShipment({ orderStatus: 'CANCELLED', shipments: [{ status: 'PENDING' }] })).toBe(false);
  });
});

describe('shouldRenewIdempotencyKey', () => {
  const fetchError = (status: number, code?: string) =>
    Object.assign(new Error('x'), {
      status,
      response: { data: { error: { status, details: code ? { code } : {} } } },
    });

  it('a 4xx answer (the request was refused) → a new key for the next attempt', () => {
    expect(shouldRenewIdempotencyKey(fetchError(400, 'BILLING_TAX_NOT_FOUND'))).toBe(true);
    expect(shouldRenewIdempotencyKey(fetchError(409, 'PAYMENT_NOT_INVOICEABLE'))).toBe(true);
    expect(shouldRenewIdempotencyKey(fetchError(404))).toBe(true);
  });

  it('keeps the key on 408 / 429 (the request may not have been handled)', () => {
    expect(shouldRenewIdempotencyKey(fetchError(408))).toBe(false);
    expect(shouldRenewIdempotencyKey(fetchError(429))).toBe(false);
  });

  it('keeps the key on 5xx (a proxy may hide a recorded document) and without an answer', () => {
    expect(shouldRenewIdempotencyKey(fetchError(500))).toBe(false);
    expect(shouldRenewIdempotencyKey(fetchError(502))).toBe(false);
    expect(shouldRenewIdempotencyKey(fetchError(504))).toBe(false);
    expect(shouldRenewIdempotencyKey(new TypeError('Failed to fetch'))).toBe(false);
    expect(shouldRenewIdempotencyKey(new SyntaxError('Unexpected token <'))).toBe(false);
    expect(shouldRenewIdempotencyKey(undefined)).toBe(false);
  });

  it('reads the status from the error body when the error has none', () => {
    expect(shouldRenewIdempotencyKey({ response: { data: { error: { status: 400 } } } })).toBe(true);
    expect(shouldRenewIdempotencyKey({ response: { data: { error: { status: 503 } } } })).toBe(false);
  });
});

describe('totalDiscount', () => {
  it('sums the product, order and shipping discounts', () => {
    expect(
      totalDiscount({
        itemsOriginal: 15000,
        productDiscount: 2000,
        subtotal: 13000,
        orderDiscount: 1300,
        shippingOriginal: 800,
        shippingDiscount: 800,
        shippingTotal: 0,
        total: 11700,
      })
    ).toBe(4100);
  });

  it('has no totalDiscount row without discounts', () => {
    const rows = financialSummaryRows(
      {
        itemsOriginal: 1000,
        productDiscount: 0,
        subtotal: 1000,
        orderDiscount: 0,
        shippingOriginal: 0,
        shippingDiscount: 0,
        shippingTotal: 0,
        total: 1000,
      },
      { orderTotal: 1000, total: 1000, paid: 0, pendingPayments: 0, refunded: 0, net: 0, due: 1000, excess: 0, overRefunded: 0 }
    );
    expect(rows.some((r) => r.key === 'totalDiscount')).toBe(false);
  });
});

describe('order promotions', () => {
  const snapshot = {
    eligibility: { mode: 'ALL' },
    conditions: { type: 'GROUP', operator: 'AND', children: [] },
    stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
    priority: 0,
    perOrderLimit: null,
  };
  const promo = (over: Partial<OrderPromotion> = {}): OrderPromotion =>
    ({
      promotionId: 1,
      version: 1,
      name: 'Summer internal',
      displayName: { pt: 'Verão', en: 'Summer' },
      code: 'VERAO20',
      method: 'CODE',
      classes: ['PRODUCT_DISCOUNT', 'SHIPPING_DISCOUNT'],
      amount: 2800,
      benefits: [
        {
          index: 0,
          type: 'PRODUCT_PERCENT',
          class: 'PRODUCT_DISCOUNT',
          amount: 2000,
          params: { type: 'PRODUCT_PERCENT', target: { productIds: [1], variantIds: [] }, percent: 10, maxQuantity: null },
        },
        {
          index: 1,
          type: 'SHIPPING_FREE',
          class: 'SHIPPING_DISCOUNT',
          amount: 800,
          params: { type: 'SHIPPING_FREE', maxAmount: null },
        },
      ],
      snapshot,
      redemptionStatus: 'RESERVED',
      ...over,
    }) as OrderPromotion;

  it('promotionRows gives one row per benefit with its amount', () => {
    const rows = promotionRows([promo(), promo({ promotionId: 2, code: null, method: 'AUTOMATIC', amount: 1300, redemptionStatus: 'RELEASED', displayName: {}, benefits: [{ index: 0, type: 'ORDER_FIXED', class: 'ORDER_DISCOUNT', amount: 1300, params: { type: 'ORDER_FIXED', amount: 1300 } }] })], { locale: 'en' });
    expect(rows).toEqual([
      expect.objectContaining({ key: '1-0', promotionId: 1, displayName: 'Summer', name: 'Summer internal', code: 'VERAO20', method: 'CODE', discountClass: 'PRODUCT_DISCOUNT', amount: 2000, released: false }),
      expect.objectContaining({ key: '1-1', promotionId: 1, discountClass: 'SHIPPING_DISCOUNT', amount: 800, benefit: { type: 'SHIPPING_FREE', maxAmount: null } }),
      expect.objectContaining({ key: '2-0', promotionId: 2, displayName: null, code: null, method: 'AUTOMATIC', discountClass: 'ORDER_DISCOUNT', amount: 1300, released: true }),
    ]);
  });

  it('promotionRows reads a legacy or missing list as empty', () => {
    expect(promotionRows(undefined as unknown as OrderPromotion[], { locale: 'pt' })).toEqual([]);
    expect(promotionRows([promo({ benefits: undefined as any })], { locale: 'pt' })).toEqual([]);
  });

  it('promotionDisplayName: order locale, then default locale, then null', () => {
    expect(promotionDisplayName(promo(), 'pt', 'en')).toBe('Verão');
    expect(promotionDisplayName(promo({ displayName: { en: 'Summer', pt: '  ' } }), 'pt', 'en')).toBe('Summer');
    expect(promotionDisplayName(promo({ displayName: { fr: 'Été' } }), 'pt', 'en')).toBeNull();
    expect(promotionDisplayName(promo({ displayName: { en: 'Summer' } }), 'pt')).toBeNull();
  });

  it('promotionsDiscountTotal sums the stored amounts', () => {
    expect(promotionsDiscountTotal([promo(), promo({ promotionId: 2, amount: 1300 })])).toBe(4100);
    expect(promotionsDiscountTotal([])).toBe(0);
  });

  it('linePromotionNames maps the line promotion ids to labels, skipping unknown ids', () => {
    const list = [promo(), promo({ promotionId: 2, displayName: {}, name: 'Internal two' })];
    expect(linePromotionNames([1, 2, 9], list, { locale: 'en' })).toEqual(['Summer', 'Internal two']);
    expect(linePromotionNames(undefined as unknown as number[], list, { locale: 'en' })).toEqual([]);
  });

  it('has en + pt labels for the section, classes, code statuses and history types', () => {
    [
      'ecommerce.orders.detail.summary.totalDiscount',
      'ecommerce.orders.promotions.columns.promotion',
      'ecommerce.orders.promotions.columns.method',
      'ecommerce.orders.promotions.columns.type',
      'ecommerce.orders.promotions.columns.benefit',
      'ecommerce.orders.promotions.columns.amount',
      'ecommerce.orders.promotions.released',
      'ecommerce.orders.promotions.total',
      'ecommerce.orders.promotions.empty',
      'ecommerce.orders.promotions.fallbackName',
      'ecommerce.orders.promotions.classes.PRODUCT_DISCOUNT',
      'ecommerce.orders.promotions.classes.ORDER_DISCOUNT',
      'ecommerce.orders.promotions.classes.SHIPPING_DISCOUNT',
      'ecommerce.orders.detail.lines.unitDiscount',
      'ecommerce.orders.history.type.PROMOTIONS_APPLIED',
      'ecommerce.orders.history.type.PROMOTIONS_RELEASED',
      ...[
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
      ].map((s) => `ecommerce.orders.promotions.codeStatus.${s}`),
    ].forEach((k) => {
      expect(en[`${P}${k}`], k).toEqual(expect.any(String));
      expect(pt[`${P}${k}`], k).toEqual(expect.any(String));
    });
    expect(en[`${P}ecommerce.orders.promotions.fallbackName`]).toBe('Promotion');
    expect(pt[`${P}ecommerce.orders.promotions.fallbackName`]).toBe('Promoção');
  });

  it('API_ERROR_CODES covers the promotion codes of order create and quote', () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'PROMOTION_UNAVAILABLE',
        'PROMOTION_CODE_INVALID',
        'TOTAL_CHANGED',
        'too_many',
        'invalid_email',
        'invalid_country',
      ])
    );
  });
});

describe('unappliedPromotionCodes', () => {
  it('lists the entered codes that did not apply, with their status', () => {
    expect(
      unappliedPromotionCodes([
        { code: 'VERAO20', status: 'APPLIED', promotionId: 1 },
        { code: 'COAT', status: 'NO_BENEFIT', promotionId: 2 },
        { code: 'NOPE', status: 'NOT_FOUND', promotionId: null },
      ])
    ).toEqual([
      { code: 'COAT', status: 'NO_BENEFIT', promotionId: 2 },
      { code: 'NOPE', status: 'NOT_FOUND', promotionId: null },
    ]);
  });

  it('reads a missing list (older server) as empty', () => {
    expect(unappliedPromotionCodes(undefined)).toEqual([]);
  });

  it('has en + pt labels for the entered codes block', () => {
    expect(en[`${P}ecommerce.orders.promotions.enteredCodes`]).toEqual(expect.any(String));
    expect(pt[`${P}ecommerce.orders.promotions.enteredCodes`]).toEqual(expect.any(String));
  });

  it('drops the orphan placeholder key', () => {
    expect(en[`${P}ecommerce.orders.detail.sections.empty`]).toBeUndefined();
    expect(pt[`${P}ecommerce.orders.detail.sections.empty`]).toBeUndefined();
  });
});

describe('apiErrorDetail', () => {
  const answer = (code: string, message: string) => ({
    response: { data: { error: { message, details: { code } } } },
  });

  it('the provider message of a billing refusal', () => {
    expect(apiErrorDetail(answer('BILLING_REQUEST_FAILED', 'Moloni rejected invoices/insert (vat:2).'))).toBe(
      'Moloni rejected invoices/insert (vat:2).'
    );
  });

  it('nothing when the message is the code, or the error is not from billing', () => {
    expect(apiErrorDetail(answer('BILLING_UNREACHABLE', 'BILLING_UNREACHABLE'))).toBeNull();
    expect(apiErrorDetail(answer('ORDER_NOT_FOUND', 'Not found'))).toBeNull();
    expect(apiErrorDetail(new Error('network'))).toBeNull();
  });
});
