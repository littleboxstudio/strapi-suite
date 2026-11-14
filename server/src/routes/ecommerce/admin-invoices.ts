import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path: `/admin/ecommerce${path}`,
  handler,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { ordersRead: oRead, invoicingManage: inv } = ECOMMERCE_PERMISSIONS;

const I = 'EcommerceInvoiceController';

export default [
  route('GET', '/orders/:id/invoice-selection', `${I}.selection`, oRead),
  route('POST', '/orders/:id/invoices', `${I}.issue`, inv),
  route('POST', '/invoices/:id/reconcile', `${I}.reconcile`, inv),
  route('GET', '/invoices/:id/pdf', `${I}.pdf`, oRead),
  route('GET', '/invoices/:id/credit-note/preview', `${I}.creditNotePreview`, oRead),
  route('POST', '/invoices/:id/credit-note', `${I}.issueCreditNote`, inv),
];
