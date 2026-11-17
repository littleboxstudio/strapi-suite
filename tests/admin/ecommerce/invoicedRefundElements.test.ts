import { describe, expect, it } from 'vitest';
import {
  emptyRefundForm,
  refundServerErrors,
  switchRefundScope,
  validateRefundForm,
} from '../../../admin/src/ecommerce/utils/refundForm';
import {
  refundCreditMode,
  refundCreditModeAfterError,
  refundElementsTotal,
  refundItemRows,
  selectionFromItems,
  selectionKey,
  storedCreditItems,
} from '../../../admin/src/ecommerce/utils/refundCreditNote';
import { API_ERROR_CODES } from '../../../admin/src/ecommerce/utils/orderDetail';
import type {
  InvoiceLine,
  InvoiceView,
  RefundCreditNoteOptions,
  RefundElementInvoice,
  RefundPreview,
} from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const NOW = new Date(2026, 10, 17, 10, 0, 0);

const elements = (): RefundElementInvoice[] => [
  {
    invoiceId: 6,
    number: 'FT X/6',
    lines: [
      { index: 0, kind: 'ITEM', name: 'Shirt', quantityLeft: 3, unitValue: 1000, valueLeft: 2900 },
      { index: 1, kind: 'SHIPPING', name: 'CTT', quantityLeft: 1, unitValue: 500, valueLeft: 500 },
    ],
  },
  {
    invoiceId: 7,
    number: 'FT X/7',
    lines: [{ index: 0, kind: 'ITEM', name: 'Mug', quantityLeft: 2, unitValue: 333, valueLeft: 667 }],
  },
];

const preview = (over: Partial<RefundPreview> = {}): RefundPreview => ({
  orderTotal: 5000,
  received: 5000,
  refunded: 0,
  inFlight: 0,
  excess: 0,
  invoicedRefundable: 4067,
  refundable: 0,
  moneyRefundable: 0,
  stripeRefundable: 0,
  hasStripe: true,
  limits: {
    EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
    INVOICED: { refundable: 4067, moneyRefundable: 4067, stripeRefundable: 600 },
  },
  invoicedElements: { invoices: elements() },
  ...over,
});

const shirtLine = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  orderLineId: 1,
  kind: 'ITEM',
  sku: 'S',
  name: 'Shirt',
  quantity: 3,
  total: 2700,
  tax: 23,
  partial: false,
  discountShare: 300,
  ...over,
});

describe('refundElementsTotal', () => {
  it('sums whole units and shipping lines, valued as the server does', () => {
    const sel = { [selectionKey(6, 0)]: 2, [selectionKey(6, 1)]: 1, [selectionKey(7, 0)]: 1 };
    // Shirt: 2 of 3 with share left 100 → 2000 − floor(100×2/3) = 1934; CTT 500; Mug 333.
    const lineOf = (invoiceId: number, index: number) => (invoiceId === 6 && index === 0 ? shirtLine() : undefined);
    expect(refundElementsTotal(elements(), sel, lineOf)).toBe(1934 + 500 + 333);
    expect(refundElementsTotal(elements(), {})).toBe(0);
    // More than left counts nothing.
    expect(refundElementsTotal(elements(), { [selectionKey(7, 0)]: 3 })).toBe(0);
  });
});

