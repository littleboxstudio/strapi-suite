import type { ProviderDefinition } from '../registry';
import { bearerCheck, missingFields, str } from '../http';

const L = 'ecommerce.settings.providers.stripe.fields';

const stripe: ProviderDefinition = {
  id: 'stripe',
  category: 'payment',
  name: 'Stripe',
  exclusive: false,
  verified: true,
  fields: [
    { key: 'secretKey', type: 'secret', required: true, label: `${L}.secretKey` },
    { key: 'webhookSecret', type: 'secret', required: false, label: `${L}.webhookSecret` },
    { key: 'publishableKey', type: 'string', required: false, label: `${L}.publishableKey` },
    {
      key: 'paymentSuccessPath',
      type: 'string',
      format: 'path',
      required: true,
      default: '/checkout/success',
      label: `${L}.paymentSuccessPath`,
    },
    {
      key: 'paymentCancelPath',
      type: 'string',
      format: 'path',
      required: true,
      default: '/checkout/cancel',
      label: `${L}.paymentCancelPath`,
    },
  ],
  async testConnection(rt) {
    const key = str(rt, 'secretKey');
    if (!key) return missingFields(['secretKey']);
    // A restricted key (rk_…) authenticates but may not read the account: 403 means the key is valid.
    return bearerCheck('https://api.stripe.com/v1/account', key, [401], async (res) =>
      res.status === 403 ? { ok: true, message: 'Restricted key' } : null
    );
  },
};

export default stripe;
