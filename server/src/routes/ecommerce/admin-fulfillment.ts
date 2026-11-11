import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path: `/admin/ecommerce${path}`,
  handler,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { ordersRead: oRead, ordersManage: oManage } = ECOMMERCE_PERMISSIONS;

const S = 'EcommerceShipmentController';
const R = 'EcommerceReturnController';

export default [
  route('POST', '/orders/:id/shipments', `${S}.create`, oManage),
  route('POST', '/shipments/:id/deliver', `${S}.deliver`, oManage),
  route('POST', '/shipments/:id/tracking', `${S}.updateTracking`, oManage),
  route('POST', '/shipments/:id/refresh-tracking', `${S}.refreshTracking`, oManage),
  route('POST', '/shipments/:id/retry', `${S}.retry`, oManage),
  route('POST', '/shipments/:id/cancel', `${S}.cancel`, oManage),
  route('GET', '/shipments/:id/label', `${S}.label`, oRead),
  route('POST', '/orders/:id/returns', `${R}.register`, oManage),
];
