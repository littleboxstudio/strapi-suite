import { describe, it, expect } from 'vitest';
import {
  isDiscountPercent,
  manualUnitDiscount,
  readDiscountPercent,
  storedDiscountPercent,
} from '../../../../server/src/services/modules/ecommerce/domain/lineDiscounts';

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
