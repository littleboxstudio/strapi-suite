import type { ProviderDefinition } from '../registry';
import { INVALID_CREDENTIALS, UNREACHABLE, missingFields, str, timedFetch } from '../http';

const L = 'ecommerce.settings.providers.moloni.fields';

const moloni: ProviderDefinition = {
  id: 'moloni',
  category: 'billing',
  name: 'Moloni',
  exclusive: true,
  verified: false,
  fields: [
    { key: 'clientId', type: 'string', required: true, label: `${L}.clientId` },
    { key: 'clientSecret', type: 'secret', required: true, label: `${L}.clientSecret` },
    { key: 'username', type: 'string', required: true, label: `${L}.username` },
    { key: 'password', type: 'secret', required: true, label: `${L}.password` },
    { key: 'companyId', type: 'number', required: true, label: `${L}.companyId` },
    { key: 'documentType', type: 'select', required: false, default: 'FR', options: ['FR', 'FT'], label: `${L}.documentType` },
    { key: 'documentSetId', type: 'number', required: false, label: `${L}.documentSetId` },
    { key: 'exemptionReason', type: 'string', required: false, label: `${L}.exemptionReason` },
  ],
  async testConnection(rt) {
    const values = {
      client_id: str(rt, 'clientId'),
      client_secret: str(rt, 'clientSecret'),
      username: str(rt, 'username'),
      password: str(rt, 'password'),
    };
    const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) return missingFields(missing);

    const query = Object.entries({ grant_type: 'password', ...values })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const res = await timedFetch(`https://api.moloni.pt/v1/grant/?${query}`, { method: 'GET' });
    if (!res) return UNREACHABLE;
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body && typeof body.access_token === 'string' && body.access_token) return { ok: true };
    return INVALID_CREDENTIALS;
  },
};

export default moloni;
