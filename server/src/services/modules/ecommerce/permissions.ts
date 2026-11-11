import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';

export const ECOMMERCE_PERMISSIONS = {
  productsRead: `plugin::${PLUGIN_ID}.ecommerce.products.read`,
  productsManage: `plugin::${PLUGIN_ID}.ecommerce.products.manage`,
};

const ECOMMERCE_ACTIONS = [
  { uid: 'ecommerce.products.read', displayName: 'Read products' },
  { uid: 'ecommerce.products.manage', displayName: 'Manage products' },
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
