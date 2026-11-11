import { describe, it, expect } from 'vitest';
import fulfillment from '../../../server/src/routes/ecommerce/admin-fulfillment';
import invoicing from '../../../server/src/routes/ecommerce/admin-invoices';
import adminRoutes from '../../../server/src/routes/admin-api';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const A = '/admin/ecommerce';
const S = 'EcommerceShipmentController';
const R = 'EcommerceReturnController';
const I = 'EcommerceInvoiceController';

const expectedFulfillment: [string, string, string, string][] = [
  ['POST', `${A}/orders/:id/shipments`, `${S}.create`, P.ordersManage],
  ['POST', `${A}/shipments/:id/deliver`, `${S}.deliver`, P.ordersManage],
  ['POST', `${A}/shipments/:id/tracking`, `${S}.updateTracking`, P.ordersManage],
  ['POST', `${A}/shipments/:id/refresh-tracking`, `${S}.refreshTracking`, P.ordersManage],
  ['POST', `${A}/shipments/:id/retry`, `${S}.retry`, P.ordersManage],
  ['POST', `${A}/shipments/:id/cancel`, `${S}.cancel`, P.ordersManage],
  ['GET', `${A}/shipments/:id/label`, `${S}.label`, P.ordersRead],
  ['POST', `${A}/orders/:id/returns`, `${R}.register`, P.ordersManage],
];
const expectedInvoices: [string, string, string, string][] = [
  ['GET', `${A}/orders/:id/invoice-preview`, `${I}.preview`, P.ordersRead],
  ['POST', `${A}/orders/:id/invoices`, `${I}.issue`, P.invoicingManage],
  ['POST', `${A}/invoices/:id/reconcile`, `${I}.reconcile`, P.invoicingManage],
  ['GET', `${A}/invoices/:id/pdf`, `${I}.pdf`, P.ordersRead],
  ['GET', `${A}/invoices/:id/credit-note/preview`, `${I}.creditNotePreview`, P.ordersRead],
  ['POST', `${A}/invoices/:id/credit-note`, `${I}.issueCreditNote`, P.invoicingManage],
];

describe.each([
  ['fulfillment', fulfillment, expectedFulfillment],
  ['invoice', invoicing, expectedInvoices],
] as const)('ecommerce %s routes', (_n, routes, expected) => {
  it.each(expected)('%s %s is guarded', (method, path, handler, action) => {
    const r = (routes as any[]).find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(handler);
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    // hasPermissions is AND across actions: exactly one action each
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [action] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });
  it('declares exactly the expected routes', () => expect(routes).toHaveLength(expected.length));
  it('are included in the admin routes', () => expect(adminRoutes).toEqual(expect.arrayContaining(routes as any[])));
});

describe('route ordering', () => {
  it('no parametrised path shadows a later static one', () => {
    const all = (adminRoutes as any[]).filter((r) => r.path.startsWith('/admin/ecommerce'));
    all.forEach((r, i) => {
      const re = new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`);
      all.slice(i + 1).forEach((later) => {
        if (later.method === r.method && !later.path.includes(':')) {
          expect(re.test(later.path), `${r.path} shadows ${later.path}`).toBe(false);
        }
      });
    });
  });
});
