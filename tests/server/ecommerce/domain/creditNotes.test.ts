import { describe, it, expect } from 'vitest';
import {
  creditOptions,
  buildCreditLines,
  settledShippingLineIds,
  type CreditRequest,
} from '../../../../server/src/services/modules/ecommerce/domain/creditNotes';
import type {
  InvoiceDoc,
  PositionOrder,
} from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import { withTotal, type InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';

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

  it('a credited part keeps the discount percentage of its line (grossTotal scales)', () => {
    expect(
      withTotal({ ...item(1, 3600, false), quantity: 2, grossTotal: 4000 }, 1800)
    ).toMatchObject({ total: 1800, grossTotal: 2000 });
    expect(withTotal(item(1, 900, true), 450)).not.toHaveProperty('grossTotal');
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

describe('SHIPPING credit notes (shipping recalculated below what was invoiced)', () => {
  /** Shipping now charges 500 − 260: a credit line after the invoiced one. */
  const lowered = (): PositionOrder => {
    const o = order();
    return {
      ...o,
      shippingTotal: 240,
      shippingLines: [
        ...o.shippingLines,
        { ...o.shippingLines[0], id: 2, origin: 'RECALCULATION', amount: -260 },
      ],
    };
  };
  const inv = invoice([item(3, 1500), ship]);

  it('offers the shipping invoiced above what is charged, on the invoice shipping line', () => {
    const options = creditOptions(inv, [inv], lowered());
    expect(options.shippingAdjustment).toEqual([{ index: 1, value: 260 }]);
    const built = buildCreditLines(inv, options, { creditType: 'SHIPPING', lines: [], shippingIndexes: [] });
    expect(built.issues).toEqual([]);
    expect(built.total).toBe(260);
    expect(built.lines).toEqual([expect.objectContaining({ kind: 'SHIPPING', total: 260 })]);
  });

  it('nothing to adjust when the shipping is not over-invoiced; lines or indexes are refused', () => {
    const options = creditOptions(inv, [inv], order());
    expect(options.shippingAdjustment).toEqual([]);
    expect(buildCreditLines(inv, options, { creditType: 'SHIPPING', lines: [], shippingIndexes: [] }).issues).toEqual([
      { path: 'creditType', code: 'NOTHING_TO_CREDIT' },
    ]);
    const over = creditOptions(inv, [inv], lowered());
    expect(
      buildCreditLines(inv, over, { creditType: 'SHIPPING', lines: [{ index: 0, quantity: 1 }], shippingIndexes: [1] })
        .issues
    ).toEqual([
      { path: 'lines', code: 'invalid' },
      { path: 'shippingIndexes', code: 'invalid' },
    ]);
  });

  it('once issued, nothing is left to adjust', () => {
    const options = creditOptions(inv, [inv], lowered());
    const built = buildCreditLines(inv, options, { creditType: 'SHIPPING', lines: [], shippingIndexes: [] });
    const cn: InvoiceDoc = {
      ...credit(2, 'SHIPPING', built.creditedLines),
      lines: built.lines,
    };
    expect(creditOptions(inv, [inv, cn], lowered()).shippingAdjustment).toEqual([]);
    // A pending one counts too.
    expect(creditOptions(inv, [inv, { ...cn, status: 'PENDING' }], lowered()).shippingAdjustment).toEqual([]);
  });
});

describe('discount shares (invoices of whole items)', () => {
  /** 3 units at 3100 net, 1000 of order discount spread on them; shipping 500; the discount. */
  const shared = (): InvoiceLine => ({ ...item(3, 8300), grossTotal: 9300, discountShare: 1000 });
  const shipShared: InvoiceLine = { ...ship, grossTotal: 500, discountShare: 0 };
  const discount: InvoiceLine = {
    orderLineId: null,
    kind: 'DISCOUNT',
    sku: 'DISCOUNT',
    name: 'Gesture',
    quantity: 1,
    total: -1000,
    grossTotal: -1000,
    tax: 0,
    partial: false,
    discountId: 'm:1',
  };
  const shareInvoice = () => invoice([shared(), shipShared, discount]);
  const shareOrder = (returnedQuantity: number) =>
    order({ unitPrice: 3100, returnedQuantity });

  it('RETURN of 1 of 3 units with share 1000 credits net − 333', () => {
    const inv = shareInvoice();
    const r = buildCreditLines(
      inv,
      creditOptions(inv, [inv], shareOrder(1)),
      request({ lines: [{ index: 0, quantity: 1 }] })
    );
    expect(r.issues).toEqual([]);
    expect(r.total).toBe(2767);
    expect(r.creditedLines).toEqual([{ index: 0, value: 2767, quantity: 1 }]);
    expect(r.lines).toEqual([
      { ...shared(), quantity: 1, total: 2767, grossTotal: 3100, discountShare: 333 },
    ]);
  });

  it('the last unit takes the remaining share', () => {
    const inv = shareInvoice();
    const first = credit(2, 'RETURN', [{ index: 0, value: 2 * 3100 - 666, quantity: 2 }]);
    const options = creditOptions(inv, [inv, first], shareOrder(3));
    expect(options.returnable).toEqual([{ index: 0, units: 1, unitsLeft: 1, valueLeft: 2766 }]);
    const r = buildCreditLines(inv, options, request({ lines: [{ index: 0, quantity: 1 }] }));
    expect(r.issues).toEqual([]);
    expect(r.total).toBe(3100 - 334);
    expect(r.lines[0]).toMatchObject({ quantity: 1, total: 2766, grossTotal: 3100, discountShare: 334 });
    // One unit at a time adds up to the line total too.
    const one = credit(2, 'RETURN', [{ index: 0, value: 2767, quantity: 1 }]);
    const two = buildCreditLines(
      inv,
      creditOptions(inv, [inv, one], shareOrder(2)),
      request({ lines: [{ index: 0, quantity: 1 }] })
    );
    expect(two.total).toBe(3100 - 333);
    const second = credit(3, 'RETURN', [{ index: 0, value: two.total, quantity: 1 }]);
    const three = buildCreditLines(
      inv,
      creditOptions(inv, [inv, one, second], shareOrder(3)),
      request({ lines: [{ index: 0, quantity: 1 }] })
    );
    expect(2767 + two.total + three.total).toBe(8300);
  });

  it('CORRECTION credits the invoice total and never a DISCOUNT line alone', () => {
    const inv = shareInvoice();
    const r = buildCreditLines(inv, creditOptions(inv, [inv], shareOrder(0)), request({ creditType: 'CORRECTION' }));
    expect(r.issues).toEqual([]);
    expect(r.total).toBe(8300 + 500);
    expect(r.lines).toEqual([shared(), shipShared, discount]);
    expect(r.creditedLines).toEqual([
      { index: 0, value: 8300, quantity: 3 },
      { index: 1, value: 500, quantity: 1 },
      { index: 2, value: 0, quantity: 0 },
    ]);

    // After a RETURN of one unit: the rest, with the share it still holds.
    const one = credit(2, 'RETURN', [{ index: 0, value: 2767, quantity: 1 }]);
    const rest = buildCreditLines(
      inv,
      creditOptions(inv, [inv, one], shareOrder(1)),
      request({ creditType: 'CORRECTION' })
    );
    expect(rest.total).toBe(8300 + 500 - 2767);
    expect(rest.lines[0]).toEqual({ ...shared(), quantity: 2, total: 5533, grossTotal: 6200, discountShare: 667 });
    expect(rest.lines[2]).toEqual(discount);

    // Only a DISCOUNT line left: nothing to credit.
    const all = credit(3, 'RETURN', [
      { index: 0, value: 8300, quantity: 3 },
      { index: 1, value: 500, quantity: 1 },
    ]);
    expect(
      buildCreditLines(inv, creditOptions(inv, [inv, all], shareOrder(3)), request({ creditType: 'CORRECTION' }))
        .issues
    ).toEqual([{ path: 'lines', code: 'required' }]);
  });

  it('a DISCOUNT line is not creditable', () => {
    const inv = shareInvoice();
    const options = creditOptions(inv, [inv], shareOrder(1));
    expect(options.creditable[2]).toBe(0);
    expect(options.unitsLeft[2]).toBe(0);
    expect(options.returnable.map((r) => r.index)).toEqual([0]);
    expect(options.shipping.map((s) => s.index)).toEqual([1]);
    const r = buildCreditLines(inv, options, request({ lines: [{ index: 2, quantity: 1 }], shippingIndexes: [2] }));
    expect(r.issues).toEqual([
      { path: 'lines.0.index', code: 'invalid' },
      { path: 'shippingIndexes.0', code: 'SHIPPING_NOT_CREDITABLE' },
    ]);
  });

  it('a legacy line (no discountShare) keeps the proportional rule', () => {
    const inv = invoice([{ ...item(3, 1000), grossTotal: 1500 }]);
    const r = buildCreditLines(inv, creditOptions(inv, [inv], order(returned)), request({ lines: [{ index: 0, quantity: 1 }] }));
    expect(r.total).toBe(333);
    expect(r.lines[0]).not.toHaveProperty('discountShare');
  });
});

describe('settledShippingLineIds', () => {
  const s = (shippingLineId: number, value: number, invoiced = false) => ({ shippingLineId, value, invoiced });

  it('settles the negative lines the credit covers, oldest first', () => {
    expect(settledShippingLineIds([s(1, 500, true), s(2, -300)], 300)).toEqual([2]);
    expect(settledShippingLineIds([s(1, 500, true), s(2, -100), s(3, -200), s(4, -50)], 300)).toEqual([2, 3]);
  });

  it('a line the credit does not cover, an invoiced one or a positive one is not settled', () => {
    expect(settledShippingLineIds([s(2, -300)], 200)).toEqual([]);
    expect(settledShippingLineIds([s(2, -300, true), s(3, 400)], 300)).toEqual([]);
    expect(settledShippingLineIds([s(2, -300)], 0)).toEqual([]);
  });
});
