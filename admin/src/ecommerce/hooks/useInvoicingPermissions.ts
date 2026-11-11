import { useRBAC } from '@strapi/strapi/admin';
import { INVOICING_MANAGE_ACTION, rbacKey } from '../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes. A call of its own:
// `invoicing.manage` shares its `allowedActions` key (`canManage`) with the other `*.manage` actions.
const PERMISSIONS = [{ action: INVOICING_MANAGE_ACTION, subject: null }];

const KEY = rbacKey(INVOICING_MANAGE_ACTION);

/** `canInvoice` (`ecommerce.invoicing.manage`: issue, reconcile, credit notes) is false while loading. */
export function useInvoicingPermissions(): { canInvoice: boolean } {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return { canInvoice: !isLoading && !!allowedActions[KEY] };
}
