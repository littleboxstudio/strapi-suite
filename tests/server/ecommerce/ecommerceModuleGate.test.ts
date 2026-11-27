import { describe, it, expect, vi } from 'vitest';
import {
  createEcommerceModuleGate,
  isEcommercePath,
} from '../../../server/src/middlewares/ecommerceModuleGate';

function setup(path: string, value: string | null) {
  const findOne = vi.fn().mockResolvedValue(value === null ? null : { value });
  const strapi: any = {
    config: {
      get: (key: string, fallback?: unknown) =>
        key === 'api.rest.prefix' ? '/api' : key.startsWith('plugin::') ? { uuid: { app: { setting: 'setting-uid' } } } : fallback,
    },
    db: { query: vi.fn(() => ({ findOne })) },
  };
  const ctx: any = { path };
  const next = vi.fn();
  return { findOne, ctx, next, gate: createEcommerceModuleGate({ strapi }) };
}

describe('isEcommercePath', () => {
  it.each([
    '/littlebox-strapi-suite/admin/ecommerce/products',
    '/littlebox-strapi-suite/admin/ecommerce/settings/store',
    '/api/littlebox-strapi-suite/ecommerce/storefront/products',
    '/api/littlebox-strapi-suite/ecommerce/stripe/webhook',
    '/api/littlebox-strapi-suite/ecommerce',
  ])('matches %s', (path) => {
    expect(isEcommercePath(path, '/api')).toBe(true);
  });

  it.each([
    '/littlebox-strapi-suite/admin/settings',
    '/api/littlebox-strapi-suite/modules/pages/ecommerce-tips',
    '/api/littlebox-strapi-suite/ecommerce-tips',
    '/api/other-plugin/ecommerce/products',
    '/admin/ecommerce',
  ])('ignores %s', (path) => {
    expect(isEcommercePath(path, '/api')).toBe(false);
  });

  it('follows a custom REST prefix', () => {
    expect(isEcommercePath('/rest/littlebox-strapi-suite/ecommerce/storefront/cart', '/rest/')).toBe(true);
    expect(isEcommercePath('/api/littlebox-strapi-suite/ecommerce/storefront/cart', '/rest')).toBe(false);
  });
});

describe('createEcommerceModuleGate', () => {
  it('answers 404 to an e-commerce endpoint while the module is off', async () => {
    const { ctx, next, gate } = setup('/api/littlebox-strapi-suite/ecommerce/storefront/products', 'false');
    await gate(ctx, next);
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({
      data: null,
      error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 404 when the setting row is missing', async () => {
    const { ctx, next, gate } = setup('/littlebox-strapi-suite/admin/ecommerce/orders', null);
    await gate(ctx, next);
    expect(ctx.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets e-commerce requests through while the module is on', async () => {
    const { ctx, next, gate } = setup('/littlebox-strapi-suite/admin/ecommerce/orders', 'true');
    await gate(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.status).toBeUndefined();
  });

  it('never reads the setting for other paths', async () => {
    const { findOne, ctx, next, gate } = setup('/littlebox-strapi-suite/admin/settings', 'false');
    await gate(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });
});
