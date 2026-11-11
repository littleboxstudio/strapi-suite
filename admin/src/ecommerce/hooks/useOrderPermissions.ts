import { useRBAC } from '@strapi/strapi/admin';
import { ORDERS_MANAGE_ACTION, ORDERS_READ_ACTION, rbacKey } from '../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes.
const PERMISSIONS = [
  { action: ORDERS_READ_ACTION, subject: null },
  { action: ORDERS_MANAGE_ACTION, subject: null },
];

const READ_KEY = rbacKey(ORDERS_READ_ACTION);
const MANAGE_KEY = rbacKey(ORDERS_MANAGE_ACTION);

/**
 * `canRead` / `canManage` are false while loading and for users without
 * `ecommerce.orders.read` / `ecommerce.orders.manage`.
 */
export function useOrderPermissions(): { isLoading: boolean; canRead: boolean; canManage: boolean } {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return {
    isLoading,
    canRead: !isLoading && !!allowedActions[READ_KEY],
    canManage: !isLoading && !!allowedActions[MANAGE_KEY],
  };
}
