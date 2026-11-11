import { describe, it, expect, vi } from 'vitest';
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
});
