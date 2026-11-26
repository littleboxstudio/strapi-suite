import { PLUGIN_ID } from '../../config';

/**
 * Storefront API for the BFF (server to server only). Authenticated by the API token chosen in
 * the e-commerce settings (`check-storefront-token`); the checkout session travels in
 * `X-Checkout-Session`, the login session in `X-Customer-Token` (access per mode:
 * domain/accounts/access.ts). Paths keep `/ecommerce/` so the module middleware recognises them.
 * Contract: docs/ecommerce/storefront-api.md.
 */
const route = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  action: string,
  controller = 'EcommerceStorefrontController'
) => ({
  method,
  path: `/ecommerce/storefront${path}`,
  handler: `${controller}.${action}`,
  config: {
    auth: false as const,
    policies: ['check-storefront-token'],
    middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
  },
});

const ACCOUNT = 'EcommerceStorefrontAccountController';
const account = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, action: string) =>
  route(method, `/account${path}`, action, ACCOUNT);

const accountRoutes = [
  account('POST', '/register', 'register'),
  account('POST', '/verify-email', 'verifyEmail'),
  account('POST', '/verify-email/resend', 'resendVerification'),
  account('POST', '/login', 'login'),
  account('POST', '/password/forgot', 'forgotPassword'),
  account('POST', '/password/reset', 'resetPassword'),
  account('POST', '/logout', 'logout'),
  account('GET', '/me', 'me'),
  account('PUT', '/me', 'updateMe'),
  account('POST', '/password', 'changePassword'),
  account('POST', '/email', 'requestEmailChange'),
  account('GET', '/orders', 'orders'),
  account('GET', '/orders/:publicId', 'order'),
  account('GET', '/sessions', 'sessions'),
  account('DELETE', '/sessions/:id', 'revokeSession'),
  account('POST', '/sessions/revoke-others', 'revokeOtherSessions'),
  account('POST', '/email/confirm', 'confirmEmailChange'),
];

export default [
  route('GET', '/products', 'listProducts'),
  route('GET', '/products/:slug', 'getProduct'),
  route('GET', '/categories', 'listCategories'),
  route('GET', '/categories/:slug', 'getCategory'),
  route('GET', '/collections', 'listCollections'),
  route('GET', '/collections/:slug', 'getCollection'),
  route('POST', '/checkout/session', 'openSession'),
  route('GET', '/cart', 'getCart'),
  route('POST', '/cart/quote', 'quoteCart'),
  route('GET', '/shipping/pickup-points', 'pickupPoints'),
  route('POST', '/discounts/apply', 'applyDiscount'),
  route('POST', '/store-credit/check', 'checkStoreCredit'),
  route('POST', '/checkout/email-verification', 'requestEmailVerification'),
  route('POST', '/checkout/email-verification/confirm', 'confirmEmailVerification'),
  route('POST', '/orders', 'createOrder'),
  route('POST', '/orders/:publicId/payment', 'paymentLink'),
  route('GET', '/orders/:publicId/status', 'orderStatus'),
  ...accountRoutes,
];
