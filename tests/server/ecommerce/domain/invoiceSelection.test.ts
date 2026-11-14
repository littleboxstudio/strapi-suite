import { describe, it, expect } from 'vitest';
import {
  invoicingPosition as computePosition,
  paymentNets,
  priceSelection,
  fitsPosition,
  selectedValue,
  readInvoiceDoc,
  type InvoiceDoc,
  type PositionOrder,
  type InvoicingPosition,
} from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import {
  readInvoiceLines,
  type InvoiceLine,
} from '../../../../server/src/services/modules/ecommerce/domain/invoicing';
import type {
  ShippingLine,
  ShippingLineOrigin,
} from '../../../../server/src/services/modules/ecommerce/domain/shippingLines';

const A = 10;
const B = 20;

const shippingLine = (id: number, origin: ShippingLineOrigin, amount: number): ShippingLine => ({
  id,
  origin,
  amount,
  providerId: 'p',
  serviceId: 's',
  name: 'Ship',
  tax: 23,
  createdAt: '2026-11-01T00:00:00.000Z',
  actor: 'system',
});

/** A (2 × 1000), B (1 × 500), order discount 300, one CHECKOUT shipping line of 500. */
const baseOrder = (over: Partial<PositionOrder> = {}): PositionOrder => ({
  lines: [
    { id: A, unitPrice: 1000, unitDiscount: 0, quantity: 2, returnedQuantity: 0, tax: 23 },
    { id: B, unitPrice: 500, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
  ],
  orderDiscount: 300,
  shippingTotal: 500,
  shippingTax: 23,
  shippingLines: [shippingLine(1, 'CHECKOUT', 500)],
  ...over,
});

const item = (
  orderLineId: number,
  quantity: number,
  total: number,
  partial = false
): InvoiceLine => ({
  orderLineId,
  kind: 'ITEM',
  sku: 'SKU',
  name: 'Item',
  quantity,
  total,
  tax: 23,
  partial,
});

const ship = (total: number, shippingLineId?: number): InvoiceLine => ({
  orderLineId: null,
  kind: 'SHIPPING',
  sku: 'SHIP',
  name: 'Ship',
  quantity: 1,
  total,
  tax: 23,
  partial: false,
  ...(shippingLineId !== undefined ? { shippingLineId } : {}),
});

const invoice = (id: number, lines: InvoiceLine[], over: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  id,
  kind: 'INVOICE',
  status: 'ISSUED',
  creditedInvoiceId: null,
  creditType: null,
  lines,
  paymentIds: [],
  creditedLines: [],
  ...over,
});

const creditNote = (
  id: number,
  creditedInvoiceId: number,
  creditType: InvoiceDoc['creditType'],
  lines: InvoiceLine[],
  over: Partial<InvoiceDoc> = {}
): InvoiceDoc => ({
  id,
  kind: 'CREDIT_NOTE',
  status: 'ISSUED',
  creditedInvoiceId,
  creditType,
  lines,
  paymentIds: [],
  creditedLines: [],
  ...over,
});

const total = (values: number[]) => values.reduce((s, v) => s + v, 0);

/**
 * The position, checked against the invariant Σ invoiced + Σ remainingValue + stranded = order
 * total whenever it is checkable (no pool invoiced above its due).
 */
const invoicingPosition = (order: PositionOrder, docs: InvoiceDoc[]): InvoicingPosition => {
  const p = computePosition(order, docs);
  expect(p.stranded.products).toBeGreaterThanOrEqual(0);
  expect(p.stranded.shipping).toBeGreaterThanOrEqual(0);
  if (p.products.invoiced <= p.products.due && p.shippingPool.invoiced <= p.shippingPool.due) {
    expect(
      p.products.invoiced +
        p.shippingPool.invoiced +
        total(p.lines.map((l) => l.remainingValue)) +
        total(p.shipping.map((s) => s.remainingValue)) +
        p.stranded.products +
        p.stranded.shipping
    ).toBe(p.products.due + p.shippingPool.due);
  }
  return p;
};

const lineOf = (p: InvoicingPosition, id: number) => p.lines.find((l) => l.orderLineId === id)!;
const shipOf = (p: InvoicingPosition, id: number) =>
  p.shipping.find((s) => s.shippingLineId === id)!;

/** Invoice 100: A × 1 (880) and shipping line 1 (500). */
const firstInvoice = (over: Partial<InvoiceDoc> = {}) =>
  invoice(100, [item(A, 1, 880), ship(500, 1)], over);

