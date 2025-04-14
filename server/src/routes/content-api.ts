export default [
  {
    method: 'GET',
    path: '/modules/pages',
    handler: 'SlugModuleController.getPages',
    config: {
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/menus',
    handler: 'MenuModuleController.getMenus',
    config: {
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/translations',
    handler: 'TranslationModuleController.getTranslations',
    config: {
      policies: ['check-api-token'],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/modules/parameters',
    handler: 'ParameterModuleController.getParameters',
    config: {
      policies: ['check-api-token'],
      auth: false,
    },
  }
];
