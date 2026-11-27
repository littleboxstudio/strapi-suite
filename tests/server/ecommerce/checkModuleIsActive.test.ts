import { describe, it, expect, vi } from 'vitest';
import checkModuleIsActive from '../../../server/src/middlewares/checkModuleIsActive';

function setup(url: string, value: string | null) {
  const findOne = vi.fn().mockResolvedValue(value === null ? null : { value });
  const strapi = {
    config: { get: () => ({ uuid: { app: { setting: 'setting-uid' } } }) },
    db: { query: vi.fn(() => ({ findOne })) },
  };
  const [path] = url.split('?');
  const ctx: any = { request: { url, path }, forbidden: vi.fn() };
  const next = vi.fn();
  return { findOne, ctx, next, middleware: checkModuleIsActive({}, { strapi }) };
}

describe('checkModuleIsActive', () => {
  it('looks up the ecommerce module and answers 404 when inactive', async () => {
    const { findOne, ctx, next, middleware } = setup(
      '/littlebox-strapi-suite/admin/ecommerce/products',
      'false'
    );
    await middleware(ctx, next);
    expect(findOne).toHaveBeenCalledWith({ where: { module: 'ecommerce', property: 'active' } });
    expect(ctx.status).toBe(404);
    expect(ctx.body.error).toMatchObject({ status: 404, name: 'NotFoundError' });
    expect(ctx.forbidden).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the ecommerce module is active', async () => {
    const { ctx, next, middleware } = setup('/littlebox-strapi-suite/admin/ecommerce/products', 'true');
    await middleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.forbidden).not.toHaveBeenCalled();
  });

  it('still maps /modules/parameters to the parameter module', async () => {
    const { findOne, ctx, next, middleware } = setup('/littlebox-strapi-suite/modules/parameters', 'true');
    await middleware(ctx, next);
    expect(findOne).toHaveBeenCalledWith({ where: { module: 'parameter', property: 'active' } });
  });

  it('ignores the query string when mapping existing modules', async () => {
    const { findOne, ctx, next, middleware } = setup(
      '/littlebox-strapi-suite/modules/pages?slug=/blog/ecommerce-tips',
      'true'
    );
    await middleware(ctx, next);
    expect(findOne).toHaveBeenCalledWith({ where: { module: 'slug', property: 'active' } });
    expect(next).toHaveBeenCalled();
  });

  it('maps ecommerce routes that carry a query string', async () => {
    const { findOne, ctx, next, middleware } = setup(
      '/littlebox-strapi-suite/admin/ecommerce/products?search=x',
      'true'
    );
    await middleware(ctx, next);
    expect(findOne).toHaveBeenCalledWith({ where: { module: 'ecommerce', property: 'active' } });
  });

  it('only matches ecommerce as a whole path segment', async () => {
    const { findOne, ctx, next, middleware } = setup(
      '/littlebox-strapi-suite/modules/pages/ecommerce-tips',
      'true'
    );
    await middleware(ctx, next);
    expect(findOne).toHaveBeenCalledWith({ where: { module: 'slug', property: 'active' } });
  });

  it('answers 404 for ecommerce when its setting row is missing', async () => {
    const { ctx, next, middleware } = setup('/littlebox-strapi-suite/admin/ecommerce/products', null);
    await middleware(ctx, next);
    expect(ctx.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps answering 403 for the other modules when inactive', async () => {
    const { ctx, next, middleware } = setup('/littlebox-strapi-suite/modules/menus', 'false');
    await middleware(ctx, next);
    expect(ctx.forbidden).toHaveBeenCalledWith('Module is not active');
    expect(next).not.toHaveBeenCalled();
  });
});
