import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const route = (method: string, path: string, handler: string, action: string) => ({
  method,
  path: `/admin/ecommerce/orders${path}`,
  handler: `EcommerceOrderController.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const { ordersRead: read, ordersManage: manage, paymentsManage: pay } = ECOMMERCE_PERMISSIONS;

export default [
  route('GET', '', 'list', read),
  route('POST', '', 'create', manage),
  // Static paths come before '/:id' so they are never read as an order id.
  // Same payload as /admin/ecommerce/locales, readable with the orders permission alone
  // (hasPermissions with several actions requires all of them).
  route('GET', '/locales', 'getLocales', read),
  route('POST', '/shipping-quote', 'shippingQuote', manage),
  route('POST', '/quote', 'quote', manage),
  route('GET', '/variant-search', 'variantSearch', manage),
  route('GET', '/:id', 'get', read),
  route('POST', '/:id/payments', 'addPayment', manage),
  route('POST', '/:id/payment-link', 'createPaymentLink', pay),
  route('POST', '/:id/payment-instructions', 'sendPaymentInstructions', pay),
  route('POST', '/:id/store-credit-payment', 'addStoreCreditPayment', manage),
  route('POST', '/:id/cancel', 'cancel', manage),
  route('POST', '/:id/archive', 'archive', manage),
  route('POST', '/:id/modification/preview', 'previewModification', manage),
  route('POST', '/:id/modification', 'applyModification', manage),
];
