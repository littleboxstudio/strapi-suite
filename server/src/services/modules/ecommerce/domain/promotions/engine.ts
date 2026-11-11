/**
 * Promotion selection (no Strapi imports): which candidates apply, which combination is best
 * (requirements 2.3, 2.5, 2.13, 2.14, 2.15) and the status of every entered code. Deterministic:
 * the result does not depend on the order of the candidates. Money is integer cents.
 */
import { normalizeEmail } from '../email';
import { candidateBlock, requiresVerifiedEmail, type BlockReason } from './availability';
import {
  applyCombination,
  type CombinationContext,
  type CombinationResult,
  type GiftOption,
  type PricedLine,
} from './benefits';
import { conditionsMet, eligibilityMet } from './conditions';
import { normalizePromotionCode } from './definition';
import {
  BENEFIT_CLASS,
  type Benefit,
  type ConditionGroup,
  type DiscountClass,
  type Eligibility,
  type EvaluationLine,
  type PromotionCandidate,
  type PromotionDefinition,
  type Stacking,
} from './types';

export const PROMOTION_SEARCH_LIMIT_DEFAULT = 12;
/**
 * Exhaustive search evaluates up to 2^limit subsets. Measured per evaluation with mutually
 * compatible candidates on a small cart (dev laptop): ~20 ms at 12, ~100–450 ms at 16
 * (65 536 applyCombination calls; grows with the number of cart units). A quote followed by a
 * create evaluates twice.
 */
export const PROMOTION_SEARCH_LIMIT_MAX = 16;

export const classesOf = (p: PromotionDefinition): Set<DiscountClass> =>
  new Set(p.benefits.map((b) => BENEFIT_CLASS[b.type]));

const allows = (s: Stacking, c: DiscountClass): boolean =>
  c === 'PRODUCT_DISCOUNT' ? s.withProduct : c === 'ORDER_DISCOUNT' ? s.withOrder : s.withShipping;

/** Neither is exclusive and each one allows every class of the other (two-way). */
export const compatible = (a: PromotionDefinition, b: PromotionDefinition): boolean => {
  if (a.stacking.exclusive || b.stacking.exclusive) return false;
  for (const c of classesOf(b)) if (!allows(a.stacking, c)) return false;
  for (const c of classesOf(a)) if (!allows(b.stacking, c)) return false;
  return true;
};

export type CodeStatus =
  | 'APPLIED'
  | 'NOT_FOUND'
  | BlockReason
  | 'CONDITIONS_NOT_MET'
  | 'CONFLICT'
  | 'NO_BENEFIT'
  | 'AWAITING_SHIPPING';

export type AppliedBenefit = {
  index: number;
  type: Benefit['type'];
  class: DiscountClass;
  amount: number;
  params: Benefit;
};

export type AppliedPromotion = {
  promotionId: number;
  version: number;
  name: string;
  displayName: Record<string, string>;
  code: string | null;
  method: 'AUTOMATIC' | 'CODE';
  classes: DiscountClass[];
  amount: number;
  benefits: AppliedBenefit[];
  snapshot: {
    eligibility: Eligibility;
    conditions: ConditionGroup;
    stacking: Stacking;
    priority: number;
    perOrderLimit: number | null;
  };
};

export type EvaluationInput = {
  /** Customer lines (no gifts). */
  lines: EvaluationLine[];
  email: string | null;
  /** Absent = trusted (admin); `false` = storefront without a verified e-mail. */
  emailVerified?: boolean;
  shipping: number | null;
  codes: string[];
  candidates: PromotionCandidate[];
  /** `available` must already exclude the cart units of the same variant (see GiftOption). */
  gifts: Map<number, GiftOption>;
  giftChoices?: Record<number, number>;
  now: Date;
  searchLimit: number;
  /** Called when a condition evaluator throws; the condition then counts as false. */
  onConditionError?: (promotionId: number, type: string, err: unknown) => void;
};

export type RejectionReason = Exclude<CodeStatus, 'APPLIED' | 'NOT_FOUND'>;

export type PromotionEvaluation = {
  evaluated: number[];
  eligible: number[];
  applied: AppliedPromotion[];
  rejected: { promotionId: number; reason: RejectionReason }[];
  codes: { code: string; status: CodeStatus; promotionId: number | null }[];
  lines: PricedLine[];
  itemsOriginal: number;
  productDiscount: number;
  subtotal: number;
  orderDiscount: number;
  shippingOriginal: number | null;
  shippingDiscount: number;
  totalDiscount: number;
  total: number;
  exhaustive: boolean;
};

