import { describe, it, expect } from 'vitest';
import { quoteVatItems, vatBreakdown } from '../../../../../server/src/services/modules/ecommerce/domain/storefront/tax';

describe('vatBreakdown', () => {
  it('groups by rate, sorted by rate', () => {
    expect(
      vatBreakdown([
        { amount: 12300, rate: 23 },
        { amount: 1060, rate: 6 },
      ])
    ).toEqual([
      { rate: 6, base: 1000, vat: 60, gross: 1060 },
      { rate: 23, base: 10000, vat: 2300, gross: 12300 },
    ]);
  });

  it('sums the gross per rate before rounding', () => {
    expect(
      vatBreakdown([
        { amount: 100, rate: 23 },
        { amount: 100, rate: 23 },
      ])
    ).toEqual([{ rate: 23, base: 163, vat: 37, gross: 200 }]);
  });

  it('rate 0 has no VAT; zero gross rows are omitted', () => {
    expect(
      vatBreakdown([
        { amount: 500, rate: 0 },
        { amount: 0, rate: 13 },
      ])
    ).toEqual([{ rate: 0, base: 500, vat: 0, gross: 500 }]);
  });

  it('rounds half up and accepts rates with two decimals', () => {
    // 123 * 100 / 123 = 100 exactly; 1 * 100 / 105 = 0.952 -> 1
    expect(vatBreakdown([{ amount: 1, rate: 5 }])).toEqual([{ rate: 5, base: 1, vat: 0, gross: 1 }]);
    // 3 * 100 / 200 = 1.5 -> 2
    expect(vatBreakdown([{ amount: 3, rate: 100 }])).toEqual([{ rate: 100, base: 2, vat: 1, gross: 3 }]);
    // 10550 * 100 / 105.5 = 10000
    expect(vatBreakdown([{ amount: 10550, rate: 5.5 }])).toEqual([{ rate: 5.5, base: 10000, vat: 550, gross: 10550 }]);
  });

  it('handles large sums exactly', () => {
    const [row] = vatBreakdown([{ amount: 1_000_000_000, rate: 23 }, { amount: 1_000_000_000, rate: 23 }]);
    expect(row.gross).toBe(2_000_000_000);
    expect(row.base + row.vat).toBe(row.gross);
    expect(row.base).toBe(1_626_016_260);
  });
});

describe('quoteVatItems', () => {
  it('spreads the order discount over lines and adds shipping', () => {
    expect(
      quoteVatItems({
        lines: [
          { unitPrice: 3000, unitDiscount: 0, quantity: 2, tax: 23 },
          { unitPrice: 2500, unitDiscount: 500, quantity: 2, tax: 6 },
        ],
        orderDiscount: 1000,
        shippingTotal: 499,
        shippingTax: 23,
      })
    ).toEqual([
      { amount: 5400, rate: 23 },
      { amount: 3600, rate: 6 },
      { amount: 499, rate: 23 },
    ]);
  });

  it('omits shipping when unknown', () => {
    expect(
      quoteVatItems({
        lines: [{ unitPrice: 1000, unitDiscount: 0, quantity: 1, tax: 23 }],
        orderDiscount: 0,
        shippingTotal: null,
        shippingTax: null,
      })
    ).toEqual([{ amount: 1000, rate: 23 }]);
    expect(
      quoteVatItems({
        lines: [],
        orderDiscount: 0,
        shippingTotal: 500,
        shippingTax: null,
      })
    ).toEqual([]);
  });
});
