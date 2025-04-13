export default [
  {
    method: 'GET',
    path: '/admin/settings',
    handler: 'SettingAppController.getAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/admin/settings',
    handler: 'SettingAppController.update',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/slugs',
    handler: 'SlugModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/slugs/actions/delete',
    handler: 'SlugModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/attributes',
    handler: 'AttributeModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/attributes/:contentId',
    handler: 'AttributeModuleController.adminGetByContentId',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/attributes/actions/delete',
    handler: 'AttributeModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/menus',
    handler: 'MenuModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/menus',
    handler: 'MenuModuleController.adminCreate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/menus/:documentId',
    handler: 'MenuModuleController.adminGetByDocumentId',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/admin/menus/:documentId',
    handler: 'MenuModuleController.adminEdit',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/menus/actions/delete',
    handler: 'MenuModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/menus/actions/duplicate',
    handler: 'MenuModuleController.adminDuplicate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/parameters',
    handler: 'ParameterModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/parameters',
    handler: 'ParameterModuleController.adminCreate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/admin/parameters/:documentId',
    handler: 'ParameterModuleController.adminEdit',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/parameters/actions/delete',
    handler: 'ParameterModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/translations',
    handler: 'TranslationModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/translations',
    handler: 'TranslationModuleController.adminCreate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/admin/translations/:uid',
    handler: 'TranslationModuleController.adminEdit',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/translations/actions/delete',
    handler: 'TranslationModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/admin/templates',
    handler: 'TemplateModuleController.adminGetAll',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/templates',
    handler: 'TemplateModuleController.adminCreate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/admin/templates/:documentId',
    handler: 'TemplateModuleController.adminEdit',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/admin/templates/actions/delete',
    handler: 'TemplateModuleController.adminBulkDelete',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
    },
  },
];
