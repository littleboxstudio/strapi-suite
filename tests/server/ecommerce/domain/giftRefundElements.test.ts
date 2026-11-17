import { describe, it, expect } from 'vitest';
import {
  buildCreditLines,
  creditOptions,
  refundCreditLine,
  refundCreditOptions,
  refundStoredCreditLine,
} from '../../../../server/src/services/modules/ecommerce/domain/creditNotes';
import {
  invoicedRefundableAmount,
  invoicedUnitsOnlyAvailable,
  refundReservationDocs,
} from '../../../../server/src/services/modules/ecommerce/domain/refunds';
import {
  invoicingPosition,
  refundCreditedUnits,
  type InvoiceDoc,
  type PositionOrder,
} from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import type { InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';

/**
 * Zero-value invoiced ITEM lines (promotional gifts) are refund elements valued 0, in whole units:
 * a refund picking them stops their units shipping, and its credit note credits them at 0 with
 * their price before discounts (a 100% discount).
 */

const PAID = 10;
const GIFT = 11;

const order: PositionOrder = {
  lines: [
    { id: PAID, unitPrice: 2490, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
    { id: GIFT, unitPrice: 3100, unitDiscount: 3100, quantity: 1, returnedQuantity: 0, tax: 23 },
  ],
  orderDiscount: 0,
  shippingTotal: 500,
  shippingTax: 23,
  shippingLines: [
    {
      id: 1,
      origin: 'CHECKOUT',
      amount: 500,
      providerId: 'p',
      serviceId: 's',
      name: 'Ship',
      tax: 23,
      createdAt: '2026-11-01T00:00:00.000Z',
      actor: 'system',
    },
  ],
};

const paid: InvoiceLine = {
  orderLineId: PAID,
  kind: 'ITEM',
  sku: 'SKU-P',
  name: 'Serum',
  quantity: 1,
  total: 2490,
  grossTotal: 2490,
  tax: 23,
  partial: false,
  discountShare: 0,
};
const gift: InvoiceLine = {
  orderLineId: GIFT,
  kind: 'ITEM',
  sku: 'SKU-G',
  name: 'Gift cream',
  quantity: 1,
  total: 0,
  grossTotal: 3100,
  tax: 23,
  partial: false,
  discountShare: 0,
};
const ship: InvoiceLine = {
  orderLineId: null,
  kind: 'SHIPPING',
  sku: 'SHIP',
  name: 'Ship',
  quantity: 1,
  total: 500,
  tax: 23,
  partial: false,
  shippingLineId: 1,
};

const invoice: InvoiceDoc = {
  id: 20,
  kind: 'INVOICE',
  status: 'ISSUED',
  creditedInvoiceId: null,
  creditType: null,
  lines: [paid, gift, ship],
  paymentIds: [],
  creditedLines: [],
};

const refund = (id: number, items: { index: number; quantity: number; value: number }[], status = 'COMPLETED') => ({
  id,
  scope: 'INVOICED',
  status,
  amount: items.reduce((s, i) => s + i.value, 0),
  metadata: { items: items.map((i) => ({ invoiceId: invoice.id, ...i })) },
});

describe('zero-value invoiced lines (gifts) as refund elements', () => {
  it('the gift line is offered with value 0, in whole units, with its order line', () => {
    const options = creditOptions(invoice, [invoice], order);
    expect(refundCreditOptions(invoice, options)).toEqual([
      { index: 0, kind: 'ITEM', orderLineId: PAID, name: 'Serum', quantityLeft: 1, unitValue: 2490, valueLeft: 2490 },
      { index: 1, kind: 'ITEM', orderLineId: GIFT, name: 'Gift cream', quantityLeft: 1, unitValue: 0, valueLeft: 0 },
      { index: 2, kind: 'SHIPPING', orderLineId: null, name: 'Ship', quantityLeft: 1, unitValue: 500, valueLeft: 500 },
    ]);
  });

  it('a gift unit is valued 0; its credit line keeps the price before discounts', () => {
    const options = creditOptions(invoice, [invoice], order);
    const built = refundCreditLine(invoice, options, 1, 1);
    expect(built).toEqual({ line: { ...gift, quantity: 1, total: 0, grossTotal: 3100 }, value: 0, quantity: 1 });
    expect(refundCreditLine(invoice, options, 1, 2)).toEqual({ issue: 'quantity', code: 'QUANTITY_EXCEEDS_CREDITABLE' });
  });

  it('a stored gift element is credited at 0; any other stored value is refused', () => {
    const options = creditOptions(invoice, [invoice], order);
    expect(refundStoredCreditLine(invoice, options, { index: 1, quantity: 1, value: 0 })).toEqual({
      line: { ...gift, quantity: 1, total: 0, grossTotal: 3100 },
      value: 0,
      quantity: 1,
    });
    expect(refundStoredCreditLine(invoice, options, { index: 1, quantity: 1, value: 1 })).toBeNull();
    // A paid element still needs a value above 0.
    expect(refundStoredCreditLine(invoice, options, { index: 0, quantity: 1, value: 0 })).toBeNull();
  });

  it('a refund holding the gift reserves it: not offered again, its unit refunded, the value unchanged', () => {
    const refunds = [refund(1, [{ index: 1, quantity: 1, value: 0 }])];
    const docs = [invoice, ...refundReservationDocs(refunds, [invoice])];
    const options = creditOptions(invoice, docs, order);
    expect(refundCreditOptions(invoice, options).map((o) => o.index)).toEqual([0, 2]);
    expect(refundCreditedUnits(docs).get(GIFT)).toBe(1);
    const position = invoicingPosition(order, [invoice]);
    const p = { docs: [invoice], order, position, held: 2990 };
    expect(invoicedRefundableAmount({ ...p, refunds })).toBe(2990);
    expect(invoicedUnitsOnlyAvailable({ ...p, refunds: [] })).toBe(true);
    expect(invoicedUnitsOnlyAvailable({ ...p, refunds })).toBe(false);
  });

  it('a RETURN or a CORRECTION never credits the gift line', () => {
    const options = creditOptions(invoice, [invoice], { ...order, lines: order.lines.map((l) => ({ ...l, returnedQuantity: 1 })) });
    expect(options.returnable.map((r) => r.index)).toEqual([0]);
    const correction = buildCreditLines(invoice, options, { creditType: 'CORRECTION', lines: [], shippingIndexes: [] });
    expect(correction.creditedLines.map((e) => e.index)).toEqual([0, 2]);
  });
});
