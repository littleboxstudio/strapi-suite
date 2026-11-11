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

/**
 * The promotion definition (conditions, benefits, stacking, eligibility are validated by the
 * server; the editor, Task 12, narrows them).
 */
export type PromotionDefinition = {
  name: string;
  description: string | null;
  code: string | null;
  method: PromotionMethod;
  displayName: Record<string, string>;
  priority: number;
  eligibility: Record<string, any>;
  conditions: Record<string, any>;
  benefits: Record<string, any>;
  stacking: Record<string, any>;
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
