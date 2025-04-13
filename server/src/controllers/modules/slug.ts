import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';
import services from 'src/services';

const SlugModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('SlugModuleService')
      .adminGetAll();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('SlugModuleService')
      .adminBulkDelete();
  },
  async getPages() {
    const ctx = strapi.requestContext.get();
    const service = strapi.plugin(PLUGIN_ID).service("SlugModuleService");
    return ctx.query.slug
      ? await service.getPage()
      : await service.getPages(); 
  },
});

export default SlugModuleController;
