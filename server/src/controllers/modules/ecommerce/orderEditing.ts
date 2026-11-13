import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError } from './errors';

const REVIEW_FLAG_CODES = ['SHIPPING_REVIEW', 'DISCOUNTS_REVIEW'];

const positiveInt = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

const EcommerceOrderEditingController = ({ strapi }: { strapi: Core.Strapi }) => {
  const editing = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceOrderEditingService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;
  const body = (ctx: any): Record<string, any> => ctx.request?.body ?? {};

  /** Splits the client's `operationId` from the section input. */
  const splitBody = (ctx: any): { operationId: string; input: any } => {
    const { operationId, ...input } = body(ctx);
    return { operationId, input };
  };

  /**
   * Parses `:id` and the extra positive-integer params before running `fn`; any bad one is a 400.
   * Validation errors carry their first code as `details.code`.
   */
  const handle =
    (extra: string[], fn: (ctx: any, id: number, ...rest: number[]) => Promise<unknown>) =>
    async (ctx: any) => {
      const ids = ['id', ...extra].map((name) => positiveInt(ctx.params?.[name]));
      if (ids.some((v) => v === null)) return ctx.badRequest('Invalid id');
      try {
        ctx.body = await fn(ctx, ids[0] as number, ...(ids.slice(1) as number[]));
      } catch (err) {
        return handleDomainError(ctx, err, {
          invalid: 'Invalid order',
          notFound: 'Order not found',
          withCode: true,
        });
      }
    };

  return {
    shippingAddressCountries: handle([], (_ctx, id) => editing().shippingAddressCountries(id)),

    updateShippingAddress: handle([], (ctx, id) => {
      const { operationId, input } = splitBody(ctx);
      return editing().updateShippingAddress(id, input, actorOf(ctx), operationId);
    }),

    previewLines: handle([], (ctx, id) => editing().previewLines(id, body(ctx))),

    applyLines: handle([], (ctx, id) => {
      const { operationId, input } = splitBody(ctx);
      return editing().applyLines(id, input, actorOf(ctx), operationId);
    }),

    shippingOptions: handle([], (_ctx, id) => editing().shippingOptionsForOrder(id)),

    previewShippingRecalculation: handle([], (_ctx, id) =>
      editing().previewShippingRecalculation(id)
    ),

    recalculateShipping: handle([], (ctx, id) => {
      const { operationId } = splitBody(ctx);
      return editing().recalculateShipping(id, actorOf(ctx), operationId);
    }),

    editShippingLine: handle(['lineId'], (ctx, id, lineId) => {
      const { operationId, input } = splitBody(ctx);
      return editing().editShippingLine(id, lineId, input, actorOf(ctx), operationId);
    }),

    addShippingLine: handle([], (ctx, id) => {
      const { operationId, input } = splitBody(ctx);
      return editing().addShippingLine(id, input, actorOf(ctx), operationId);
    }),

    previewDiscounts: handle([], (ctx, id) => editing().previewDiscounts(id, body(ctx))),

    applyDiscounts: handle([], (ctx, id) => {
      const { operationId, input } = splitBody(ctx);
      return editing().applyDiscounts(id, input, actorOf(ctx), operationId);
    }),

    addManualDiscount: handle([], (ctx, id) => {
      const { operationId, input } = splitBody(ctx);
      return editing().addManualDiscount(id, input, actorOf(ctx), operationId);
    }),

    removeManualDiscount: handle(['discountId'], (ctx, id, discountId) => {
      const { operationId } = splitBody(ctx);
      return editing().removeManualDiscount(id, discountId, actorOf(ctx), operationId);
    }),

    dismissReviewFlag: async (ctx: any) => {
      const code = ctx.params?.code;
      if (!REVIEW_FLAG_CODES.includes(code)) {
        if (positiveInt(ctx.params?.id) === null) return ctx.badRequest('Invalid id');
        return ctx.badRequest('Invalid order', {
          code: 'invalid',
          errors: [{ path: 'code', code: 'invalid' }],
        });
      }
      return handle([], (c, id) => {
        const { operationId } = splitBody(c);
        return editing().dismissReviewFlag(id, code, actorOf(c), operationId);
      })(ctx);
    },
  };
};

export default EcommerceOrderEditingController;
