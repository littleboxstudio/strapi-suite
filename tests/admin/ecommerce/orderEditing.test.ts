import { describe, it, expect } from 'vitest';
import {
  balanceActions,
  canEdit,
  discountSelectionToggle,
  hasRowActions,
  manualDiscountDraftToInput,
  reviewAlertDate,
  reviewAlerts,
  shippingLineRows,
} from '../../../admin/src/ecommerce/utils/orderEditing';
import type {
  DiscountRow,
  Order,
  OrderEditAction,
  OrderEditing,
  ShippingLineView,
} from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

const editing = (over: Partial<OrderEditing> = {}): OrderEditing => ({
  editable: true,
  blockedBy: null,
  hasShipments: false,
  actions: ['ADD_PRODUCTS', 'EDIT_SHIPPING_LINE', 'RECALCULATE_DISCOUNTS'],
  ...over,
});

const order = (over: Record<string, unknown> = {}): Order =>
  ({
    orderStatus: 'OPEN',
    editing: editing(),
    reviewFlags: [],
    availableActions: [],
    summary: { due: 0, excess: 0 },
    ...over,
  }) as unknown as Order;

const line = (over: Partial<ShippingLineView> = {}): ShippingLineView => ({
  id: 1,
  origin: 'CHECKOUT',
  amount: 500,
  providerId: 'manual',
  serviceId: 'std',
  name: 'Standard',
  tax: 23,
  createdAt: '2026-01-01T00:00:00.000Z',
  actor: 'system',
  paid: false,
  invoiced: false,
  spent: false,
  ...over,
});

const row = (over: Partial<DiscountRow> = {}): DiscountRow => ({
  key: 'p:1',
  kind: 'APPLIED_VALID',
  promotionId: 1,
  manualId: null,
  name: 'Summer',
  displayName: {},
  code: null,
  method: 'AUTOMATIC',
  classes: ['ORDER_DISCOUNT'],
  currentAmount: 100,
  amount: 100,
  invalidReason: null,
  selected: true,
  locked: null,
  ...over,
});

describe('canEdit', () => {
  it('follows editing.actions', () => {
    const o = order();
    expect(canEdit(o, 'ADD_PRODUCTS')).toBe(true);
    expect(canEdit(o, 'EDIT_ADDRESS' as OrderEditAction)).toBe(false);
    expect(canEdit(order({ editing: editing({ editable: false, actions: [] }) }), 'ADD_PRODUCTS')).toBe(false);
  });
});

