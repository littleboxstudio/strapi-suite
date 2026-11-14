import { describe, it, expect } from 'vitest';
import {
  isDiscountPercent,
  manualUnitDiscount,
  readDiscountPercent,
  releaseLineRefs,
  storedDiscountPercent,
} from '../../../../server/src/services/modules/ecommerce/domain/lineDiscounts';
import type { AppliedPromotion } from '../../../../server/src/services/modules/ecommerce/domain/promotions';

describe('line discount percent (spec 4.1)', () => {
  it('accepts 0 < p ≤ 100 with at most 2 decimals', () => {
    for (const p of [0.01, 1, 10, 12.5, 33.33, 99.99, 100]) expect(isDiscountPercent(p)).toBe(true);
    for (const p of [0, -1, 100.01, 10.123, NaN, Infinity, '10', null]) {
      expect(isDiscountPercent(p)).toBe(false);
    }
  });

  it('reads absent, null and empty as none; anything else must be a valid percent', () => {
    expect(readDiscountPercent(undefined)).toEqual({ ok: true, value: null });
    expect(readDiscountPercent(null)).toEqual({ ok: true, value: null });
    expect(readDiscountPercent('')).toEqual({ ok: true, value: null });
    expect(readDiscountPercent(15)).toEqual({ ok: true, value: 15 });
    expect(readDiscountPercent(0)).toEqual({ ok: false });
    expect(readDiscountPercent('15')).toEqual({ ok: false });
    expect(readDiscountPercent(101)).toEqual({ ok: false });
    expect(readDiscountPercent(1.005)).toEqual({ ok: false });
  });

  it('unit discount = round(unit price × p / 100) in cents', () => {
    expect(manualUnitDiscount(2000, 10)).toBe(200);
    expect(manualUnitDiscount(1999, 33.33)).toBe(666); // 666.27
    expect(manualUnitDiscount(1005, 50)).toBe(503); // 502.5 rounds half up
    expect(manualUnitDiscount(1, 50)).toBe(1);
    expect(manualUnitDiscount(2000, 100)).toBe(2000);
    expect(manualUnitDiscount(2000, 0.01)).toBe(0);
  });

  it('a stored value (decimal column: number or string) reads as a percent or none', () => {
    expect(storedDiscountPercent(10)).toBe(10);
    expect(storedDiscountPercent('12.50')).toBe(12.5);
    expect(storedDiscountPercent(null)).toBeNull();
    expect(storedDiscountPercent(undefined)).toBeNull();
    expect(storedDiscountPercent(0)).toBeNull();
    expect(storedDiscountPercent('x')).toBeNull();
  });
});

describe('releaseLineRefs (spec 4.1: a manual percent replaces a promotion discount)', () => {
  const applied = (): AppliedPromotion[] =>
    [
      {
        promotionId: 7,
        amount: 2500,
        benefits: [
          { index: 0, amount: 2000 },
          { index: 1, amount: 500 },
        ],
      },
      { promotionId: 8, amount: 300, benefits: [{ index: 0, amount: 300 }] },
    ] as unknown as AppliedPromotion[];

  it('takes each released ref off its benefit and the promotion total', () => {
    const r = releaseLineRefs(applied(), [{ promotionId: 7, benefitIndex: 0, amount: 1200 }]);
    expect(r.released).toEqual([{ promotionId: 7, benefitIndex: 0, amount: 1200 }]);
    expect(r.applied[0]).toMatchObject({ amount: 1300, benefits: [{ amount: 800 }, { amount: 500 }] });
    expect(r.applied[1]).toMatchObject({ amount: 300 });
  });

  it('never goes below 0 and ignores refs of promotions the order does not store', () => {
    const input = applied();
    const r = releaseLineRefs(input, [
      { promotionId: 8, benefitIndex: 0, amount: 900 },
      { promotionId: 99, benefitIndex: 0, amount: 100 },
    ]);
    expect(r.released).toEqual([{ promotionId: 8, benefitIndex: 0, amount: 300 }]);
    expect(r.applied[1]).toMatchObject({ amount: 0, benefits: [{ amount: 0 }] });
    expect(input[1].amount).toBe(300); // not mutated
  });
});
