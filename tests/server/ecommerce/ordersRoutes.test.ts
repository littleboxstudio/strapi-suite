import { describe, it, expect } from 'vitest';
import customerRoutes from '../../../server/src/routes/ecommerce/admin-customers';
import orderRoutes from '../../../server/src/routes/ecommerce/admin-orders';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const C = '/admin/ecommerce/customers';
const O = '/admin/ecommerce/orders';
const customers: [string, string, string, string][] = [
  ['GET', C, 'list', P.customersRead],
  ['GET', `${C}/:id`, 'get', P.customersRead],
  ['PUT', `${C}/:id`, 'update', P.customersManage],
  ['GET', `${C}/:id/orders`, 'listOrders', P.customersRead],
  ['GET', `${C}/:id/last-addresses`, 'lastAddresses', P.ordersManage],
];
const orders: [string, string, string, string][] = [
  ['GET', O, 'list', P.ordersRead],
  ['POST', O, 'create', P.ordersManage],
  ['GET', `${O}/locales`, 'getLocales', P.ordersRead],
  ['POST', `${O}/shipping-quote`, 'shippingQuote', P.ordersManage],
  ['GET', `${O}/variant-search`, 'variantSearch', P.ordersManage],
  ['GET', `${O}/:id`, 'get', P.ordersRead],
  ['POST', `${O}/:id/payments`, 'addPayment', P.ordersManage],
  ['POST', `${O}/:id/payment-link`, 'createPaymentLink', P.paymentsManage],
  ['POST', `${O}/:id/payment-instructions`, 'sendPaymentInstructions', P.paymentsManage],
  ['POST', `${O}/:id/store-credit-payment`, 'addStoreCreditPayment', P.ordersManage],
  ['POST', `${O}/:id/cancel`, 'cancel', P.ordersManage],
  ['POST', `${O}/:id/archive`, 'archive', P.ordersManage],
  ['POST', `${O}/:id/modification/preview`, 'previewModification', P.ordersManage],
  ['POST', `${O}/:id/modification`, 'applyModification', P.ordersManage],
];

const check = (routes: any[], ctrl: string, expected: [string, string, string, string][]) => {
  it.each(expected)('%s %s is guarded', (method, path, handler, action) => {
    const r = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(`${ctrl}.${handler}`);
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });
  it('declares exactly the expected routes', () => expect(routes).toHaveLength(expected.length));
  it('are included in the admin routes', () =>
    expect(adminRoutes).toEqual(expect.arrayContaining(routes)));
};

describe('ecommerce customer routes', () => check(customerRoutes, 'EcommerceCustomerController', customers));
describe('ecommerce order routes', () => {
  check(orderRoutes, 'EcommerceOrderController', orders);
  it('registers static paths before /:id', () => {
    const idx = (m: string, p: string) => orderRoutes.findIndex((r) => r.method === m && r.path === p);
    const id = idx('GET', `${O}/:id`);
    expect(idx('GET', `${O}/locales`)).toBeLessThan(id);
    expect(idx('GET', `${O}/variant-search`)).toBeLessThan(id);
    expect(idx('POST', `${O}/shipping-quote`)).toBeLessThan(idx('POST', `${O}/:id/cancel`));
  });
});
