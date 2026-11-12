import { describe, it, expect } from 'vitest';
import {
  normalizeMarketRates,
  readMarketRates,
  orderWeightGrams,
  priceForWeight,
} from '../../../server/src/services/modules/ecommerce/domain/shippingRates';
import { MAX_MONEY_CENTS } from '../../../server/src/services/modules/ecommerce/domain/orders';

const M = new Set(['PT']);
const run = (input: unknown) => {
  const errs: { path: string; code: string }[] = [];
  const out = normalizeMarketRates(input, M, errs);
  return { out, errs };
};

describe('normalizeMarketRates', () => {
  it('accepts valid brackets', () => {
    const rates = {
      PT: [
        { upTo: 1, price: 300 },
        { upTo: 5, price: 1000 },
        { upTo: null, price: 2000 },
      ],
    };
    const { out, errs } = run(rates);
    expect(out).toEqual(rates);
    expect(errs).toEqual([]);
  });

  it('upper-cases keys; null/undefined give {}', () => {
    expect(run({ pt: [{ upTo: null, price: 1 }] }).out).toEqual({ PT: [{ upTo: null, price: 1 }] });
    expect(run(null).out).toEqual({});
    expect(run(undefined).out).toEqual({});
  });

  it('rejects unknown or malformed country', () => {
    expect(run({ ES: [{ upTo: null, price: 1 }] }).errs).toContainEqual({ path: 'rates.ES', code: 'invalid_country' });
    expect(run({ PRT: [{ upTo: null, price: 1 }] }).errs).toContainEqual({ path: 'rates.PRT', code: 'invalid_country' });
  });

  it('rejects empty array', () => {
    expect(run({ PT: [] }).errs).toContainEqual({ path: 'rates.PT', code: 'required' });
  });

  it('rejects bad upTo', () => {
    expect(run({ PT: [{ upTo: 5, price: 1 }, { upTo: 1, price: 1 }] }).errs).toContainEqual({ path: 'rates.PT.1.upTo', code: 'out_of_range' });
    expect(run({ PT: [{ upTo: 0, price: 1 }] }).errs).toContainEqual({ path: 'rates.PT.0.upTo', code: 'out_of_range' });
    expect(run({ PT: [{ upTo: -1, price: 1 }] }).errs).toContainEqual({ path: 'rates.PT.0.upTo', code: 'out_of_range' });
    expect(run({ PT: [{ upTo: 1.2345, price: 1 }] }).errs).toContainEqual({ path: 'rates.PT.0.upTo', code: 'invalid_number' });
    expect(run({ PT: [{ upTo: null, price: 1 }, { upTo: 2, price: 1 }] }).errs).toContainEqual({ path: 'rates.PT.0.upTo', code: 'out_of_range' });
  });

  it('rejects bad price', () => {
    expect(run({ PT: [{ upTo: null, price: 1.5 }] }).errs).toContainEqual({ path: 'rates.PT.0.price', code: 'invalid_number' });
    expect(run({ PT: [{ upTo: null, price: -1 }] }).errs).toContainEqual({ path: 'rates.PT.0.price', code: 'out_of_range' });
    expect(run({ PT: [{ upTo: null, price: MAX_MONEY_CENTS + 1 }] }).errs).toContainEqual({ path: 'rates.PT.0.price', code: 'out_of_range' });
  });

  it('rejects non-object input', () => {
    expect(run('x').errs).toContainEqual({ path: 'rates', code: 'invalid_number' });
  });
});

describe('readMarketRates', () => {
  it('keeps only valid country arrays', () => {
    expect(readMarketRates({ '3': 350, PT: [{ upTo: null, price: 350 }] })).toEqual({
      PT: [{ upTo: null, price: 350 }],
    });
    expect(readMarketRates(null)).toEqual({});
  });
});

describe('orderWeightGrams', () => {
  it('sums in grams', () => {
    expect(orderWeightGrams([{ weight: 0.1, quantity: 3 }])).toBe(300);
    expect(orderWeightGrams([{ weight: 1.25, quantity: 2 }, { weight: 0, quantity: 9 }])).toBe(2500);
  });
  it('missing or negative weight counts as 0', () => {
    expect(orderWeightGrams([{ weight: undefined as unknown as number, quantity: 2 }, { weight: -1, quantity: 2 }])).toBe(0);
  });
});

describe('priceForWeight', () => {
  const B = [{ upTo: 1, price: 300 }, { upTo: 5, price: 1000 }];
  it('picks the covering bracket', () => {
    expect(priceForWeight(B, 0)).toBe(300);
    expect(priceForWeight(B, 1000)).toBe(300);
    expect(priceForWeight(B, 1001)).toBe(1000);
    expect(priceForWeight(B, 5000)).toBe(1000);
    expect(priceForWeight(B, 5001)).toBeNull();
    expect(priceForWeight([...B, { upTo: null, price: 2000 }], 9_999_000)).toBe(2000);
  });
});
