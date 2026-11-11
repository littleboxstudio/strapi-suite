import { useRBAC } from '@strapi/strapi/admin';
import { PAYMENTS_MANAGE_ACTION, REFUNDS_MANAGE_ACTION, rbacKey } from '../utils/rbac';

// Stable references: useRBAC re-checks whenever the permissions array changes. One call per
// action: `payments.manage` and `refunds.manage` share the same `allowedActions` key (`canManage`).
const PAY = [{ action: PAYMENTS_MANAGE_ACTION, subject: null }];
const REFUND = [{ action: REFUNDS_MANAGE_ACTION, subject: null }];

const PAY_KEY = rbacKey(PAYMENTS_MANAGE_ACTION);
const REFUND_KEY = rbacKey(REFUNDS_MANAGE_ACTION);

/**
 * `canPay` (`ecommerce.payments.manage`: payment links and instructions) and `canRefund`
 * (`ecommerce.refunds.manage`: refunds and store credit) are false while loading.
 */
export function usePaymentPermissions(): { canPay: boolean; canRefund: boolean } {
  const pay = useRBAC(PAY);
  const refund = useRBAC(REFUND);
  return {
    canPay: !pay.isLoading && !!pay.allowedActions[PAY_KEY],
    canRefund: !refund.isLoading && !!refund.allowedActions[REFUND_KEY],
  };
}
