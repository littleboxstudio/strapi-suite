import { describe, it, expect } from 'vitest';
import {
  addressLockReason,
  allowedCountryCodes,
  balanceActions,
  canEdit,
  currentShippingMethod,
  defaultShippingOptionKey,
  shippingAddressErrors,
  shippingLineAmount,
  shippingLineDraftToInput,
  shippingLineEditUnchanged,
  shippingLineErrorKey,
  shippingOptionKey,
  discountConflictNames,
  discountsSaveErrorId,
  discountRowGroups,
  discountSelectionToggle,
  hasRowActions,
  manualDiscountPercent,
  discountPercentFromInput,
  manualLineDiscountRows,
  manualLineDiscountTotal,
  formatLineDiscount,
  lineUnitDiscount,
  parseDiscountPercent,
  percentToInput,
  manualDiscountRows,
  manualDiscountBase,
  canAddManualDiscount,
  orderDiscountTotal,
  manualDiscountDraftToInput,
  deliveryAlert,
  reviewAlertDate,
  reviewAlerts,
  shippingLineRows,
} from '../../../admin/src/ecommerce/utils/orderEditing';
import type {
  DiscountRow,
  ManualDiscount,
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
        messageKey: 'ecommerce.orders.review.SHIPPING_REVIEW',
        reasonKey: 'ecommerce.orders.review.reason.PRODUCTS_CHANGED',
        raisedAt: 'a',
        sectionId: 'order-section-shipping-charges',
        actionable: true,
        dismissable: false,
        locked: false,
      },
      {
        code: 'DISCOUNTS_REVIEW',
        messageKey: 'ecommerce.orders.review.DISCOUNTS_REVIEW',
        reasonKey: 'ecommerce.orders.review.reason.SHIPPING_CHANGED',
        raisedAt: 'b',
        sectionId: 'order-section-promotions',
        actionable: true,
        dismissable: false,
        locked: false,
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
    expect(alerts.map((a) => [a.actionable, a.dismissable, a.locked])).toEqual([
      [false, true, true],
      [false, true, true],
    ]);
  });

  it('has no alerts without flags', () => {
    expect(reviewAlerts(order())).toEqual([]);
  });

  it('REFUND_REVIEW (plan 15): last, on the refunds section, dismissable on an open order, never locked', () => {
    const alerts = reviewAlerts(
      order({
        reviewFlags: [
          { code: 'REFUND_REVIEW', reason: 'REFUND_REVERSED_WITH_CREDIT_NOTE', raisedAt: 'c', actor: 'webhook:stripe' },
          ...flags,
        ] as any,
      })
    );
    expect(alerts.map((a) => a.code)).toEqual(['SHIPPING_REVIEW', 'DISCOUNTS_REVIEW', 'REFUND_REVIEW']);
    expect(alerts[2]).toEqual({
      code: 'REFUND_REVIEW',
      messageKey: 'ecommerce.orders.review.REFUND_REVIEW',
      reasonKey: 'ecommerce.orders.review.reason.REFUND_REVERSED_WITH_CREDIT_NOTE',
      raisedAt: 'c',
      sectionId: 'order-section-refunds',
      actionable: false,
      dismissable: true,
      locked: false,
    });
    const closed = reviewAlerts(
      order({
        reviewFlags: [
          { code: 'REFUND_REVIEW', reason: 'REFUND_REVERSED_WITH_CREDIT_NOTE', raisedAt: 'c', actor: 'x' },
        ] as any,
        editing: editing({ editable: false, blockedBy: 'ARCHIVED', actions: [] }),
      })
    );
    expect(closed[0]).toMatchObject({ dismissable: true, locked: false });
  });

  it('REFUND_REVIEW for elements a late Stripe success finds used: its own message and reason', () => {
    const [alert] = reviewAlerts(
      order({
        reviewFlags: [
          { code: 'REFUND_REVIEW', reason: 'REFUND_ELEMENTS_CONFLICT', raisedAt: 'c', actor: 'webhook:stripe' },
        ] as any,
      })
    );
    expect(alert).toMatchObject({
      code: 'REFUND_REVIEW',
      messageKey: 'ecommerce.orders.review.REFUND_ELEMENTS_CONFLICT',
      reasonKey: 'ecommerce.orders.review.reason.REFUND_ELEMENTS_CONFLICT',
      sectionId: 'order-section-refunds',
      dismissable: true,
      locked: false,
    });
    // The edit flags keep the message of their code.
    expect(reviewAlerts(order({ reviewFlags: flags as any })).map((a) => a.messageKey)).toEqual([
      'ecommerce.orders.review.SHIPPING_REVIEW',
      'ecommerce.orders.review.DISCOUNTS_REVIEW',
    ]);
  });
});

