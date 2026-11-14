import { describe, expect, it } from 'vitest';
import {
  grossUnitPrice,
  moloniLinePrices,
} from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/linePricing';
import type { InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  orderLineId: 1,
  kind: 'ITEM',
  sku: 'SKU',
  name: 'Item',
  quantity: 1,
  total: 1000,
  tax: 23,
  partial: false,
  ...over,
});

describe('moloniLinePrices', () => {
  it('a line without grossTotal goes at its discounted price, no discount', () => {
    expect(moloniLinePrices([line({ quantity: 3, total: 1000 })])).toEqual([{ price: 2.71, discount: 0 }]);
  });

  it('a 10% line discount: price before the discount and 10%', () => {
    // 2 × 20,00 € (VAT incl.) − 10% = 36,00 €
    expect(moloniLinePrices([line({ quantity: 2, total: 3600, grossTotal: 4000 })])).toEqual([
      { price: 16.2602, discount: 10 },
    ]);
  });

  it('a 2 € shipping discount on 15 € becomes 13.33%', () => {
    expect(
      moloniLinePrices([line({ kind: 'SHIPPING', orderLineId: null, total: 1300, grossTotal: 1500 })])
    ).toEqual([{ price: 12.1951, discount: 13.33 }]);
  });

  it('a gift (value 0) is a 100% discount', () => {
    expect(moloniLinePrices([line({ total: 0, grossTotal: 1000 })])).toEqual([
      { price: 8.1301, discount: 100 },
    ]);
  });

  it('grossTotal not above total shows no discount', () => {
    expect(moloniLinePrices([line({ total: 1000, grossTotal: 1000 })])).toEqual([
      { price: 8.1301, discount: 0 },
    ]);
  });

  it('a percentage that would change the cents is not used for that line', () => {
    // 999,99 € → 989,97 €: 1.00% would give 990,00 €.
    const [cheap, dear] = moloniLinePrices([
      line({ total: 900, grossTotal: 1000 }),
      line({ total: 98997, grossTotal: 99999 }),
    ]);
    expect(cheap.discount).toBe(10);
    expect(dear).toEqual({ price: 804.8537, discount: 0 });
  });

  it('every line keeps the cents of the discounted price, and so does the document', () => {
    const lines = [
      line({ quantity: 2, total: 3600, grossTotal: 4000 }),
      line({ quantity: 3, total: 2467, grossTotal: 2970, tax: 6 }),
      line({ kind: 'SHIPPING', orderLineId: null, total: 1300, grossTotal: 1500 }),
    ];
    const prices = moloniLinePrices(lines);
    const gross = (i: number, p: { price: number; discount: number }) =>
      lines[i].quantity * p.price * (1 - p.discount / 100) * (1 + lines[i].tax / 100);
    const plain = lines.map((l) => ({ price: (l.total * 100) / (100 + l.tax) / l.quantity / 100, discount: 0 }));
    const sum = (ps: { price: number; discount: number }[]) =>
      Math.round(ps.reduce((s, p, i) => s + gross(i, p), 0) * 100);
    expect(sum(prices)).toBe(sum(plain));
    expect(prices.every((p) => p.discount > 0)).toBe(true);
  });
});

describe('grossUnitPrice', () => {
  it('is the price before discounts, or the net price without grossTotal', () => {
    expect(grossUnitPrice(line({ total: 1300, grossTotal: 1500 }))).toBe(12.1951);
    expect(grossUnitPrice(line({ total: 1230 }))).toBe(10);
  });
});