describe('invoicingPosition', () => {
  it('with no documents everything is left, valued like coverageDues', () => {
    const p = invoicingPosition(baseOrder(), []);
    expect(p.products).toEqual({ due: 2200, invoiced: 0, remaining: 2200 });
    expect(p.shippingPool).toEqual({ due: 500, invoiced: 0, remaining: 500 });
    expect(p.lines).toEqual([
      {
        orderLineId: A,
        invoicedUnits: 0,
        returnCreditedUnits: 0,
        remainingQuantity: 2,
        remainingValue: 1760,
      },
      {
        orderLineId: B,
        invoicedUnits: 0,
        returnCreditedUnits: 0,
        remainingQuantity: 1,
        remainingValue: 440,
      },
    ]);
    expect(p.shipping).toEqual([
      { shippingLineId: 1, amount: 500, invoiced: false, available: true, remainingValue: 500 },
    ]);
    expect(p.annulledInvoiceIds).toEqual([]);
    expect(p.stranded).toEqual({ products: 0, shipping: 0 });
  });

  it('an ISSUED invoice consumes its units, value and shipping lines', () => {
    const p = invoicingPosition(baseOrder(), [firstInvoice()]);
    expect(lineOf(p, A)).toMatchObject({
      invoicedUnits: 1,
      remainingQuantity: 1,
      remainingValue: 880,
    });
    expect(lineOf(p, B)).toMatchObject({
      invoicedUnits: 0,
      remainingQuantity: 1,
      remainingValue: 440,
    });
    expect(p.products).toEqual({ due: 2200, invoiced: 880, remaining: 1320 });
    expect(shipOf(p, 1)).toEqual({
      shippingLineId: 1,
      amount: 500,
      invoiced: true,
      available: false,
      remainingValue: 0,
    });
    expect(p.shippingPool).toEqual({ due: 500, invoiced: 500, remaining: 0 });
    expect(p.stranded).toEqual({ products: 0, shipping: 0 });
  });

  it('an UNCERTAIN or PENDING invoice counts like an ISSUED one; a FAILED one is ignored', () => {
    const issued = invoicingPosition(baseOrder(), [firstInvoice()]);
    expect(invoicingPosition(baseOrder(), [firstInvoice({ status: 'UNCERTAIN' })])).toEqual(issued);
    expect(invoicingPosition(baseOrder(), [firstInvoice({ status: 'PENDING' })])).toEqual(issued);
    expect(invoicingPosition(baseOrder(), [firstInvoice({ status: 'FAILED' })])).toEqual(
      invoicingPosition(baseOrder(), [])
    );
  });

  it('an ISSUED CORRECTION annuls the invoice; a PENDING one does not', () => {
    const correction = creditNote(200, 100, 'CORRECTION', [item(A, 1, 880), ship(500, 1)]);
    const p = invoicingPosition(baseOrder(), [firstInvoice(), correction]);
    expect(p.annulledInvoiceIds).toEqual([100]);
    expect({ ...p, annulledInvoiceIds: [] }).toEqual(invoicingPosition(baseOrder(), []));

    const pending = invoicingPosition(baseOrder(), [
      firstInvoice(),
      { ...correction, status: 'PENDING' },
    ]);
    expect(pending.annulledInvoiceIds).toEqual([]);
    expect(lineOf(pending, A).remainingQuantity).toBe(1);
  });

  describe('returns', () => {
    const fullA = () => invoice(100, [item(A, 2, 1760)]);
    const returnedA = () =>
      baseOrder({
        lines: [
          { id: A, unitPrice: 1000, unitDiscount: 0, quantity: 2, returnedQuantity: 1, tax: 23 },
          { id: B, unitPrice: 500, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
        ],
      });

    it('a unit returned after being invoiced is not left to invoice', () => {
      const p = invoicingPosition(returnedA(), [fullA()]);
      expect(lineOf(p, A)).toMatchObject({
        invoicedUnits: 2,
        returnCreditedUnits: 0,
        remainingQuantity: 0,
        remainingValue: 0,
      });
    });

    it('a RETURN credit note keeps it at 0 and nets the invoiced value', () => {
      const cn = creditNote(200, 100, 'RETURN', [item(A, 1, 880)], {
        creditedLines: [{ index: 0, value: 880, quantity: 1 }],
      });
      const p = invoicingPosition(returnedA(), [fullA(), cn]);
      expect(lineOf(p, A)).toMatchObject({
        invoicedUnits: 2,
        returnCreditedUnits: 1,
        remainingQuantity: 0,
      });
      expect(p.products.invoiced).toBe(1760 - 880);
    });

    it('a legacy credit note (no creditType) reads as RETURN with partial ? 0 : quantity units', () => {
      const whole = creditNote(200, 100, null, [item(A, 1, 880)]);
      expect(lineOf(invoicingPosition(returnedA(), [fullA(), whole]), A).returnCreditedUnits).toBe(
        1
      );
      const partial = creditNote(200, 100, null, [item(A, 1, 500, true)]);
      expect(
        lineOf(invoicingPosition(returnedA(), [fullA(), partial]), A).returnCreditedUnits
      ).toBe(0);
    });

    it('a PENDING RETURN credit note does not reduce what is invoiced', () => {
      const cn = creditNote(200, 100, 'RETURN', [item(A, 1, 880)], {
        status: 'PENDING',
        creditedLines: [{ index: 0, value: 880, quantity: 1 }],
      });
      const p = invoicingPosition(returnedA(), [fullA(), cn]);
      expect(lineOf(p, A).returnCreditedUnits).toBe(0);
      expect(p.products.invoiced).toBe(1760);
    });

    it('a unit returned before invoicing simply is not invoiced', () => {
      const p = invoicingPosition(returnedA(), []);
      expect(lineOf(p, A)).toMatchObject({ invoicedUnits: 0, remainingQuantity: 1 });
    });
  });

  describe('legacy invoices', () => {
    it('a partial ITEM line counts floor(total × effective quantity / lineDue) units', () => {
      const p = invoicingPosition(baseOrder(), [invoice(100, [{ ...item(A, 1, 900, true) }])]);
      expect(lineOf(p, A)).toMatchObject({ invoicedUnits: 1, remainingQuantity: 1 });
    });

    it('a partial ITEM line is clamped to the order line quantity', () => {
      const p = invoicingPosition(baseOrder(), [invoice(100, [item(A, 1, 5000, true)])]);
      expect(lineOf(p, A).invoicedUnits).toBe(2);
    });

    it('a non-partial ITEM line counts its quantity', () => {
      const p = invoicingPosition(baseOrder(), [invoice(100, [item(A, 2, 1760)])]);
      expect(lineOf(p, A)).toMatchObject({
        invoicedUnits: 2,
        remainingQuantity: 0,
        remainingValue: 0,
      });
    });

    it('a SHIPPING line without shippingLineId invoices the CHECKOUT line', () => {
      const order = baseOrder({
        shippingTotal: 800,
        shippingLines: [shippingLine(1, 'CHECKOUT', 500), shippingLine(2, 'MANUAL', 300)],
      });
      const p = invoicingPosition(order, [invoice(100, [ship(500)])]);
      expect(shipOf(p, 1)).toMatchObject({ invoiced: true, available: false });
      expect(shipOf(p, 2)).toMatchObject({ invoiced: false, available: true, remainingValue: 300 });
    });

    it('without a CHECKOUT line, the lowest id is invoiced', () => {
      const order = baseOrder({
        shippingTotal: 800,
        shippingLines: [shippingLine(2, 'MANUAL', 300), shippingLine(1, 'EDIT', 500)],
      });
      const p = invoicingPosition(order, [invoice(100, [ship(500)])]);
      expect(p.shipping.map((s) => s.shippingLineId)).toEqual([1, 2]);
      expect(shipOf(p, 1).invoiced).toBe(true);
      expect(shipOf(p, 2).invoiced).toBe(false);
    });
  });

  it('a negative shipping line is never available and only lowers the pool', () => {
    const order = baseOrder({
      shippingTotal: 300,
      shippingLines: [shippingLine(1, 'CHECKOUT', 500), shippingLine(2, 'EDIT', -200)],
    });
    const p = invoicingPosition(order, []);
    expect(p.shippingPool).toEqual({ due: 300, invoiced: 0, remaining: 300 });
    expect(shipOf(p, 1)).toMatchObject({ available: true, remainingValue: 300 });
    expect(shipOf(p, 2)).toMatchObject({ available: false, invoiced: false, remainingValue: 0 });
  });

  it('when every weight is 0 the pool is split by remaining quantity', () => {
    const G = 30;
    const lines = [
      { id: A, unitPrice: 1000, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
      { id: G, unitPrice: 0, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
    ];
    const discounted = baseOrder({ lines, orderDiscount: 500 });
    const before = invoicingPosition(discounted, []);
    expect(lineOf(before, A).remainingValue).toBe(500);
    const docs = [invoice(100, [item(A, 1, 500)])];

    const p = invoicingPosition({ ...discounted, orderDiscount: 0 }, docs);
    expect(p.products).toEqual({ due: 1000, invoiced: 500, remaining: 500 });
    expect(lineOf(p, A)).toMatchObject({ remainingQuantity: 0, remainingValue: 0 });
    expect(lineOf(p, G)).toMatchObject({ remainingQuantity: 1, remainingValue: 500 });
  });

  it('product value with no units left to carry it is stranded, never put on a line', () => {
    const lines = [
      { id: A, unitPrice: 1000, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 },
    ];
    const docs = [invoice(100, [item(A, 1, 500), ship(500, 1)])];
    const p = invoicingPosition(baseOrder({ lines, orderDiscount: 0 }), docs);
    expect(p.products).toEqual({ due: 1000, invoiced: 500, remaining: 500 });
    expect(p.stranded).toEqual({ products: 500, shipping: 0 });
    expect(total(p.lines.map((l) => l.remainingValue))).toBe(0);
    expect(p.lines.filter((l) => l.remainingQuantity > 0)).toEqual([]);
    expect(p.shipping.filter((s) => s.available)).toEqual([]);
  });

  it('shipping credited by a RETURN stays invoiced; its value is stranded', () => {
    const cn = creditNote(200, 100, 'RETURN', [ship(500, 1)], {
      creditedLines: [{ index: 1, value: 500, quantity: 0 }],
    });
    const p = invoicingPosition(baseOrder(), [firstInvoice(), cn]);
    expect(shipOf(p, 1)).toMatchObject({ invoiced: true, available: false, remainingValue: 0 });
    expect(p.shippingPool).toEqual({ due: 500, invoiced: 0, remaining: 500 });
    expect(p.stranded).toEqual({ products: 0, shipping: 500 });
  });

  it('invoiced parts stay fixed when the order discount changes (Review Focus 3)', () => {
    const first = selectedValue(1760, 2, 1);
    expect(first).toBe(880);
    const docs = [invoice(100, [item(A, 1, first)])];
    const p = invoicingPosition(baseOrder({ orderDiscount: 500 }), docs);
    const remaining = lineOf(p, A).remainingValue + lineOf(p, B).remainingValue;
    expect(remaining).toBe(2000 - 880);
    expect(first + remaining).toBe(p.products.due);
  });
});

describe('selectedValue', () => {
  it('floors partial quantities and returns the whole remaining value for the rest', () => {
    expect(selectedValue(1000, 3, 1)).toBe(333);
    expect(selectedValue(1000, 3, 3)).toBe(1000);
    expect(selectedValue(667, 2, 2)).toBe(667);
  });
});

describe('paymentNets', () => {
  const payments = [
    { id: 1, amount: 5000 },
    { id: 2, amount: 3000 },
  ];

  it('a linked held refund lowers its payment', () => {
    const nets = paymentNets(
      payments,
      [{ status: 'COMPLETED', amount: 1000, paymentId: 1 }],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 4000],
        [2, 3000],
      ])
    );
  });

  it('PROCESSING and PENDING refunds are held too', () => {
    const nets = paymentNets(
      payments,
      [
        { status: 'PROCESSING', amount: 1000, paymentId: 1 },
        { status: 'PENDING', amount: 500, paymentId: 2 },
      ],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 4000],
        [2, 2500],
      ])
    );
  });

  it('an unlinked refund goes to the latest payment not invoiced first (Review Focus 1)', () => {
    const nets = paymentNets(
      [
        { id: 2, amount: 3000 },
        { id: 1, amount: 5000 },
      ],
      [{ status: 'COMPLETED', amount: 1000, paymentId: null }],
      new Set([1])
    );
    expect(nets.get(1)).toBe(5000);
    expect(nets.get(2)).toBe(2000);
  });

  it('an unlinked refund goes to the latest payment when none is invoiced', () => {
    const nets = paymentNets(
      payments,
      [{ status: 'COMPLETED', amount: 1000, paymentId: null }],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 5000],
        [2, 2000],
      ])
    );
  });

  it('the pool spills to earlier payments, then to invoiced ones', () => {
    const nets = paymentNets(
      [
        { id: 1, amount: 1000 },
        { id: 2, amount: 1000 },
        { id: 3, amount: 1000 },
      ],
      [{ status: 'COMPLETED', amount: 2500, paymentId: null }],
      new Set([3])
    );
    expect(nets).toEqual(
      new Map([
        [1, 0],
        [2, 0],
        [3, 500],
      ])
    );
  });

  it('ignores FAILED and CANCELLED refunds', () => {
    const nets = paymentNets(
      payments,
      [
        { status: 'FAILED', amount: 1000, paymentId: 1 },
        { status: 'CANCELLED', amount: 1000, paymentId: null },
      ],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 5000],
        [2, 3000],
      ])
    );
  });

  it('ignores a refund linked to a payment that is not COMPLETED', () => {
    const nets = paymentNets(
      payments,
      [{ status: 'COMPLETED', amount: 1000, paymentId: 9 }],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 5000],
        [2, 3000],
      ])
    );
  });

  it('caps a linked refund at its payment and sends the excess to the pool', () => {
    const nets = paymentNets(
      [
        { id: 1, amount: 3000 },
        { id: 2, amount: 1000 },
      ],
      [{ status: 'COMPLETED', amount: 1500, paymentId: 2 }],
      new Set()
    );
    expect(nets).toEqual(
      new Map([
        [1, 2500],
        [2, 0],
      ])
    );
  });
});

