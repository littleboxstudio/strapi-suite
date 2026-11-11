import { describe, expect, it } from 'vitest';
import contentApiRoutes from '../../../server/src/routes/content-api';
import storefrontRoutes from '../../../server/src/routes/ecommerce/content-api-storefront';
import controllers from '../../../server/src/controllers';
import policies from '../../../server/src/policies';

const MIDDLEWARE = 'plugin::littlebox-strapi-suite.check-module-is-active';

const EXPECTED: [string, string, string][] = [
  ['GET', '/ecommerce/storefront/products', 'listProducts'],
  ['GET', '/ecommerce/storefront/products/:slug', 'getProduct'],
  ['POST', '/ecommerce/storefront/checkout/session', 'openSession'],
  ['GET', '/ecommerce/storefront/cart', 'getCart'],
  ['POST', '/ecommerce/storefront/cart/quote', 'quoteCart'],
  ['POST', '/ecommerce/storefront/discounts/apply', 'applyDiscount'],
  ['POST', '/ecommerce/storefront/store-credit/check', 'checkStoreCredit'],
  ['POST', '/ecommerce/storefront/checkout/email-verification', 'requestEmailVerification'],
  ['POST', '/ecommerce/storefront/checkout/email-verification/confirm', 'confirmEmailVerification'],
  ['POST', '/ecommerce/storefront/orders', 'createOrder'],
  ['POST', '/ecommerce/storefront/orders/:publicId/payment', 'paymentLink'],
  ['GET', '/ecommerce/storefront/orders/:publicId/status', 'orderStatus'],
];

describe('storefront content-api routes', () => {
  it('declares the 12 routes with the handler, auth: false, the BFF policy and the module middleware', () => {
    expect(storefrontRoutes).toHaveLength(12);
    expect(storefrontRoutes.map((r: any) => [r.method, r.path, r.handler])).toEqual(
      EXPECTED.map(([m, p, h]) => [m, p, `EcommerceStorefrontController.${h}`])
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
    const controller = (controllers as any).EcommerceStorefrontController({
      strapi: { plugin: () => ({ service: () => ({}) }), log: { warn() {} } },
    });
    for (const [, , h] of EXPECTED) expect(typeof controller[h]).toBe('function');
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
    // Legacy (6) + Stripe webhook (1) + storefront (12).
    expect(contentApiRoutes).toHaveLength(19);
    expect((contentApiRoutes as any[]).filter((r) => r.config.policies.includes('check-storefront-token'))).toHaveLength(12);
  });
});
