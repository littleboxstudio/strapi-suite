import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path,
  handler: `EcommerceCollectionController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { productsRead: read, productsManage: manage } = ECOMMERCE_PERMISSIONS;

// Literal sub-paths are registered before the `:id` routes.
export default [
  route('POST', '/admin/ecommerce/products/bulk', 'bulkProducts', manage),
  route('GET', '/admin/ecommerce/collections', 'list', read),
  route('POST', '/admin/ecommerce/collections', 'create', manage),
  route('POST', '/admin/ecommerce/collections/preview', 'preview', manage),
  route('POST', '/admin/ecommerce/collections/:id/recalculate', 'recalculate', manage),
  route('GET', '/admin/ecommerce/collections/:id/products', 'listProducts', read),
  route('POST', '/admin/ecommerce/collections/:id/products', 'addProducts', manage),
  route('DELETE', '/admin/ecommerce/collections/:id/products', 'removeProducts', manage),
  route('PUT', '/admin/ecommerce/collections/:id/products/order', 'reorderProducts', manage),
  route('GET', '/admin/ecommerce/collections/:id', 'get', read),
  route('PUT', '/admin/ecommerce/collections/:id', 'update', manage),
  route('DELETE', '/admin/ecommerce/collections/:id', 'delete', manage),
];
