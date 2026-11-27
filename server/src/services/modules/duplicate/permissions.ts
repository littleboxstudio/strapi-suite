import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';

/** The admin action that gates every duplication route (and the dashboard card). */
export const DUPLICATE_PERMISSION = `plugin::${PLUGIN_ID}.duplicate.run`;

const DUPLICATE_ACTIONS = [{ uid: 'duplicate.run', displayName: 'Duplicate content' }];

export const registerDuplicatePermissions = async (strapi: Core.Strapi): Promise<void> => {
  await (strapi as any).admin.services.permission.actionProvider.registerMany(
    DUPLICATE_ACTIONS.map((action) => ({
      section: 'plugins',
      pluginName: PLUGIN_ID,
      subCategory: 'duplicate',
      ...action,
    }))
  );
};