type Scored = {
  members: PromotionCandidate[];
  result: CombinationResult;
  /** See costOf. */
  cost: number;
  codeCount: number;
  prioritySum: number;
  ids: number[];
};

const discountOf = (r: CombinationResult): number =>
  r.productDiscount + r.orderDiscount + r.shippingDiscount;

/**
 * What the customer pays, minus the retail value of the gifts they get for free. A free gift is
 * a saving worth its price (otherwise it never changes `total` and could never win); a gift the
 * customer has to pay for, even in part, is measured as a purchase: its paid part raises the
 * cost and its partial discount is not a saving, so a paid gift never raises the amount to pay
 * on its own. Consequence (intended, merchant-configured): an expensive free gift can beat a
 * smaller cash discount, and the customer cannot trade the gift for the cash.
 */
const costOf = (r: CombinationResult): number =>
  r.total -
  r.lines.reduce(
    (s, l) => (l.isGift && l.unitDiscount >= l.unitPrice ? s + l.unitPrice * l.quantity : s),
    0
  );

/** Requirements 2.13 / 2.14: lowest cost, entered codes, priority sum, fewer, lowest ids. */
const better = (a: Scored, b: Scored): boolean => {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.codeCount !== b.codeCount) return a.codeCount > b.codeCount;
  if (a.prioritySum !== b.prioritySum) return a.prioritySum > b.prioritySum;
  if (a.ids.length !== b.ids.length) return a.ids.length < b.ids.length;
  for (let i = 0; i < a.ids.length; i += 1) if (a.ids[i] !== b.ids[i]) return a.ids[i] < b.ids[i];
  return false;
};