describe('deliveryAlert', () => {
  const shipment = (status: string, deliveryStatus: string | null) => ({ id: 1, status, deliveryStatus });

  it('counts the ACTIVE shipments not yet delivered, linked to the shipments section', () => {
    const o = order({
      shipments: [
        shipment('ACTIVE', 'IN_TRANSIT'),
        shipment('ACTIVE', null),
        shipment('ACTIVE', 'EXCEPTION'),
        shipment('ACTIVE', 'DELIVERED'),
      ],
    });
    expect(deliveryAlert(o)).toEqual({
      count: 3,
      messageKey: 'ecommerce.orders.deliveryPending.text',
      sectionId: 'order-section-shipments',
    });
  });

  it('PENDING, FAILED and CANCELLED shipments do not count', () => {
    const o = order({
      shipments: [shipment('PENDING', null), shipment('FAILED', null), shipment('CANCELLED', null)],
    });
    expect(deliveryAlert(o)).toBeNull();
  });

  it('none when every ACTIVE shipment is delivered, or there are no shipments', () => {
    expect(deliveryAlert(order({ shipments: [shipment('ACTIVE', 'DELIVERED')] }))).toBeNull();
    expect(deliveryAlert(order({ shipments: [] }))).toBeNull();
    expect(deliveryAlert(order())).toBeNull();
  });

  it('only on OPEN orders', () => {
    for (const orderStatus of ['CANCELLED', 'ARCHIVED']) {
      expect(deliveryAlert(order({ orderStatus, shipments: [shipment('ACTIVE', 'IN_TRANSIT')] }))).toBeNull();
    }
  });

  it('the message exists in en and pt with a plural count', () => {
    const id = 'littlebox-strapi-suite.ecommerce.orders.deliveryPending.text';
    expect(en[id]).toContain('{count, plural,');
    expect(pt[id]).toContain('{count, plural,');
  });
});

