import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path: `/admin/ecommerce/promotions${path}`,
  handler: `EcommercePromotionController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { promotionsRead: read, promotionsManage: manage } = ECOMMERCE_PERMISSIONS;

export default [
  route('GET', '', 'list', read),
  route('POST', '', 'create', manage),
  // Static paths come before '/:id' so they are never read as a promotion id.
  route('GET', '/catalog-search', 'catalogSearch', manage),
  // Locales and store time zone for the editor, readable with promotions.read alone.
  route('GET', '/context', 'context', read),
  route('GET', '/:id', 'get', read),
  route('PUT', '/:id', 'update', manage),
  route('DELETE', '/:id', 'remove', manage),
  route('GET', '/:id/redemptions', 'listRedemptions', read),
];
