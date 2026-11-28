import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createController, { aiFailureReason } from '../../../server/src/controllers/modules/ecommerce/products';

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
    expect(ctx.body).toEqual({ translations: { pt: { a: 'x' }, fr: { a: 'y' } }, failed: 3, errors: [] });
  });

  it('translate sends the most characters each field accepts, product fields and variant options', async () => {
    const translateStrings = vi.fn().mockResolvedValue({ translations: {}, failed: 0, errors: [] });
    const attributes: Record<string, any> = {
      'plugin::x.product-translation': {
        name: { type: 'string' },
        shortDescription: { type: 'text' },
        description: { type: 'text', maxLength: 2000 },
      },
      'plugin::x.variant-translation': { option: { type: 'string', maxLength: 80 } },
    };
    const strapi: any = {
      plugin: () => ({
        service: () => ({
          getCredentials: vi.fn().mockResolvedValue({ apiKey: 'k' }),
          getLocales: vi.fn().mockResolvedValue([{ code: 'en', name: 'English' }, { code: 'pt', name: 'PT' }]),
          translateStrings,
        }),
      }),
      config: {
        get: () => ({
          uuid: {
            modules: {
              ecommerce: {
                productTranslation: 'plugin::x.product-translation',
                variantTranslation: 'plugin::x.variant-translation',
              },
            },
          },
        }),
      },
      contentType: (uid: string) => ({ attributes: attributes[uid] }),
    };
    const ctx: any = {
      request: {
        body: {
          sourceLocale: 'en',
          targetLocales: ['pt'],
          strings: { name: 'Shoe', shortDescription: 'Nice', description: 'Long', 'variants.0.option': 'Red' },
        },
      },
    };
    await createController({ strapi }).translate(ctx);
    expect(translateStrings.mock.calls[0][4]).toEqual({ name: 255, description: 2000, 'variants.0.option': 80 });
  });

  it('aiFailureReason keeps the provider message and masks keys', () => {
    const raw = 'pt: OpenAI request failed with status 429: {\n  "error": {\n    "message": "You have no credits remaining.",\n    "type": "insufficient_quota"\n  }\n}';
    expect(aiFailureReason(raw)).toBe('You have no credits remaining.');
    expect(aiFailureReason('pt: Incorrect API key provided: sk-proj-ab12****cd34.')).toBe('Incorrect API key provided: sk-….');
    expect(aiFailureReason('fr-FR: timeout\nstack')).toBe('timeout');
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

  describe('uploadImage discards the uploaded original', () => {
    const tempFile = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltb-upload-'));
      const filepath = path.join(dir, 'original.png');
      fs.writeFileSync(filepath, 'original bytes');
      return { dir, filepath };
    };

    it('after a successful upload', async () => {
      const { dir, filepath } = tempFile();
      const upload = vi.fn().mockResolvedValue({ id: 1, url: '/uploads/x.webp' });
      const controller = setup({ EcommerceImageService: { upload } });
      const ctx: any = {
        request: { files: { file: { size: 10, filepath, originalFilename: 'a.png' } }, body: { productId: '1', transform: '{"mode":"resize","width":1,"height":1}' } },
        badRequest: vi.fn(),
      };
      await controller.uploadImage(ctx);
      expect(ctx.status).toBe(201);
      expect(fs.existsSync(filepath)).toBe(false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('after a rejected request or a failed processing', async () => {
      const a = tempFile();
      const controller = setup({ EcommerceImageService: { upload: vi.fn().mockRejectedValue(new Error('INVALID_IMAGE')) } });
      const invalid: any = {
        request: { files: { file: { size: 10, filepath: a.filepath } }, body: { productId: '1', transform: '{"mode":"resize","width":1,"height":1}' } },
        badRequest: vi.fn(),
      };
      await controller.uploadImage(invalid);
      expect(invalid.badRequest).toHaveBeenCalled();
      expect(fs.existsSync(a.filepath)).toBe(false);

      const b = tempFile();
      const noOwner: any = { request: { files: { file: { size: 10, filepath: b.filepath } }, body: { transform: '{}' } }, badRequest: vi.fn() };
      await controller.uploadImage(noOwner);
      expect(fs.existsSync(b.filepath)).toBe(false);
      [a, b].forEach((t) => fs.rmSync(t.dir, { recursive: true, force: true }));
    });
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

describe('EcommerceProductController.list filters', () => {
  it('passes the organization filters as positive integers', async () => {
    const list = vi.fn().mockResolvedValue({ results: [] });
    const controller = setup({ EcommerceProductService: { list } });
    const ctx: any = {
      query: { page: '2', categoryId: '3', tagId: '5', collectionId: '6' },
    };
    await controller.list(ctx);
    expect(list).toHaveBeenCalledWith({
      page: 2,
      search: undefined,
      locale: undefined,
      categoryId: 3,
      tagId: 5,
      collectionId: 6,
    });
  });

  it('drops malformed filters', async () => {
    const list = vi.fn().mockResolvedValue({ results: [] });
    const controller = setup({ EcommerceProductService: { list } });
    await controller.list({ query: { categoryId: 'x', tagId: '-1', collectionId: '1.5' } } as any);
    expect(list).toHaveBeenCalledWith({ page: 1, search: undefined, locale: undefined });
  });
});