describe('paymentNets: refunds over time and issued invoices', () => {
  const T = (h: number) => Date.UTC(2026, 10, 14, h);

  it('a payment made after a refund never takes it; a new payment keeps its whole value', () => {
    const payments = [
      { id: 1, amount: 5000, at: T(1) },
      { id: 2, amount: 3000, at: T(5) },
    ];
    const refund = { status: 'COMPLETED', amount: 1000, paymentId: null, at: T(3) };
    expect(paymentNets(payments, [refund], new Map())).toEqual(
      new Map([
        [1, 4000],
        [2, 3000],
      ])
    );
  });

  it('an issued invoice stays true: its allocations are never cut while other money is free', () => {
    // Invoice used 1000 + 2370 of payment 2 (3990); refunds 1620 + 3990 came before payments 2 and 3.
    const payments = [
      { id: 1, amount: 1000, at: T(1) },
      { id: 2, amount: 3990, at: T(5) },
      { id: 3, amount: 3990, at: T(6) },
      { id: 4, amount: 3690, at: T(20) },
    ];
    const refunds = [
      { status: 'COMPLETED', amount: 3610, paymentId: null, at: T(4) },
      { status: 'COMPLETED', amount: 2000, paymentId: null, at: T(7) },
    ];
    const allocated = new Map([
      [1, 1000],
      [2, 2370],
    ]);
    const nets = paymentNets(payments, refunds, allocated);
    expect(nets).toEqual(
      new Map([
        [1, 1000],
        [2, 2370],
        [3, 0],
        [4, 3690],
      ])
    );
  });

  it('only as a last resort does a refund cut an allocated payment', () => {
    const nets = paymentNets(
      [{ id: 1, amount: 1000, at: T(1) }],
      [{ status: 'COMPLETED', amount: 300, paymentId: null, at: T(2) }],
      new Map([[1, 1000]])
    );
    expect(nets.get(1)).toBe(700);
  });
});

