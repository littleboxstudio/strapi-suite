/**
 * Admin-side shapes of the promotions admin API (server routes admin-promotions).
 * Money is always integer cents. Dates are local wall time `YYYY-MM-DDTHH:mm` in the store time zone.
 */
import type { VariantSearchResult } from './orderTypes';

export type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE' | 'EXPIRED';
export type PromotionMethod = 'AUTOMATIC' | 'CODE';

export type PromotionListItem = {
  id: number;
  name: string;
  code: string | null;
  method: PromotionMethod;
  status: PromotionStatus;
  startsAt: string;
  endsAt: string | null;
  redemptions: number;
  usageLimit: number | null;
};

export type PromotionListParams = { page?: number; search?: string };

export type ProductTarget = { productIds: number[]; variantIds: number[] };

export type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type EmailOperator = 'eq' | 'neq' | 'contains' | 'not_contains';

/** Mirrors the server's promotion condition (domain/promotions/types.ts). Money in cents. */
export type PromotionCondition =
  | { type: 'SUBTOTAL'; operator: NumberOperator; value: number }
  | { type: 'SUBTOTAL_BETWEEN'; min: number; max: number }
  | { type: 'CART_CONTAINS'; match: 'ANY' | 'ALL' | 'NONE'; target: ProductTarget }
  | { type: 'PRODUCT_QUANTITY'; target: ProductTarget; operator: NumberOperator; value: number }
  | { type: 'TOTAL_QUANTITY' | 'DISTINCT_PRODUCTS'; operator: NumberOperator; value: number }
  | { type: 'EMAIL'; operator: EmailOperator; value: string };

export type PromotionConditionGroup = {
  type: 'GROUP';
  operator: 'AND' | 'OR';
  children: (PromotionConditionGroup | PromotionCondition)[];
};

export type PromotionReward =
  | { kind: 'FREE' }
  | { kind: 'PERCENT'; percent: number }
  | { kind: 'FIXED'; amount: number };

/** Mirrors the server's promotion benefit. Money in cents, percentages as numbers (12.5). */
export type PromotionBenefit =
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
      reward: PromotionReward;
    }
  | { type: 'ORDER_PERCENT'; percent: number }
  | { type: 'ORDER_FIXED'; amount: number }
  | { type: 'SHIPPING_FREE'; maxAmount: number | null }
  | { type: 'SHIPPING_PERCENT'; percent: number }
  | { type: 'SHIPPING_FIXED'; amount: number };

export type PromotionBenefitType = PromotionBenefit['type'];

export type PromotionStacking = {
  exclusive: boolean;
  withProduct: boolean;
  withOrder: boolean;
  withShipping: boolean;
};

export type PromotionEligibility = { mode: 'ALL' } | { mode: 'EMAILS'; emails: string[] };

/** The promotion definition the server validates (create and update bodies). */
export type PromotionDefinition = {
  name: string;
  description: string | null;
  code: string | null;
  method: PromotionMethod;
  displayName: Record<string, string>;
  priority: number;
  eligibility: PromotionEligibility;
  conditions: PromotionConditionGroup;
  benefits: PromotionBenefit[];
  stacking: PromotionStacking;
  perOrderLimit: number | null;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
};

export type PromotionLabels = {
  products: Record<number, string>;
  variants: Record<number, { name: string; option: string | null; sku: string }>;
};

export type Promotion = PromotionDefinition & {
  id: number;
  status: PromotionStatus;
  redemptions: number;
  version: number;
  timezone: string;
  createdAt: string | null;
  updatedAt: string | null;
  labels: PromotionLabels;
};

/** Update body: the definition plus the `version` it was loaded with. */
export type PromotionSaveInput = PromotionDefinition & { version?: number };

export type PromotionRedemption = {
  id: number;
  orderId: number | null;
  orderReference: number | null;
  customerId: number | null;
  /** `a***@example.com`: never the full address. */
  maskedEmail: string | null;
  amount: number;
  status: 'RESERVED' | 'RELEASED';
  createdAt: string | null;
  releasedAt: string | null;
};

export type PromotionCatalogResult = VariantSearchResult;

/** `GET promotions/context`: what the editor needs with promotions.read alone. */
export type PromotionEditorContext = {
  defaultLocale: string;
  locales: { code: string; name: string }[];
  /** Store time zone (IANA): dates are wall time in it. */
  timezone: string;
};

export type StoreCreditMovement = {
  id: number;
  type: 'ISSUE' | 'CONSUME' | 'RESTORE' | 'ADJUST';
  /** Signed: ISSUE/RESTORE positive, CONSUME negative, ADJUST either. */
  amount: number;
  orderId: number | null;
  paymentId: number | null;
  refundId: number | null;
  operationKey: string;
  actor: string | null;
  createdAt: string | null;
};
