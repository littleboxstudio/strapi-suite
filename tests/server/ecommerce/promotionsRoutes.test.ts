import { describe, it, expect } from 'vitest';
import promotionRoutes from '../../../server/src/routes/ecommerce/admin-promotions';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const B = '/admin/ecommerce/promotions';
const expected: [string, string, string, string][] = [
  ['GET', B, 'list', P.promotionsRead],
  ['POST', B, 'create', P.promotionsManage],
  ['GET', `${B}/catalog-search`, 'catalogSearch', P.promotionsManage],
  ['GET', `${B}/:id`, 'get', P.promotionsRead],
  ['PUT', `${B}/:id`, 'update', P.promotionsManage],
  ['DELETE', `${B}/:id`, 'remove', P.promotionsManage],
  ['GET', `${B}/:id/redemptions`, 'listRedemptions', P.promotionsRead],
];

describe('ecommerce promotion routes', () => {
  it.each(expected)('%s %s is guarded', (method, path, handler, action) => {
    const r = promotionRoutes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r!.handler).toBe(`EcommercePromotionController.${handler}`);
    expect(r!.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r!.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r!.config.policies).toContain('admin::isAuthenticatedAdmin');
  });
  it('declares exactly the expected routes', () => expect(promotionRoutes).toHaveLength(expected.length));
  it('has one permission per route', () => {
    for (const r of promotionRoutes) {
      const p: any = r.config.policies.find((x: any) => x.name === 'admin::hasPermissions');
      expect(p.config.actions).toHaveLength(1);
    }
  });
  it('registers catalog-search before /:id', () => {
    const idx = (m: string, p: string) => promotionRoutes.findIndex((r) => r.method === m && r.path === p);
    expect(idx('GET', `${B}/catalog-search`)).toBeLessThan(idx('GET', `${B}/:id`));
  });
  it('are included in the admin routes', () => expect(adminRoutes).toEqual(expect.arrayContaining(promotionRoutes)));
});
