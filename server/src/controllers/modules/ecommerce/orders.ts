import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { MAX_KEY, asObject, fail, optionalString, promotionFields, requiredString } from './validation';

const EcommerceOrderController = ({ strapi }: { strapi: Core.Strapi }) => {
  const orders = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceOrderService');
  const payments = (): any => strapi.plugin(PLUGIN_ID).service('EcommercePaymentService');
  const stripePayments = (): any =>
    strapi.plugin(PLUGIN_ID).service('EcommerceStripePaymentService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;
  const body = (ctx: any) => ctx.request?.body ?? {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  const handleDomainError = (ctx: any, err: unknown, withCode = false) =>
    handleSharedDomainError(ctx, err, {
      invalid: 'Invalid order',
      notFound: 'Order not found',
      withCode,
    });

  /** `withCode`: validation errors also carry the first code as `details.code`. */
  const respond = async (
    ctx: any,
    fn: () => Promise<unknown>,
    status?: number,
    withCode = false
  ) => {
    try {
      const result = await fn();
      if (status) ctx.status = status;
      ctx.body = result;
    } catch (err) {
      return handleDomainError(ctx, err, withCode);
    }
  };

  /** Validates `:id` (NaN → 400) before running `fn`. */
  const withId = (
    ctx: any,
    fn: (id: number) => Promise<unknown>,
    status?: number,
    withCode = false
  ) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    return respond(ctx, () => fn(id), status, withCode);
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
      return respond(
        ctx,
        () => {
          // promotionCodes / expectedTotal / giftChoices are checked here, the rest by the service.
          const promo = promotionFields('Invalid order', asObject(input));
          // Store credit at creation is storefront-only: the admin adds it as a payment.
          const { storeCreditCode: _storefrontOnly, ...admin } = input;
          return orders().create({ ...admin, ...promo }, { actor: actorOf(ctx), source: 'admin' });
        },
        201,
        true
      );
    },

    /** Prices a cart with promotions and gifts. Writes nothing: no reservation, no stock. */
    quote: (ctx: any) =>
      respond(
        ctx,
        () => {
          const input = body(ctx);
          const promo = promotionFields('Invalid order', asObject(input));
          return orders().quote({ ...input, ...promo });
        },
        undefined,
        true
      ),

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

    /** Gets or creates the Stripe payment link for what is due. Never settles anything. */
    createPaymentLink: (ctx: any) =>
      withId(ctx, async (id) => {
        // The service decides CHECKOUT or SUPPLEMENTARY.
        const link = await stripePayments().getOrCreatePaymentLink(id, { actor: actorOf(ctx) });
        const { url, expiresAt, amount, reused } = link;
        return { url, expiresAt, amount, reused };
      }, undefined, true),

    sendPaymentInstructions: (ctx: any) =>
      withId(ctx, (id) => {
        const msg = 'Invalid payment instructions';
        const b = asObject(body(ctx));
        if (b.mode === 'STRIPE') {
          return payments().sendPaymentInstructions(id, { mode: 'STRIPE' }, actorOf(ctx));
        }
        if (b.mode !== 'MANUAL') return fail(msg, 'mode', 'invalid');
        const instructions = requiredString(msg, 'instructions', b.instructions, 5000);
        const methodLabel = optionalString(msg, 'methodLabel', b.methodLabel);
        return payments().sendPaymentInstructions(
          id,
          { mode: 'MANUAL', instructions, ...(methodLabel ? { methodLabel } : {}) },
          actorOf(ctx)
        );
      }, undefined, true),

    addStoreCreditPayment: (ctx: any) =>
      withId(
        ctx,
        (id) => {
          const msg = 'Invalid payment';
          const b = asObject(body(ctx));
          return payments().addStoreCreditPayment(
            id,
            {
              code: requiredString(msg, 'code', b.code, 64),
              idempotencyKey: requiredString(msg, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
            },
            actorOf(ctx)
          );
        },
        201,
        true
      ),

    cancel: (ctx: any) => withId(ctx, (id) => orders().cancel(id, actorOf(ctx))),
    archive: (ctx: any) => withId(ctx, (id) => orders().archive(id, actorOf(ctx))),

    /**
     * Body `{ lines: [{ orderLineId?, variantId, quantity }], shipping, addresses?, orderDiscount? }`.
     * An order may hold several lines of the same variant (promotions split them): every entry
     * for such a variant must carry its `orderLineId`, otherwise `INVALID_QUANTITY` on
     * `lines.<i>.orderLineId`. `orderDiscount` (cents) adjusts the order discount manually.
     */
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
