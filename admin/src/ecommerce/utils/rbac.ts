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