describe('shippingLineRows', () => {
  it('badges: paid or unpaid (a correction is neither), and invoiced; never shipped', () => {
    const rows = shippingLineRows(
      [
        line({ paid: true, invoiced: true, spent: true }),
        line({ id: 2, paid: true }),
        line({ id: 3, spent: true }),
        line({ id: 4, origin: 'EDIT', amount: -100, editOf: 3 }),
      ],
      editing(),
      true
    );
    expect(rows.map((r) => [r.line.id, r.badges])).toEqual([
      [1, ['PAID', 'INVOICED']],
      [2, ['PAID']],
      [3, ['UNPAID']],
      [4, []],
    ]);
  });

  it('offers REMOVE on an unpaid, uninvoiced charge, never on the last one', () => {
    const rows = shippingLineRows(
      [line({ id: 1, paid: true }), line({ id: 2 }), line({ id: 3, invoiced: true })],
      editing(),
      true
    );
    expect(rows.map((r) => [r.line.id, r.actions])).toEqual([
      [1, []],
      [2, ['EDIT', 'REMOVE']],
      [3, ['EDIT']],
    ]);
    expect(shippingLineRows([line()], editing(), true)[0].actions).toEqual(['EDIT']);
  });

  it('offers EDIT only with the edit action and orders.manage', () => {
    const lines = [line()];
    expect(shippingLineRows(lines, editing(), true)[0].actions).toEqual(['EDIT']);
    expect(shippingLineRows(lines, editing(), false)[0].actions).toEqual([]);
    // A paid line is never edited.
    expect(shippingLineRows([{ ...lines[0], paid: true }], editing(), true)[0].actions).toEqual([]);
    expect(shippingLineRows(lines, editing({ actions: ['ADD_PRODUCTS'] }), true)[0].actions).toEqual([]);
  });

  it('never offers EDIT on a correction line', () => {
    const rows = shippingLineRows([line(), line({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 })], editing(), true);
    expect(rows.map((r) => [r.line.id, r.actions])).toEqual([
      [1, ['EDIT']],
      [2, []],
    ]);
  });

  it('lists each correction under its target, so the main amounts add up to the charge', () => {
    const lines = [
      line({ id: 1, amount: 400, effectiveAmount: 700 }),
      line({ id: 2, origin: 'MANUAL', amount: 300 }),
      line({ id: 3, origin: 'EDIT', amount: 200, editOf: 1 }),
      line({ id: 4, origin: 'EDIT', amount: 100, editOf: 1 }),
      line({ id: 5, origin: 'EDIT', amount: -50, editOf: 9 }),
    ];
    const rows = shippingLineRows(lines, editing(), true);
    expect(rows.map((r) => [r.line.id, r.correctionOf, r.now])).toEqual([
      [1, null, 700],
      [3, 1, null],
      [4, 1, null],
      [2, null, null],
      [5, 9, null],
    ]);
    expect(rows.reduce((sum, r) => sum + r.line.amount, 0)).toBe(950);
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
    'ecommerce.orders.errors.SHIPPING_LINE_PAID',
    'ecommerce.orders.errors.SHIPPING_LINE_LOCKED',
    'ecommerce.orders.errors.CREDIT_EXCEEDS_INVOICE',
    'ecommerce.orders.errors.BILLING_ADDRESS_LOCKED',
    'ecommerce.orders.address.billingLocked.INVOICED',
    'ecommerce.orders.address.billingLocked.CANCELLED',
    'ecommerce.orders.address.billingLocked.ARCHIVED',
    'ecommerce.orders.errors.MANUAL_DISCOUNT_NOT_FOUND',
    'ecommerce.orders.errors.INVALID_PERCENT',
    'ecommerce.orders.products.saved',
    'ecommerce.orders.discounts.errors.PROMOTION_UNAVAILABLE',
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

describe('addressLockReason', () => {
  it('is null while the address can be edited', () => {
    expect(addressLockReason(editing())).toBeNull();
  });
  it('prefers the block reason, then HAS_SHIPMENTS', () => {
    expect(addressLockReason(editing({ editable: false, blockedBy: 'CANCELLED', hasShipments: true }))).toBe(
      'CANCELLED'
    );
    expect(addressLockReason(editing({ hasShipments: true }))).toBe('HAS_SHIPMENTS');
  });
});

describe('allowedCountryCodes', () => {
  it('keeps the served countries and adds the current one when missing', () => {
    expect(allowedCountryCodes(['PT', 'ES'], 'PT')).toEqual(['PT', 'ES']);
    expect(allowedCountryCodes(['PT'], 'fr')).toEqual(['PT', 'FR']);
    expect(allowedCountryCodes(['PT'], ' ')).toEqual(['PT']);
  });
});

describe('shippingAddressErrors', () => {
  it('flags the empty required fields under address.*', () => {
    const form = {
      firstName: 'Ana',
      lastName: ' ',
      company: '',
      nif: '',
      line1: 'Rua 1',
      line2: '',
      postalCode: '1000-001',
      city: '',
      country: 'PT',
      phone: '',
    };
    expect(shippingAddressErrors(form)).toEqual([
      { path: 'address.lastName', code: 'required' },
      { path: 'address.city', code: 'required' },
    ]);
  });
});

describe('shippingLineAmount', () => {
  it('shows the corrected amount when the line has corrections', () => {
    expect(shippingLineAmount(line({ amount: 500 }))).toBe(500);
    expect(shippingLineAmount(line({ amount: 500, effectiveAmount: 700 }))).toBe(700);
    expect(shippingLineAmount(line({ amount: 500, effectiveAmount: 0 }))).toBe(0);
  });
});

describe('currentShippingMethod', () => {
  it('is the newest line that chose a method; recalculation lines inherit it', () => {
    const lines = [
      line({ id: 1, origin: 'CHECKOUT', providerId: 'ctt', serviceId: 'a' }),
      line({ id: 2, origin: 'EDIT', providerId: 'dpd', serviceId: 'b' }),
      line({ id: 3, origin: 'RECALCULATION', providerId: 'ctt', serviceId: 'a' }),
    ];
    expect(currentShippingMethod(lines)).toEqual({ providerId: 'dpd', serviceId: 'b' });
    expect(currentShippingMethod([])).toBeNull();
  });

  it('of the CREATE lines only the first sets the method; a later edit still does', () => {
    const create = [
      line({ id: 1, origin: 'CREATE', providerId: 'ctt', serviceId: 'a' }),
      line({ id: 2, origin: 'CREATE', providerId: 'dpd', serviceId: 'b' }),
      line({ id: 3, origin: 'CREATE', providerId: 'manual', serviceId: 'c' }),
    ];
    expect(currentShippingMethod(create)).toEqual({ providerId: 'ctt', serviceId: 'a' });
    // Out of order: the lowest id is the first one.
    expect(currentShippingMethod([create[2], create[1], create[0]])).toEqual({ providerId: 'ctt', serviceId: 'a' });
    expect(
      currentShippingMethod([...create, line({ id: 4, origin: 'MANUAL', providerId: 'dpd', serviceId: 'b' })])
    ).toEqual({ providerId: 'dpd', serviceId: 'b' });
    expect(
      currentShippingMethod([...create, line({ id: 4, origin: 'RECALCULATION', providerId: 'x', serviceId: 'y' })])
    ).toEqual({ providerId: 'ctt', serviceId: 'a' });
  });

  it('an edited delivery line stays the delivery method; an edited extra charge never becomes it', () => {
    const one = line({ id: 1, origin: 'CREATE', providerId: 'ctt', serviceId: 'a' });
    const two = line({ id: 2, origin: 'CREATE', extra: true, providerId: 'dpd-portugal', serviceId: 'PICKUP' });
    const ctt = { providerId: 'ctt', serviceId: 'a' };
    expect(currentShippingMethod([{ ...one, origin: 'EDIT' }, two])).toEqual(ctt);
    expect(currentShippingMethod([one, { ...two, origin: 'EDIT' }])).toEqual(ctt);
    expect(currentShippingMethod([{ ...one, origin: 'EDIT' }, { ...two, extra: undefined }])).toEqual(ctt);
    // The delivery line removed: the next one is promoted.
    expect(currentShippingMethod([two])).toEqual({ providerId: 'dpd-portugal', serviceId: 'PICKUP' });
  });

  it('translates the CREATE origin in en and pt', () => {
    const key = 'littlebox-strapi-suite.ecommerce.orders.shippingCharges.origin.CREATE';
    expect(require('../../../admin/src/core/translations/en.json')[key]).toEqual(expect.any(String));
    expect(require('../../../admin/src/core/translations/pt.json')[key]).toEqual(expect.any(String));
  });
});

describe('defaultShippingOptionKey', () => {
  const options = [
    { providerId: 'ctt', serviceId: 'a', name: 'CTT', price: 400, tax: 23 },
    { providerId: 'dpd', serviceId: 'b', name: 'DPD', price: 600, tax: 23 },
  ];
  it('picks the preferred method when offered, else the first option', () => {
    expect(defaultShippingOptionKey(options, { providerId: 'dpd', serviceId: 'b' })).toBe('dpd:b');
    expect(defaultShippingOptionKey(options, { providerId: 'x', serviceId: 'y' })).toBe('ctt:a');
    expect(defaultShippingOptionKey(options, null)).toBe('ctt:a');
    expect(defaultShippingOptionKey([], null)).toBeNull();
    expect(shippingOptionKey(options[1])).toBe('dpd:b');
  });
});

describe('shippingLineDraftToInput', () => {
  const option = { providerId: 'ctt', serviceId: 'a', name: 'CTT', price: 400, tax: 23 };
  it('builds the input from the chosen method and the price in euros', () => {
    expect(shippingLineDraftToInput(option, '4,50')).toEqual({
      input: { providerId: 'ctt', serviceId: 'a', amount: 450 },
      errors: [],
    });
    expect(shippingLineDraftToInput(option, '0').input?.amount).toBe(0);
  });
  it('requires a method and a valid amount', () => {
    expect(shippingLineDraftToInput(null, 'abc')).toEqual({
      input: null,
      errors: [
        { path: 'method', code: 'required' },
        { path: 'amount', code: 'INVALID_AMOUNT' },
      ],
    });
    expect(shippingLineDraftToInput(option, '').errors).toEqual([{ path: 'amount', code: 'INVALID_AMOUNT' }]);
    expect(shippingLineDraftToInput(option, '99999999').errors).toEqual([
      { path: 'amount', code: 'INVALID_AMOUNT' },
    ]);
  });
});

describe('shippingLineErrorKey', () => {
  it('maps server paths to the modal fields', () => {
    expect(shippingLineErrorKey('amount')).toBe('amount');
    expect(shippingLineErrorKey('method')).toBe('method');
    expect(shippingLineErrorKey('shipping')).toBe('form');
    expect(shippingLineErrorKey('lineId')).toBe('form');
  });
});

describe('shipping charges texts', () => {
  const keys = [
    'ecommerce.orders.shippingCharges.title',
    'ecommerce.orders.shippingCharges.recalculate',
    'ecommerce.orders.shippingCharges.add',
    'ecommerce.orders.shippingCharges.edit',
    'ecommerce.orders.shippingCharges.origin.CHECKOUT',
    'ecommerce.orders.shippingCharges.origin.RECALCULATION',
    'ecommerce.orders.shippingCharges.origin.EDIT',
    'ecommerce.orders.shippingCharges.origin.MANUAL',
    'ecommerce.orders.shippingCharges.badge.PAID',
    'ecommerce.orders.shippingCharges.badge.INVOICED',
    'ecommerce.orders.shippingCharges.badge.UNPAID',
    'ecommerce.orders.shippingCharges.remove',
    'ecommerce.orders.shippingCharges.removeTitle',
    'ecommerce.orders.shippingCharges.removeBody',
    'ecommerce.orders.errors.SHIPPING_LINE_INVOICED',
    'ecommerce.orders.errors.SHIPPING_LINE_LAST',
    'ecommerce.orders.shippingCharges.columns.method',
    'ecommerce.orders.shippingCharges.columns.date',
    'ecommerce.orders.shippingCharges.columns.amount',
    'ecommerce.orders.shippingCharges.columns.status',
    'ecommerce.orders.shippingCharges.columns.actions',
    'ecommerce.orders.shippingCharges.charged',
    'ecommerce.orders.shippingCharges.invoiced',
    'ecommerce.orders.amountDue.text',
    'ecommerce.orders.shippingCharges.pickMethod',
    'ecommerce.orders.shippingCharges.pickMethodFirst',
    'ecommerce.orders.errors.SHIPPING_METHOD_REQUIRED',
    'ecommerce.orders.shippingCharges.unchanged',
    'ecommerce.orders.shippingCharges.noMethods',
    'ecommerce.orders.shippingCharges.suggested',
    'ecommerce.orders.address.locked.HAS_SHIPMENTS',
    'ecommerce.orders.address.locked.CANCELLED',
    'ecommerce.orders.address.locked.ARCHIVED',
    'ecommerce.orders.address.locked.SHIPMENT_PENDING',
  ];
  it.each(keys)('%s exists in en and pt', (key) => {
    const id = `littlebox-strapi-suite.${key}`;
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });
});

describe('shippingLineEditUnchanged', () => {
  const target = line({ id: 1, amount: 400, effectiveAmount: 600, providerId: 'ctt', serviceId: 'a' });
  const lines = [target, line({ id: 2, origin: 'EDIT', amount: 200, editOf: 1, providerId: 'dpd', serviceId: 'b' })];
  it('is true when the method and amount match what the line now charges', () => {
    expect(shippingLineEditUnchanged(lines, target, { providerId: 'dpd', serviceId: 'b', amount: 600 })).toBe(true);
    expect(shippingLineEditUnchanged(lines, target, { providerId: 'ctt', serviceId: 'a', amount: 600 })).toBe(false);
    expect(shippingLineEditUnchanged(lines, target, { providerId: 'dpd', serviceId: 'b', amount: 650 })).toBe(false);
    const plain = line({ id: 7, amount: 500 });
    expect(shippingLineEditUnchanged([plain], plain, { providerId: 'manual', serviceId: 'std', amount: 500 })).toBe(true);
  });
});

describe('defaultShippingOptionKey with carrier failures', () => {
  const options = [{ providerId: 'ctt', serviceId: 'a', name: 'CTT', price: 400, tax: 23 }];
  it('selects nothing when the preferred method is missing because its carrier failed', () => {
    const failures = [{ providerId: 'dpd', code: 'TIMEOUT' }];
    expect(defaultShippingOptionKey(options, { providerId: 'dpd', serviceId: 'b' }, failures)).toBeNull();
    expect(defaultShippingOptionKey(options, { providerId: 'gls', serviceId: 'c' }, failures)).toBe('ctt:a');
  });
});

describe('address lock fallback text', () => {
  it('exists in en and pt', () => {
    const id = 'littlebox-strapi-suite.ecommerce.orders.address.locked.default';
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });
});

const manual = (over: Partial<ManualDiscount> = {}): ManualDiscount => ({
  id: 1,
  kind: 'FIXED',
  percent: null,
  amount: 500,
  reason: 'Goodwill',
  createdAt: '2026-11-13T10:00:00.000Z',
  actor: 'admin',
  ...over,
});

describe('discountRowGroups', () => {
  it('groups the rows in the spec 7.1 order and skips empty groups', () => {
    const rows = [
      row({ key: 'm:1', kind: 'MANUAL' }),
      row({ key: 'p:2', kind: 'NEW' }),
      row({ key: 'p:1', kind: 'APPLIED_VALID' }),
      row({ key: 'p:4', kind: 'NEW' }),
    ];
    expect(discountRowGroups(rows).map((g) => [g.kind, g.rows.map((r) => r.key)])).toEqual([
      ['APPLIED_VALID', ['p:1']],
      ['NEW', ['p:2', 'p:4']],
      ['MANUAL', ['m:1']],
    ]);
  });

  it('puts the no-longer-valid ones right after the valid ones', () => {
    const rows = [row({ key: 'p:2', kind: 'APPLIED_INVALID' }), row({ key: 'p:1' })];
    expect(discountRowGroups(rows).map((g) => g.kind)).toEqual(['APPLIED_VALID', 'APPLIED_INVALID']);
  });
});

describe('discountConflictNames', () => {
  it('names each conflicting row once, in order', () => {
    const rows = [row({ key: 'p:1', name: 'A' }), row({ key: 'p:2', name: 'B' }), row({ key: 'p:3', name: 'C' })];
    const nameOf = (r: DiscountRow) => r.name;
    expect(
      discountConflictNames(
        [
          ['p:1', 'p:2'],
          ['p:1', 'p:3'],
        ],
        rows,
        nameOf
      )
    ).toEqual(['A', 'B', 'C']);
  });

  it('falls back to the key of a row it does not know', () => {
    expect(discountConflictNames([['p:1', 'p:9']], [row({ key: 'p:1', name: 'A' })], (r) => r.name)).toEqual([
      'A',
      'p:9',
    ]);
  });
});

describe('orderDiscountTotal', () => {
  it('adds the promotions and the manual discounts', () => {
    expect(orderDiscountTotal([{ amount: 300 }, { amount: 200 }], [manual({ amount: 500 }), manual({ id: 2, amount: 50 })])).toBe(
      1050
    );
    expect(orderDiscountTotal([], [])).toBe(0);
  });
});

describe('manualDiscountRows', () => {
  const o = (actions: OrderEditAction[] = ['REMOVE_DISCOUNT']) =>
    order({ editing: editing({ actions }), manualDiscounts: [manual(), manual({ id: 2, kind: 'LEGACY', reason: 'x' })] });

  it('offers Remove behind REMOVE_DISCOUNT and orders.manage', () => {
    expect(manualDiscountRows(o(), true).map((r) => [r.discount.id, r.legacy, r.actions])).toEqual([
      [1, false, ['REMOVE']],
      [2, true, ['REMOVE']],
    ]);
    expect(manualDiscountRows(o([]), true).every((r) => r.actions.length === 0)).toBe(true);
    expect(manualDiscountRows(o(), false).every((r) => r.actions.length === 0)).toBe(true);
  });

  it('offers nothing while the order is not editable', () => {
    const closed = order({
      editing: editing({ editable: false, actions: ['REMOVE_DISCOUNT'] }),
      manualDiscounts: [manual()],
    });
    expect(manualDiscountRows(closed, true)[0].actions).toEqual([]);
  });

  it('never offers Remove on a discount an invoice reflects', () => {
    const invoiced = order({
      editing: editing({ actions: ['REMOVE_DISCOUNT'] }),
      manualDiscounts: [manual({ invoiced: true }), manual({ id: 2 })],
    });
    expect(manualDiscountRows(invoiced, true).map((r) => r.actions)).toEqual([[], ['REMOVE']]);
  });

  it('reads a missing list as empty', () => {
    expect(manualDiscountRows(order({ manualDiscounts: undefined }), true)).toEqual([]);
  });
});

describe('manualDiscountPercent', () => {
  it('formats the percent of a PERCENT discount in the UI locale', () => {
    expect(manualDiscountPercent(manual({ kind: 'PERCENT', percent: 10 }), 'pt-PT')).toBe('10 %');
    expect(manualDiscountPercent(manual({ kind: 'PERCENT', percent: 12.5 }), 'pt-PT')).toBe('12,5 %');
    expect(manualDiscountPercent(manual({ kind: 'PERCENT', percent: 12.5 }), 'en')).toBe('12.5 %');
  });

  it('is null for the other kinds', () => {
    expect(manualDiscountPercent(manual(), 'en')).toBeNull();
    expect(manualDiscountPercent(manual({ kind: 'PERCENT', percent: null }), 'en')).toBeNull();
  });
});

describe('discounts texts', () => {
  const keys = [
    'recalculate',
    'add',
    'remove',
    'removeTitle',
    'removeConfirm',
    'group.APPLIED_VALID',
    'group.APPLIED_INVALID',
    'group.NEW',
    'group.MANUAL',
    'invalidToday',
    'reason.INACTIVE',
    'reason.SCHEDULED',
    'reason.EXPIRED',
    'reason.USAGE_LIMIT_REACHED',
    'reason.CUSTOMER_LIMIT_REACHED',
    'reason.EMAIL_NOT_ELIGIBLE',
    'reason.EMAIL_NOT_VERIFIED',
    'reason.CONDITIONS_NOT_MET',
    'reason.CONFLICT',
    'reason.NO_BENEFIT',
    'reason.AWAITING_SHIPPING',
    'reason.NOT_FOUND',
    'conflict',
    'giftShipped',
    'manual',
    'kind.FIXED',
    'kind.PERCENT',
    'value',
    'reasonLabel',
    'legacyReason',
    'current',
    'after',
    'columns.select',
    'columns.promotion',
    'columns.current',
    'columns.amount',
    'manualName',
    'totals.subtotal',
    'totals.shipping',
    'totals.total',
    'totals.due',
    'nothing',
    'close',
    'confirm',
    'save',
    'saved',
    'saveError',
    'previewError',
    'greedy',
    'percentHint',
    'kindLabel',
  ].map((k) => `ecommerce.orders.discounts.${k}`);
  it.each(keys)('%s exists in en and pt', (key) => {
    const id = `littlebox-strapi-suite.${key}`;
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });

  it('names the Actions column of the promotions table', () => {
    const id = 'littlebox-strapi-suite.ecommerce.orders.promotions.columns.actions';
    expect(en[id]).toBe('Actions');
    expect(pt[id]).toBe('Ações');
  });

  it('uses the brief wording', () => {
    const k = (s: string) => `littlebox-strapi-suite.ecommerce.orders.discounts.${s}`;
    expect(pt[k('invalidToday')]).toBe('Não é válida hoje, mas era no dia da compra');
    expect(pt[k('legacyReason')]).toBe('Ajuste manual anterior');
    expect(en[k('conflict')]).toBe('These promotions cannot be combined: {names}');
    expect(pt[k('group.NEW')]).toBe('Aplicar-se-ia agora');
  });
});

describe('discountsSaveErrorId', () => {
  const httpError = (status: number, error: unknown) => ({ response: { status, data: { error } } });
  it('maps PROMOTION_UNAVAILABLE to the edit-flow text, other codes as usual', () => {
    expect(discountsSaveErrorId(httpError(409, { details: { code: 'PROMOTION_UNAVAILABLE' } }))).toBe(
      'ecommerce.orders.discounts.errors.PROMOTION_UNAVAILABLE'
    );
    expect(discountsSaveErrorId(httpError(409, { details: { code: 'PROMOTIONS_NOT_COMBINABLE' } }))).toBe(
      'ecommerce.orders.errors.PROMOTIONS_NOT_COMBINABLE'
    );
    expect(discountsSaveErrorId(new Error('network'))).toBe('ecommerce.orders.discounts.saveError');
  });
});

describe('quantityFromInput', () => {
  it('keeps only digits; empty is 0 (shown as a validation error)', async () => {
    const { quantityFromInput } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    expect(quantityFromInput('3')).toBe(3);
    expect(quantityFromInput(' 12 ')).toBe(12);
    expect(quantityFromInput('1a2')).toBe(12);
    expect(quantityFromInput('-4')).toBe(4);
    expect(quantityFromInput('2.5')).toBe(25);
    expect(quantityFromInput('')).toBe(0);
    expect(quantityFromInput('abc')).toBe(0);
    expect(quantityFromInput('99999999')).toBe(9999);
  });
});

describe('balanceAfter', () => {
  const totals = (due: number, excess: number) =>
    ({ itemsOriginal: 0, productDiscount: 0, subtotal: 0, orderDiscount: 0, shippingTotal: 0, total: 0, paid: 0, due, excess }) as any;

  it('still owed after the edit → DUE with the whole pending amount', async () => {
    const { balanceAfter } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    // A product removed from an unpaid order: less to pay, but 800 is still pending.
    expect(balanceAfter(totals(800, 0))).toEqual({ outcome: 'DUE', amount: 800 });
  });

  it('paid more than the new total → REFUNDABLE with the excess', async () => {
    const { balanceAfter } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    expect(balanceAfter(totals(0, 200))).toEqual({ outcome: 'REFUNDABLE', amount: 200 });
  });

  it('settled → NONE', async () => {
    const { balanceAfter } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    expect(balanceAfter(totals(0, 0))).toEqual({ outcome: 'NONE', amount: 0 });
  });
});

describe('line discount percent helpers (spec 4.1)', () => {
  it('discountPercentFromInput keeps digits and one separator, at most 2 decimals and 3 digits', () => {
    expect(discountPercentFromInput('12,5')).toBe('12,5');
    expect(discountPercentFromInput('12.345')).toBe('12.34');
    expect(discountPercentFromInput('1a0%')).toBe('10');
    expect(discountPercentFromInput('1,2,3')).toBe('1,23');
    expect(discountPercentFromInput('12345')).toBe('123');
    expect(discountPercentFromInput('')).toBe('');
    expect(discountPercentFromInput('-5')).toBe('5');
  });

  it('parseDiscountPercent: empty is none; 0 < p ≤ 100 with a comma or a dot', () => {
    expect(parseDiscountPercent('')).toEqual({ ok: true, value: null });
    expect(parseDiscountPercent('  ')).toEqual({ ok: true, value: null });
    expect(parseDiscountPercent('10')).toEqual({ ok: true, value: 10 });
    expect(parseDiscountPercent('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseDiscountPercent('33.33')).toEqual({ ok: true, value: 33.33 });
    expect(parseDiscountPercent('100')).toEqual({ ok: true, value: 100 });
    for (const bad of ['0', '0,00', '100,01', '101', '10,', ',5', '1.234', 'x']) {
      expect(parseDiscountPercent(bad)).toEqual({ ok: false });
    }
  });

  it('lineUnitDiscount rounds like the server (half up, cents)', () => {
    expect(lineUnitDiscount(2000, 10)).toBe(200);
    expect(lineUnitDiscount(1999, 33.33)).toBe(666);
    expect(lineUnitDiscount(1005, 50)).toBe(503);
    expect(lineUnitDiscount(2000, 100)).toBe(2000);
  });

  it('never formats with non-Latin digits', () => {
    expect(percentToInput(12.5, 'ar-EG')).toMatch(/^12[.,٫]5$/);
    expect(percentToInput(12.5, 'ar-EG')).not.toMatch(/[٠-٩]/);
    expect(formatLineDiscount(10, 'ar-EG')).toBe('−10 %');
  });

  it('formats a percent for display and for the input', () => {
    expect(formatLineDiscount(10, 'en')).toBe('−10 %');
    expect(formatLineDiscount(12.5, 'pt')).toBe('−12,5 %');
    expect(percentToInput(12.5, 'pt')).toBe('12,5');
    expect(percentToInput(12.5, 'en')).toBe('12.5');
    expect(percentToInput(null, 'en')).toBe('');
  });

  it('texts exist in en and pt', () => {
    for (const key of [
      'ecommerce.orders.lines.discount',
      'ecommerce.orders.errors.DISCOUNT_LINE_SHIPPED',
      'ecommerce.orders.detail.lines.manualDiscount',
    ]) {
      expect(en[`littlebox-strapi-suite.${key}`]).toBeTruthy();
      expect(pt[`littlebox-strapi-suite.${key}`]).toBeTruthy();
    }
  });
});

describe('manual line discounts in the discounts table (spec 4.1)', () => {
  const lines = [
    { name: 'Camisa', option: 'M', manualDiscountPercent: 10, unitDiscount: 200, quantity: 3, returnedQuantity: 1, isGift: false },
    { name: 'Mug', option: null, manualDiscountPercent: null, unitDiscount: 500, quantity: 1, returnedQuantity: 0, isGift: false },
    { name: 'Hat', option: null, manualDiscountPercent: 12.5, unitDiscount: 250, quantity: 2, isGift: false },
  ];

  it('one row per line with a manual percent: label, percent and unit discount × kept units', () => {
    expect(manualLineDiscountRows(lines, 'pt')).toEqual([
      { key: 'line-0', label: 'Camisa — M −10 %', amount: 400 },
      { key: 'line-2', label: 'Hat −12,5 %', amount: 500 },
    ]);
  });

  it('adds up', () => {
    expect(manualLineDiscountTotal(manualLineDiscountRows(lines, 'en'))).toBe(900);
    expect(manualLineDiscountTotal([])).toBe(0);
  });

  it('texts exist in en and pt', () => {
    const id = 'littlebox-strapi-suite.ecommerce.orders.discounts.manualLineName';
    expect(en[id]).toBeTruthy();
    expect(pt[id]).toBeTruthy();
  });
});

describe('shipping credits (a recalculation below what was charged)', () => {
  it('are never shown as charges; corrections still are', async () => {
    const { shippingLineRows, isShippingCredit } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    const lines = [
      line({ id: 1, invoiced: true }),
      line({ id: 2, origin: 'EDIT', amount: -100, editOf: 1 }),
      line({ id: 3, origin: 'RECALCULATION', amount: -260 }),
    ];
    expect(isShippingCredit(lines[2])).toBe(true);
    expect(isShippingCredit(lines[1])).toBe(false);
    expect(shippingLineRows(lines, editing(), true).map((r) => r.line.id)).toEqual([1, 2]);
  });
});

describe('suggestedChargePrice (Add shipping charge)', () => {
  it('quote of the units not yet shipped minus the shipping charged; null at 0 or below', async () => {
    const { suggestedChargePrice } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    expect(suggestedChargePrice(800, { pendingOnly: true, charged: 500 })).toBe(300);
    expect(suggestedChargePrice(500, { pendingOnly: true, charged: 500 })).toBeNull();
    expect(suggestedChargePrice(800, { pendingOnly: true, charged: 3100 })).toBeNull();
    // Every unit shipped: nothing left to quote.
    expect(suggestedChargePrice(800, { pendingOnly: false, charged: 0 })).toBeNull();
    expect(suggestedChargePrice(800, { pendingOnly: false, charged: 500 })).toBeNull();
  });
});

describe('reviewDifference', () => {
  it('the quote less the shipping discount, minus what was paid', async () => {
    const { reviewDifference } = await import('../../../admin/src/ecommerce/utils/orderEditing');
    expect(reviewDifference({ paid: 2900, shippingDiscount: 200 }, 3100)).toBe(0);
    expect(reviewDifference({ paid: 2900, shippingDiscount: 200 }, 3600)).toBe(500);
    expect(reviewDifference({ paid: 2900, shippingDiscount: 200 }, 100)).toBe(-2900);
  });
});

describe('manual discount base (products not yet invoiced)', () => {
  const editable = (discountBase?: { products: number; pendingDiscounts: number }) =>
    order({ editing: editing({ actions: ['ADD_DISCOUNT'] }), ...(discountBase ? { discountBase } : {}) });

  it('uses the products not yet invoiced, less the pending order discounts', () => {
    expect(manualDiscountBase(editable({ products: 6200, pendingDiscounts: 1000 }))).toEqual({ products: 6200, available: 5200 });
  });

  it('offers Add discount only while something can take it', () => {
    expect(canAddManualDiscount(editable({ products: 6200, pendingDiscounts: 0 }))).toBe(true);
    expect(canAddManualDiscount(editable({ products: 0, pendingDiscounts: 0 }))).toBe(false);
    expect(canAddManualDiscount(editable({ products: 1000, pendingDiscounts: 1000 }))).toBe(false);
  });
});
