import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError } from './errors';
import { asObject, optionalString, toInt } from './validation';

const MSG = 'Invalid promotion';

const EcommercePromotionController = ({ strapi }: { strapi: Core.Strapi }) => {
  const promotions = (): any => strapi.plugin(PLUGIN_ID).service('EcommercePromotionService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const respond = async (ctx: any, fn: () => Promise<unknown>, status?: number) => {
    try {
      const result = await fn();
      if (status) ctx.status = status;
      ctx.body = result;
    } catch (err) {
      return handleDomainError(ctx, err, {
        invalid: MSG,
        notFound: 'Promotion not found',
        withCode: true,
      });
    }
  };

  /** Strict `:id` (digits only, >= 1) before running `fn`. */
  const withId = (ctx: any, fn: (id: number) => Promise<unknown>, status?: number) => {
    const id = toInt(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    return respond(ctx, () => fn(id), status);
  };

  const pageOf = (v: unknown): number => {
    const n = toInt(v);
    return Number.isInteger(n) && n >= 1 ? n : 1;
  };

  return {
    list: (ctx: any) =>
      respond(ctx, async () => {
        const { page, search } = ctx.query || {};
        return promotions().list({
          page: pageOf(page),
          search: optionalString(MSG, 'search', search, 100),
        });
      }),

    // The definition itself (fields, conditions, benefits) is validated by the service.
    create: (ctx: any) =>
      respond(ctx, () => promotions().create(asObject(ctx.request?.body), actorOf(ctx)), 201),

    catalogSearch: (ctx: any) =>
      respond(ctx, async () => {
        const { q, locale } = ctx.query || {};
        return promotions().catalogSearch(
          optionalString(MSG, 'q', q, 100) ?? '',
          optionalString(MSG, 'locale', locale, 20)
        );
      }),

    get: (ctx: any) => withId(ctx, (id) => promotions().get(id)),

    /** Body: the promotion definition plus the `version` it was loaded with. */
    update: (ctx: any) =>
      withId(ctx, (id) => promotions().update(id, asObject(ctx.request?.body), actorOf(ctx))),

    remove: (ctx: any) =>
      withId(ctx, async (id) => {
        await promotions().remove(id, actorOf(ctx));
        return { ok: true };
      }),

    listRedemptions: (ctx: any) =>
      withId(ctx, (id) => promotions().listRedemptions(id, { page: pageOf(ctx.query?.page) })),
  };
};

export default EcommercePromotionController;
