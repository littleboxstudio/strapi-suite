import { describe, it, expect } from 'vitest';
import {
  toInvoicedCoverage,
  toPaymentCoverage,
  reconcileCoverages,
  invoiceableByPayment,
  buildInvoiceLines,
  invoiceCustomer,
  overInvoiced,
  suggestCreditNote,
  validateCreditNoteRequest,
  issueDate,
  type InvoiceLine,
  type InvoicedCoverage,
} from '../../../../server/src/services/modules/ecommerce/domain/invoicing';
import {
  computeCoverage,
  type CoverageOrderState,
} from '../../../../server/src/services/modules/ecommerce/domain/orders';
import { EcommerceValidationError } from '../../../../server/src/services/modules/ecommerce/errors';

type Line = CoverageOrderState['lines'][number] & {
  sku: string;
  name: string;
  option: string | null;
};

const line = (id: number, unitPrice: number, quantity: number, over: Partial<Line> = {}): Line => ({
  id,
  unitPrice,
  unitDiscount: 0,
  quantity,
  returnedQuantity: 0,
  tax: 23,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  option: null,
  ...over,
});

const order = (lines: Line[], over: Partial<CoverageOrderState> = {}) => ({
  lines,
  orderDiscount: 0,
  shippingTotal: 0,
  shippingTax: 23,
  ...over,
});

const SHIPPING = { name: 'Shipping', reference: 'PORTES', tax: 23 };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('coverage mappers', () => {
  it('toPaymentCoverage maps the plan 3 PaymentCoverage (shipping object → number)', () => {
    const stored = computeCoverage(order([line(1, 1000, 2)], { shippingTotal: 500 }), [], 2500);
    expect(toPaymentCoverage(stored)).toEqual({
      lines: [{ orderLineId: 1, value: 2000 }],
      shipping: 500,
    });
  });

  it('toPaymentCoverage → null when missing or malformed', () => {
    expect(toPaymentCoverage(null)).toBeNull();
    expect(toPaymentCoverage(undefined)).toBeNull();
    expect(toPaymentCoverage('x')).toBeNull();
    expect(toPaymentCoverage({ shipping: { value: 1, tax: 23 } })).toBeNull();
  });

  it('toInvoicedCoverage maps the stored ReconciledCoverage (shipping number)', () => {
    expect(
      toInvoicedCoverage({
        paymentId: 7,
        lines: [{ orderLineId: 1, value: 2000 }],
        shipping: 300,
        value: 2300,
        excluded: 0,
      })
    ).toEqual({ lines: [{ orderLineId: 1, value: 2000 }], shipping: 300 });
  });

  it('toInvoicedCoverage → empty for garbage', () => {
    const empty = { lines: [], shipping: 0 };
    expect(toInvoicedCoverage(null)).toEqual(empty);
    expect(toInvoicedCoverage('garbage')).toEqual(empty);
    expect(toInvoicedCoverage({ lines: 'nope', shipping: 4 })).toEqual(empty);
    expect(toInvoicedCoverage([1, 2])).toEqual(empty);
  });
});

