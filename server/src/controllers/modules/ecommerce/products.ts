import fs from 'fs';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const EcommerceProductController = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const products = () => service('EcommerceProductService');
  const images = () => service('EcommerceImageService');
  const ai = () => service('AiTranslationModuleService');
  const toId = (ctx: any) => Number(ctx.params.id);

  const handleDomainError = (ctx: any, err: unknown) =>
    handleSharedDomainError(ctx, err, { invalid: 'Invalid product', notFound: 'Product not found' });

  return {
    async getLocales(ctx: any) {
      const [defaultLocale, locales, credentials] = await Promise.all([
        products().getDefaultLocale(),
        products().getLocales(),
        ai().getCredentials(),
      ]);
      ctx.body = { defaultLocale, locales, aiAvailable: credentials !== null };
    },

    async list(ctx: any) {
      const { page, search, locale } = ctx.query || {};
      ctx.body = await products().list({
        page: Number(page) || 1,
        search: typeof search === 'string' ? search : undefined,
        locale: typeof locale === 'string' ? locale : undefined,
      });
    },

    async get(ctx: any) {
      try {
        ctx.body = await products().get(toId(ctx));
      } catch (err) {
        return handleDomainError(ctx, err);
      }
    },

    async create(ctx: any) {
      try {
        const result = await products().create(ctx.request.body);
        ctx.status = 201;
        ctx.body = { id: result.id };
      } catch (err) {
        return handleDomainError(ctx, err);
      }
    },

    async update(ctx: any) {
      try {
        await products().update(toId(ctx), ctx.request.body);
        ctx.status = 204;
      } catch (err) {
        return handleDomainError(ctx, err);
      }
    },

    async uploadImage(ctx: any) {
      const file = ctx.request.files?.file;
      const body = ctx.request.body || {};
      if (!file) return ctx.badRequest('A file is required');
      if (file.size > MAX_IMAGE_BYTES) return ctx.badRequest('The image exceeds 15 MB');

      const productId = body.productId ? Number(body.productId) : undefined;
      const variantId = body.variantId ? Number(body.variantId) : undefined;
      if (!productId && !variantId) {
        return ctx.badRequest('productId or variantId is required');
      }

      let transform;
      try {
        transform = typeof body.transform === 'string' ? JSON.parse(body.transform) : body.transform;
      } catch {
        return ctx.badRequest('transform must be valid JSON');
      }
      if (!transform || typeof transform !== 'object') {
        return ctx.badRequest('transform is required');
      }

      const buffer = await fs.promises.readFile(file.filepath);
      try {
        const record = await images().upload({
          buffer,
          originalName: file.originalFilename || 'image',
          transform,
          owner: { productId, variantId },
        });
        ctx.status = 201;
        ctx.body = record;
      } catch (error: any) {
        if (error?.message === 'INVALID_IMAGE') {
          return ctx.badRequest('Invalid image', { error: { code: 'INVALID_IMAGE' } });
        }
        throw error;
      }
    },

    async removeImage(ctx: any) {
      await images().remove(toId(ctx));
      ctx.status = 204;
    },

    async translate(ctx: any) {
      const credentials = await ai().getCredentials();
      if (!credentials) {
        ctx.status = 409;
        ctx.body = { code: 'AI_NOT_CONFIGURED' };
        return;
      }

      const { sourceLocale, targetLocales, strings } = ctx.request.body || {};
      if (!sourceLocale || !Array.isArray(targetLocales) || !strings) {
        return ctx.badRequest('sourceLocale, targetLocales and strings are required');
      }

      const locales: { code: string; name: string }[] = await ai().getLocales();
      const source = locales.find((l) => l.code === sourceLocale);
      if (!source) return ctx.badRequest(`The locale ${sourceLocale} is not configured`);

      const translations: Record<string, Record<string, string>> = {};
      let failed = 0;
      for (const code of targetLocales as string[]) {
        const target = locales.find((l) => l.code === code);
        if (!target) return ctx.badRequest(`The locale ${code} is not configured`);
        const result = await ai().translateStrings(credentials, source, target, strings);
        translations[code] = result.translations;
        failed += result.failed;
      }
      ctx.body = { translations, failed };
    },
  };
};

export default EcommerceProductController;
