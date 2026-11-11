import type { PromotionCandidate } from './types';

export type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE' | 'EXPIRED';

export function promotionStatus(
  p: { active: boolean; startsAt: string; endsAt: string | null },
  now: Date
): PromotionStatus {
  if (!p.active) return 'INACTIVE';
  const t = now.getTime();
  if (t < new Date(p.startsAt).getTime()) return 'SCHEDULED';
  if (p.endsAt && t >= new Date(p.endsAt).getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export type BlockReason =
  | 'INACTIVE'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'EMAIL_NOT_ELIGIBLE';

/** Why a candidate cannot apply right now, or null when it is available. `email` is normalised. */
export function candidateBlock(
  c: PromotionCandidate,
  ctx: { now: Date; email: string | null }
): BlockReason | null {
  const status = promotionStatus(c, ctx.now);
  if (status !== 'ACTIVE') return status;
  if (c.usageLimit !== null && c.redemptions >= c.usageLimit) return 'USAGE_LIMIT_REACHED';
  if (c.eligibility.mode === 'EMAILS') {
    if (!ctx.email || !c.eligibility.emails.includes(ctx.email)) return 'EMAIL_NOT_ELIGIBLE';
  }
  if (ctx.email && c.perCustomerLimit !== null && c.customerUses >= c.perCustomerLimit) {
    return 'CUSTOMER_LIMIT_REACHED';
  }
  return null;
}
