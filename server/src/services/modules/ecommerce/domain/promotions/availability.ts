import type { Condition, ConditionGroup, PromotionCandidate, PromotionDefinition } from './types';

export type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE' | 'EXPIRED';

export function promotionStatus(
  p: { active: boolean; startsAt: string; endsAt: string | null },
  now: Date
): PromotionStatus {
  if (!p.active) return 'INACTIVE';
  const t = now.getTime();
  const start = new Date(p.startsAt).getTime();
  const end = p.endsAt ? new Date(p.endsAt).getTime() : null;
  if (Number.isNaN(start) || (end !== null && Number.isNaN(end))) return 'INACTIVE';
  if (t < start) return 'SCHEDULED';
  if (end !== null && t >= end) return 'EXPIRED';
  return 'ACTIVE';
}

export type BlockReason =
  | 'INACTIVE'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'EMAIL_NOT_ELIGIBLE'
  | 'EMAIL_NOT_VERIFIED';

const hasEmailCondition = (node: ConditionGroup | Condition): boolean =>
  node.type === 'GROUP' ? node.children.some(hasEmailCondition) : node.type === 'EMAIL';

/**
 * Whether the promotion may only apply to a verified e-mail: the flag, an e-mail list, an EMAIL
 * condition at any depth, or a per-customer limit (which, checked against an unverified e-mail,
 * would reveal whether that e-mail already bought).
 */
export const requiresVerifiedEmail = (
  p: Pick<PromotionDefinition, 'requireVerifiedEmail' | 'eligibility' | 'conditions'> & {
    perCustomerLimit: number | null;
  }
): boolean =>
  p.requireVerifiedEmail === true ||
  p.eligibility.mode === 'EMAILS' ||
  hasEmailCondition(p.conditions) ||
  p.perCustomerLimit !== null;

/** Why a candidate cannot apply right now, or null when it is available. `email` is normalised. */
export function candidateBlock(
  c: PromotionCandidate,
  ctx: { now: Date; email: string | null }
): BlockReason | null {
  const status = promotionStatus(c, ctx.now);
  if (status !== 'ACTIVE') return status;
  if (c.usageLimit !== null && c.redemptions >= c.usageLimit) return 'USAGE_LIMIT_REACHED';
  if (ctx.email && c.perCustomerLimit !== null && c.customerUses >= c.perCustomerLimit) {
    return 'CUSTOMER_LIMIT_REACHED';
  }
  if (c.eligibility.mode === 'EMAILS') {
    if (!ctx.email || !c.eligibility.emails.includes(ctx.email)) return 'EMAIL_NOT_ELIGIBLE';
  }
  return null;
}
