import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (
  method: string,
  path: string,
  handler: string,
  action: string
) => ({
  method,
  path,
  handler: `EcommerceProductController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { productsRead: read, productsManage: manage } = ECOMMERCE_PERMISSIONS;

export default [
  route('GET', '/admin/ecommerce/locales', 'getLocales', read),
  route('GET', '/admin/ecommerce/products', 'list', read),
  // Registered before ':id' routes so 'translate' is never read as an id.
  route('POST', '/admin/ecommerce/products/translate', 'translate', manage),
  route('GET', '/admin/ecommerce/products/:id', 'get', read),
  route('POST', '/admin/ecommerce/products', 'create', manage),
  route('PUT', '/admin/ecommerce/products/:id', 'update', manage),
  route('DELETE', '/admin/ecommerce/products/:id', 'delete', manage),
  route('PUT', '/admin/ecommerce/products/:id/active', 'setActive', manage),
  route('PUT', '/admin/ecommerce/variants/:id/active', 'setVariantActive', manage),
  route('POST', '/admin/ecommerce/images', 'uploadImage', manage),
  route('DELETE', '/admin/ecommerce/images/:id', 'removeImage', manage),
];
