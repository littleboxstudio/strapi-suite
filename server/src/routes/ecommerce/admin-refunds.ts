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

const { ordersRead: oRead, ordersManage: oManage, refundsManage: ref, customersRead: cRead } =
  ECOMMERCE_PERMISSIONS;

const R = 'EcommerceRefundController';
const S = 'EcommerceStoreCreditController';
const N = 'EcommerceNotificationController';

export default [
  route('GET', '/orders/:id/refunds/preview', `${R}.preview`, oRead),
  route('GET', '/orders/:id/refunds', `${R}.list`, oRead),
  route('POST', '/orders/:id/refunds', `${R}.create`, ref),
  route('POST', '/refunds/:id/resume', `${R}.resume`, ref),
  route('POST', '/refunds/:id/mark-failed', `${R}.markFailed`, ref),
  route('GET', '/orders/:id/notifications', `${N}.listForOrder`, oRead),
  route('POST', '/notifications/:id/resend', `${N}.resend`, oManage),
  route('GET', '/store-credits', `${S}.list`, cRead),
  route('GET', '/store-credits/:id', `${S}.get`, cRead),
  route('POST', '/store-credits', `${S}.issue`, ref),
  route('POST', '/store-credits/:id/void', `${S}.void`, ref),
  route('GET', '/customers/:id/store-credits', `${S}.listForCustomer`, cRead),
];
