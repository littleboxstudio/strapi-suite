import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';

const EcommerceOrderController = ({ strapi }: { strapi: Core.Strapi }) => {
  const orders = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceOrderService');
  const payments = (): any => strapi.plugin(PLUGIN_ID).service('EcommercePaymentService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;
  const body = (ctx: any) => ctx.request?.body ?? {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  const handleDomainError = (ctx: any, err: unknown) =>
    handleSharedDomainError(ctx, err, { invalid: 'Invalid order', notFound: 'Order not found' });

  const respond = async (ctx: any, fn: () => Promise<unknown>, status?: number) => {
    try {
      const result = await fn();
      if (status) ctx.status = status;
      ctx.body = result;
    } catch (err) {
      return handleDomainError(ctx, err);
    }
  };

  /** Validates `:id` (NaN → 400) before running `fn`. */
  const withId = (ctx: any, fn: (id: number) => Promise<unknown>, status?: number) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    return respond(ctx, () => fn(id), status);
  };

  return {
    /** Reuses the products locales endpoint so both serve the same payload. */
    getLocales: (ctx: any) => {
      const products: any = strapi.plugin(PLUGIN_ID).controller('EcommerceProductController');
      return products.getLocales(ctx);
    },

    async list(ctx: any) {
      const { page, search, orderStatus, paymentStatus, fulfillmentStatus } = ctx.query || {};
      return respond(ctx, () =>
        orders().list({
          page: Number(page) || 1,
          search: str(search),
          orderStatus: str(orderStatus),
          paymentStatus: str(paymentStatus),
          fulfillmentStatus: str(fulfillmentStatus),
        })
      );
    },

    get: (ctx: any) => withId(ctx, (id) => orders().get(id)),

    async create(ctx: any) {
      const input = body(ctx);
      if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
        return ctx.badRequest('idempotencyKey is required');
      }
      return respond(ctx, () => orders().create(input, { actor: actorOf(ctx), source: 'admin' }), 201);
    },

    shippingQuote: (ctx: any) => {
      const { country, postalCode, lines, locale } = body(ctx);
      return respond(ctx, () => orders().quoteForLines({ country, postalCode, lines, locale }));
    },

    variantSearch: (ctx: any) => {
      const { q, locale } = ctx.query || {};
      return respond(ctx, () => orders().searchVariants(str(q) ?? '', str(locale)));
    },

    addPayment: (ctx: any) =>
      withId(
        ctx,
        (id) => {
          const { amount, reference, methodLabel, idempotencyKey } = body(ctx);
          return payments().addManualPayment(
            id,
            { amount, reference, methodLabel, idempotencyKey },
            actorOf(ctx)
          );
        },
        201
      ),

    cancel: (ctx: any) => withId(ctx, (id) => orders().cancel(id, actorOf(ctx))),
    archive: (ctx: any) => withId(ctx, (id) => orders().archive(id, actorOf(ctx))),

    previewModification: (ctx: any) =>
      withId(ctx, (id) => orders().previewModification(id, body(ctx))),

    applyModification: (ctx: any) =>
      withId(ctx, (id) => {
        const { operationId, ...input } = body(ctx);
        return orders().applyModification(id, input, actorOf(ctx), operationId);
      }),
  };
};

export default EcommerceOrderController;
