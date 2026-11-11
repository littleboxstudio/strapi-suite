import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (
  method: string,
  path: string,
  handler: string,
  action: string
) => ({
  method,
  path: `/admin/ecommerce/settings${path}`,
  handler: `EcommerceSettingsController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { settingsRead: read, settingsManage: manage } = ECOMMERCE_PERMISSIONS;

export default [
  // Same payload as /admin/ecommerce/locales, but readable with the settings permission alone
  // (hasPermissions with several actions requires all of them).
  route('GET', '/locales', 'getLocales', read),
  route('GET', '/store', 'getStore', read),
  route('PUT', '/store', 'updateStore', manage),
  route('POST', '/store/logo', 'uploadStoreLogo', manage),
  route('DELETE', '/store/logo', 'removeStoreLogo', manage),
  route('GET', '/stripe-webhook', 'getStripeWebhook', read),
  route('GET', '/storefront/api-tokens', 'listApiTokens', read),
  route('GET', '/integrations', 'listIntegrations', read),
  route('PUT', '/integrations/:id', 'updateIntegration', manage),
  route('POST', '/integrations/:id/activate', 'setIntegrationActive', manage),
  route('POST', '/integrations/:id/test', 'testIntegration', manage),
  route('GET', '/shipping-methods', 'listShippingMethods', read),
  route('POST', '/shipping-methods', 'createShippingMethod', manage),
  route('PUT', '/shipping-methods/:id', 'updateShippingMethod', manage),
  route('DELETE', '/shipping-methods/:id', 'deleteShippingMethod', manage),
  route('GET', '/email-templates', 'listEmailTemplates', read),
  // Registered before the ':locale' routes so 'preview' is never read as a locale.
  route('POST', '/email-templates/:type/preview', 'previewEmailTemplate', read),
  route('GET', '/email-templates/:type/:locale', 'getEmailTemplate', read),
  route('PUT', '/email-templates/:type/:locale', 'saveEmailTemplate', manage),
  route('POST', '/email-templates/:type/:locale/test', 'sendTestEmail', manage),
  route('POST', '/email-templates/:type/:locale/restore-default', 'restoreDefaultEmailTemplate', manage),
  route('GET', '/email-templates/:type/:locale/versions', 'listEmailTemplateVersions', read),
  route('POST', '/email-templates/:type/:locale/versions/:versionId/restore', 'restoreEmailTemplateVersion', manage),
];