export const evaluatePromotions = (input: EvaluationInput): PromotionEvaluation => {
  const ctx: CombinationContext = {
    lines: input.lines,
    shipping: input.shipping,
    gifts: input.gifts,
    giftChoices: input.giftChoices ?? {},
  };
  const email = input.email === null ? null : normalizeEmail(input.email) || null;
  // Customer cart at original prices plus shipping: the cost of the empty combination.
  const baseCost =
    input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) + (input.shipping ?? 0);

  // Step 1: codes and candidates.
  const codes: string[] = [];
  for (const raw of input.codes) {
    const code = normalizePromotionCode(raw);
    if (code && !codes.includes(code)) codes.push(code);
  }
  const byId = new Map<number, PromotionCandidate>();
  for (const c of input.candidates) if (!byId.has(c.id)) byId.set(c.id, c);
  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  const codeOwner = new Map<string, PromotionCandidate>();
  for (const c of all) {
    if (c.method !== 'CODE' || c.code === null) continue;
    const code = normalizePromotionCode(c.code);
    if (codes.includes(code) && !codeOwner.has(code)) codeOwner.set(code, c);
  }
  const enteredIds = new Set([...codeOwner.values()].map((c) => c.id));
  const considered = all.filter((c) => c.method === 'AUTOMATIC' || enteredIds.has(c.id));

  // Step 2: filter and isolated value.
  const reasons = new Map<number, RejectionReason>();
  const eligible: PromotionCandidate[] = [];
  const isolated = new Map<number, number>();
  const pool: PromotionCandidate[] = [];
  for (const c of considered) {
    // Unverified e-mail: the per-customer limit is not evaluated (email: null) and, if nothing
    // else blocks, the answer is the same for every e-mail (no list membership is revealed).
    const unverified = input.emailVerified === false && requiresVerifiedEmail(c);
    const block = candidateBlock(
      { ...c, eligibility: { mode: 'ALL' } },
      { now: input.now, email: unverified ? null : email }
    );
    if (block) {
      reasons.set(c.id, block);
      continue;
    }
    if (unverified) {
      reasons.set(c.id, 'EMAIL_NOT_VERIFIED');
      continue;
    }
    if (!eligibilityMet(c.eligibility, email)) {
      reasons.set(c.id, 'EMAIL_NOT_ELIGIBLE');
      continue;
    }
    const met = conditionsMet(c.conditions, {
      lines: input.lines,
      email,
      onError: input.onConditionError
        ? (type, err) => input.onConditionError?.(c.id, type, err)
        : undefined,
    });
    if (!met) {
      reasons.set(c.id, 'CONDITIONS_NOT_MET');
      continue;
    }
    eligible.push(c);
    if (
      input.shipping === null &&
      c.benefits.length > 0 &&
      c.benefits.every((b) => BENEFIT_CLASS[b.type] === 'SHIPPING_DISCOUNT')
    ) {
      reasons.set(c.id, 'AWAITING_SHIPPING');
      continue;
    }
    const value = baseCost - costOf(applyCombination([c], ctx));
    isolated.set(c.id, value);
    if (value <= 0) reasons.set(c.id, 'NO_BENEFIT');
    else pool.push(c);
  }

  // Step 3: search. A combination where a member realises 0 is not a candidate (the same set
  // without that member is), so ties are compared between combinations that really apply.
  const score = (members: PromotionCandidate[]): Scored | null => {
    const result = applyCombination(members, ctx);
    for (const m of members) {
      const realised = (result.benefitAmounts.get(m.id) ?? []).reduce((s, v) => s + v, 0);
      if (realised <= 0) return null;
    }
    return {
      members,
      result,
      cost: costOf(result),
      codeCount: members.filter((m) => enteredIds.has(m.id)).length,
      prioritySum: members.reduce((s, m) => s + m.priority, 0),
      ids: members.map((m) => m.id),
    };
  };

  const limit = Number.isInteger(input.searchLimit)
    ? Math.min(Math.max(input.searchLimit, 0), PROMOTION_SEARCH_LIMIT_MAX)
    : PROMOTION_SEARCH_LIMIT_DEFAULT;
  const n = pool.length;
  const exhaustive = n <= limit;
  let best = score([]) as Scored;
  if (exhaustive) {
    const compat = pool.map((a, i) =>
      pool.reduce((mask, b, j) => (i !== j && compatible(a, b) ? mask | (1 << j) : mask), 0)
    );
    const valid = new Uint8Array(1 << n);
    valid[0] = 1;
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const low = 31 - Math.clz32(mask & -mask);
      const rest = mask & ~(1 << low);
      if (!valid[rest] || (compat[low] & rest) !== rest) continue;
      valid[mask] = 1;
      const candidate = score(pool.filter((_, i) => mask & (1 << i)));
      if (candidate && better(candidate, best)) best = candidate;
    }
  } else {
    const order = [...pool].sort(
      (a, b) =>
        (isolated.get(b.id) as number) - (isolated.get(a.id) as number) ||
        b.priority - a.priority ||
        a.id - b.id
    );
    for (const p of order) {
      if (!best.members.every((m) => compatible(m, p))) continue;
      const candidate = score([...best.members, p].sort((a, b) => a.id - b.id));
      if (candidate && candidate.cost < best.cost) best = candidate;
    }
  }

  // Step 5: eligible promotions outside the chosen combination.
  const chosen = new Set(best.ids);
  for (const c of eligible) {
    if (chosen.has(c.id) || reasons.has(c.id)) continue;
    reasons.set(c.id, (isolated.get(c.id) ?? 0) > 0 ? 'CONFLICT' : 'NO_BENEFIT');
  }

  const applied: AppliedPromotion[] = [...best.members]
    .sort((a, b) => b.priority - a.priority || a.id - b.id)
    .map((p) => {
      const amounts = best.result.benefitAmounts.get(p.id) ?? [];
      const benefits = p.benefits.map((b, index) => ({
        index,
        type: b.type,
        class: BENEFIT_CLASS[b.type],
        amount: amounts[index] ?? 0,
        params: b,
      }));
      return {
        promotionId: p.id,
        version: p.version,
        name: p.name,
        displayName: p.displayName,
        code: p.method === 'CODE' && p.code !== null ? normalizePromotionCode(p.code) : null,
        method: p.method,
        classes: [...classesOf(p)].sort(),
        amount: benefits.reduce((s, b) => s + b.amount, 0),
        benefits,
        snapshot: {
          eligibility: p.eligibility,
          conditions: p.conditions,
          stacking: p.stacking,
          priority: p.priority,
          perOrderLimit: p.perOrderLimit,
        },
      };
    });

  const r = best.result;
  return {
    evaluated: considered.map((c) => c.id),
    eligible: eligible.map((c) => c.id),
    applied,
    rejected: considered
      .filter((c) => reasons.has(c.id))
      .map((c) => ({ promotionId: c.id, reason: reasons.get(c.id) as RejectionReason })),
    codes: codes.map((code) => {
      const owner = codeOwner.get(code);
      if (!owner) return { code, status: 'NOT_FOUND' as CodeStatus, promotionId: null };
      const status: CodeStatus = chosen.has(owner.id)
        ? 'APPLIED'
        : (reasons.get(owner.id) as RejectionReason);
      return { code, status, promotionId: owner.id };
    }),
    lines: r.lines,
    itemsOriginal: r.itemsOriginal,
    productDiscount: r.productDiscount,
    subtotal: r.subtotal,
    orderDiscount: r.orderDiscount,
    shippingOriginal: r.shippingOriginal,
    shippingDiscount: r.shippingDiscount,
    totalDiscount: discountOf(r),
    total: r.total,
    exhaustive,
  };
};
