import { describe, expect, it } from 'vitest';
import {
  emptyRefundForm,
  isUnitsOnlyRefund,
  refundScopes,
  validateRefundForm,
} from '../../../admin/src/ecommerce/utils/refundForm';
import {
  giftOrderLineIds,
  refundElementsTotal,
  refundOptionValue,
  refundRowActions,
  selectionKey,
} from '../../../admin/src/ecommerce/utils/refundCreditNote';
import type { RefundElementInvoice, RefundPreview, RefundView } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const NOW = new Date(2026, 10, 17, 10, 0, 0);

/** Invoice X/20 of order 10: a paid line, a promotional gift (0) and shipping. */
const elements = (): RefundElementInvoice[] => [
  {
    invoiceId: 20,
    number: 'FR X/20',
    lines: [
      { index: 0, kind: 'ITEM', orderLineId: 1, name: 'Serum', quantityLeft: 1, unitValue: 2490, valueLeft: 2490 },
      { index: 1, kind: 'ITEM', orderLineId: 2, name: 'Cream', quantityLeft: 1, unitValue: 0, valueLeft: 0 },
      { index: 2, kind: 'SHIPPING', orderLineId: null, name: 'CTT', quantityLeft: 1, unitValue: 500, valueLeft: 500 },
    ],
  },
];

const preview = (over: Partial<RefundPreview> = {}): RefundPreview => ({
  orderTotal: 2990,
  received: 2990,
  refunded: 0,
  inFlight: 0,
  excess: 0,
  invoicedRefundable: 2990,
  refundable: 0,
  moneyRefundable: 0,
  stripeRefundable: 0,
  hasStripe: false,
  limits: {
    EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
    INVOICED: { refundable: 2990, moneyRefundable: 2990, stripeRefundable: 0 },
  },
  invoicedElements: { invoices: elements() },
  ...over,
});

const form = (selection: Record<string, number>) => ({
  ...emptyRefundForm(preview(), 'pt-PT', NOW),
  reason: 'OTHER' as const,
  selection,
});

describe('gift elements in the refund modal', () => {
  it('a gift unit is worth 0 and adds 0 to the amount', () => {
    const [invoice] = elements();
    expect(refundOptionValue(invoice.lines[1], 1)).toBe(0);
    expect(refundElementsTotal(elements(), { [selectionKey(20, 0)]: 1, [selectionKey(20, 1)]: 1 })).toBe(2490);
  });

  it('a paid unit plus the gift sends both items, the amount the paid value', () => {
    const result = validateRefundForm(form({ [selectionKey(20, 0)]: 1, [selectionKey(20, 1)]: 1 }), preview(), NOW);
    expect(result.input).toMatchObject({
      amount: 2490,
      method: 'MANUAL_TRANSFER',
      items: [
        { invoiceId: 20, index: 0, quantity: 1 },
        { invoiceId: 20, index: 1, quantity: 1 },
      ],
    });
  });

  it('a 0 total is allowed only when the selection is non-empty (units-only, MANUAL_TRANSFER, no money fields)', () => {
    const giftOnly = { ...form({ [selectionKey(20, 1)]: 1 }), method: 'STORE_CREDIT' as const, expiresAt: '', reference: 'x' };
    expect(isUnitsOnlyRefund(giftOnly, preview())).toBe(true);
    expect(validateRefundForm(giftOnly, preview(), NOW)).toEqual({
      errors: [],
      input: {
        method: 'MANUAL_TRANSFER',
        amount: 0,
        reason: 'OTHER',
        scope: 'INVOICED',
        items: [{ invoiceId: 20, index: 1, quantity: 1 }],
      },
    });
    const empty = form({});
    expect(isUnitsOnlyRefund(empty, preview())).toBe(false);
    expect(validateRefundForm(empty, preview(), NOW).errors).toEqual([{ path: 'items', code: 'required' }]);
    // The reason is still required.
    expect(validateRefundForm({ ...giftOnly, reason: '' }, preview(), NOW).errors).toEqual([
      { path: 'reason', code: 'required' },
    ]);
  });

  it('INVOICED is offered when only gift units are left (nothing of value)', () => {
    const giftsOnly = preview({
      invoicedRefundable: 0,
      limits: {
        EXCESS: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
        INVOICED: { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 },
      },
      invoicedElements: { invoices: [{ ...elements()[0], lines: [elements()[0].lines[1]] }] },
    });
    expect(refundScopes(giftsOnly)).toEqual(['INVOICED']);
    const noGift = { ...giftsOnly, invoicedElements: { invoices: [] } };
    expect(refundScopes(noGift)).toEqual([]);
  });

  it('gift order lines are matched by orderLineId', () => {
    expect([...giftOrderLineIds([{ id: 1, isGift: false }, { id: 2, isGift: true }])]).toEqual([2]);
  });

  it('a units-only refund (amount 0) offers no credit note', () => {
    const r = { scope: 'INVOICED', creditNoteId: null, status: 'COMPLETED', method: 'MANUAL_TRANSFER', removable: true } as Pick<
      RefundView,
      'scope' | 'creditNoteId' | 'status' | 'method' | 'removable' | 'amount'
    >;
    const ctx = { billingActive: true, archived: false, canRefund: true, canInvoice: true, creditNote: null };
    expect(refundRowActions({ ...r, amount: 0 }, ctx)).toEqual({ creditNote: false, pdf: false, remove: true });
    expect(refundRowActions({ ...r, amount: 2490 }, ctx).creditNote).toBe(true);
  });

  it('has the units-only notice in en and pt', () => {
    for (const k of ['ecommerce.orders.refund.unitsOnly.notice', 'ecommerce.orders.refund.unitsOnly.confirm']) {
      expect(en[P + k], k).toBeTruthy();
      expect(pt[P + k], k).toBeTruthy();
    }
    expect(pt[`${P}ecommerce.orders.refund.unitsOnly.notice`]).toBe(
      'Só foram escolhidas ofertas (valor €0): as unidades deixam de ser enviadas e não há dinheiro a devolver.'
    );
  });
});