describe('validateRefundForm, INVOICED scope', () => {
  const base = () => ({ ...emptyRefundForm(preview(), 'pt-PT', NOW), reason: 'OTHER' as const });

  it('starts INVOICED with nothing selected', () => {
    expect(base()).toMatchObject({ scope: 'INVOICED', selection: {} });
  });

  it('sends the chosen items and their sum as the amount', () => {
    const form = { ...base(), selection: { [selectionKey(7, 0)]: 2, [selectionKey(6, 1)]: 1 } };
    expect(validateRefundForm(form, preview(), NOW)).toEqual({
      errors: [],
      input: {
        method: 'MANUAL_TRANSFER',
        amount: 1167,
        reason: 'OTHER',
        scope: 'INVOICED',
        items: [
          { invoiceId: 6, index: 1, quantity: 1 },
          { invoiceId: 7, index: 0, quantity: 2 },
        ],
      },
    });
  });

  it('ignores the free amount text', () => {
    const form = { ...base(), amount: 'abc', selection: { [selectionKey(6, 1)]: 1 } };
    expect(validateRefundForm(form, preview(), NOW).input?.amount).toBe(500);
  });

  it('refuses an empty selection and a quantity above what is left', () => {
    expect(validateRefundForm(base(), preview(), NOW).errors).toEqual([{ path: 'items', code: 'required' }]);
    const tooMany = { ...base(), selection: { [selectionKey(7, 0)]: 3 } };
    expect(validateRefundForm(tooMany, preview(), NOW).errors).toEqual([
      { path: 'items', code: 'invalid_quantity' },
    ]);
    const fraction = { ...base(), selection: { [selectionKey(7, 0)]: 1.5 } };
    expect(validateRefundForm(fraction, preview(), NOW).errors).toEqual([
      { path: 'items', code: 'invalid_quantity' },
    ]);
  });

  it('checks the sum against the scope limits (Stripe)', () => {
    const form = { ...base(), method: 'STRIPE' as const, selection: { [selectionKey(7, 0)]: 2 } };
    expect(validateRefundForm(form, preview(), NOW).errors).toEqual([
      { path: 'amount', code: 'exceeds_stripe_refundable' },
    ]);
  });

  it('switching scope keeps the selection; EXCESS is unchanged (amount, no items)', () => {
    const both = preview({
      excess: 300,
      refundable: 300,
      moneyRefundable: 300,
      stripeRefundable: 300,
      limits: {
        EXCESS: { refundable: 300, moneyRefundable: 300, stripeRefundable: 300 },
        INVOICED: { refundable: 4067, moneyRefundable: 4067, stripeRefundable: 600 },
      },
    });
    const form = { ...emptyRefundForm(both, 'pt-PT', NOW), reason: 'OTHER' as const };
    expect(form.scope).toBe('EXCESS');
    const invoiced = switchRefundScope({ ...form, selection: { [selectionKey(6, 1)]: 1 } }, both, 'INVOICED', 'pt-PT');
    expect(invoiced.selection).toEqual({ [selectionKey(6, 1)]: 1 });
    const excess = switchRefundScope(invoiced, both, 'EXCESS', 'pt-PT');
    expect(validateRefundForm(excess, both, NOW).input).toEqual({
      method: 'MANUAL_TRANSFER',
      amount: 300,
      reason: 'OTHER',
    });
  });
});

describe('refundServerErrors', () => {
  const sent = [
    { invoiceId: 6, index: 1, quantity: 1 },
    { invoiceId: 7, index: 0, quantity: 2 },
  ];

  it('puts items.N on its element, form fields on their field, the rest on the form', () => {
    expect(
      refundServerErrors(
        [
          { path: 'items.1', code: 'REFUND_ITEMS_INVALID' },
          { path: 'items.0.quantity', code: 'invalid_quantity' },
          { path: 'method', code: 'stripe_split_unavailable' },
          { path: 'amount', code: 'REFUND_AMOUNT_DIFFERS' },
          { path: 'items', code: 'REFUND_ITEMS_INVALID' },
        ],
        sent
      )
    ).toEqual({
      rows: { [selectionKey(7, 0)]: 'REFUND_ITEMS_INVALID', [selectionKey(6, 1)]: 'invalid_quantity' },
      fields: [
        { path: 'method', code: 'stripe_split_unavailable' },
        { path: 'amount', code: 'REFUND_AMOUNT_DIFFERS' },
        { path: 'items', code: 'REFUND_ITEMS_INVALID' },
      ],
    });
  });

  it('an items.N beyond what was sent stays on the items field', () => {
    expect(refundServerErrors([{ path: 'items.5', code: 'REFUND_ITEMS_INVALID' }], sent)).toEqual({
      rows: {},
      fields: [{ path: 'items', code: 'REFUND_ITEMS_INVALID' }],
    });
  });
});

// ---------------------------------------------------------------------------
// Refund credit note: the refund's own elements
// ---------------------------------------------------------------------------

const options = (over: Partial<RefundCreditNoteOptions> = {}): RefundCreditNoteOptions => ({
  refund: { id: 9, amount: 1167 },
  creditable: true,
  reason: null,
  invoices: elements(),
  selected: [
    { invoiceId: 6, index: 1, quantity: 1, value: 500 },
    { invoiceId: 7, index: 0, quantity: 2, value: 667 },
  ],
  ...over,
});

describe('refundCreditMode', () => {
  it('STORED when every stored element is still offered with its units', () => {
    expect(refundCreditMode(options())).toBe('STORED');
  });

  it('FREE for a legacy refund (no stored elements) or older server', () => {
    expect(refundCreditMode(options({ selected: [] }))).toBe('FREE');
    expect(refundCreditMode(options({ selected: undefined }))).toBe('FREE');
  });

  it('UNAVAILABLE when a stored element is missing or has fewer units left', () => {
    const missing = options({ invoices: [elements()[0]] });
    expect(refundCreditMode(missing)).toBe('UNAVAILABLE');
    const fewer = elements();
    fewer[1].lines[0] = { ...fewer[1].lines[0], quantityLeft: 1 };
    expect(refundCreditMode(options({ invoices: fewer }))).toBe('UNAVAILABLE');
  });
});

