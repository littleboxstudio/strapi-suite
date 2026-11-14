import { describe, it, expect } from 'vitest';
import {
  creditOptions,
  buildCreditLines,
  type CreditRequest,
} from '../../../../server/src/services/modules/ecommerce/domain/creditNotes';
import type {
  InvoiceDoc,
  PositionOrder,
} from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import type { InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';

const A = 10;

const order = (over: Partial<PositionOrder['lines'][number]> = {}): PositionOrder => ({
  lines: [
    { id: A, unitPrice: 500, unitDiscount: 0, quantity: 3, returnedQuantity: 0, tax: 23, ...over },
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
});

const item = (quantity: number, total: number, partial = false): InvoiceLine => ({
  orderLineId: A,
  kind: 'ITEM',
  sku: 'SKU-A',
  name: 'A',
  quantity,
  total,
  tax: 23,
  partial,
});

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

const invoice = (lines: InvoiceLine[]): InvoiceDoc => ({
  id: 1,
  kind: 'INVOICE',
  status: 'ISSUED',
  creditedInvoiceId: null,
  creditType: null,
  lines,
  paymentIds: [],
  creditedLines: [],
});

const credit = (
  id: number,
  creditType: InvoiceDoc['creditType'],
  creditedLines: InvoiceDoc['creditedLines'],
  status: InvoiceDoc['status'] = 'ISSUED'
): InvoiceDoc => ({
  id,
  kind: 'CREDIT_NOTE',
  status,
  creditedInvoiceId: 1,
  creditType,
  lines: [],
  paymentIds: [],
  creditedLines,
});

const returned = { returnedQuantity: 1 };
const full = () => invoice([item(3, 1500), ship]);
const request = (over: Partial<CreditRequest> = {}): CreditRequest => ({
  creditType: 'RETURN',
  lines: [],
  shippingIndexes: [],
  ...over,
});

describe('creditOptions', () => {
  it('offers the returned unit and the shipping line', () => {
    const inv = full();
    const o = creditOptions(inv, [inv], order(returned));
    expect(o.creditable).toEqual([1500, 500]);
    expect(o.unitsLeft).toEqual([3, 0]);
    expect(o.returnable).toEqual([{ index: 0, units: 1, unitsLeft: 3, valueLeft: 1500 }]);
    expect(o.shipping).toEqual([{ index: 1, value: 500 }]);
  });

  it('a live PENDING RETURN credit takes the unit', () => {
    const inv = full();
    const cn = credit(2, 'RETURN', [{ index: 0, value: 500, quantity: 1 }], 'PENDING');
    const o = creditOptions(inv, [inv, cn], order(returned));
    expect(o.returnable).toEqual([{ index: 0, units: 0, unitsLeft: 2, valueLeft: 1000 }]);
  });

  it('a FAILED credit note does not count', () => {
    const inv = full();
    const cn = credit(2, 'RETURN', [{ index: 0, value: 500, quantity: 1 }], 'FAILED');
    const o = creditOptions(inv, [inv, cn], order(returned));
    expect(o.returnable[0]).toMatchObject({ units: 1, unitsLeft: 3 });
  });

  it('a quantity lowered by an edit, without a return, is not returnable', () => {
    const inv = full();
    const o = creditOptions(inv, [inv], order({ quantity: 2 }));
    expect(o.returnable).toEqual([{ index: 0, units: 0, unitsLeft: 3, valueLeft: 1500 }]);
  });

  it('a legacy partial line is not returnable', () => {
    const inv = invoice([item(1, 900, true)]);
    const o = creditOptions(inv, [inv], order(returned));
    expect(o.returnable).toEqual([]);
    expect(o.creditable).toEqual([900]);
  });

  it('a fully credited line has nothing left', () => {
    const inv = full();
    const cn = credit(2, 'RETURN', [{ index: 0, value: 1500, quantity: 3 }]);
    const o = creditOptions(inv, [inv, cn], order({ returnedQuantity: 3 }));
    expect(o.creditable).toEqual([0, 500]);
    expect(o.unitsLeft).toEqual([0, 0]);
    expect(o.returnable).toEqual([]);
  });
});

describe('buildCreditLines, RETURN', () => {
  const build = (req: CreditRequest, docs?: InvoiceDoc[]) => {
    const inv = full();
    const all = docs ?? [inv];
    return buildCreditLines(inv, creditOptions(inv, all, order(returned)), req);
  };

  it('credits the units and the shipping line', () => {
    const r = build(request({ lines: [{ index: 0, quantity: 1 }], shippingIndexes: [1] }));
    expect(r.issues).toEqual([]);
    expect(r.lines).toEqual([
      { ...item(1, 500), partial: false },
      { ...ship, total: 500 },
    ]);
    expect(r.lines[1].shippingLineId).toBe(1);
    expect(r.creditedLines).toEqual([
      { index: 0, value: 500, quantity: 1 },
      { index: 1, value: 500, quantity: 1 },
    ]);
    expect(r.total).toBe(1000);
  });

  it('rejects more units than returnable', () => {
    const r = build(request({ lines: [{ index: 0, quantity: 2 }] }));
    expect(r.issues).toEqual([{ path: 'lines.0.quantity', code: 'QUANTITY_EXCEEDS_CREDITABLE' }]);
    expect(r.lines).toEqual([]);
  });

  it('rejects an ITEM index as shipping', () => {
    const r = build(request({ shippingIndexes: [0] }));
    expect(r.issues).toEqual([{ path: 'shippingIndexes.0', code: 'SHIPPING_NOT_CREDITABLE' }]);
  });

  it('requires something to credit', () => {
    expect(build(request()).issues).toEqual([{ path: 'lines', code: 'required' }]);
  });
});

describe('buildCreditLines, CORRECTION', () => {
  it('credits what is left of every line', () => {
    const inv = full();
    const cn = credit(2, 'RETURN', [{ index: 0, value: 500, quantity: 1 }]);
    const docs = [inv, cn];
    const r = buildCreditLines(
      inv,
      creditOptions(inv, docs, order(returned)),
      request({ creditType: 'CORRECTION' })
    );
    expect(r.issues).toEqual([]);
    expect(r.lines).toEqual([item(2, 1000), { ...ship, total: 500 }]);
    expect(r.creditedLines).toEqual([
      { index: 0, value: 1000, quantity: 2 },
      { index: 1, value: 500, quantity: 1 },
    ]);
    expect(r.total).toBe(1500);
  });

  it('rejects lines', () => {
    const inv = full();
    const r = buildCreditLines(
      inv,
      creditOptions(inv, [inv], order()),
      request({ creditType: 'CORRECTION', lines: [{ index: 0, quantity: 1 }] })
    );
    expect(r.issues).toEqual([{ path: 'lines', code: 'invalid' }]);
  });

  it('credits a legacy partial line through creditLine', () => {
    const inv = invoice([item(1, 900, true)]);
    const r = buildCreditLines(
      inv,
      creditOptions(inv, [inv], order()),
      request({ creditType: 'CORRECTION' })
    );
    expect(r.lines).toEqual([item(1, 900, true)]);
  });

  it('leaves out a fully credited line', () => {
    const inv = full();
    const cn = credit(2, 'RETURN', [{ index: 0, value: 1500, quantity: 3 }]);
    const r = buildCreditLines(
      inv,
      creditOptions(inv, [inv, cn], order()),
      request({ creditType: 'CORRECTION' })
    );
    expect(r.lines).toEqual([{ ...ship, total: 500 }]);
    expect(r.creditedLines).toEqual([{ index: 1, value: 500, quantity: 1 }]);
  });
});
