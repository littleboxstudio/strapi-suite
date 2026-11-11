/**
 * Promotion condition engine (no Strapi imports). Nested AND/OR groups over a registry of
 * evaluators: a new condition type is one entry in CONDITION_EVALUATORS plus one in the
 * validation; the engine does not change. Money is integer cents.
 */
import { normalizeEmail } from '../email';
import {
  targetMatches,
  type Condition,
  type ConditionGroup,
  type Eligibility,
  type EvaluationLine,
  type NumberOperator,
} from './types';

/** Customer lines only (no gifts), and the customer e-mail when known. */
export type ConditionContext = {
  lines: EvaluationLine[];
  email: string | null;
  /** Called when an evaluator throws (the condition then counts as false). */
  onError?: (type: string, err: unknown) => void;
};

/** Distributes over the union, so a member with a union `type` serves each of its types. */
type ConditionOf<K extends Condition['type']> = Condition extends infer C
  ? C extends { type: infer T }
    ? K extends T
      ? C
      : never
    : never
  : never;

const compare = (actual: number, operator: NumberOperator, value: number): boolean => {
  switch (operator) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'gt':
      return actual > value;
    case 'gte':
      return actual >= value;
    case 'lt':
      return actual < value;
    case 'lte':
      return actual <= value;
    default:
      return false;
  }
};

const subtotalOf = (lines: EvaluationLine[]): number =>
  lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

const totalQuantity = (lines: EvaluationLine[]): number =>
  lines.reduce((sum, l) => sum + l.quantity, 0);

export const CONDITION_EVALUATORS: {
  [K in Condition['type']]: (c: ConditionOf<K>, ctx: ConditionContext) => boolean;
} = {
  SUBTOTAL: (c, ctx) => compare(subtotalOf(ctx.lines), c.operator, c.value),
  SUBTOTAL_BETWEEN: (c, ctx) => {
    const subtotal = subtotalOf(ctx.lines);
    return subtotal >= c.min && subtotal <= c.max;
  },
  CART_CONTAINS: (c, ctx) => {
    if (!c.target.variantIds.length && !c.target.productIds.length) return false;
    const items = [
      ...c.target.variantIds.map((id) => ctx.lines.some((l) => l.variantId === id)),
      ...c.target.productIds.map((id) => ctx.lines.some((l) => l.productId === id)),
    ];
    if (c.match === 'ALL') return items.every(Boolean);
    if (c.match === 'NONE') return !items.some(Boolean);
    return items.some(Boolean);
  },
  PRODUCT_QUANTITY: (c, ctx) =>
    compare(
      ctx.lines.filter((l) => targetMatches(c.target, l)).reduce((sum, l) => sum + l.quantity, 0),
      c.operator,
      c.value
    ),
  TOTAL_QUANTITY: (c, ctx) => compare(totalQuantity(ctx.lines), c.operator, c.value),
  DISTINCT_PRODUCTS: (c, ctx) =>
    compare(new Set(ctx.lines.map((l) => l.productId)).size, c.operator, c.value),
  EMAIL: (c, ctx) => {
    if (ctx.email === null) return false;
    const email = normalizeEmail(ctx.email);
    const value = normalizeEmail(c.value);
    if (!value) return false;
    switch (c.operator) {
      case 'eq':
        return email === value;
      case 'neq':
        return email !== value;
      case 'contains':
        return email.includes(value);
      case 'not_contains':
        return !email.includes(value);
      default:
        return false;
    }
  },
};

type AnyEvaluator = (c: Condition, ctx: ConditionContext) => boolean;

/** Fail closed: a null, malformed or unknown condition, or a throwing evaluator, is false. */
const evaluateCondition = (c: Condition, ctx: ConditionContext): boolean => {
  try {
    const type = (c as { type?: unknown } | null)?.type;
    if (typeof type !== 'string') return false;
    if (!Object.prototype.hasOwnProperty.call(CONDITION_EVALUATORS, type)) return false;
    return (CONDITION_EVALUATORS as unknown as Record<string, AnyEvaluator>)[type](c, ctx);
  } catch (err) {
    try {
      ctx.onError?.(String((c as { type?: unknown } | null)?.type), err);
    } catch {
      // a failing hook must not break evaluation
    }
    return false;
  }
};

/** A group without children has no conditions and is true. */
export const conditionsMet = (group: ConditionGroup, ctx: ConditionContext): boolean => {
  const children = Array.isArray(group?.children) ? group.children : [];
  if (children.length === 0) return true;
  const test = (child: ConditionGroup | Condition): boolean => {
    if (!child || typeof child !== 'object') return false;
    return child.type === 'GROUP' ? conditionsMet(child, ctx) : evaluateCondition(child, ctx);
  };
  if (group.operator === 'OR') return children.some(test);
  if (group.operator === 'AND') return children.every(test);
  return false;
};

export const eligibilityMet = (e: Eligibility, email: string | null): boolean => {
  if (e.mode === 'ALL') return true;
  if (email === null) return false;
  const normalized = normalizeEmail(email);
  return e.emails.some((stored) => normalizeEmail(stored) === normalized);
};

/** Applied promotions whose stored eligibility/conditions no longer hold for the new context. */
export const unmetPromotions = (
  applied: {
    promotionId: number;
    name: string;
    snapshot: { eligibility: Eligibility; conditions: ConditionGroup };
  }[],
  ctx: ConditionContext
): { promotionId: number; name: string }[] =>
  applied
    .filter(
      (a) =>
        !(
          eligibilityMet(a.snapshot.eligibility, ctx.email) &&
          conditionsMet(a.snapshot.conditions, ctx)
        )
    )
    .map((a) => ({ promotionId: a.promotionId, name: a.name }));

/**
 * `unmetPromotions` for stored snapshots, failing closed per promotion: a condition that throws
 * or a malformed snapshot reports the promotion as unmet (never silently met), and
 * `onConditionError` hears about it with the promotion id.
 */
export const unmetAppliedPromotions = (
  applied: {
    promotionId: number;
    name: string;
    snapshot: { eligibility: Eligibility; conditions: ConditionGroup };
  }[],
  ctx: { lines: EvaluationLine[]; email: string | null },
  onConditionError?: (promotionId: number, type: string, err: unknown) => void
): { promotionId: number; name: string }[] => {
  const notify = (promotionId: number, type: string, err: unknown) => {
    try {
      onConditionError?.(promotionId, type, err);
    } catch {
      // a failing hook must not break evaluation
    }
  };
  return applied
    .filter((a) => {
      let failed = false;
      try {
        const unmet = unmetPromotions([a], {
          ...ctx,
          onError: (type, err) => {
            failed = true;
            notify(a.promotionId, type, err);
          },
        });
        return failed || unmet.length > 0;
      } catch (err) {
        notify(a.promotionId, 'SNAPSHOT', err);
        return true;
      }
    })
    .map((a) => ({ promotionId: a.promotionId, name: a.name }));
};