describe('reconcileCoverages', () => {
  it('Review Focus 3: paid line replaced by another of the same price → new line, nothing excluded', () => {
    const before = order([line(1, 2000, 1)]);
    const coverage = computeCoverage(before, [], 2000);
    const after = order([line(2, 2000, 1)]);
    const r = reconcileCoverages(
      after,
      [{ id: 10, amount: 2000, refunded: 0, coverage }],
      new Map()
    );
    expect(r.get(10)).toEqual({
      paymentId: 10,
      lines: [{ orderLineId: 2, value: 2000 }],
      shipping: 0,
      value: 2000,
      excluded: 0,
    });
    const lines = buildInvoiceLines([r.get(10)!], after, SHIPPING);
    expect(lines.map((l) => l.orderLineId)).toEqual([2]);
    expect(lines.reduce((s, l) => s + l.total, 0)).toBe(2000);
  });

  it('line reduced from 3 to 1 after full payment → 1/3 covered, rest excluded', () => {
    const coverage = computeCoverage(order([line(1, 1000, 3)]), [], 3000);
    const r = reconcileCoverages(
      order([line(1, 1000, 1)]),
      [{ id: 1, amount: 3000, refunded: 0, coverage }],
      new Map()
    );
    expect(r.get(1)).toMatchObject({
      lines: [{ orderLineId: 1, value: 1000 }],
      value: 1000,
      excluded: 2000,
    });
  });

  it('invoiced payment keeps its fixed coverage; a second payment gets only the remaining capacity', () => {
    const o = order([line(1, 1000, 1), line(2, 1000, 1)]);
    const c1 = computeCoverage(o, [], 1500);
    const c2 = computeCoverage(o, [{ coverage: c1 }], 500);
    const invoiced = new Map<number, InvoicedCoverage>([
      [
        1,
        {
          lines: [
            { orderLineId: 1, value: 1000 },
            { orderLineId: 2, value: 500 },
          ],
          shipping: 0,
        },
      ],
    ]);
    const r = reconcileCoverages(
      o,
      [
        { id: 1, amount: 1500, refunded: 0, coverage: c1 },
        { id: 2, amount: 500, refunded: 0, coverage: c2 },
      ],
      invoiced
    );
    expect(r.get(1)).toMatchObject({ lines: invoiced.get(1)!.lines, value: 1500, excluded: 0 });
    expect(r.get(2)).toMatchObject({
      lines: [{ orderLineId: 2, value: 500 }],
      value: 500,
      excluded: 0,
    });
    expect(invoiceableByPayment(r, new Set([1]))).toEqual(
      new Map([
        [1, 0],
        [2, 500],
      ])
    );
  });

  it('invoiced A (2000) later reduced to 1000 → stays 2000 (no clamp), others get 0 of A, overInvoiced 1000', () => {
    const before = order([line(1, 1000, 2)]);
    const after = order([line(1, 1000, 1), line(2, 1000, 1)]);
    const invoiced = new Map<number, InvoicedCoverage>([
      [1, { lines: [{ orderLineId: 1, value: 2000 }], shipping: 0 }],
    ]);
    // a second payment whose stored coverage claims line A: it must not get any of A
    const r = reconcileCoverages(
      after,
      [
        { id: 1, amount: 2000, refunded: 0, coverage: computeCoverage(before, [], 2000) },
        {
          id: 2,
          amount: 1000,
          refunded: 0,
          coverage: { lines: [{ orderLineId: 1, value: 1000 }], shipping: { value: 0, tax: 23 } },
        },
      ],
      invoiced
    );
    expect(r.get(1)).toMatchObject({ lines: [{ orderLineId: 1, value: 2000 }], value: 2000 });
    expect(r.get(2)).toMatchObject({
      lines: [{ orderLineId: 2, value: 1000 }],
      value: 1000,
      excluded: 0,
    });
    const issued = buildInvoiceLines(
      [
        {
          paymentId: 1,
          lines: [{ orderLineId: 1, value: 2000 }],
          shipping: 0,
          value: 2000,
          excluded: 0,
        },
      ],
      before,
      SHIPPING
    );
    expect(
      overInvoiced({ ...after, status: 'OPEN' }, [{ kind: 'INVOICE', lines: issued }])
    ).toEqual(new Map([[1, 1000]]));
  });

  it('null coverage → the whole payment is reallocated', () => {
    const o = order([line(1, 1000, 1), line(2, 3000, 1)], { shippingTotal: 1000 });
    const r = reconcileCoverages(
      o,
      [{ id: 5, amount: 2500, refunded: 0, coverage: null }],
      new Map()
    );
    const c = r.get(5)!;
    expect(c.value).toBe(2500);
    expect(c.excluded).toBe(0);
    expect(c.lines.reduce((s, l) => s + l.value, 0) + c.shipping).toBe(2500);
    expect(c.lines).toEqual([
      { orderLineId: 1, value: 500 },
      { orderLineId: 2, value: 1500 },
    ]);
    expect(c.shipping).toBe(500);
  });

  it('orphan beyond remaining capacity is excluded; splits sum exactly', () => {
    const o = order([line(1, 333, 1), line(2, 333, 1), line(3, 334, 1)]);
    const r = reconcileCoverages(
      o,
      [
        { id: 1, amount: 700, refunded: 0, coverage: null },
        { id: 2, amount: 700, refunded: 0, coverage: null },
      ],
      new Map()
    );
    const total = [...r.values()].reduce((s, c) => s + c.value, 0);
    expect(total).toBe(1000);
    expect(r.get(1)!.value + r.get(1)!.excluded).toBe(700);
    expect(r.get(2)!.value + r.get(2)!.excluded).toBe(700);
    expect(r.get(2)!.excluded).toBe(400);
  });

  it('respects the order discount share (lineDue)', () => {
    const o = order([line(1, 1000, 1), line(2, 1000, 1)], { orderDiscount: 200 });
    const r = reconcileCoverages(
      o,
      [{ id: 1, amount: 2000, refunded: 0, coverage: null }],
      new Map()
    );
    expect(r.get(1)).toMatchObject({
      lines: [
        { orderLineId: 1, value: 900 },
        { orderLineId: 2, value: 900 },
      ],
      value: 1800,
      excluded: 200,
    });
  });
});

