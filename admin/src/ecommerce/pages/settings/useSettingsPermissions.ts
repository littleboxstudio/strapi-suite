import { useRBAC } from '@strapi/strapi/admin';
import { SETTINGS_MANAGE_ACTION, SETTINGS_READ_ACTION, rbacKey } from '../../utils/rbac';

// Stable reference: useRBAC re-checks whenever the permissions array changes.
const PERMISSIONS = [
  { action: SETTINGS_READ_ACTION, subject: null },
  { action: SETTINGS_MANAGE_ACTION, subject: null },
];

const MANAGE_KEY = rbacKey(SETTINGS_MANAGE_ACTION);

/** `canUpdate` is false while loading and for users without `ecommerce.settings.manage`. */
export function useSettingsPermissions(): { isLoading: boolean; canUpdate: boolean } {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return { isLoading, canUpdate: !isLoading && !!allowedActions[MANAGE_KEY] };
}
