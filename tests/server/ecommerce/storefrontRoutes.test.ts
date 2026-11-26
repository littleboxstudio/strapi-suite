import { describe, expect, it } from 'vitest';
import contentApiRoutes from '../../../server/src/routes/content-api';
import storefrontRoutes from '../../../server/src/routes/ecommerce/content-api-storefront';
import controllers from '../../../server/src/controllers';
import policies from '../../../server/src/policies';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

type Expected = [string, string, string] | [string, string, string, string];
const ACCOUNT = 'EcommerceStorefrontAccountController';

const EXPECTED: Expected[] = [
  ['GET', '/ecommerce/storefront/products', 'listProducts'],
  ['GET', '/ecommerce/storefront/products/:slug', 'getProduct'],
  ['GET', '/ecommerce/storefront/categories', 'listCategories'],
  ['GET', '/ecommerce/storefront/categories/:slug', 'getCategory'],
  ['GET', '/ecommerce/storefront/collections', 'listCollections'],
  ['GET', '/ecommerce/storefront/collections/:slug', 'getCollection'],
  ['POST', '/ecommerce/storefront/checkout/session', 'openSession'],
  ['GET', '/ecommerce/storefront/cart', 'getCart'],
  ['POST', '/ecommerce/storefront/cart/quote', 'quoteCart'],
  ['GET', '/ecommerce/storefront/shipping/pickup-points', 'pickupPoints'],
  ['POST', '/ecommerce/storefront/discounts/apply', 'applyDiscount'],
  ['POST', '/ecommerce/storefront/store-credit/check', 'checkStoreCredit'],
  ['POST', '/ecommerce/storefront/checkout/email-verification', 'requestEmailVerification'],
  ['POST', '/ecommerce/storefront/checkout/email-verification/confirm', 'confirmEmailVerification'],
  ['POST', '/ecommerce/storefront/orders', 'createOrder'],
  ['POST', '/ecommerce/storefront/orders/:publicId/payment', 'paymentLink'],
  ['GET', '/ecommerce/storefront/orders/:publicId/status', 'orderStatus'],
  ['POST', '/ecommerce/storefront/account/register', 'register', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/verify-email', 'verifyEmail', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/verify-email/resend', 'resendVerification', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/login', 'login', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/password/forgot', 'forgotPassword', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/password/reset', 'resetPassword', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/logout', 'logout', ACCOUNT],
  ['GET', '/ecommerce/storefront/account/me', 'me', ACCOUNT],
  ['PUT', '/ecommerce/storefront/account/me', 'updateMe', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/password', 'changePassword', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/email', 'requestEmailChange', ACCOUNT],
  ['GET', '/ecommerce/storefront/account/orders', 'orders', ACCOUNT],
  ['GET', '/ecommerce/storefront/account/orders/:publicId', 'order', ACCOUNT],
  ['GET', '/ecommerce/storefront/account/sessions', 'sessions', ACCOUNT],
  ['DELETE', '/ecommerce/storefront/account/sessions/:id', 'revokeSession', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/sessions/revoke-others', 'revokeOtherSessions', ACCOUNT],
  ['POST', '/ecommerce/storefront/account/email/confirm', 'confirmEmailChange', ACCOUNT],
];
const TOTAL = EXPECTED.length; // 17 + 17 account routes

describe('storefront content-api routes', () => {
  it('declares the 34 routes with the handler, auth: false, the BFF policy and the module middleware', () => {
    expect(TOTAL).toBe(34);
    expect(storefrontRoutes).toHaveLength(TOTAL);
    expect(storefrontRoutes.map((r: any) => [r.method, r.path, r.handler])).toEqual(
      EXPECTED.map(([m, p, h, c]) => [m, p, `${c ?? 'EcommerceStorefrontController'}.${h}`])
    );
    for (const r of storefrontRoutes as any[]) {
      expect(r.config).toEqual({
        auth: false,
        policies: ['check-storefront-token'],
        middlewares: [MIDDLEWARE],
      });
    }
  });

  it('every handler exists on the registered controller and the policy is registered', () => {
    const strapi = { plugin: () => ({ service: () => ({}) }), log: { warn() {} } };
    const built: Record<string, any> = {
      EcommerceStorefrontController: (controllers as any).EcommerceStorefrontController({ strapi }),
      [ACCOUNT]: (controllers as any)[ACCOUNT]({ strapi }),
    };
    for (const [, , h, c] of EXPECTED) {
      expect(typeof built[c ?? 'EcommerceStorefrontController'][h]).toBe('function');
    }
    expect(policies['check-storefront-token']).toBeTypeOf('function');
  });

  it('content-api.ts includes all of them, and every path has /ecommerce/ (module middleware)', () => {
    for (const r of storefrontRoutes as any[]) {
      expect(contentApiRoutes).toContain(r);
      expect(r.path).toMatch(/\/ecommerce\//);
    }
  });

  it('the existing content-api routes are unchanged (same count, still check-api-token)', () => {
    const legacy = (contentApiRoutes as any[]).filter((r) => r.path.startsWith('/modules/'));
    expect(legacy.map((r) => r.path)).toEqual([
      '/modules/pages',
      '/modules/pages/home',
      '/modules/menus',
      '/modules/translations',
      '/modules/parameters',
      '/modules/locales',
    ]);
    for (const r of legacy) {
      expect(r.method).toBe('GET');
      expect(r.config.policies).toEqual(['check-api-token']);
      expect(r.config.auth).toBe(false);
    }
    // Legacy (6) + Stripe webhook (1) + storefront (34).
    expect(contentApiRoutes).toHaveLength(41);
    expect((contentApiRoutes as any[]).filter((r) => r.config.policies.includes('check-storefront-token'))).toHaveLength(
      TOTAL
    );
  });
});
