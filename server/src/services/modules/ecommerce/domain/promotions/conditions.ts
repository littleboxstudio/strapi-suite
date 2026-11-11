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
export type ConditionContext = { lines: EvaluationLine[]; email: string | null };

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

const evaluateCondition = (c: Condition, ctx: ConditionContext): boolean => {
  const evaluator = Object.prototype.hasOwnProperty.call(CONDITION_EVALUATORS, c?.type)
    ? (CONDITION_EVALUATORS as Record<string, (c: Condition, ctx: ConditionContext) => boolean>)[
        c.type
      ]
    : undefined;
  if (!evaluator) return false; // unknown type never matches and never throws
  try {
    return evaluator(c, ctx);
  } catch {
    return false;
  }
};

/** A group without children has no conditions and is true. */
export const conditionsMet = (group: ConditionGroup, ctx: ConditionContext): boolean => {
  const children = Array.isArray(group?.children) ? group.children : [];
  if (children.length === 0) return true;
  const test = (child: ConditionGroup | Condition): boolean =>
    child.type === 'GROUP' ? conditionsMet(child, ctx) : evaluateCondition(child, ctx);
  return group.operator === 'OR' ? children.some(test) : children.every(test);
};

export const eligibilityMet = (e: Eligibility, email: string | null): boolean => {
  if (e.mode === 'ALL') return true;
  if (email === null) return false;
  return e.emails.includes(normalizeEmail(email));
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
