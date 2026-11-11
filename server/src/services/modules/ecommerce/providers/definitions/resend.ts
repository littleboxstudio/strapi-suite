import type { ProviderDefinition } from '../registry';
import { bearerCheck, missingFields, str } from '../http';

const L = 'ecommerce.settings.providers.resend.fields';

const resend: ProviderDefinition = {
  id: 'resend',
  category: 'email',
  name: 'Resend',
  exclusive: false,
  verified: true,
  fields: [
    { key: 'apiKey', type: 'secret', required: true, label: `${L}.apiKey` },
    { key: 'fromEmail', type: 'string', required: true, label: `${L}.fromEmail` },
    { key: 'fromName', type: 'string', required: false, label: `${L}.fromName` },
  ],
  async testConnection(rt) {
    const key = str(rt, 'apiKey');
    if (!key) return missingFields(['apiKey']);
    return bearerCheck('https://api.resend.com/domains', key, [401, 403]);
  },
};

export default resend;
