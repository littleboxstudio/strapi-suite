import { describe, it, expect } from 'vitest';
import routes from '../../../server/src/routes/ecommerce/admin-settings';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const B = '/admin/ecommerce/settings';
const T = `${B}/email-templates/:type/:locale`;
const expected: [string, string, string, string][] = [
  ['GET', `${B}/locales`, 'getLocales', P.settingsRead],
  ['GET', `${B}/store`, 'getStore', P.settingsRead],
  ['PUT', `${B}/store`, 'updateStore', P.settingsManage],
  ['POST', `${B}/store/logo`, 'uploadStoreLogo', P.settingsManage],
  ['DELETE', `${B}/store/logo`, 'removeStoreLogo', P.settingsManage],
  ['GET', `${B}/stripe-webhook`, 'getStripeWebhook', P.settingsRead],
  ['GET', `${B}/storefront/token`, 'getStorefrontToken', P.settingsRead],
  ['POST', `${B}/storefront/token/generate`, 'generateStorefrontToken', P.settingsManage],
  ['POST', `${B}/storefront/token/regenerate`, 'regenerateStorefrontToken', P.settingsManage],
  ['GET', `${B}/integrations`, 'listIntegrations', P.settingsRead],
  ['PUT', `${B}/integrations/:id`, 'updateIntegration', P.settingsManage],
  ['POST', `${B}/integrations/:id/activate`, 'setIntegrationActive', P.settingsManage],
  ['POST', `${B}/integrations/:id/test`, 'testIntegration', P.settingsManage],
  ['GET', `${B}/integrations/:id/lookups`, 'integrationLookups', P.settingsManage],
  ['GET', `${B}/shipping-methods`, 'listShippingMethods', P.settingsRead],
  ['POST', `${B}/shipping-methods`, 'createShippingMethod', P.settingsManage],
  ['PUT', `${B}/shipping-methods/:id`, 'updateShippingMethod', P.settingsManage],
  ['DELETE', `${B}/shipping-methods/:id`, 'deleteShippingMethod', P.settingsManage],
  ['GET', `${B}/shipping-zones`, 'listShippingZones', P.settingsRead],
  ['POST', `${B}/shipping-zones`, 'createShippingZone', P.settingsManage],
  ['PUT', `${B}/shipping-zones/:id`, 'updateShippingZone', P.settingsManage],
  ['DELETE', `${B}/shipping-zones/:id`, 'deleteShippingZone', P.settingsManage],
  ['GET', `${B}/email-templates`, 'listEmailTemplates', P.settingsRead],
  ['GET', T, 'getEmailTemplate', P.settingsRead],
  ['PUT', T, 'saveEmailTemplate', P.settingsManage],
  ['POST', `${B}/email-templates/:type/preview`, 'previewEmailTemplate', P.settingsRead],
  ['POST', `${T}/test`, 'sendTestEmail', P.settingsManage],
  ['POST', `${T}/restore-default`, 'restoreDefaultEmailTemplate', P.settingsManage],
  ['GET', `${T}/versions`, 'listEmailTemplateVersions', P.settingsRead],
  ['POST', `${T}/versions/:versionId/restore`, 'restoreEmailTemplateVersion', P.settingsManage],
];

describe('ecommerce settings routes', () => {
  it.each(expected)('%s %s is guarded', (method, path, handler, action) => {
    const r: any = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(`EcommerceSettingsController.${handler}`);
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });

  it('declares exactly the expected routes', () => {
    expect(routes).toHaveLength(expected.length);
  });

  it('registers preview before the :locale routes', () => {
    const idx = (p: string) => routes.findIndex((r) => r.path === p);
    expect(idx(`${B}/email-templates/:type/preview`)).toBeLessThan(idx(`${T}/test`));
    expect(idx(`${B}/email-templates/:type/preview`)).toBeLessThan(idx(T));
  });

  it('no longer lists the Strapi API tokens for choosing', () => {
    expect(routes.some((r) => r.path.includes('api-tokens'))).toBe(false);
  });

  it('are included in the admin routes', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(routes));
  });
});