describe('reconcileCoverages on net payment amounts', () => {
  it('refunded excess is never invoiced; a later payment for the new line reconciles onto it', () => {
    const coverage = computeCoverage(order([line(1, 1000, 3)]), [], 3000);
    const after = order([line(1, 1000, 1), line(2, 2000, 1)]);
    const c2 = computeCoverage(
      after,
      [{ coverage: { lines: [{ orderLineId: 1, value: 1000 }], shipping: { value: 0, tax: 23 } } }],
      2000
    );
    const r = reconcileCoverages(
      after,
      [
        { id: 1, amount: 3000, refunded: 2000, coverage },
        { id: 2, amount: 2000, refunded: 0, coverage: c2 },
      ],
      new Map()
    );
    expect(r.get(1)).toEqual({
      paymentId: 1,
      lines: [{ orderLineId: 1, value: 1000 }],
      shipping: 0,
      value: 1000,
      excluded: 0,
    });
    expect(r.get(2)).toMatchObject({
      lines: [{ orderLineId: 2, value: 2000 }],
      value: 2000,
      excluded: 0,
    });
  });

  it('value + excluded = net amount; refunds above the amount cap the net at 0', () => {
    const o = order([line(1, 1000, 1)]);
    const r = reconcileCoverages(
      o,
      [
        { id: 1, amount: 1500, refunded: 200, coverage: null },
        { id: 2, amount: 500, refunded: 900, coverage: null },
      ],
      new Map()
    );
    expect(r.get(1)).toMatchObject({ value: 1000, excluded: 300 });
    expect(r.get(2)).toMatchObject({ lines: [], value: 0, excluded: 0 });
  });

  it('invoiced coverages consume capacity even when their payment is not in the list', () => {
    const o = order([line(1, 1000, 1)]);
    const invoiced = new Map<number, InvoicedCoverage>([
      [1, { lines: [{ orderLineId: 1, value: 1000 }], shipping: 0 }],
    ]);
    const r = reconcileCoverages(
      o,
      [{ id: 2, amount: 1000, refunded: 0, coverage: null }],
      invoiced
    );
    expect([...r.keys()]).toEqual([2]);
    expect(r.get(2)).toMatchObject({ lines: [], value: 0, excluded: 1000 });
  });

  it('negative, NaN or non-integer amounts, or a missing/invalid refunded, are a domain error', () => {
    const o = order([line(1, 1000, 1)]);
    for (const bad of [
      { id: 1, amount: -1, refunded: 0, coverage: null },
      { id: 1, amount: NaN, refunded: 0, coverage: null },
      { id: 1, amount: 10.5, refunded: 0, coverage: null },
      { id: 1, amount: 100, refunded: -5, coverage: null },
      { id: 1, amount: 100, refunded: NaN, coverage: null },
      { id: 1, amount: 100, coverage: null } as never,
    ]) {
      expect(() => reconcileCoverages(o, [bad], new Map())).toThrow(EcommerceValidationError);
    }
  });
});

