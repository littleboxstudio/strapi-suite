/**
 * Manual per-line discount (spec 4.1): a percentage the admin sets on an order line. Pure: no
 * Strapi imports. Money is integer cents.
 */
import { percentOf } from './promotions';

/** 0 < p ≤ 100 with at most 2 decimals. */
export const isDiscountPercent = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v > 0 &&
  v <= 100 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

/** An input value: absent, null or '' = no manual discount; anything else must be a percent. */
export const readDiscountPercent = (
  raw: unknown
): { ok: true; value: number | null } | { ok: false } => {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  return isDiscountPercent(raw) ? { ok: true, value: raw } : { ok: false };
};

/** round(unit price × p / 100), half up, in integer cents. */
export const manualUnitDiscount = (unitPrice: number, percent: number): number =>
  Math.min(unitPrice, percentOf(unitPrice, percent));

/** The stored column (decimal: number or string); anything not a valid percent reads as none. */
export const storedDiscountPercent = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return isDiscountPercent(n) ? n : null;
};
