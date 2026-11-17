import { describe, it, expect } from 'vitest';
import {
  checkoutLine,
  readShippingLines,
  chargedShipping,
  currentMethod,
  nextShippingLineId,
  shippingLineViews,
  isReplaceable,
  planLineChange,
  appendLine,
  invoicedMethod,
  type ShippingLine,
  type ShippingLineView,
} from '../../../../server/src/services/modules/ecommerce/domain/shippingLines';

const A = { providerId: 'manual', serviceId: '1', name: 'Courier', tax: 23 };
const B = { providerId: 'ctt', serviceId: '9', name: 'Express', tax: 23 };
const AT = '2026-11-01T10:00:00.000Z';
const META = { at: '2026-11-05T10:00:00.000Z', actor: 'admin:1' };

const line = (over: Partial<ShippingLine> = {}): ShippingLine => ({
  id: 1,
  origin: 'CHECKOUT',
  amount: 500,
  createdAt: AT,
  actor: 'system',
  ...A,
  ...over,
});

const view = (over: Partial<ShippingLineView> = {}): ShippingLineView => ({
  ...line(),
  paid: false,
  invoiced: false,
  spent: false,
  ...over,
});

const ctx = (over: Partial<Parameters<typeof shippingLineViews>[1]> = {}) => ({
  coveredShipping: 0,
  invoicedLineIds: [],
  hasActiveShipment: false,
  ...over,
});

describe('checkoutLine', () => {
  it('builds line 1 from the legacy columns', () => {
    expect(
      checkoutLine({
        createdAt: AT,
        shippingOriginal: 500,
        shippingTax: 23,
        shippingMethod: { providerId: 'manual', serviceId: '1', name: 'Courier' },
      })
    ).toEqual({
      id: 1,
      origin: 'CHECKOUT',
      amount: 500,
      tax: 23,
      providerId: 'manual',
      serviceId: '1',
      name: 'Courier',
      createdAt: AT,
      actor: 'system',
    });
  });
});

describe('readShippingLines', () => {
  const order = {
    createdAt: AT,
    shippingOriginal: 500,
    shippingTax: 23,
    shippingMethod: { providerId: 'manual', serviceId: '1', name: 'Courier' },
  };

  it('falls back to the checkout line when the column is null', () => {
    expect(readShippingLines({ ...order, shippingLines: null })).toEqual([checkoutLine(order)]);
  });

  it('drops malformed entries', () => {
    const valid = line({ id: 2, origin: 'MANUAL' });
    expect(readShippingLines({ ...order, shippingLines: { lines: [valid, { id: 'x' }] } })).toEqual([
      valid,
    ]);
  });

  it('keeps a valid editOf and drops a malformed one', () => {
    const fix = line({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 });
    const bad = { ...line({ id: 3, origin: 'EDIT' }), editOf: 'x' };
    expect(readShippingLines({ ...order, shippingLines: { lines: [line(), fix, bad] } })).toEqual([
      line(),
      fix,
      line({ id: 3, origin: 'EDIT' }),
    ]);
  });

  it('falls back when nothing valid remains and sorts by id', () => {
    expect(readShippingLines({ ...order, shippingLines: { lines: [{ id: 'x' }] } })).toEqual([
      checkoutLine(order),
    ]);
    const l1 = line();
    const l2 = line({ id: 2, origin: 'MANUAL' });
    expect(readShippingLines({ ...order, shippingLines: { lines: [l2, l1] } })).toEqual([l1, l2]);
  });
});

describe('chargedShipping / nextShippingLineId', () => {
  it('sums signed amounts', () => {
    expect(
      chargedShipping([line({ amount: 500 }), line({ id: 2, amount: -200 }), line({ id: 3, amount: 300 })])
    ).toBe(600);
  });
  it('next id is max + 1', () => {
    expect(nextShippingLineId([line(), line({ id: 4 })])).toBe(5);
    expect(nextShippingLineId([])).toBe(1);
  });
});

