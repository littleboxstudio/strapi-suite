import { useRBAC } from '@strapi/strapi/admin';
import { CUSTOMERS_MANAGE_ACTION, CUSTOMERS_READ_ACTION, rbacKey } from '../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes.
const PERMISSIONS = [
  { action: CUSTOMERS_READ_ACTION, subject: null },
  { action: CUSTOMERS_MANAGE_ACTION, subject: null },
];

const MANAGE_KEY = rbacKey(CUSTOMERS_MANAGE_ACTION);

/** `canManage` is false while loading and for users without `ecommerce.customers.manage`. */
export function useCustomerPermissions(): { isLoading: boolean; canManage: boolean } {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return { isLoading, canManage: !isLoading && !!allowedActions[MANAGE_KEY] };
}
