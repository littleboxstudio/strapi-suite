import { ECOMMERCE_PERMISSIONS } from '../../services/modules/ecommerce/permissions';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const build = (controller: string) => (
  method: string,
  path: string,
  handler: string,
  action: string
) => ({
  method,
  path: `/admin/ecommerce/orders${path}`,
  handler: `${controller}.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [action] } },
    ],
    middlewares: [MIDDLEWARE],
  },
});

const route = build('EcommerceOrderController');
const edit = build('EcommerceOrderEditingController');

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
  // Order editing by section: every route needs orders.manage, including the quoting GETs.
  edit('GET', '/:id/shipping-address/countries', 'shippingAddressCountries', manage),
  edit('PUT', '/:id/shipping-address', 'updateShippingAddress', manage),
  edit('PUT', '/:id/billing-address', 'updateBillingAddress', manage),
  edit('POST', '/:id/lines/preview', 'previewLines', manage),
  edit('POST', '/:id/lines', 'applyLines', manage),
  edit('GET', '/:id/shipping-options', 'shippingOptions', manage),
  edit('POST', '/:id/shipping/recalculate/preview', 'previewShippingRecalculation', manage),
  edit('POST', '/:id/shipping/recalculate', 'recalculateShipping', manage),
  edit('PUT', '/:id/shipping-lines/:lineId', 'editShippingLine', manage),
  edit('POST', '/:id/shipping-lines', 'addShippingLine', manage),
  edit('POST', '/:id/discounts/preview', 'previewDiscounts', manage),
  edit('POST', '/:id/discounts', 'applyDiscounts', manage),
  edit('POST', '/:id/manual-discounts', 'addManualDiscount', manage),
  edit('POST', '/:id/manual-discounts/:discountId/remove', 'removeManualDiscount', manage),
  edit('POST', '/:id/review-flags/:code/dismiss', 'dismissReviewFlag', manage),
];
