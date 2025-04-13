import type { Core } from '@strapi/strapi';
import { Context } from 'koa';
import { PLUGIN_ID } from '../../config';

const SettingAppController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('SettingAppService')
      .getAll();
  },

  async update(ctx: Context) { 
    return await strapi
      .plugin(PLUGIN_ID)
      .service('SettingAppService')
      .update(ctx);
  } 
});

export default SettingAppController;
