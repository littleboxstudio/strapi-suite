import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';

export const ECOMMERCE_PERMISSIONS = {
  productsRead: `plugin::${PLUGIN_ID}.ecommerce.products.read`,
  productsManage: `plugin::${PLUGIN_ID}.ecommerce.products.manage`,
  settingsRead: `plugin::${PLUGIN_ID}.ecommerce.settings.read`,
  settingsManage: `plugin::${PLUGIN_ID}.ecommerce.settings.manage`,
  ordersRead: `plugin::${PLUGIN_ID}.ecommerce.orders.read`,
  ordersManage: `plugin::${PLUGIN_ID}.ecommerce.orders.manage`,
  customersRead: `plugin::${PLUGIN_ID}.ecommerce.customers.read`,
  customersManage: `plugin::${PLUGIN_ID}.ecommerce.customers.manage`,
  refundsManage: `plugin::${PLUGIN_ID}.ecommerce.refunds.manage`,
  paymentsManage: `plugin::${PLUGIN_ID}.ecommerce.payments.manage`,
  invoicingManage: `plugin::${PLUGIN_ID}.ecommerce.invoicing.manage`,
};

const ECOMMERCE_ACTIONS = [
  { uid: 'ecommerce.products.read', displayName: 'Read products' },
  { uid: 'ecommerce.products.manage', displayName: 'Manage products' },
  { uid: 'ecommerce.settings.read', displayName: 'Read settings' },
  { uid: 'ecommerce.settings.manage', displayName: 'Manage settings' },
  { uid: 'ecommerce.orders.read', displayName: 'Read orders' },
  { uid: 'ecommerce.orders.manage', displayName: 'Manage orders' },
  { uid: 'ecommerce.customers.read', displayName: 'Read customers' },
  { uid: 'ecommerce.customers.manage', displayName: 'Manage customers' },
  { uid: 'ecommerce.refunds.manage', displayName: 'Manage refunds and store credit' },
  { uid: 'ecommerce.payments.manage', displayName: 'Manage payment links and instructions' },
  { uid: 'ecommerce.invoicing.manage', displayName: 'Issue invoices and credit notes' },
];

export const registerEcommercePermissions = async (strapi: Core.Strapi): Promise<void> => {
  await (strapi as any).admin.services.permission.actionProvider.registerMany(
    ECOMMERCE_ACTIONS.map((action) => ({
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'ecommerce',
      ...action,
    }))
  );
};
