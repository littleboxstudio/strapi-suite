import { PLUGIN_ID } from '../../config';

/**
 * Storefront API for the BFF (server to server only). Authenticated by the API token chosen in
 * the e-commerce settings (`check-storefront-token`); the checkout session travels in
 * `X-Checkout-Session`. Paths keep `/ecommerce/` so the module middleware recognises them.
 * Contract: docs/ecommerce/storefront-api.md.
 */
const route = (method: 'GET' | 'POST', path: string, action: string) => ({
  method,
  path: `/ecommerce/storefront${path}`,
  handler: `EcommerceStorefrontController.${action}`,
  config: {
    auth: false as const,
    policies: ['check-storefront-token'],
    middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
  },
});

export default [
  route('GET', '/products', 'listProducts'),
  route('GET', '/products/:slug', 'getProduct'),
  route('POST', '/checkout/session', 'openSession'),
  route('GET', '/cart', 'getCart'),
  route('POST', '/cart/quote', 'quoteCart'),
  route('POST', '/discounts/apply', 'applyDiscount'),
  route('POST', '/store-credit/check', 'checkStoreCredit'),
  route('POST', '/checkout/email-verification', 'requestEmailVerification'),
  route('POST', '/checkout/email-verification/confirm', 'confirmEmailVerification'),
  route('POST', '/orders', 'createOrder'),
  route('POST', '/orders/:publicId/payment', 'paymentLink'),
  route('GET', '/orders/:publicId/status', 'orderStatus'),
];
