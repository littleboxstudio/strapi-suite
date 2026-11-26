import { useRBAC } from '@strapi/strapi/admin';
import {
  CUSTOMERS_BLOCK_ACTION,
  CUSTOMERS_MANAGE_ACTION,
  CUSTOMERS_PASSWORD_ACTION,
  CUSTOMERS_READ_ACTION,
  rbacKey,
} from '../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes.
const PERMISSIONS = [
  { action: CUSTOMERS_READ_ACTION, subject: null },
  { action: CUSTOMERS_MANAGE_ACTION, subject: null },
  { action: CUSTOMERS_BLOCK_ACTION, subject: null },
  { action: CUSTOMERS_PASSWORD_ACTION, subject: null },
];

const MANAGE_KEY = rbacKey(CUSTOMERS_MANAGE_ACTION);
const BLOCK_KEY = rbacKey(CUSTOMERS_BLOCK_ACTION);
const PASSWORD_KEY = rbacKey(CUSTOMERS_PASSWORD_ACTION);

/**
 * `canManage`, `canBlock` (block and unblock) and `canSetPassword` are false while loading and
 * for users without the matching `ecommerce.customers.*` action.
 */
export function useCustomerPermissions(): {
  isLoading: boolean;
  canManage: boolean;
  canBlock: boolean;
  canSetPassword: boolean;
} {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return {
    isLoading,
    canManage: !isLoading && !!allowedActions[MANAGE_KEY],
    canBlock: !isLoading && !!allowedActions[BLOCK_KEY],
    canSetPassword: !isLoading && !!allowedActions[PASSWORD_KEY],
  };
}
