import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createController from '../../../server/src/controllers/modules/ecommerce/organization';

function setup(organization: Record<string, any>) {
  const strapi: any = {
    plugin: () => ({ service: (n: string) => (n === 'EcommerceOrganizationService' ? organization : undefined) }),
  };
  return createController({ strapi });
}

const ctxOf = (extra: any = {}): any => ({
  request: { body: extra.body ?? {} },
  params: extra.params ?? {},
  query: extra.query ?? {},
  badRequest: vi.fn((message: string, details: any) => ({ status: 400, message, details })),
  notFound: vi.fn(),
});

describe('EcommerceOrganizationController', () => {
  it('createCategory answers 201 with the id', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 7 });
    const controller = setup({ createCategory });
    const body = { parentId: null, active: true, image: null, translations: { en: { name: 'A' } } };
    const ctx = ctxOf({ body });
    await controller.createCategory(ctx);
    expect(createCategory).toHaveBeenCalledWith(body);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 7 });
  });

  it('updateCategory, moveCategory and deleteCategory answer 204', async () => {
    const service = {
      updateCategory: vi.fn().mockResolvedValue(undefined),
      moveCategory: vi.fn().mockResolvedValue(undefined),
      deleteCategory: vi.fn().mockResolvedValue(undefined),
    };
    const controller = setup(service);
    for (const action of ['updateCategory', 'moveCategory', 'deleteCategory'] as const) {
      const ctx = ctxOf({ params: { id: '3' }, body: { parentId: null, position: 0 } });
      await controller[action](ctx);
      expect(ctx.status).toBe(204);
      expect(service[action].mock.calls[0][0]).toBe(3);
    }
    expect(service.moveCategory).toHaveBeenCalledWith(3, { parentId: null, position: 0 });
  });

  it.each(['CATEGORY_HAS_CHILDREN', 'IN_USE_BY_COLLECTIONS', 'NAME_TAKEN', 'CATEGORY_CYCLE', 'CATEGORY_TOO_DEEP'])(
    '%s maps to 409',
    async (code) => {
      const err = new EcommerceValidationError('Invalid', [{ path: 'x', code }]);
      const controller = setup({ deleteCategory: vi.fn().mockRejectedValue(err) });
      const ctx = ctxOf({ params: { id: '1' } });
      await controller.deleteCategory(ctx);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details.code).toBe(code);
    }
  );

  it('a plain validation error is a 400 and not found a 404', async () => {
    const controller = setup({
      createTag: vi.fn().mockRejectedValue(new EcommerceValidationError('Invalid', [{ path: 'translations.en.name', code: 'required' }])),
      deleteTag: vi.fn().mockRejectedValue(new EcommerceNotFoundError('Tag not found')),
    });
    const ctx = ctxOf();
    await controller.createTag(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    const ctx2 = ctxOf({ params: { id: '9' } });
    await controller.deleteTag(ctx2);
    expect(ctx2.notFound).toHaveBeenCalled();
  });

  it('createProductType 201, updateProductType 204', async () => {
    const controller = setup({
      createProductType: vi.fn().mockResolvedValue({ id: 2 }),
      updateProductType: vi.fn().mockResolvedValue(undefined),
    });
    const ctx = ctxOf({ body: { translations: { en: { name: 'Shirt' } } } });
    await controller.createProductType(ctx);
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ id: 2 });
    const ctx2 = ctxOf({ params: { id: '2' }, body: { translations: { en: { name: 'Shirts' } } } });
    await controller.updateProductType(ctx2);
    expect(ctx2.status).toBe(204);
  });

  it('lists parse the query', async () => {
    const listTags = vi.fn().mockResolvedValue({ results: [] });
    const listVendors = vi.fn().mockResolvedValue(['Acme']);
    const listCategoryTree = vi.fn().mockResolvedValue([]);
    const controller = setup({ listTags, listVendors, listCategoryTree });
    await controller.listTags(ctxOf({ query: { page: '2', search: 'sa', locale: 'pt' } }));
    expect(listTags).toHaveBeenCalledWith({ page: 2, search: 'sa', locale: 'pt' });
    const ctx = ctxOf({ query: { search: ['a', 'b'] } });
    await controller.listVendors(ctx);
    expect(listVendors).toHaveBeenCalledWith(undefined);
    expect(ctx.body).toEqual(['Acme']);
    await controller.listCategories(ctxOf({ query: { locale: 'pt' } }));
    expect(listCategoryTree).toHaveBeenCalledWith('pt');
  });
});