describe('reviewAlerts', () => {
  const flags = [
    { code: 'DISCOUNTS_REVIEW', reason: 'SHIPPING_CHANGED', raisedAt: 'b', actor: 'x' },
    { code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED', raisedAt: 'a', actor: 'x' },
  ];

  it('lists shipments first; open orders are actionable and not dismissable', () => {
    const alerts = reviewAlerts(order({ reviewFlags: flags }));
    expect(alerts).toEqual([
      {
        code: 'SHIPPING_REVIEW',
        reasonKey: 'ecommerce.orders.review.reason.PRODUCTS_CHANGED',
        raisedAt: 'a',
        sectionId: 'order-section-shipments',
        actionable: true,
        dismissable: false,
      },
      {
        code: 'DISCOUNTS_REVIEW',
        reasonKey: 'ecommerce.orders.review.reason.SHIPPING_CHANGED',
        raisedAt: 'b',
        sectionId: 'order-section-promotions',
        actionable: true,
        dismissable: false,
      },
    ]);
  });

  it('a cancelled order cannot act on the flag but can dismiss it', () => {
    const alerts = reviewAlerts(
      order({
        reviewFlags: flags,
        editing: editing({ editable: false, blockedBy: 'CANCELLED', actions: [] }),
      })
    );
    expect(alerts.map((a) => [a.actionable, a.dismissable])).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it('has no alerts without flags', () => {
    expect(reviewAlerts(order())).toEqual([]);
  });
});

describe('shippingLineRows', () => {
  it('badges follow paid / invoiced / spent', () => {
    const rows = shippingLineRows(
      [line({ paid: true, invoiced: true, spent: true }), line({ id: 2, paid: true })],
      editing(),
      true
    );
    expect(rows[0].badges).toEqual(['PAID', 'INVOICED', 'SPENT']);
    expect(rows[1].badges).toEqual(['PAID']);
  });

  it('offers EDIT only with the edit action and orders.manage', () => {
    const lines = [line()];
    expect(shippingLineRows(lines, editing(), true)[0].actions).toEqual(['EDIT']);
    expect(shippingLineRows(lines, editing(), false)[0].actions).toEqual([]);
    expect(shippingLineRows(lines, editing({ actions: ['ADD_PRODUCTS'] }), true)[0].actions).toEqual([]);
  });

  it('hasRowActions is false when no row has one', () => {
    expect(hasRowActions(shippingLineRows([line()], editing(), false))).toBe(false);
    expect(hasRowActions(shippingLineRows([line()], editing(), true))).toBe(true);
    expect(hasRowActions([])).toBe(false);
  });
});

describe('discountSelectionToggle', () => {
  it('adds and removes a row', () => {
    expect(discountSelectionToggle(['p:1'], row({ key: 'p:2' }))).toEqual(['p:1', 'p:2']);
    expect(discountSelectionToggle(['p:1', 'p:2'], row({ key: 'p:2' }))).toEqual(['p:1']);
  });

  it('never removes a locked row', () => {
    const locked = row({ key: 'p:3', locked: 'GIFT_SHIPPED' });
    expect(discountSelectionToggle(['p:1', 'p:3'], locked)).toEqual(['p:1', 'p:3']);
    expect(discountSelectionToggle(['p:1'], locked)).toEqual(['p:1', 'p:3']);
  });
});

describe('manualDiscountDraftToInput', () => {
  it('parses a percent with a comma or a dot', () => {
    expect(manualDiscountDraftToInput({ kind: 'PERCENT', value: '10,5', reason: 'x' })).toEqual({
      input: { kind: 'PERCENT', value: 10.5, reason: 'x' },
      errors: [],
    });
    expect(manualDiscountDraftToInput({ kind: 'PERCENT', value: '10.25', reason: 'x' }).input?.value).toBe(10.25);
  });

  it('parses euros as cents', () => {
    expect(manualDiscountDraftToInput({ kind: 'FIXED', value: '5,00', reason: 'x' })).toEqual({
      input: { kind: 'FIXED', value: 500, reason: 'x' },
      errors: [],
    });
  });

  it('requires a reason (trimmed)', () => {
    const r = manualDiscountDraftToInput({ kind: 'FIXED', value: '5', reason: '  ' });
    expect(r.input).toBeNull();
    expect(r.errors).toEqual([{ path: 'reason', code: 'required' }]);
  });

  it('rejects bad values', () => {
    expect(manualDiscountDraftToInput({ kind: 'FIXED', value: 'abc', reason: 'x' }).errors).toEqual([
      { path: 'value', code: 'INVALID_AMOUNT' },
    ]);
    expect(manualDiscountDraftToInput({ kind: 'FIXED', value: '0', reason: 'x' }).errors).toEqual([
      { path: 'value', code: 'INVALID_AMOUNT' },
    ]);
    expect(manualDiscountDraftToInput({ kind: 'PERCENT', value: '101', reason: 'x' }).errors).toEqual([
      { path: 'value', code: 'INVALID_PERCENT' },
    ]);
    expect(manualDiscountDraftToInput({ kind: 'PERCENT', value: '10.255', reason: 'x' }).errors).toEqual([
      { path: 'value', code: 'INVALID_PERCENT' },
    ]);
    expect(manualDiscountDraftToInput({ kind: 'PERCENT', value: '0', reason: 'x' }).errors).toEqual([
      { path: 'value', code: 'INVALID_PERCENT' },
    ]);
  });

  it('rejects a reason over 200 characters', () => {
    const r = manualDiscountDraftToInput({ kind: 'FIXED', value: '5', reason: 'a'.repeat(201) });
    expect(r.errors).toEqual([{ path: 'reason', code: 'too_long' }]);
  });
});

describe('balanceActions', () => {
  const all = { canManage: true, canPay: true, canRefund: true };

  it('owed: add payment and send instructions, behind their permissions', () => {
    const o = order({ summary: { due: 500, excess: 0 }, availableActions: ['ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS'] });
    expect(balanceActions(o, all)).toEqual(['ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS']);
    expect(balanceActions(o, { canManage: true, canPay: false, canRefund: true })).toEqual(['ADD_PAYMENT']);
  });

  it('refundable: refund only with refunds.manage', () => {
    const o = order({ summary: { due: 0, excess: 300 }, availableActions: ['REFUND'] });
    expect(balanceActions(o, all)).toEqual(['REFUND']);
    expect(balanceActions(o, { canManage: true, canPay: true, canRefund: false })).toEqual([]);
  });

  it('nothing when settled', () => {
    expect(balanceActions(order({ availableActions: ['REFUND', 'ADD_PAYMENT'] }), all)).toEqual([]);
  });
});

describe('translations', () => {
  const keys = [
    'ecommerce.orders.review.reason.PRODUCTS_CHANGED',
    'ecommerce.orders.review.reason.ADDRESS_CHANGED',
    'ecommerce.orders.review.reason.SHIPPING_CHANGED',
    'ecommerce.orders.review.reason.SHIPPING_QUOTE_FAILED',
    'ecommerce.orders.errors.OPERATION_ID_CONFLICT',
    'ecommerce.orders.errors.ORDER_NOT_EDITABLE',
    'ecommerce.orders.errors.ORDER_HAS_SHIPMENTS',
    'ecommerce.orders.errors.REVIEW_FLAG_NOT_DISMISSABLE',
    'ecommerce.orders.errors.PROMOTIONS_NOT_COMBINABLE',
    'ecommerce.orders.errors.PROMOTION_GIFT_SHIPPED',
    'ecommerce.orders.errors.COUNTRY_NOT_SERVED',
    'ecommerce.orders.errors.SHIPPING_METHOD_UNAVAILABLE',
    'ecommerce.orders.errors.DISCOUNT_EXCEEDS_PRODUCTS',
    'ecommerce.orders.errors.SHIPPING_LINE_NOT_FOUND',
    'ecommerce.orders.errors.MANUAL_DISCOUNT_NOT_FOUND',
    'ecommerce.orders.errors.INVALID_PERCENT',
  ];
  it.each(keys)('%s exists in en and pt', (key) => {
    const id = `littlebox-strapi-suite.${key}`;
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });
});

describe('reviewAlertDate', () => {
  it('returns valid dates and null for empty or unparseable values', () => {
    expect(reviewAlertDate('2026-11-13T10:00:00.000Z')).toBe('2026-11-13T10:00:00.000Z');
    expect(reviewAlertDate('')).toBeNull();
    expect(reviewAlertDate(null)).toBeNull();
    expect(reviewAlertDate('nope')).toBeNull();
  });
});

describe('balance action texts', () => {
  const en = require('../../../admin/src/core/translations/en.json');
  const pt = require('../../../admin/src/core/translations/pt.json');
  it('every action balanceActions can return has a label in en and pt', () => {
    const all = { canManage: true, canPay: true, canRefund: true };
    const o = order({
      summary: { due: 5, excess: 5 } as any,
      availableActions: ['ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS', 'REFUND'] as any,
    });
    const actions = balanceActions(o, all);
    expect(actions.length).toBeGreaterThan(0);
    actions.forEach((a) => {
      const key = `littlebox-strapi-suite.ecommerce.orders.detail.actions.${a}`;
      expect(en[key], key).toBeTruthy();
      expect(pt[key], key).toBeTruthy();
    });
  });
});
