/**
 * Manual per-line discount (spec 4.1): a percentage the admin sets on an order line. Pure: no
 * Strapi imports. Money is integer cents.
 */
import { percentOf, type AppliedPromotion, type BenefitRef } from './promotions';

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

/**
 * Takes the refs of a line whose promotion discount a manual percent replaced (spec 4.1) off the
 * stored promotions: each ref's amount leaves its benefit and its promotion's total, never below
 * 0. Refs of promotions the order does not store are ignored. `released` is what was taken.
 */
export const releaseLineRefs = (
  applied: AppliedPromotion[],
  refs: BenefitRef[]
): { applied: AppliedPromotion[]; released: BenefitRef[] } => {
  const out = applied.map((a) => ({ ...a, benefits: a.benefits.map((b) => ({ ...b })) }));
  const released: BenefitRef[] = [];
  for (const ref of refs) {
    const promotion = out.find((a) => a.promotionId === ref.promotionId);
    const benefit = promotion?.benefits.find((b) => b.index === ref.benefitIndex);
    if (!promotion || !benefit) continue;
    const amount = Math.min(Math.max(ref.amount, 0), benefit.amount);
    if (amount <= 0) continue;
    benefit.amount -= amount;
    promotion.amount = promotion.benefits.reduce((s, b) => s + b.amount, 0);
    released.push({ promotionId: ref.promotionId, benefitIndex: ref.benefitIndex, amount });
  }
  return { applied: out, released };
};
