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
  ],
  async testConnection(rt) {
    const key = str(rt, 'secretKey');
    if (!key) return missingFields(['secretKey']);
    return bearerCheck('https://api.stripe.com/v1/account', key, [401]);
  },
};

export default stripe;