describe('currentMethod', () => {
  it('ignores recalculation lines when another exists', () => {
    const lines = [
      line({ id: 1, origin: 'CHECKOUT', ...A }),
      line({ id: 2, origin: 'RECALCULATION', ...A }),
      line({ id: 3, origin: 'MANUAL', ...B }),
      line({ id: 4, origin: 'RECALCULATION', ...B }),
    ];
    expect(currentMethod(lines)).toEqual(B);
  });
  it('uses a recalculation line when it is the only one', () => {
    expect(currentMethod([line({ origin: 'RECALCULATION' })])).toEqual(A);
  });
  it('is null for an empty table', () => {
    expect(currentMethod([])).toBeNull();
  });
});

describe('shippingLineViews', () => {
  it('an invoiced line is paid, whatever the coverage split says', () => {
    // As order #1016 after X/15: line 19 (299) invoiced, its payment's shipping share smaller.
    const views = shippingLineViews(
      [line({ amount: 500 }), line({ id: 19, amount: 299, createdAt: '2026-11-17T00:36:58.404Z' })],
      ctx({ coveredShipping: 600, invoicedLineIds: [1, 19], lastPaymentAt: Date.parse('2026-11-16T00:00:00Z') })
    );
    expect(views.map((v) => [v.id, v.paid])).toEqual([
      [1, true],
      [19, true],
    ]);
  });

  it('a settled order has every charge paid', () => {
    const views = shippingLineViews(
      [line({ amount: 500 }), line({ id: 2, amount: 300 })],
      ctx({ coveredShipping: 100, settled: true })
    );
    expect(views.map((v) => v.paid)).toEqual([true, true]);
  });

  it('consumes covered shipping oldest-first on positive lines', () => {
    const views = shippingLineViews(
      [line({ amount: 500 }), line({ id: 2, amount: 300 })],
      ctx({ coveredShipping: 600 })
    );
    expect(views.map((v) => v.paid)).toEqual([true, false]);
  });

  it('never marks a negative line as paid', () => {
    const views = shippingLineViews(
      [line({ amount: 500 }), line({ id: 2, amount: -100 })],
      ctx({ coveredShipping: 900 })
    );
    expect(views.map((v) => v.paid)).toEqual([true, false]);
  });

  it('a credit comes off the latest charges first: the coverage pays what is left of each', () => {
    // As order #1016: 1500 + 700 + 800 + 360 charged, a credit of 260, 3100 covered.
    const views = shippingLineViews(
      [
        line({ id: 8, amount: 1500 }),
        line({ id: 9, amount: 700 }),
        line({ id: 10, amount: 800 }),
        line({ id: 11, amount: 360 }),
        line({ id: 17, origin: 'RECALCULATION', amount: -260 }),
      ],
      ctx({ coveredShipping: 3100 })
    );
    expect(views.map((v) => [v.id, v.paid])).toEqual([
      [8, true],
      [9, true],
      [10, true],
      [11, true],
      [17, false],
    ]);
    // A charge added after the credit is not reduced by it.
    const later = shippingLineViews(
      [
        line({ id: 8, amount: 1500 }),
        line({ id: 11, amount: 360 }),
        line({ id: 17, origin: 'RECALCULATION', amount: -260 }),
        line({ id: 18, amount: 510 }),
      ],
      ctx({ coveredShipping: 1600 })
    );
    expect(later.map((v) => [v.id, v.paid])).toEqual([
      [8, true],
      [11, true],
      [17, false],
      [18, false],
    ]);
    // A credit larger than the latest charge reaches the one before it.
    const big = shippingLineViews(
      [line({ id: 1, amount: 500 }), line({ id: 2, amount: 300 }), line({ id: 3, amount: -400 })],
      ctx({ coveredShipping: 300 })
    );
    expect(big.map((v) => v.paid)).toEqual([false, true, false]);
  });

  it('a line added after the last payment is never paid by coverage left over', () => {
    const views = shippingLineViews(
      [
        line({ id: 1, amount: 500, createdAt: '2026-11-01T10:00:00.000Z' }),
        line({ id: 2, amount: 200, createdAt: '2026-11-03T10:00:00.000Z' }),
      ],
      ctx({ coveredShipping: 900, lastPaymentAt: Date.parse('2026-11-02T10:00:00.000Z') })
    );
    expect(views.map((v) => v.paid)).toEqual([true, false]);
    // Before that payment, it is paid as usual.
    const before = shippingLineViews(
      [line({ id: 1, amount: 500 }), line({ id: 2, amount: 200, createdAt: '2026-11-01T11:00:00.000Z' })],
      ctx({ coveredShipping: 900, lastPaymentAt: Date.parse('2026-11-02T10:00:00.000Z') })
    );
    expect(before.map((v) => v.paid)).toEqual([true, true]);
  });

  it('marks invoiced lines by id', () => {
    const lines = [line(), line({ id: 2, createdAt: '2026-11-03T10:00:00.000Z' })];
    expect(shippingLineViews(lines, ctx({ invoicedLineIds: [1] })).map((v) => v.invoiced)).toEqual([
      true,
      false,
    ]);
    expect(shippingLineViews(lines, ctx({ invoicedLineIds: [2] })).map((v) => v.invoiced)).toEqual([
      false,
      true,
    ]);
    expect(shippingLineViews(lines, ctx()).map((v) => v.invoiced)).toEqual([false, false]);
  });

  it('spent follows the active shipment for every line', () => {
    const lines = [line(), line({ id: 2 })];
    expect(shippingLineViews(lines, ctx({ hasActiveShipment: true })).map((v) => v.spent)).toEqual([true, true]);
    expect(shippingLineViews(lines, ctx()).map((v) => v.spent)).toEqual([false, false]);
  });

  it('a line with corrections shows its effective amount', () => {
    const views = shippingLineViews(
      [line(), line({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 }), line({ id: 3, origin: 'MANUAL', amount: 50 })],
      ctx()
    );
    expect(views.map((v) => v.effectiveAmount)).toEqual([700, undefined, undefined]);
  });

  it('isReplaceable needs not paid and not invoiced; shipments do not matter', () => {
    expect(isReplaceable(view())).toBe(true);
    expect(isReplaceable(view({ spent: true }))).toBe(true);
    expect(isReplaceable(view({ paid: true }))).toBe(false);
    expect(isReplaceable(view({ invoiced: true }))).toBe(false);
  });
});