describe('priceSelection', () => {
  const position = () => invoicingPosition(baseOrder(), []);
  const available = [
    { id: 1, net: 2000, available: true },
    { id: 2, net: 700, available: true },
    { id: 3, net: 0, available: false },
    { id: 4, net: 500, available: false },
  ];
  const codes = (issues: { path: string; code: string }[]) =>
    issues.map((i) => `${i.path}:${i.code}`);

  it('prices a valid selection; payments count for their net value', () => {
    const { selection, issues } = priceSelection(position(), available, {
      lines: [
        { orderLineId: A, quantity: 2 },
        { orderLineId: B, quantity: 1 },
      ],
      shippingLineIds: [1],
      paymentIds: [1, 2],
    });
    expect(issues).toEqual([]);
    expect(selection).toEqual({
      lines: [
        { orderLineId: A, quantity: 2, value: 1760 },
        { orderLineId: B, quantity: 1, value: 440 },
      ],
      shipping: [{ shippingLineId: 1, value: 500 }],
      payments: [
        { paymentId: 1, value: 2000 },
        { paymentId: 2, value: 700 },
      ],
      total: 2700,
      paymentsTotal: 2700,
    });
  });

  it('prices a partial quantity with selectedValue', () => {
    const { selection, issues } = priceSelection(
      position(),
      [{ id: 1, net: 880, available: true }],
      {
        lines: [{ orderLineId: A, quantity: 1 }],
        shippingLineIds: [],
        paymentIds: [1],
      }
    );
    expect(issues).toEqual([]);
    expect(selection?.total).toBe(880);
  });

  it('flags quantities, shipping lines and payments that cannot be invoiced', () => {
    const invoiced = invoicingPosition(baseOrder(), [firstInvoice()]);
    const { selection, issues } = priceSelection(invoiced, available, {
      lines: [
        { orderLineId: B, quantity: 1 },
        { orderLineId: A, quantity: 2 },
      ],
      shippingLineIds: [1],
      paymentIds: [4],
    });
    expect(selection).toBeNull();
    expect(codes(issues)).toEqual([
      'lines.1.quantity:QUANTITY_EXCEEDS_UNINVOICED',
      'shippingLineIds.0:SHIPPING_LINE_NOT_INVOICEABLE',
      'paymentIds.0:PAYMENT_NOT_INVOICEABLE',
    ]);
  });

  it('a payment with net 0, or unknown, is not invoiceable', () => {
    const { issues } = priceSelection(position(), available, {
      lines: [{ orderLineId: B, quantity: 1 }],
      shippingLineIds: [],
      paymentIds: [3, 99],
    });
    expect(codes(issues)).toEqual([
      'paymentIds.0:PAYMENT_NOT_INVOICEABLE',
      'paymentIds.1:PAYMENT_NOT_INVOICEABLE',
    ]);
    const zero = priceSelection(position(), [{ id: 5, net: 0, available: true }], {
      lines: [{ orderLineId: B, quantity: 1 }],
      shippingLineIds: [],
      paymentIds: [5],
    });
    expect(codes(zero.issues)).toEqual(['paymentIds.0:PAYMENT_NOT_INVOICEABLE']);
  });

  it('refuses different totals', () => {
    const { selection, issues } = priceSelection(position(), available, {
      lines: [{ orderLineId: B, quantity: 1 }],
      shippingLineIds: [],
      paymentIds: [2],
    });
    expect(selection).toBeNull();
    expect(codes(issues)).toEqual(['paymentIds:INVOICE_TOTALS_DIFFER']);
  });

  it('refuses a selection worth 0', () => {
    const G = 30;
    const order = baseOrder({
      lines: [{ id: G, unitPrice: 0, unitDiscount: 0, quantity: 1, returnedQuantity: 0, tax: 23 }],
      orderDiscount: 0,
    });
    const { issues } = priceSelection(
      invoicingPosition(order, []),
      [{ id: 1, net: 100, available: true }],
      { lines: [{ orderLineId: G, quantity: 1 }], shippingLineIds: [], paymentIds: [1] }
    );
    expect(codes(issues)).toEqual(['paymentIds:INVOICE_TOTALS_DIFFER']);
  });

  it('requires something selected and a payment', () => {
    const { issues } = priceSelection(position(), available, {
      lines: [],
      shippingLineIds: [],
      paymentIds: [],
    });
    expect(codes(issues)).toEqual(['lines:required', 'paymentIds:required']);
  });

  it('shipping alone is a selection', () => {
    const { issues } = priceSelection(position(), [{ id: 1, net: 500, available: true }], {
      lines: [],
      shippingLineIds: [1],
      paymentIds: [1],
    });
    expect(issues).toEqual([]);
  });

  it('flags unknown lines, invalid quantities and duplicates', () => {
    const order = baseOrder({
      shippingTotal: 800,
      shippingLines: [shippingLine(1, 'CHECKOUT', 500), shippingLine(2, 'MANUAL', 300)],
    });
    const { issues } = priceSelection(invoicingPosition(order, []), available, {
      lines: [
        { orderLineId: A, quantity: 1 },
        { orderLineId: A, quantity: 1 },
        { orderLineId: 99, quantity: 1 },
        { orderLineId: B, quantity: 0 },
        { orderLineId: B, quantity: 1.5 } as never,
      ],
      shippingLineIds: [1, 1],
      paymentIds: [1, 1],
    });
    expect(codes(issues)).toEqual([
      'lines.1.orderLineId:duplicate',
      'lines.2.orderLineId:unknown_line',
      'lines.3.quantity:invalid',
      'lines.4.orderLineId:duplicate',
      'shippingLineIds.1:duplicate',
      'paymentIds.1:duplicate',
    ]);
  });
});

