import { describe, it, expect, vi } from 'vitest';
import routes from '../../../server/src/routes/ecommerce/admin-collections';
import adminRoutes from '../../../server/src/routes/admin-api';
import createController from '../../../server/src/controllers/modules/ecommerce/collections';
import controllers from '../../../server/src/controllers';
import services from '../../../server/src/services';
import { CONFLICT_CODES } from '../../../server/src/controllers/modules/ecommerce/errors';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { ECOMMERCE_PERMISSIONS as P } from '../../../server/src/services/modules/ecommerce/permissions';

const expected: [string, string, string, string][] = [
  ['POST', '/admin/ecommerce/products/bulk', 'bulkProducts', P.productsManage],
  ['GET', '/admin/ecommerce/collections', 'list', P.productsRead],
  ['POST', '/admin/ecommerce/collections', 'create', P.productsManage],
  ['POST', '/admin/ecommerce/collections/preview', 'preview', P.productsManage],
  ['POST', '/admin/ecommerce/collections/:id/recalculate', 'recalculate', P.productsManage],
  ['GET', '/admin/ecommerce/collections/:id/products', 'listProducts', P.productsRead],
  ['POST', '/admin/ecommerce/collections/:id/products', 'addProducts', P.productsManage],
  ['DELETE', '/admin/ecommerce/collections/:id/products', 'removeProducts', P.productsManage],
  ['PUT', '/admin/ecommerce/collections/:id/products/order', 'reorderProducts', P.productsManage],
  ['GET', '/admin/ecommerce/collections/:id', 'get', P.productsRead],
  ['PUT', '/admin/ecommerce/collections/:id', 'update', P.productsManage],
  ['DELETE', '/admin/ecommerce/collections/:id', 'delete', P.productsManage],
];

describe('ecommerce collection routes', () => {
  it.each(expected)('%s %s -> %s is guarded', (method, path, action, permission) => {
    const r: any = routes.find((x) => x.method === method && x.path === path);
    expect(r).toBeDefined();
    expect(r.handler).toBe(`EcommerceCollectionController.${action}`);
    expect(r.config.middlewares).toEqual(['plugin::littlebox-strapi-suite.check-module-is-active']);
    expect(r.config.policies).toContainEqual({ name: 'admin::hasPermissions', config: { actions: [permission] } });
    expect(r.config.policies).toContain('admin::isAuthenticatedAdmin');
  });

  it('has exactly the expected routes, literal sub-paths before :id', () => {
    expect(routes).toHaveLength(expected.length);
    const index = (path: string) => routes.findIndex((r) => r.path === path);
    expect(index('/admin/ecommerce/collections/:id/products')).toBeLessThan(index('/admin/ecommerce/collections/:id'));
    expect(index('/admin/ecommerce/collections/preview')).toBeLessThan(index('/admin/ecommerce/collections/:id'));
  });

  it('are included in the admin routes, and the controller and service are registered', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(routes));
    expect((controllers as any).EcommerceCollectionController).toBeDefined();
    expect((services as any).EcommerceCollectionService).toBeDefined();
    expect(CONFLICT_CODES).toContain('COLLECTION_IS_AUTOMATED');
  });
});

const ctxOf = (extra: any = {}): any => ({
  request: { body: extra.body ?? {} },
  params: extra.params ?? {},
  query: extra.query ?? {},
  badRequest: vi.fn((message: string, details: any) => ({ status: 400, message, details })),
  notFound: vi.fn(),
});

const setup = (service: Record<string, any>) =>
  createController({
    strapi: { plugin: () => ({ service: (n: string) => (n === 'EcommerceCollectionService' ? service : undefined) }) } as any,
  });

