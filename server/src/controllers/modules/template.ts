import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const TemplateModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TemplateModuleService')
      .getAll();
  },
  async adminCreate() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TemplateModuleService')
      .adminCreate();
  },
  async adminEdit() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TemplateModuleService')
      .adminEdit();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TemplateModuleService')
      .adminBulkDelete();
  }
});

export default TemplateModuleController;
