import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { EcommercePaymentError } from '../../../services/modules/ecommerce/errors';

const UNPARSED = Symbol.for('unparsedBody');

/**
 * The exact request bytes: captured by the `ecommerceRawBody` server middleware, or — if a host
 * setup bypassed it — koa-body's `includeUnparsed` copy (`strapi::body` config).
 */
const rawBodyOf = (ctx: any): Buffer | null => {
  const captured = ctx.state?.ecommerceRawBody;
  if (Buffer.isBuffer(captured)) return captured;
  const unparsed = ctx.request?.body?.[UNPARSED];
  if (typeof unparsed === 'string') return Buffer.from(unparsed, 'utf8');
  if (Buffer.isBuffer(unparsed)) return unparsed;
  return null;
};

const EcommerceStripeWebhookController = ({ strapi }: { strapi: Core.Strapi }) => {
  const webhooks = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceStripeWebhookService');

  return {
    /** POST /ecommerce/stripe/webhook (public; authenticated by the Stripe signature). */
    async handle(ctx: any) {
      const raw = rawBodyOf(ctx);
      if (!raw) {
        strapi.log?.warn('[ecommerce] Stripe webhook received without a raw body capture');
        return ctx.badRequest('Invalid webhook', { code: 'WEBHOOK_RAW_BODY_MISSING' });
      }
      const header = ctx.get?.('stripe-signature') ?? ctx.request?.headers?.['stripe-signature'];
      const signature = typeof header === 'string' ? header : '';
      try {
        const result = await webhooks().handle(raw, signature);
        ctx.status = 200;
        ctx.body = { received: true, duplicate: result.duplicate === true };
      } catch (err) {
        if (
          err instanceof EcommercePaymentError &&
          (err.code === 'WEBHOOK_SIGNATURE_INVALID' || err.code === 'WEBHOOK_PAYLOAD_INVALID')
        ) {
          return ctx.badRequest('Invalid webhook', { code: err.code });
        }
        // Already logged and recorded as FAILED by the service: Stripe retries on 5xx.
        ctx.status = 500;
        ctx.body = { received: false };
      }
    },
  };
};

export default EcommerceStripeWebhookController;
