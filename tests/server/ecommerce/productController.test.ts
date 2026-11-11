import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createController from '../../../server/src/controllers/modules/ecommerce/products';

function setup(services: Record<string, any>) {
  const strapi: any = { plugin: () => ({ service: (n: string) => services[n] }) };
  return createController({ strapi });
}

describe('EcommerceProductController', () => {
  it('translate returns 409 AI_NOT_CONFIGURED without credentials', async () => {
    const controller = setup({ AiTranslationModuleService: { getCredentials: vi.fn().mockResolvedValue(null) } });
    const ctx: any = { request: { body: {} } };
    await controller.translate(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ code: 'AI_NOT_CONFIGURED' });
  });

  it('translate calls once per target locale and sums failures', async () => {
    const translateStrings = vi.fn()
      .mockResolvedValueOnce({ translations: { a: 'x' }, failed: 1, errors: [] })
      .mockResolvedValueOnce({ translations: { a: 'y' }, failed: 2, errors: [] });
    const controller = setup({
      AiTranslationModuleService: {
        getCredentials: vi.fn().mockResolvedValue({ apiKey: 'k' }),
        getLocales: vi.fn().mockResolvedValue([{ code: 'en', name: 'English' }, { code: 'pt', name: 'PT' }, { code: 'fr', name: 'FR' }]),
        translateStrings,
      },
    });
    const ctx: any = { request: { body: { sourceLocale: 'en', targetLocales: ['pt', 'fr'], strings: { a: 'hi' } } } };
    await controller.translate(ctx);
    expect(translateStrings).toHaveBeenCalledTimes(2);
    expect(ctx.body).toEqual({ translations: { pt: { a: 'x' }, fr: { a: 'y' } }, failed: 3 });
  });

  it('uploadImage rejects files over 15 MB without calling the service', async () => {
    const upload = vi.fn();
    const controller = setup({ EcommerceImageService: { upload } });
    const ctx: any = {
      request: { files: { file: { size: 15 * 1024 * 1024 + 1, filepath: '/x' } }, body: { productId: '1', transform: '{}' } },
      badRequest: vi.fn(),
    };
    await controller.uploadImage(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploadImage rejects when no productId or variantId', async () => {
    const upload = vi.fn();
    const controller = setup({ EcommerceImageService: { upload } });
    const ctx: any = {
      request: { files: { file: { size: 10, filepath: '/x' } }, body: { transform: '{}' } },
      badRequest: vi.fn(),
    };
    await controller.uploadImage(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['create', 'update'] as const)('%s maps validation errors to badRequest with details.errors', async (method) => {
    const fieldErrors = [{ path: 'variants.0.sku', code: 'duplicate_sku' }];
    const fail = vi.fn().mockRejectedValue(new EcommerceValidationError('Invalid product', fieldErrors));
    const controller = setup({ EcommerceProductService: { create: fail, update: fail } });
    const ctx: any = { params: { id: '1' }, request: { body: {} }, badRequest: vi.fn(), notFound: vi.fn() };
    await controller[method](ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid product', { errors: fieldErrors });
  });

  it.each(['get', 'update'] as const)('%s maps not-found to ctx.notFound', async (method) => {
    const fail = vi.fn().mockRejectedValue(new EcommerceNotFoundError('Product not found'));
    const controller = setup({ EcommerceProductService: { get: fail, update: fail } });
    const ctx: any = { params: { id: '1' }, request: { body: {} }, badRequest: vi.fn(), notFound: vi.fn() };
    await controller[method](ctx);
    expect(ctx.notFound).toHaveBeenCalledWith('Product not found');
  });

  it('rethrows unknown errors', async () => {
    const boom = new Error('boom');
    const controller = setup({ EcommerceProductService: { get: vi.fn().mockRejectedValue(boom) } });
    const ctx: any = { params: { id: '1' }, badRequest: vi.fn(), notFound: vi.fn() };
    await expect(controller.get(ctx)).rejects.toBe(boom);
  });

  it('create and update pass the admin user as the stock actor', async () => {
    const create = vi.fn().mockResolvedValue({ id: 5 });
    const update = vi.fn().mockResolvedValue(undefined);
    const controller = setup({ EcommerceProductService: { create, update } });
    const body = { active: true };
    await controller.create({ request: { body }, state: { user: { id: 3 } } } as any);
    await controller.update({ request: { body }, params: { id: '5' }, state: { user: { id: 3 } } } as any);
    expect(create).toHaveBeenCalledWith(body, 'user:3');
    expect(update).toHaveBeenCalledWith(5, body, 'user:3');
    await controller.update({ request: { body }, params: { id: '5' } } as any);
    expect(update).toHaveBeenLastCalledWith(5, body, 'system');
  });
});
