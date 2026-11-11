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

export const CUSTOMERS_READ_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.customers.read';
export const CUSTOMERS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.customers.manage';
export const ORDERS_READ_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.orders.read';
export const ORDERS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.orders.manage';
export const REFUNDS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.refunds.manage';
export const PAYMENTS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.payments.manage';
export const INVOICING_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.invoicing.manage';
export const PROMOTIONS_READ_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.promotions.read';
export const PROMOTIONS_MANAGE_ACTION = 'plugin::littlebox-strapi-suite.ecommerce.promotions.manage';

/** The menu entries that need a permission to be shown (design 9.2: hide what the user cannot do). */
const MENU_PERMISSIONS: Record<string, string> = { promotions: PROMOTIONS_READ_ACTION };

/**
 * Menu items the user may see: those without a required action, and those whose action is in
 * `allowedActions` (the action uids the user holds). Order is kept.
 */
export function filterMenu<T extends { key: string }>(
  menu: readonly T[],
  allowedActions: readonly string[]
): T[] {
  return menu.filter((item) => {
    const required = MENU_PERMISSIONS[item.key];
    return !required || allowedActions.includes(required);
  });
}
