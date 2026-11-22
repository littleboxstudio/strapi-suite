import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path,
  handler: `EcommerceOrganizationController.${handler}`,
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
  route('GET', '/admin/ecommerce/categories', 'listCategories', read),
  route('GET', '/admin/ecommerce/categories/:id', 'getCategory', read),
  route('POST', '/admin/ecommerce/categories', 'createCategory', manage),
  route('PUT', '/admin/ecommerce/categories/:id', 'updateCategory', manage),
  route('PUT', '/admin/ecommerce/categories/:id/move', 'moveCategory', manage),
  route('DELETE', '/admin/ecommerce/categories/:id', 'deleteCategory', manage),
  route('GET', '/admin/ecommerce/product-types', 'listProductTypes', read),
  route('POST', '/admin/ecommerce/product-types', 'createProductType', manage),
  route('PUT', '/admin/ecommerce/product-types/:id', 'updateProductType', manage),
  route('DELETE', '/admin/ecommerce/product-types/:id', 'deleteProductType', manage),
  route('GET', '/admin/ecommerce/tags', 'listTags', read),
  route('POST', '/admin/ecommerce/tags', 'createTag', manage),
  route('PUT', '/admin/ecommerce/tags/:id', 'updateTag', manage),
  route('DELETE', '/admin/ecommerce/tags/:id', 'deleteTag', manage),
];
