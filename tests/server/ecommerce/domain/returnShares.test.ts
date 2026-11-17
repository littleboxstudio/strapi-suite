import { describe, it, expect } from 'vitest';
import {
  computeReturnShares,
  readReturnShares,
  type ReturnShareRecord,
  type ReturnSharesInput,
} from '../../../../server/src/services/modules/ecommerce/domain/returnShares';
import { invoiceItems } from '../../../../server/src/services/modules/ecommerce/domain/invoiceItems';
import {
  buildCreditLines,
  creditOptions,
} from '../../../../server/src/services/modules/ecommerce/domain/creditNotes';
import type { InvoiceDoc, PositionOrder } from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import type { InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';
import type { ManualDiscount } from '../../../../server/src/services/modules/ecommerce/domain/manualDiscounts';

const base = { sku: 'S', name: 'N', tax: 23, partial: false };
const itemLine = (orderLineId: number, quantity: number, total: number, discountShare: number): InvoiceLine => ({
  ...base,
  orderLineId,
  kind: 'ITEM',
  quantity,
  total,
  grossTotal: total + discountShare,
  discountShare,
});
const discountLine = (discountId: string, amount: number): InvoiceLine => ({
  ...base,
  orderLineId: null,
  kind: 'DISCOUNT',
  quantity: 1,
  total: -amount,
  discountId,
});
const invoice = (id: number, lines: InvoiceLine[]): InvoiceDoc => ({
  id,
  kind: 'INVOICE',
  status: 'ISSUED',
  creditedInvoiceId: null,
  creditType: null,
  lines,
  paymentIds: [],
  creditedLines: [],
});
const manual = (id: number, amount: number): ManualDiscount => ({
  id,
  kind: 'FIXED',
  percent: null,
  amount,
  reason: 'R',
  createdAt: '2026-11-01T00:00:00.000Z',
  actor: 'a',
});

type Line = { id: number; unitPrice: number; unitDiscount: number; quantity: number; returnedQuantity: number };
const orderOf = (lines: Line[], orderDiscount: number, manualDiscounts: ManualDiscount[], returnShares: ReturnShareRecord[]) => ({
  lines: lines.map((l) => ({ ...l, tax: 23 })),
  orderDiscount,
  shippingDiscount: 0,
  shippingTotal: 0,
  shippingTax: 23,
  shippingLines: [],
  manualDiscounts,
  applied: [],
  returnShares,
});

/** Registers a return the way the service does: shares, then the order and the records move on. */
const registerReturn = (
  state: { lines: Line[]; orderDiscount: number; records: ReturnShareRecord[] },
  docs: InvoiceDoc[],
  manualDiscounts: ManualDiscount[],
  request: ReturnSharesInput['request']
) => {
  const items = invoiceItems(orderOf(state.lines, state.orderDiscount, manualDiscounts, state.records), docs);
  const r = computeReturnShares({
    lines: state.lines,
    request,
    docs,
    annulledInvoiceIds: [],
    orderDiscount: state.orderDiscount,
    discounts: items.discounts,
    previous: state.records,
  });
  state.records = [...state.records, r.record];
  state.orderDiscount -= r.discountShare;
  for (const q of request) {
    const l = state.lines.find((x) => x.id === q.orderLineId)!;
    l.returnedQuantity += q.quantity;
  }
  return r;
};

describe('computeReturnShares (C1): refund equals the RETURN credit note', () => {
  it('(a) A €100 + B €100, m:1 €20 on invoice 1 with A: returning A refunds €80, as the credit note', () => {
    const state = {
      lines: [
        { id: 1, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
        { id: 2, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      ],
      orderDiscount: 2000,
      records: [] as ReturnShareRecord[],
    };
    const manuals = [manual(1, 2000)];
    const inv1 = invoice(1, [itemLine(1, 1, 8000, 2000), discountLine('m:1', 2000)]);
    const inv2 = invoice(2, [itemLine(2, 1, 10000, 0)]);
    const docs = [inv1, inv2];

    const r = registerReturn(state, docs, manuals, [{ orderLineId: 1, quantity: 1 }]);
    expect(r).toMatchObject({ grossValue: 10000, discountShare: 2000, refundableValue: 8000 });
    expect(r.record.discounts).toEqual([{ id: 'm:1', amount: 2000, invoiceId: 1 }]);
    expect(state.orderDiscount).toBe(0);

    // The RETURN credit note of that unit is the same €80.
    const order: PositionOrder = { ...orderOf(state.lines, state.orderDiscount, manuals, state.records) };
    const options = creditOptions(inv1, docs, order);
    const built = buildCreditLines(inv1, options, { creditType: 'RETURN', lines: [{ index: 0, quantity: 1 }], shippingIndexes: [] });
    expect(built.total).toBe(r.refundableValue);

    // No adj item; the order is not over-invoiced (B 100 = invoice 2).
    const items = invoiceItems(orderOf(state.lines, state.orderDiscount, manuals, state.records), docs);
    expect(items.discounts.map((d) => d.id)).toEqual(['m:1']);
    expect(items.discounts[0]).toMatchObject({ amount: 0, invoiced: true });
  });

  it('(b) 3 × €10.00 with €1.00 of discount on one invoice: units returned one by one refund 9.67/9.67/9.66', () => {
    const state = {
      lines: [{ id: 1, unitPrice: 1000, unitDiscount: 0, quantity: 3, returnedQuantity: 0 }],
      orderDiscount: 100,
      records: [] as ReturnShareRecord[],
    };
    const manuals = [manual(1, 100)];
    const inv = invoice(1, [itemLine(1, 3, 2900, 100), discountLine('m:1', 100)]);
    let docs: InvoiceDoc[] = [inv];
    const refunds: number[] = [];
    const credits: number[] = [];
    for (let k = 0; k < 3; k++) {
      const r = registerReturn(state, docs, manuals, [{ orderLineId: 1, quantity: 1 }]);
      refunds.push(r.refundableValue);
      const order: PositionOrder = orderOf(state.lines, state.orderDiscount, manuals, state.records);
      const built = buildCreditLines(inv, creditOptions(inv, docs, order), {
        creditType: 'RETURN',
        lines: [{ index: 0, quantity: 1 }],
        shippingIndexes: [],
      });
      credits.push(built.total);
      docs = [
        ...docs,
        {
          ...invoice(10 + k, built.lines),
          kind: 'CREDIT_NOTE',
          creditedInvoiceId: 1,
          creditType: 'RETURN',
          creditedLines: built.creditedLines,
        },
      ];
      // Never an adj item.
      const items = invoiceItems(orderOf(state.lines, state.orderDiscount, manuals, state.records), docs);
      expect(items.discounts.map((d) => d.id)).toEqual(['m:1']);
    }
    expect(refunds).toEqual([967, 967, 966]);
    expect(credits).toEqual(refunds);
    expect(refunds.reduce((s, v) => s + v, 0)).toBe(2900);
    expect(state.orderDiscount).toBe(0);
  });

  it('a line not invoiced takes the pro-rata share of the ORDER discounts not invoiced', () => {
    const state = {
      lines: [
        { id: 1, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
        { id: 2, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      ],
      orderDiscount: 2000,
      records: [] as ReturnShareRecord[],
    };
    const manuals = [manual(1, 2000)];
    const r = registerReturn(state, [], manuals, [{ orderLineId: 1, quantity: 1 }]);
    expect(r).toMatchObject({ discountShare: 1000, refundableValue: 9000 });
    expect(r.record.discounts).toEqual([{ id: 'm:1', amount: 1000, invoiceId: null }]);
    const items = invoiceItems(orderOf(state.lines, state.orderDiscount, manuals, state.records), []);
    expect(items.discounts).toEqual([expect.objectContaining({ id: 'm:1', amount: 1000, invoiced: false })]);
  });

  it('a line not invoiced, while the discount is on another invoice, takes no share', () => {
    const state = {
      lines: [
        { id: 1, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
        { id: 2, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      ],
      orderDiscount: 2000,
      records: [] as ReturnShareRecord[],
    };
    const manuals = [manual(1, 2000)];
    const docs = [invoice(1, [itemLine(1, 1, 8000, 2000), discountLine('m:1', 2000)])];
    const r = registerReturn(state, docs, manuals, [{ orderLineId: 2, quantity: 1 }]);
    expect(r).toMatchObject({ discountShare: 0, refundableValue: 10000 });
    const items = invoiceItems(orderOf(state.lines, state.orderDiscount, manuals, state.records), docs);
    expect(items.discounts.map((d) => d.id)).toEqual(['m:1']);
  });

  it('the pool share never exceeds the order discount before the return (discount items above it)', () => {
    // The discount items say €20 but the stored order discount is €10 (a negative adj item).
    const lines = [
      { id: 1, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      { id: 2, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
    ];
    const r = computeReturnShares({
      lines,
      request: [
        { orderLineId: 1, quantity: 1 },
        { orderLineId: 2, quantity: 1 },
      ],
      docs: [],
      annulledInvoiceIds: [],
      orderDiscount: 1000,
      discounts: [
        { id: 'm:1', kind: 'ORDER', amount: 2000, invoiced: false },
        { id: 'adj:order', kind: 'ORDER', amount: -1000, invoiced: false },
      ],
      previous: [],
    });
    expect(r.discountShare).toBe(1000);
    expect(r.refundableValue).toBe(19000);
    expect(r.record.discounts).toEqual([{ id: 'm:1', amount: 1000, invoiceId: null }]);
  });

  it('the pool share is capped at the order discount less the invoice shares of this return', () => {
    // Line 1 on a whole-item invoice with €10 of share; €5 not invoiced but the order holds €12.
    const lines = [
      { id: 1, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      { id: 2, unitPrice: 10000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
    ];
    const docs = [invoice(1, [itemLine(1, 1, 9000, 1000), discountLine('m:1', 1000)])];
    const r = computeReturnShares({
      lines,
      request: [
        { orderLineId: 1, quantity: 1 },
        { orderLineId: 2, quantity: 1 },
      ],
      docs,
      annulledInvoiceIds: [],
      orderDiscount: 1200,
      discounts: [
        { id: 'm:1', kind: 'ORDER', amount: 1000, invoiced: true },
        { id: 'm:2', kind: 'ORDER', amount: 500, invoiced: false },
      ],
      previous: [],
    });
    expect(r.items).toEqual([
      { orderLineId: 1, quantity: 1, value: 10000, share: 1000 },
      { orderLineId: 2, quantity: 1, value: 10000, share: 200 },
    ]);
    expect(r.discountShare).toBe(1200);
  });

  describe('units an INVOICED refund took (plan 15 final fixes 2)', () => {
    const refundDoc = (id: number, status: InvoiceDoc['status'], value: number): InvoiceDoc => ({
      id,
      kind: 'CREDIT_NOTE',
      status,
      creditType: 'REFUND',
      creditedInvoiceId: 1,
      lines: [],
      paymentIds: [],
      creditedLines: [{ invoiceId: 1, index: 0, quantity: 1, value }],
    });
    const run = (docs: InvoiceDoc[]) =>
      computeReturnShares({
        lines: [{ id: 1, unitPrice: 600, unitDiscount: 0, quantity: 2, returnedQuantity: 0 }],
        request: [{ orderLineId: 1, quantity: 1 }],
        docs,
        annulledInvoiceIds: [],
        orderDiscount: 199,
        discounts: [{ id: 'm:1', kind: 'ORDER', amount: 199, invoiced: true }],
        previous: [],
      });
    const inv = invoice(1, [itemLine(1, 2, 1001, 199), discountLine('m:1', 199)]);

    it('a reserved unit (501) counts as taken: the other unit gives back 500, as its RETURN credit note', () => {
      const docs = [inv, refundDoc(-7, 'ISSUED', 501)];
      const r = run(docs);
      expect(r).toMatchObject({ grossValue: 600, discountShare: 100, refundableValue: 500 });
      expect(r.record.invoiceShares).toEqual([{ invoiceId: 1, index: 0, quantity: 1, share: 100 }]);
      const order: PositionOrder = orderOf(
        [{ id: 1, unitPrice: 600, unitDiscount: 0, quantity: 2, returnedQuantity: 1 }],
        99,
        [manual(1, 199)],
        [r.record]
      );
      const built = buildCreditLines(inv, creditOptions(inv, docs, order), {
        creditType: 'RETURN',
        lines: [{ index: 0, quantity: 1 }],
        shippingIndexes: [],
      });
      expect(built.total).toBe(500);
      // Invoiced 1001 = refund 501 + return 500.
      expect(501 + built.total).toBe(1001);
    });

    it('a live REFUND credit note counts as taken; a FAILED one does not', () => {
      expect(run([inv, refundDoc(9, 'PENDING', 501)]).refundableValue).toBe(500);
      expect(run([inv, refundDoc(9, 'FAILED', 501)]).refundableValue).toBe(501);
    });
  });

  it('readReturnShares reads what a return row stores and drops malformed entries', () => {
    expect(
      readReturnShares({
        lines: [],
        discounts: [{ id: 'm:1', amount: 200, invoiceId: 3 }, { id: '', amount: 1 }, { id: 'p:1:0', amount: 5, invoiceId: null }],
        invoiceShares: [{ invoiceId: 3, index: 0, quantity: 1, share: 200 }, { invoiceId: 'x' }],
      })
    ).toEqual({
      discounts: [
        { id: 'm:1', amount: 200, invoiceId: 3 },
        { id: 'p:1:0', amount: 5, invoiceId: null },
      ],
      invoiceShares: [{ invoiceId: 3, index: 0, quantity: 1, share: 200 }],
    });
    expect(readReturnShares(null)).toEqual({ discounts: [], invoiceShares: [] });
  });
});