describe('buildInvoiceLines', () => {
  it('50% partial payment over two lines (23% and 6%) → proportional values, partial', () => {
    const o = order([line(1, 1230, 1, { tax: 23 }), line(2, 1060, 1, { tax: 6 })]);
    const r = reconcileCoverages(
      o,
      [{ id: 1, amount: 1145, refunded: 0, coverage: computeCoverage(o, [], 1145) }],
      new Map()
    );
    const lines = buildInvoiceLines([r.get(1)!], o, SHIPPING);
    expect(lines).toEqual([
      {
        orderLineId: 1,
        kind: 'ITEM',
        sku: 'SKU-1',
        name: 'Product 1',
        quantity: 1,
        total: 615,
        tax: 23,
        partial: true,
      },
      {
        orderLineId: 2,
        kind: 'ITEM',
        sku: 'SKU-2',
        name: 'Product 2',
        quantity: 1,
        total: 530,
        tax: 6,
        partial: true,
      },
    ]);
  });

  it('full payment without discount → quantity = units, not partial; shipping last; option in name', () => {
    const o = order([line(1, 1000, 3, { option: 'Red' }), line(2, 500, 2)], {
      shippingTotal: 450,
      shippingTax: 23,
    });
    const r = reconcileCoverages(
      o,
      [{ id: 1, amount: 4450, refunded: 0, coverage: computeCoverage(o, [], 4450) }],
      new Map()
    );
    expect(buildInvoiceLines([r.get(1)!], o, SHIPPING)).toEqual([
      {
        orderLineId: 1,
        kind: 'ITEM',
        sku: 'SKU-1',
        name: 'Product 1 - Red',
        quantity: 3,
        total: 3000,
        tax: 23,
        partial: false,
      },
      {
        orderLineId: 2,
        kind: 'ITEM',
        sku: 'SKU-2',
        name: 'Product 2',
        quantity: 2,
        total: 1000,
        tax: 23,
        partial: false,
      },
      {
        orderLineId: null,
        kind: 'SHIPPING',
        sku: 'PORTES',
        name: 'Shipping',
        quantity: 1,
        total: 450,
        tax: 23,
        partial: false,
      },
    ]);
  });

  it('merges coverages by line; whole units when the sum is integral', () => {
    const o = order([line(1, 1000, 2)]);
    const cov = (paymentId: number, value: number) => ({
      paymentId,
      lines: [{ orderLineId: 1, value }],
      shipping: 0,
      value,
      excluded: 0,
    });
    expect(buildInvoiceLines([cov(1, 1000), cov(2, 1000)], o, SHIPPING)).toEqual([
      {
        orderLineId: 1,
        kind: 'ITEM',
        sku: 'SKU-1',
        name: 'Product 1',
        quantity: 2,
        total: 2000,
        tax: 23,
        partial: false,
      },
    ]);
    expect(buildInvoiceLines([cov(1, 1000)], o, SHIPPING)[0]).toMatchObject({
      quantity: 1,
      partial: false,
    });
  });

  it('skips value = 0 entries and lineDue = 0 lines without NaN/Infinity', () => {
    const o = order([line(1, 0, 1), line(2, 1000, 1), line(3, 500, 2, { returnedQuantity: 2 })]);
    const lines = buildInvoiceLines(
      [
        {
          paymentId: 1,
          lines: [
            { orderLineId: 1, value: 0 },
            { orderLineId: 2, value: 0 },
            { orderLineId: 3, value: 0 },
          ],
          shipping: 0,
          value: 0,
          excluded: 0,
        },
      ],
      o,
      SHIPPING
    );
    expect(lines).toEqual([]);
  });

  it('value landing on a lineDue = 0 or missing line is a domain error (never silently dropped)', () => {
    const o = order([line(2, 1000, 1), line(3, 500, 2, { returnedQuantity: 2 })]);
    const cov = (orderLineId: number) => ({
      paymentId: 1,
      lines: [{ orderLineId, value: 100 }],
      shipping: 0,
      value: 100,
      excluded: 0,
    });
    for (const id of [3, 99]) {
      expect(() => buildInvoiceLines([cov(id)], o, SHIPPING)).toThrow(EcommerceValidationError);
      try {
        buildInvoiceLines([cov(id)], o, SHIPPING);
      } catch (e) {
        expect((e as EcommerceValidationError).errors).toEqual([
          { path: 'coverage', code: 'coverage_mismatch' },
        ]);
      }
    }
  });
});

