import { describe, it, expect } from 'vitest';
import routes from '../../../server/src/routes/ecommerce/admin-organization';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const expected: [string, string, string, string][] = [
  ['GET', '/admin/ecommerce/categories', 'listCategories', P.productsRead],
  ['GET', '/admin/ecommerce/categories/:id', 'getCategory', P.productsRead],
  ['POST', '/admin/ecommerce/categories', 'createCategory', P.productsManage],
  ['PUT', '/admin/ecommerce/categories/:id', 'updateCategory', P.productsManage],
  ['PUT', '/admin/ecommerce/categories/:id/move', 'moveCategory', P.productsManage],
  ['DELETE', '/admin/ecommerce/categories/:id', 'deleteCategory', P.productsManage],
  ['GET', '/admin/ecommerce/product-types', 'listProductTypes', P.productsRead],
  ['POST', '/admin/ecommerce/product-types', 'createProductType', P.productsManage],
  ['PUT', '/admin/ecommerce/product-types/:id', 'updateProductType', P.productsManage],
  ['DELETE', '/admin/ecommerce/product-types/:id', 'deleteProductType', P.productsManage],
  ['GET', '/admin/ecommerce/tags', 'listTags', P.productsRead],
  ['POST', '/admin/ecommerce/tags', 'createTag', P.productsManage],
  ['PUT', '/admin/ecommerce/tags/:id', 'updateTag', P.productsManage],
  ['DELETE', '/admin/ecommerce/tags/:id', 'deleteTag', P.productsManage],
  ['GET', '/admin/ecommerce/vendors', 'listVendors', P.productsRead],
];

describe('ecommerce organization routes', () => {
  it.each(expected)('%s %s -> %s is guarded', (method, path, action, permission) => {
    const r: any = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(`EcommerceOrganizationController.${action}`);
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [permission] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });

  it('has exactly the expected routes', () => {
    expect(routes).toHaveLength(expected.length);
  });

  it('are included in the admin routes', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(routes));
  });
});
