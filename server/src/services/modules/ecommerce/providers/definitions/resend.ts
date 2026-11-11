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
    { key: 'fromEmail', type: 'string', format: 'email', required: true, label: `${L}.fromEmail` },
    { key: 'fromName', type: 'string', required: false, label: `${L}.fromName` },
  ],
  async testConnection(rt) {
    const key = str(rt, 'apiKey');
    if (!key) return missingFields(['apiKey']);
    // A sending-only key cannot list domains: Resend answers 401 `restricted_api_key`, yet the key is valid.
    return bearerCheck('https://api.resend.com/domains', key, [401, 403], async (res) => {
      if (res.status !== 401) return null;
      const body: any = await res.json().catch(() => null);
      return body?.name === 'restricted_api_key'
        ? { ok: true, message: 'Key valid (sending access only)' }
        : null;
    });
  },
};

export default resend;
