import { describe, it, expect } from 'vitest';
import routes from '../../../server/src/routes/ecommerce/admin-products';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const expected: [string, string, string][] = [
  ['GET', '/admin/ecommerce/locales', P.productsRead],
  ['GET', '/admin/ecommerce/products', P.productsRead],
  ['GET', '/admin/ecommerce/products/:id', P.productsRead],
  ['POST', '/admin/ecommerce/products', P.productsManage],
  ['PUT', '/admin/ecommerce/products/:id', P.productsManage],
  ['DELETE', '/admin/ecommerce/products/:id', P.productsManage],
  ['PUT', '/admin/ecommerce/products/:id/active', P.productsManage],
  ['PUT', '/admin/ecommerce/variants/:id/active', P.productsManage],
  ['POST', '/admin/ecommerce/images', P.productsManage],
  ['DELETE', '/admin/ecommerce/images/:id', P.productsManage],
  ['POST', '/admin/ecommerce/products/translate', P.productsManage],
];

describe('ecommerce product routes', () => {
  it.each(expected)('%s %s is guarded', (method, path, action) => {
    const r: any = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });

  it('are included in the admin routes', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(routes));
  });
});
