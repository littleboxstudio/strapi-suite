import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path: `/admin/ecommerce/customers${path}`,
  handler: `EcommerceCustomerController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { customersRead, customersManage, ordersManage } = ECOMMERCE_PERMISSIONS;

export default [
  route('GET', '', 'list', customersRead),
  route('GET', '/:id', 'get', customersRead),
  route('PUT', '/:id', 'update', customersManage),
  route('GET', '/:id/orders', 'listOrders', customersRead),
  route('GET', '/:id/last-addresses', 'lastAddresses', ordersManage),
];
