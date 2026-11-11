/**
 * Promotion domain types (no Strapi imports). Money is integer cents (VAT included, EUR).
 */

export type DiscountClass = 'PRODUCT_DISCOUNT' | 'ORDER_DISCOUNT' | 'SHIPPING_DISCOUNT';

export type ProductTarget = { productIds: number[]; variantIds: number[] };

/** A listed variant or a listed product matches the line. */
export const targetMatches = (
  t: ProductTarget,
  line: { productId: number; variantId: number }
): boolean => t.variantIds.includes(line.variantId) || t.productIds.includes(line.productId);

export type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export type Condition =
  | { type: 'SUBTOTAL'; operator: NumberOperator; value: number }
  | { type: 'SUBTOTAL_BETWEEN'; min: number; max: number }
  | { type: 'CART_CONTAINS'; match: 'ANY' | 'ALL' | 'NONE'; target: ProductTarget }
  | { type: 'PRODUCT_QUANTITY'; target: ProductTarget; operator: NumberOperator; value: number }
  | { type: 'TOTAL_QUANTITY' | 'DISTINCT_PRODUCTS'; operator: NumberOperator; value: number }
  | { type: 'EMAIL'; operator: 'eq' | 'neq' | 'contains' | 'not_contains'; value: string };

export type ConditionGroup = {
  type: 'GROUP';
  operator: 'AND' | 'OR';
  children: (ConditionGroup | Condition)[];
};

export type Reward =
  | { kind: 'FREE' }
  | { kind: 'PERCENT'; percent: number }
  | { kind: 'FIXED'; amount: number };

export type Benefit =
  | { type: 'PRODUCT_PERCENT'; target: ProductTarget; percent: number; maxQuantity: number | null }
  | {
      type: 'PRODUCT_FIXED';
      target: ProductTarget;
      amount: number;
      per: 'UNIT' | 'SET';
      maxQuantity: number | null;
    }
  | {
      type: 'BUY_X_GET_Y';
      buy: { target: ProductTarget; quantity: number; minAmount: number | null };
      get:
        | { mode: 'IN_CART'; target: ProductTarget; quantity: number }
        | { mode: 'GIFT'; variantIds: number[]; quantity: number };
      reward: Reward;
    }
  | { type: 'ORDER_PERCENT'; percent: number }
  | { type: 'ORDER_FIXED'; amount: number }
  | { type: 'SHIPPING_FREE'; maxAmount: number | null }
  | { type: 'SHIPPING_PERCENT'; percent: number }
  | { type: 'SHIPPING_FIXED'; amount: number };

export const BENEFIT_CLASS: Record<Benefit['type'], DiscountClass> = {
  PRODUCT_PERCENT: 'PRODUCT_DISCOUNT',
  PRODUCT_FIXED: 'PRODUCT_DISCOUNT',
  BUY_X_GET_Y: 'PRODUCT_DISCOUNT',
  ORDER_PERCENT: 'ORDER_DISCOUNT',
  ORDER_FIXED: 'ORDER_DISCOUNT',
  SHIPPING_FREE: 'SHIPPING_DISCOUNT',
  SHIPPING_PERCENT: 'SHIPPING_DISCOUNT',
  SHIPPING_FIXED: 'SHIPPING_DISCOUNT',
};

export type Stacking = {
  exclusive: boolean;
  withProduct: boolean;
  withOrder: boolean;
  withShipping: boolean;
};

export type Eligibility = { mode: 'ALL' } | { mode: 'EMAILS'; emails: string[] };

export type PromotionDefinition = {
  id: number;
  name: string;
  code: string | null;
  method: 'AUTOMATIC' | 'CODE';
  displayName: Record<string, string>;
  priority: number;
  eligibility: Eligibility;
  conditions: ConditionGroup;
  benefits: Benefit[];
  stacking: Stacking;
  perOrderLimit: number | null;
  /** Checkout must have a verified e-mail (always the case when restricted by e-mail or per customer). */
  requireVerifiedEmail: boolean;
  version: number;
};

export type PromotionCandidate = PromotionDefinition & {
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  redemptions: number;
  customerUses: number;
};

export type EvaluationLine = {
  variantId: number;
  productId: number;
  unitPrice: number;
  quantity: number;
};

/** Half-up rounding of `amount * percent / 100` in integers (percent has at most 2 decimals). */
export const percentOf = (amount: number, percent: number): number => {
  const basis = Math.round(percent * 100);
  return Math.floor((amount * basis + 5000) / 10000);
};
