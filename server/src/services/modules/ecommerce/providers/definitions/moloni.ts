import type { ConnectionResult, ProviderDefinition } from '../registry';
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
    { key: 'documentSetId', type: 'number', required: false, label: `${L}.documentSetId`, help: `${L}.documentSetId.help` },
    { key: 'exemptionReason', type: 'string', required: false, label: `${L}.exemptionReason`, help: `${L}.exemptionReason.help` },
    { key: 'paymentMethodId', type: 'number', required: false, label: `${L}.paymentMethodId`, help: `${L}.paymentMethodId.help` },
    { key: 'storeCreditPaymentMethodId', type: 'number', required: false, label: `${L}.storeCreditPaymentMethodId`, help: `${L}.storeCreditPaymentMethodId.help` },
    { key: 'productCategoryId', type: 'number', required: false, label: `${L}.productCategoryId`, help: `${L}.productCategoryId.help` },
    { key: 'measurementUnitId', type: 'number', required: false, label: `${L}.measurementUnitId`, help: `${L}.measurementUnitId.help` },
    { key: 'shippingReference', type: 'string', required: false, default: 'PORTES', label: `${L}.shippingReference`, help: `${L}.shippingReference.help` },
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
    const result = await timedFetch<ConnectionResult>(
      `https://api.moloni.pt/v1/grant/?${query}`,
      { method: 'GET' },
      async (res) => {
        if (res.status >= 500) {
          await res.body?.cancel().catch(() => undefined);
          return UNREACHABLE;
        }
        const body: any = await res.json().catch((e) => {
          if (e instanceof SyntaxError) return null; // non-JSON body
          throw e; // abort / stalled body
        });
        return res.ok && body && typeof body.access_token === 'string' && body.access_token
          ? { ok: true }
          : INVALID_CREDENTIALS;
      }
    );
    return result ?? UNREACHABLE;
  },
};

export default moloni;