describe('refundCreditModeAfterError', () => {
  const unavailable = [{ path: 'items.1', code: 'REFUND_ELEMENTS_UNAVAILABLE' }];

  it('STORED switches to UNAVAILABLE when the server says a stored element is unavailable', () => {
    expect(refundCreditModeAfterError('STORED', unavailable)).toBe('UNAVAILABLE');
    expect(
      refundCreditModeAfterError('STORED', [{ path: 'items.0.quantity', code: 'invalid_quantity' }, ...unavailable])
    ).toBe('UNAVAILABLE');
  });

  it('other answers keep the mode', () => {
    expect(refundCreditModeAfterError('STORED', [{ path: 'items.0', code: 'invalid_quantity' }])).toBe('STORED');
    expect(refundCreditModeAfterError('STORED', [])).toBe('STORED');
    expect(refundCreditModeAfterError('FREE', unavailable)).toBe('FREE');
    expect(refundCreditModeAfterError('UNAVAILABLE', unavailable)).toBe('UNAVAILABLE');
  });
});

describe('stored elements', () => {
  it('selectionFromItems keys each element with its units', () => {
    expect(selectionFromItems(options().selected)).toEqual({ [selectionKey(6, 1)]: 1, [selectionKey(7, 0)]: 2 });
    expect(selectionFromItems(undefined)).toEqual({});
  });

  it('storedCreditItems sends exactly the stored elements', () => {
    expect(storedCreditItems(options())).toEqual([
      { invoiceId: 6, index: 1, quantity: 1 },
      { invoiceId: 7, index: 0, quantity: 2 },
    ]);
  });
});

describe('refundItemRows', () => {
  const invoice = (id: number, number: string | null, lines: Partial<InvoiceLine>[]) =>
    ({ id, number, lines: lines.map((l) => shirtLine(l)) }) as unknown as InvoiceView;

  it('names each element from its invoice line, in stored order', () => {
    const invoices = [
      invoice(6, 'FT X/6', [{ name: 'Shirt' }, { kind: 'SHIPPING', name: 'CTT' }]),
      invoice(7, null, [{ name: 'Mug' }]),
    ];
    expect(
      refundItemRows(
        [
          { invoiceId: 6, index: 1, quantity: 1, value: 500 },
          { invoiceId: 7, index: 0, quantity: 2, value: 667 },
          { invoiceId: 8, index: 0, quantity: 1, value: 100 },
        ],
        invoices
      )
    ).toEqual([
      { key: '6:1', invoice: 'FT X/6', kind: 'SHIPPING', orderLineId: 1, name: 'CTT', quantity: 1, value: 500 },
      { key: '7:0', invoice: '#7', kind: 'ITEM', orderLineId: 1, name: 'Mug', quantity: 2, value: 667 },
      { key: '8:0', invoice: '#8', kind: 'ITEM', orderLineId: null, name: null, quantity: 1, value: 100 },
    ]);
  });
});

describe('translations of invoiced refund elements', () => {
  const keys = [
    'ecommerce.orders.errors.REFUND_AMOUNT_DIFFERS',
    'ecommerce.orders.errors.REFUND_ITEMS_INVALID',
    'ecommerce.orders.errors.REFUND_ELEMENTS_UNAVAILABLE',
    'ecommerce.orders.errors.stripe_split_unavailable',
    'ecommerce.orders.refund.elements.intro',
    'ecommerce.orders.refund.elements.none',
    'ecommerce.orders.refund.elements.required',
    'ecommerce.orders.refund.elements.quantity',
    'ecommerce.orders.refund.summary.selected',
    'ecommerce.orders.refunds.creditNote.storedNote',
    'ecommerce.orders.refunds.creditNote.unavailableNotice',
    'ecommerce.orders.refunds.details.elements',
    'ecommerce.orders.refunds.details.elementColumns.invoice',
    'ecommerce.orders.refunds.details.elementColumns.name',
    'ecommerce.orders.refunds.details.elementColumns.quantity',
    'ecommerce.orders.refunds.details.elementColumns.value',
  ];

  it('has every key in en and pt', () => {
    for (const k of keys) {
      expect(en[P + k], k).toBeTruthy();
      expect(pt[P + k], k).toBeTruthy();
    }
  });

  it('the new server codes are known error codes with an en and a pt message', () => {
    for (const code of ['REFUND_AMOUNT_DIFFERS', 'REFUND_ITEMS_INVALID', 'REFUND_ELEMENTS_UNAVAILABLE', 'stripe_split_unavailable']) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(en[`${P}ecommerce.orders.errors.${code}`], code).toBeTruthy();
      expect(pt[`${P}ecommerce.orders.errors.${code}`], code).toBeTruthy();
    }
  });
});
