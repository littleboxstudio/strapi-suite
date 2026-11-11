import { PLUGIN_ID } from '../../config';

/** Public: Stripe authenticates itself with the `Stripe-Signature` header. */
export default [
  {
    method: 'POST',
    path: '/ecommerce/stripe/webhook',
    handler: 'EcommerceStripeWebhookController.handle',
    config: {
      auth: false,
      policies: [],
      middlewares: [`plugin::${PLUGIN_ID}.check-module-is-active`],
    },
  },
];