describe('fitsPosition', () => {
  it('false when its units exceed what is left of a line', () => {
    const order = baseOrder();
    const position = invoicingPosition(order, [invoice(100, [item(A, 1, 880)])]);
    const late = invoice(101, [item(A, 2, 1760)], { status: 'FAILED' });
    expect(fitsPosition(position, late, order)).toBe(false);
  });

  it('false when a shipping line is already invoiced', () => {
    const order = baseOrder();
    const position = invoicingPosition(order, [invoice(100, [ship(500, 1)])]);
    expect(
      fitsPosition(position, invoice(101, [ship(500, 1)], { status: 'UNCERTAIN' }), order)
    ).toBe(false);
    expect(fitsPosition(position, invoice(101, [ship(500)], { status: 'UNCERTAIN' }), order)).toBe(
      false
    );
  });

  it('true otherwise', () => {
    const order = baseOrder();
    const position = invoicingPosition(order, [invoice(100, [item(A, 1, 880)])]);
    const late = invoice(101, [item(A, 1, 880), item(B, 1, 440), ship(500, 1)], {
      status: 'UNCERTAIN',
    });
    expect(fitsPosition(position, late, order)).toBe(true);
  });
});

describe('readInvoiceDoc', () => {
  it('reads kind, status, credit type, lines and credited lines', () => {
    const doc = readInvoiceDoc(
      {
        id: 7,
        kind: 'CREDIT_NOTE',
        status: 'ISSUED',
        creditedInvoice: { id: 3 },
        lines: { lines: [{ ...item(A, 1, 880) }, { ...ship(500, 1) }] },
        metadata: {
          creditType: 'CORRECTION',
          creditedLines: [
            { index: 0, value: 880, quantity: 1 },
            { index: 1, value: 500 },
            { value: 1 },
          ],
        },
      },
      [4]
    );
    expect(doc).toEqual({
      id: 7,
      kind: 'CREDIT_NOTE',
      status: 'ISSUED',
      creditedInvoiceId: 3,
      creditType: 'CORRECTION',
      lines: [item(A, 1, 880), ship(500, 1)],
      paymentIds: [4],
      creditedLines: [
        { index: 0, value: 880, quantity: 1 },
        { index: 1, value: 500, quantity: 0 },
      ],
    });
  });

  it('a legacy row has no credit type nor credited invoice', () => {
    const doc = readInvoiceDoc(
      {
        id: 1,
        kind: 'INVOICE',
        status: 'PENDING',
        creditedInvoice: null,
        lines: null,
        metadata: { creditType: 'X' },
      },
      []
    );
    expect(doc).toMatchObject({
      creditedInvoiceId: null,
      creditType: null,
      lines: [],
      creditedLines: [],
    });
  });
});

describe('readInvoiceLines', () => {
  it('parses shippingLineId on SHIPPING lines and drops malformed entries', () => {
    expect(
      readInvoiceLines({
        lines: [
          {
            kind: 'SHIPPING',
            orderLineId: null,
            sku: 'S',
            name: 'N',
            quantity: 1,
            total: 500,
            tax: 23,
            partial: false,
            shippingLineId: 2,
          },
          {
            kind: 'SHIPPING',
            orderLineId: null,
            sku: 'S',
            name: 'N',
            quantity: 1,
            total: 100,
            tax: 23,
          },
          'junk',
        ],
      })
    ).toEqual([
      {
        orderLineId: null,
        kind: 'SHIPPING',
        sku: 'S',
        name: 'N',
        quantity: 1,
        total: 500,
        tax: 23,
        partial: false,
        shippingLineId: 2,
      },
      {
        orderLineId: null,
        kind: 'SHIPPING',
        sku: 'S',
        name: 'N',
        quantity: 1,
        total: 100,
        tax: 23,
        partial: false,
      },
    ]);
    expect(readInvoiceLines(null)).toEqual([]);
  });
});
