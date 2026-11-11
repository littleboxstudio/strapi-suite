import { useRBAC } from '@strapi/strapi/admin';
import {
  CUSTOMERS_READ_ACTION,
  PROMOTIONS_MANAGE_ACTION,
  PROMOTIONS_READ_ACTION,
  REFUNDS_MANAGE_ACTION,
  rbacKey,
} from '../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes.
const PROMOTIONS = [
  { action: PROMOTIONS_READ_ACTION, subject: null },
  { action: PROMOTIONS_MANAGE_ACTION, subject: null },
];
const CREDITS = [
  { action: CUSTOMERS_READ_ACTION, subject: null },
  { action: REFUNDS_MANAGE_ACTION, subject: null },
];

/** Every flag is false while loading. */
export function usePromotionPermissions(): {
  isLoading: boolean;
  canRead: boolean;
  canManage: boolean;
  /** `customers.read`: the Store credit tab and its list. */
  canReadCredits: boolean;
  /** `refunds.manage`: voiding a store credit. */
  canVoidCredits: boolean;
} {
  const promotions = useRBAC(PROMOTIONS);
  const credits = useRBAC(CREDITS);
  const isLoading = promotions.isLoading || credits.isLoading;
  return {
    isLoading,
    canRead: !promotions.isLoading && !!promotions.allowedActions[rbacKey(PROMOTIONS_READ_ACTION)],
    canManage: !promotions.isLoading && !!promotions.allowedActions[rbacKey(PROMOTIONS_MANAGE_ACTION)],
    canReadCredits: !credits.isLoading && !!credits.allowedActions[rbacKey(CUSTOMERS_READ_ACTION)],
    canVoidCredits: !credits.isLoading && !!credits.allowedActions[rbacKey(REFUNDS_MANAGE_ACTION)],
  };
}