describe('EcommerceCollectionController', () => {
  it('create answers 201, update/delete 204, list passes page/search/locale', async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ id: 4 }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ results: [] }),
    };
    const c = setup(service);
    const created = ctxOf({ body: { type: 'MANUAL' } });
    await c.create(created);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 4 });
    const updated = ctxOf({ params: { id: '4' }, body: { type: 'MANUAL' } });
    await c.update(updated);
    expect(service.update).toHaveBeenCalledWith(4, { type: 'MANUAL' });
    expect(updated.status).toBe(204);
    const deleted = ctxOf({ params: { id: '4' } });
    await c.delete(deleted);
    expect(service.delete).toHaveBeenCalledWith(4);
    expect(deleted.status).toBe(204);
    await c.list(ctxOf({ query: { page: '2', search: 'su', locale: 'pt' } }));
    expect(service.list).toHaveBeenCalledWith({ page: 2, search: 'su', locale: 'pt' });
  });

  it('product membership actions read productIds from the body', async () => {
    const service = {
      addProducts: vi.fn().mockResolvedValue(undefined),
      removeProducts: vi.fn().mockResolvedValue(undefined),
      reorderProducts: vi.fn().mockResolvedValue(undefined),
      listProducts: vi.fn().mockResolvedValue({ results: [] }),
      bulkProducts: vi.fn().mockResolvedValue({ updated: 2 }),
    };
    const c = setup(service);
    for (const action of ['addProducts', 'removeProducts', 'reorderProducts'] as const) {
      const ctx = ctxOf({ params: { id: '3' }, body: { productIds: [1, 2] } });
      await c[action](ctx);
      expect(service[action]).toHaveBeenCalledWith(3, [1, 2]);
      expect(ctx.status).toBe(204);
    }
    await c.listProducts(ctxOf({ params: { id: '3' }, query: { page: '2', locale: 'en' } }));
    expect(service.listProducts).toHaveBeenCalledWith(3, { page: 2, locale: 'en' });
    const bulk = ctxOf({ body: { productIds: [1, 2], action: 'addTag', value: 5 } });
    await c.bulkProducts(bulk);
    expect(service.bulkProducts).toHaveBeenCalledWith({ productIds: [1, 2], action: 'addTag', value: 5 });
    expect(bulk.body).toEqual({ updated: 2 });
  });

  it('preview passes match/conditions/page/locale from the body; recalculate answers the counts', async () => {
    const service = {
      preview: vi.fn().mockResolvedValue({ results: [], pagination: { page: 2 } }),
      recalculate: vi.fn().mockResolvedValue({ added: 1, removed: 2 }),
    };
    const c = setup(service);
    const conditions = [{ field: 'PRICE', operator: 'lt', value: 1000 }];
    const preview = ctxOf({ body: { match: 'ANY', conditions, page: 2, locale: 'pt' } });
    await c.preview(preview);
    expect(service.preview).toHaveBeenCalledWith({ match: 'ANY', conditions, page: 2, locale: 'pt' });
    expect(preview.body).toEqual({ results: [], pagination: { page: 2 } });
    const recalc = ctxOf({ params: { id: '7' } });
    await c.recalculate(recalc);
    expect(service.recalculate).toHaveBeenCalledWith(7);
    expect(recalc.body).toEqual({ added: 1, removed: 2 });
  });

  it('preview validation errors answer 400', async () => {
    const c = setup({
      preview: vi
        .fn()
        .mockRejectedValue(new EcommerceValidationError('Invalid collection', [{ path: 'conditions', code: 'required' }])),
    });
    const ctx = ctxOf({ body: { match: 'ALL', conditions: [] } });
    await c.preview(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid collection', { errors: [{ path: 'conditions', code: 'required' }] });
  });

  it('COLLECTION_IS_AUTOMATED answers 409; other validation errors 400', async () => {
    const c = setup({
      addProducts: vi.fn().mockRejectedValue(
        new EcommerceValidationError('Invalid collection', [{ path: 'collection', code: 'COLLECTION_IS_AUTOMATED' }])
      ),
      create: vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'type', code: 'invalid' }])),
    });
    const conflict = ctxOf({ params: { id: '1' }, body: { productIds: [1] } });
    await c.addProducts(conflict);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.code).toBe('COLLECTION_IS_AUTOMATED');
    const bad = ctxOf({ body: {} });
    await c.create(bad);
    expect(bad.badRequest).toHaveBeenCalledWith('Invalid collection', { errors: [{ path: 'type', code: 'invalid' }] });
  });
});