describe('invoiceCustomer', () => {
  const customer = { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com' };
  const billing = {
    firstName: 'Ana',
    lastName: 'Silva',
    line1: 'Rua A, 1',
    line2: '2º Esq',
    postalCode: '1000-001',
    city: 'Lisboa',
    country: 'PT',
  };

  it('without NIF → nif null and person name', () => {
    expect(invoiceCustomer(billing, customer)).toEqual({
      name: 'Ana Silva',
      nif: null,
      address: 'Rua A, 1, 2º Esq',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
      email: 'ana@example.com',
    });
  });

  it('with company → company name and NIF', () => {
    expect(
      invoiceCustomer({ ...billing, company: 'ACME Lda', nif: '501234567' }, customer)
    ).toMatchObject({
      name: 'ACME Lda',
      nif: '501234567',
    });
  });

  it('no billing address → customer name, empty address, nif null', () => {
    expect(invoiceCustomer(null, customer)).toEqual({
      name: 'Ana Silva',
      nif: null,
      address: '',
      postalCode: '',
      city: '',
      country: '',
      email: 'ana@example.com',
    });
  });
});

const invLine = (
  orderLineId: number | null,
  total: number,
  over: Partial<InvoiceLine> = {}
): InvoiceLine => ({
  orderLineId,
  kind: orderLineId === null ? 'SHIPPING' : 'ITEM',
  sku: 'S',
  name: 'N',
  quantity: 1,
  total,
  tax: 23,
  partial: false,
  ...over,
});

describe('overInvoiced', () => {
  it('invoiced 2000, credited 500, current lineDue 1000 → 500', () => {
    const o = { ...order([line(1, 1000, 1)]), status: 'OPEN' as const };
    expect(
      overInvoiced(o, [
        { kind: 'INVOICE', lines: [invLine(1, 2000)] },
        { kind: 'CREDIT_NOTE', lines: [invLine(1, 500)] },
      ])
    ).toEqual(new Map([[1, 500]]));
  });

  it('cancelled order (all lineDue 0) → invoiced minus credited; shipping counted apart', () => {
    const o = {
      ...order([line(1, 1000, 1)], { shippingTotal: 400 }),
      status: 'CANCELLED' as const,
    };
    expect(
      overInvoiced(o, [
        { kind: 'INVOICE', lines: [invLine(1, 1000), invLine(null, 400)] },
        { kind: 'CREDIT_NOTE', lines: [invLine(1, 300)] },
      ])
    ).toEqual(
      new Map<number | 'SHIPPING', number>([
        [1, 700],
        ['SHIPPING', 400],
      ])
    );
  });

  it('shipping over-invoiced when shipping total drops; removed lines count fully', () => {
    const o = { ...order([line(1, 1000, 1)], { shippingTotal: 100 }), status: 'OPEN' as const };
    expect(
      overInvoiced(o, [
        { kind: 'INVOICE', lines: [invLine(1, 1000), invLine(9, 800), invLine(null, 400)] },
      ])
    ).toEqual(
      new Map<number | 'SHIPPING', number>([
        [9, 800],
        ['SHIPPING', 300],
      ])
    );
  });
});

describe('credit notes', () => {
  it('suggestCreditNote after returning 1 of 2 invoiced units → half that line', () => {
    const invoiced = order([line(1, 1000, 2), line(2, 500, 1)]);
    const lines = buildInvoiceLines(
      [
        {
          paymentId: 1,
          lines: [
            { orderLineId: 1, value: 2000 },
            { orderLineId: 2, value: 500 },
          ],
          shipping: 0,
          value: 2500,
          excluded: 0,
        },
      ],
      invoiced,
      SHIPPING
    );
    const afterReturn = order([line(1, 1000, 2, { returnedQuantity: 1 }), line(2, 500, 1)]);
    const over = overInvoiced({ ...afterReturn, status: 'OPEN' }, [{ kind: 'INVOICE', lines }]);
    expect(suggestCreditNote({ lines }, [0, 0], over)).toEqual([1000, 0]);
    expect(suggestCreditNote({ lines }, [600, 0], over)).toEqual([1000, 0]);
    expect(suggestCreditNote({ lines }, [1500, 0], over)).toEqual([500, 0]);
  });

  it('suggestCreditNote shares the remaining over across lines of the same key', () => {
    const lines = [invLine(1, 600), invLine(1, 600)];
    expect(suggestCreditNote({ lines }, [], new Map([[1, 900]]))).toEqual([600, 300]);
  });

  const invoice = { lines: [invLine(1, 1000), invLine(null, 400)] };

  it('valid request → no issues', () => {
    expect(
      validateCreditNoteRequest(invoice, [200, 0], {
        lines: [{ index: 0, value: 800 }],
        reason: 'Return',
      })
    ).toEqual([]);
  });

  it('required: no lines or no reason', () => {
    expect(codes(validateCreditNoteRequest(invoice, [], { lines: [], reason: 'x' }))).toEqual([
      'required',
    ]);
    expect(
      codes(
        validateCreditNoteRequest(invoice, [], { lines: [{ index: 0, value: 1 }], reason: '  ' })
      )
    ).toEqual(['required']);
    expect(
      validateCreditNoteRequest(invoice, [], { lines: [{ index: 0, value: 1 }], reason: '' })[0]
        .path
    ).toBe('reason');
  });

  it('unknown_line for a non-existent index', () => {
    expect(
      codes(
        validateCreditNoteRequest(invoice, [], { lines: [{ index: 2, value: 1 }], reason: 'x' })
      )
    ).toEqual(['unknown_line']);
    expect(
      codes(
        validateCreditNoteRequest(invoice, [], { lines: [{ index: -1, value: 1 }], reason: 'x' })
      )
    ).toEqual(['unknown_line']);
  });

  it('invalid_amount for 0, negative and non-integer', () => {
    for (const value of [0, -5, 1.5, NaN]) {
      expect(
        codes(validateCreditNoteRequest(invoice, [], { lines: [{ index: 0, value }], reason: 'x' }))
      ).toEqual(['invalid_amount']);
    }
  });

  it('exceeds_creditable above total − credited (also summed across repeated indexes)', () => {
    expect(
      codes(
        validateCreditNoteRequest(invoice, [200, 0], {
          lines: [{ index: 0, value: 801 }],
          reason: 'x',
        })
      )
    ).toEqual(['exceeds_creditable']);
    expect(
      codes(
        validateCreditNoteRequest(invoice, [], {
          lines: [
            { index: 1, value: 300 },
            { index: 1, value: 200 },
          ],
          reason: 'x',
        })
      )
    ).toEqual(['exceeds_creditable']);
  });
});

describe('issueDate', () => {
  it('23:30 UTC on 31/12 in Europe/Lisbon (winter) → 12-31', () => {
    expect(issueDate(new Date('2026-12-31T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-12-31');
  });

  it('uses the store time zone', () => {
    expect(issueDate(new Date('2026-12-31T23:30:00Z'), 'Europe/Madrid')).toBe('2027-01-01');
    expect(issueDate(new Date('2026-07-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-02');
  });

  it('falls back to UTC for an invalid time zone', () => {
    expect(issueDate(new Date('2026-07-01T23:30:00Z'), 'Not/AZone')).toBe('2026-07-01');
  });
});
