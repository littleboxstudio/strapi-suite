import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const MenuModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminGetAll();
  },
  async adminCreate() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminCreate();
  },
  async adminGetByDocumentId() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminGetByDocumentId();
  },
  async adminEdit() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminEdit();
  },
  async adminBulkDelete() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminBulkDelete();
  },
  async adminDuplicate() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .adminDuplicate();
  },
  async getMenus() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('MenuModuleService')
      .getMenus();
  }
});

export default MenuModuleController;
