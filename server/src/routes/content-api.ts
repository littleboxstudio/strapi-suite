import { PLUGIN_ID } from '../config';

export default [
  {
    method: 'GET',
    path: '/modules/pages',
    handler: 'SlugModuleController.getPages',
    config: {
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/pages/home',
    handler: 'SlugModuleController.getHomePage',
    config: {
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/menus',
    handler: 'MenuModuleController.getMenus',
    config: {
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/translations',
    handler: 'TranslationModuleController.getTranslations',
    config: {
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/parameters',
    handler: 'ParameterModuleController.getParameters',
    config: {
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
      policies: ['check-api-token'],
      auth: false,
    },
  }
];
