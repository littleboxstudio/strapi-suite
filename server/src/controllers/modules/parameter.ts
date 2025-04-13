import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const ParameterModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('ParameterModuleService')
      .adminGetAll();
  },
  async adminCreate() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('ParameterModuleService')
      .adminCreate();
  },
  async adminEdit() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('ParameterModuleService')
      .adminEdit();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('ParameterModuleService')
      .adminBulkDelete();
  },
  async getParameters() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('ParameterModuleService')
      .getParameters();
  }
});

export default ParameterModuleController;
