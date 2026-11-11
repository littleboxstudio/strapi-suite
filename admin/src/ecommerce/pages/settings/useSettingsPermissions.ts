import { useRBAC } from '@strapi/strapi/admin';

// Stable reference: useRBAC re-checks whenever the permissions object changes.
const PERMISSIONS = {
  read: [{ action: 'plugin::littlebox-strapi-suite.ecommerce.settings.read', subject: null }],
  update: [{ action: 'plugin::littlebox-strapi-suite.ecommerce.settings.manage', subject: null }],
};

/** `canUpdate` is false while loading and for users without `ecommerce.settings.manage`. */
export function useSettingsPermissions(): { isLoading: boolean; canUpdate: boolean } {
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS);
  return { isLoading, canUpdate: !isLoading && !!allowedActions.canUpdate };
}
