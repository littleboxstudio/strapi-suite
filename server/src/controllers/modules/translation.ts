import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const TranslationModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TranslationModuleService')
      .adminGetAll();
  },
  async adminCreate() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TranslationModuleService')
      .adminCreate();
  },
  async adminEdit() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TranslationModuleService')
      .adminEdit();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TranslationModuleService')
      .adminBulkDelete();
  },
  async getTranslations() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('TranslationModuleService')
      .getTranslations();
  }
});

export default TranslationModuleController;