describe('planLineChange', () => {
  it('replaces a replaceable line in place', () => {
    const r = planLineChange([view()], 1, { method: B, amount: 700 }, META);
    expect(r.mode).toBe('REPLACED');
    expect(r.lines).toEqual([
      { id: 1, origin: 'EDIT', amount: 700, ...B, createdAt: META.at, actor: META.actor },
    ]);
  });

  it('an invoiced line is never changed (raise, lower or method only): UNCHANGED + SHIPPING_LINE_LOCKED', () => {
    for (const change of [
      { method: B, amount: 700 },
      { method: A, amount: 300 },
      { method: B, amount: 500 },
    ]) {
      const r = planLineChange([view({ invoiced: true })], 1, change, META);
      expect(r.mode).toBe('UNCHANGED');
      expect(r.issue).toBe('SHIPPING_LINE_LOCKED');
      expect(r.lines).toEqual([line()]);
    }
  });

  it('a replaceable line with corrections is set to the rest: 500 + 200, edit to 800 → 600', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 })];
    const r = planLineChange(lines, 1, { method: A, amount: 800 }, META);
    expect(r.mode).toBe('REPLACED');
    expect(r.lines.map((l) => [l.id, l.amount, l.editOf])).toEqual([
      [1, 600, undefined],
      [2, 200, 1],
    ]);
    expect(chargedShipping(r.lines)).toBe(800);
    expect(shippingLineViews(r.lines, ctx())[0].effectiveAmount).toBe(800);
    expect(planLineChange(lines, 1, { method: A, amount: 700 }, META).mode).toBe('UNCHANGED');
  });

  it('a line with a locked correction is locked: the edit is refused, lines unchanged', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1, invoiced: true })];
    const r = planLineChange(lines, 1, { method: A, amount: 800 }, META);
    expect(r.mode).toBe('UNCHANGED');
    expect(r.issue).toBe('SHIPPING_LINE_LOCKED');
    expect(r.lines.map((l) => [l.id, l.amount, l.editOf])).toEqual([
      [1, 500, undefined],
      [2, 200, 1],
    ]);
  });

  it('legacy EDIT lines without editOf are not counted as corrections', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200 })];
    const r = planLineChange(lines, 1, { method: A, amount: 700 }, META);
    expect(r.mode).toBe('REPLACED');
    expect(r.lines.map((l) => [l.id, l.amount])).toEqual([
      [1, 700],
      [2, 200],
    ]);
  });

  it('a locked line (invoiced or paid) is never lowered: SHIPPING_LINE_LOCKED, nothing appended', () => {
    for (const locked of [view({ invoiced: true }), view({ paid: true })]) {
      const r = planLineChange([locked], 1, { method: A, amount: 300 }, META);
      expect(r.issue).toBe('SHIPPING_LINE_LOCKED');
      expect(r.mode).toBe('UNCHANGED');
      expect(r.lines).toEqual([line()]);
    }
  });

  it('a locked line with a correction is never lowered below what it charges (500 + 200 → 600)', () => {
    const lines = [view({ invoiced: true }), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 })];
    expect(planLineChange(lines, 1, { method: A, amount: 600 }, META).issue).toBe('SHIPPING_LINE_LOCKED');
  });

  it('a locked line raised is refused: SHIPPING_LINE_LOCKED, nothing appended', () => {
    const r = planLineChange([view({ paid: true })], 1, { method: A, amount: 650 }, META);
    expect(r.issue).toBe('SHIPPING_LINE_LOCKED');
    expect(r.mode).toBe('UNCHANGED');
    expect(r.lines).toEqual([line()]);
  });

  it('a replaceable line can be set to any non-negative amount, never stored negative', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1 })];
    const r = planLineChange(lines, 1, { method: A, amount: 100 }, META);
    expect(r.issue).toBeUndefined();
    expect(r.mode).toBe('REPLACED');
    expect(chargedShipping(r.lines)).toBe(100);
    expect(r.lines.every((l) => l.amount >= 0)).toBe(true);
    const zero = planLineChange([view()], 1, { method: A, amount: 0 }, META);
    expect(zero.lines).toEqual([{ ...line(), origin: 'EDIT', amount: 0, createdAt: META.at, actor: META.actor }]);
  });

  it('is unchanged for the same method and amount, or an unknown id', () => {
    const lines = [view({ invoiced: true })];
    const same = planLineChange(lines, 1, { method: A, amount: 500 }, META);
    expect(same.mode).toBe('UNCHANGED');
    expect(same.lines).toEqual([line()]);
    expect(planLineChange(lines, 99, { method: B, amount: 1 }, META).mode).toBe('UNCHANGED');
  });
});

describe('appendLine', () => {
  it('assigns the next id', () => {
    const out = appendLine([line()], {
      origin: 'MANUAL',
      amount: 100,
      ...B,
      createdAt: META.at,
      actor: META.actor,
    });
    expect(out.map((l) => l.id)).toEqual([1, 2]);
    expect(out[1]).toMatchObject({ origin: 'MANUAL', amount: 100 });
  });
});

describe('invoicedMethod', () => {
  it('is the method of the most recent invoiced line, or null', () => {
    expect(invoicedMethod([view()])).toBeNull();
    expect(
      invoicedMethod([view({ invoiced: true }), view({ id: 2, ...B, invoiced: true }), view({ id: 3 })])
    ).toEqual(B);
  });
});
