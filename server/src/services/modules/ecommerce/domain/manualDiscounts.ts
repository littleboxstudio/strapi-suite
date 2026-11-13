/**
 * Manual order discounts (plan 10): the items an admin adds on top of the promotions.
 * Pure domain: no I/O. Amounts are integer cents.
 */
import { MAX_MONEY_CENTS } from './orders';
import { percentOf } from './promotions';

export type ManualDiscount = {
  id: number;
  kind: 'FIXED' | 'PERCENT' | 'LEGACY';
  percent: number | null;
  amount: number;
  reason: string;
  createdAt: string;
  actor: string;
};

export const LEGACY_DISCOUNT_REASON = 'Previous manual adjustment';
export const MAX_DISCOUNT_REASON = 200;

type DiscountError = { path: string; code: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sum of the applied ORDER_DISCOUNT benefits; a legacy `[]` reads as no promotions. */
const appliedOrderDiscount = (promotions: unknown): number => {
  if (!isRecord(promotions) || !Array.isArray(promotions.applied)) return 0;
  let total = 0;
  for (const promotion of promotions.applied) {
    if (!isRecord(promotion) || !Array.isArray(promotion.benefits)) continue;
    for (const benefit of promotion.benefits) {
      if (isRecord(benefit) && benefit.class === 'ORDER_DISCOUNT' && typeof benefit.amount === 'number') {
        total += benefit.amount;
      }
    }
  }
  return total;
};

/** The discount an order had before the manual list existed: what the promotions do not explain. */
export function legacyManualDiscount(order: {
  createdAt: string;
  orderDiscount: unknown;
  promotions: unknown;
}): ManualDiscount | null {
  const discount = typeof order.orderDiscount === 'number' ? order.orderDiscount : 0;
  const amount = Math.max(0, discount - appliedOrderDiscount(order.promotions));
  if (amount === 0) return null;
  return {
    id: 1,
    kind: 'LEGACY',
    percent: null,
    amount,
    reason: LEGACY_DISCOUNT_REASON,
    createdAt: order.createdAt,
    actor: 'system',
  };
}

/** The stored list; a null column reads as the legacy item, or none. */
export function readManualDiscounts(
  order: { manualDiscounts?: unknown } & Parameters<typeof legacyManualDiscount>[0]
): ManualDiscount[] {
  if (Array.isArray(order.manualDiscounts)) return order.manualDiscounts.filter(isRecord) as ManualDiscount[];
  const legacy = legacyManualDiscount(order);
  return legacy ? [legacy] : [];
}

export const manualDiscountTotal = (items: ManualDiscount[]): number =>
  items.reduce((sum, item) => sum + item.amount, 0);

/** Percent in (0, 100] with at most two decimals. */
const isPercent = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v > 0 &&
  v <= 100 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

export function buildManualDiscount(
  input: unknown,
  ctx: { subtotal: number; orderDiscount: number; nextId: number; at: string; actor: string }
): { discount: ManualDiscount | null; errors: DiscountError[] } {
  const body = isRecord(input) ? input : {};
  const errors: DiscountError[] = [];

  const kind = body.kind === 'FIXED' || body.kind === 'PERCENT' ? body.kind : null;
  if (!kind) errors.push({ path: 'kind', code: 'required' });

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1 || reason.length > MAX_DISCOUNT_REASON) errors.push({ path: 'reason', code: 'required' });

  let amount = 0;
  let percent: number | null = null;
  if (kind === 'FIXED') {
    const v = body.value;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_MONEY_CENTS) amount = v;
  } else if (kind === 'PERCENT') {
    if (isPercent(body.value)) {
      percent = body.value;
      amount = percentOf(ctx.subtotal, percent);
    }
  }
  if (kind && amount < 1) {
    errors.push({ path: 'value', code: 'INVALID_AMOUNT' });
  } else if (kind && amount > ctx.subtotal - ctx.orderDiscount) {
    errors.push({ path: 'value', code: 'DISCOUNT_EXCEEDS_PRODUCTS' });
  }

  if (errors.length > 0 || !kind) return { discount: null, errors };
  return {
    discount: { id: ctx.nextId, kind, percent, amount, reason, createdAt: ctx.at, actor: ctx.actor },
    errors,
  };
}
