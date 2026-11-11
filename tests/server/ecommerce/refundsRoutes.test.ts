import { describe, it, expect } from 'vitest';
import routes from '../../../server/src/routes/ecommerce/admin-refunds';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const A = '/admin/ecommerce';
const R = 'EcommerceRefundController';
const S = 'EcommerceStoreCreditController';
const N = 'EcommerceNotificationController';

const expected: [string, string, string, string][] = [
  ['GET', `${A}/orders/:id/refunds/preview`, `${R}.preview`, P.ordersRead],
  ['GET', `${A}/orders/:id/refunds`, `${R}.list`, P.ordersRead],
  ['POST', `${A}/orders/:id/refunds`, `${R}.create`, P.refundsManage],
  ['POST', `${A}/refunds/:id/resume`, `${R}.resume`, P.refundsManage],
  ['POST', `${A}/refunds/:id/mark-failed`, `${R}.markFailed`, P.refundsManage],
  ['POST', `${A}/refunds/:id/refresh`, `${R}.refresh`, P.refundsManage],
  ['GET', `${A}/orders/:id/notifications`, `${N}.listForOrder`, P.ordersRead],
  ['POST', `${A}/notifications/:id/resend`, `${N}.resend`, P.ordersManage],
  ['GET', `${A}/store-credits`, `${S}.list`, P.customersRead],
  ['GET', `${A}/store-credits/:id`, `${S}.get`, P.customersRead],
  ['POST', `${A}/store-credits`, `${S}.issue`, P.refundsManage],
  ['POST', `${A}/store-credits/:id/void`, `${S}.void`, P.refundsManage],
  ['GET', `${A}/customers/:id/store-credits`, `${S}.listForCustomer`, P.customersRead],
];

describe('ecommerce refund, store credit and notification routes', () => {
  it.each(expected)('%s %s is guarded', (method, path, handler, action) => {
    const r = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r!.handler).toBe(handler);
    expect(r!.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    // hasPermissions is AND across actions: exactly one action each
    expect(r!.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r!.config.policies).toContain('admin::isAuthenticatedAdmin');
  });
  it('declares exactly the expected routes', () => expect(routes).toHaveLength(expected.length));
  it('are included in the admin routes', () => expect(adminRoutes).toEqual(expect.arrayContaining(routes)));
});
