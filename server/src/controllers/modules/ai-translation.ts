import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';

const AiTranslationModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminTranslateStrings() {
    return await strapi
      .plugin(PLUGIN_ID)
      .service('AiTranslationModuleService')
      .adminTranslateStrings();
  }
});

export default AiTranslationModuleController;
