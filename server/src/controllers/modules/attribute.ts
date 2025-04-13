import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const AttributeModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('AttributeModuleService')
      .adminGetAll();
  },
  async adminGetByContentId() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('AttributeModuleService')
      .adminGetByContentId();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('AttributeModuleService')
      .adminBulkDelete();
  }
});

export default AttributeModuleController;
