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
  planRecalculation,
  shippingTaxRates,
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
  invoices: [],
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

  it('marks invoiced lines by invoice date, kind, status and shipping', () => {
    const lines = [line(), line({ id: 2, createdAt: '2026-11-03T10:00:00.000Z' })];
    const inv = (over: object = {}) => ({
      kind: 'INVOICE',
      status: 'ISSUED',
      createdAt: '2026-11-02T10:00:00.000Z',
      hasShipping: true,
      ...over,
    });
    expect(shippingLineViews(lines, ctx({ invoices: [inv()] })).map((v) => v.invoiced)).toEqual([true, false]);
    expect(
      shippingLineViews(lines, ctx({ invoices: [inv({ status: 'UNCERTAIN' })] })).map((v) => v.invoiced)
    ).toEqual([true, false]);
    expect(
      shippingLineViews(lines, ctx({ invoices: [inv({ kind: 'CREDIT_NOTE' })] })).map((v) => v.invoiced)
    ).toEqual([false, false]);
    expect(
      shippingLineViews(lines, ctx({ invoices: [inv({ status: 'FAILED' })] })).map((v) => v.invoiced)
    ).toEqual([false, false]);
    expect(
      shippingLineViews(lines, ctx({ invoices: [inv({ hasShipping: false })] })).map((v) => v.invoiced)
    ).toEqual([false, false]);
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

  it('isReplaceable needs not spent and not invoiced', () => {
    expect(isReplaceable(view())).toBe(true);
    expect(isReplaceable(view({ spent: true }))).toBe(false);
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

  it('appends the difference when the line is invoiced', () => {
    const r = planLineChange([view({ invoiced: true })], 1, { method: B, amount: 700 }, META);
    expect(r.mode).toBe('APPENDED');
    expect(r.lines).toEqual([
      line(),
      { id: 2, origin: 'EDIT', amount: 200, ...B, createdAt: META.at, actor: META.actor, editOf: 1 },
    ]);
  });

  it('a second edit of a locked line appends only the rest: 500 → 700 → 800 charges 800', () => {
    const META2 = { at: '2026-11-06T10:00:00.000Z', actor: 'admin:1' };
    const first = planLineChange([view({ invoiced: true })], 1, { method: A, amount: 700 }, META);
    const views = first.lines.map((l) => view({ ...l, invoiced: l.id === 1 }));
    const second = planLineChange(views, 1, { method: A, amount: 800 }, META2);
    expect(second.mode).toBe('APPENDED');
    expect(second.lines.map((l) => [l.id, l.amount, l.editOf])).toEqual([
      [1, 500, undefined],
      [2, 200, 1],
      [3, 100, 1],
    ]);
    expect(chargedShipping(second.lines)).toBe(800);
    const again = planLineChange(
      second.lines.map((l) => view({ ...l, invoiced: l.id === 1 })),
      1,
      { method: A, amount: 800 },
      META2
    );
    expect(again.mode).toBe('UNCHANGED');
  });

  it('a locked line changing only its method appends a zero correction under the new method', () => {
    const r = planLineChange([view({ invoiced: true })], 1, { method: B, amount: 500 }, META);
    expect(r.mode).toBe('APPENDED');
    expect(r.lines[1]).toMatchObject({ amount: 0, ...B, editOf: 1 });
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

  it('a line with a locked correction is locked: the edit appends', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1, invoiced: true })];
    const r = planLineChange(lines, 1, { method: A, amount: 800 }, META);
    expect(r.mode).toBe('APPENDED');
    expect(r.lines.map((l) => [l.id, l.amount, l.editOf])).toEqual([
      [1, 500, undefined],
      [2, 200, 1],
      [3, 100, 1],
    ]);
  });

  it('legacy EDIT lines without editOf are not counted as corrections', () => {
    const lines = [
      view({ invoiced: true }),
      view({ id: 2, origin: 'EDIT', amount: 200, invoiced: true }),
    ];
    const r = planLineChange(lines, 1, { method: A, amount: 700 }, META);
    expect(r.lines[2]).toMatchObject({ id: 3, amount: 200, editOf: 1 });
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

describe('planRecalculation', () => {
  const meta = { method: B, ...META };

  it('collapses replaceable lines into one recalculation line', () => {
    const r = planRecalculation([view({ amount: 500 }), view({ id: 2, amount: 300 })], 650, meta);
    expect(r.mode).toBe('REPLACED');
    expect(r.charged).toBe(800);
    expect(r.delta).toBe(-150);
    expect(r.lines).toEqual([
      { id: 3, origin: 'RECALCULATION', amount: 650, ...B, createdAt: META.at, actor: META.actor },
    ]);
  });

  it('appends a correction when every line is locked', () => {
    const r = planRecalculation([view({ spent: true })], 350, meta);
    expect(r.mode).toBe('APPENDED');
    expect(r.delta).toBe(-150);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toEqual(line());
    expect(r.lines[1]).toMatchObject({ id: 2, origin: 'RECALCULATION', amount: -150 });
  });

  it('is unchanged when due equals charged', () => {
    const r = planRecalculation([view({ amount: 500 }), view({ id: 2, amount: 300 })], 800, meta);
    expect(r.mode).toBe('UNCHANGED');
    expect(r.delta).toBe(0);
    expect(r.lines.map((l) => l.id)).toEqual([1, 2]);
    expect(r.lines.map((l) => l.amount)).toEqual([500, 300]);
  });

  it('keeps a replaceable line whose correction is locked, so the correction is never orphaned', () => {
    const lines = [view(), view({ id: 2, origin: 'EDIT', amount: 200, editOf: 1, invoiced: true })];
    const r = planRecalculation(lines, 900, meta);
    expect(r.mode).toBe('APPENDED');
    expect(r.lines.map((l) => [l.id, l.amount, l.editOf])).toEqual([
      [1, 500, undefined],
      [2, 200, 1],
      [3, 200, undefined],
    ]);
  });

  it('leaves out a zero recalculation line when locked lines exist', () => {
    const r = planRecalculation([view({ spent: true, amount: 500 }), view({ id: 2, amount: 300 })], 500, meta);
    expect(r.mode).toBe('REPLACED');
    expect(r.lines).toEqual([line({ amount: 500 })]);
  });
});

describe('shippingTaxRates', () => {
  it('weights each rate by its positive total, highest rate first', () => {
    const lines = [
      line({ id: 1, tax: 23, amount: 500, name: 'Courier' }),
      line({ id: 2, tax: 6, amount: 100, name: 'Mail' }),
      line({ id: 3, tax: 23, amount: -600, name: 'Express' }),
    ];
    expect(shippingTaxRates(lines)).toEqual([
      { tax: 23, weight: 0, name: 'Express' },
      { tax: 6, weight: 100, name: 'Mail' },
    ]);
  });
});
