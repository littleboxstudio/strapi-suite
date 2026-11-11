export const SETTINGS_READ_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.settings.read';
export const SETTINGS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.settings.manage';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The `allowedActions` key Strapi's `useRBAC` returns for an action uid: the last dot segment,
 * hyphens removed with each part capitalised, prefixed with `can`
 * (`...settings.manage` → `canManage`, `admin::roles.create-draft` → `canCreateDraft`).
 */
export function rbacKey(action: string): string {
  const last = action.split('.').slice(-1)[0] ?? '';
  return `can${capitalise(last.split('-').map(capitalise).join(''))}`;
}
