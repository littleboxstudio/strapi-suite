import type { ProviderDefinition } from '../registry';

const L = 'ecommerce.settings.providers.dpd-portugal.fields';

export const DPD_PORTUGAL_ID = 'dpd-portugal';
export const DPD_PICKUP_ENDPOINT_DEFAULT = 'http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl';

/**
 * DPD Portugal (spec 3). The Express/Pickup services and their rate tables are stored in the
 * config under `services` and saved by the settings service (`saveDpdServices`), not as fields.
 * `accountHome` is required with EXPRESS active, `accountShop` and `pickupKey` with PICKUP active.
 */
const dpdPortugal: ProviderDefinition = {
  id: DPD_PORTUGAL_ID,
  category: 'carrier',
  name: 'DPD Portugal',
  exclusive: false,
  fields: [
    { key: 'authEndpoint', type: 'string', required: true, label: `${L}.authEndpoint` },
    { key: 'expeditionEndpoint', type: 'string', required: true, label: `${L}.expeditionEndpoint` },
    { key: 'clientId', type: 'string', required: true, label: `${L}.clientId` },
    { key: 'clientSecret', type: 'secret', required: true, label: `${L}.clientSecret` },
    { key: 'username', type: 'string', required: true, label: `${L}.username` },
    { key: 'password', type: 'secret', required: true, label: `${L}.password` },
    { key: 'accountHome', type: 'string', required: false, label: `${L}.accountHome` },
    { key: 'accountShop', type: 'string', required: false, label: `${L}.accountShop` },
    {
      key: 'pickupEndpoint',
      type: 'string',
      required: false,
      default: DPD_PICKUP_ENDPOINT_DEFAULT,
      label: `${L}.pickupEndpoint`,
    },
    { key: 'pickupKey', type: 'secret', required: false, label: `${L}.pickupKey` },
    { key: 'senderName', type: 'string', required: true, label: `${L}.senderName` },
    { key: 'senderAddress', type: 'string', required: true, label: `${L}.senderAddress` },
    { key: 'senderPostalCode', type: 'string', required: true, label: `${L}.senderPostalCode` },
    { key: 'senderCity', type: 'string', required: true, label: `${L}.senderCity` },
    { key: 'senderPhone', type: 'string', required: true, label: `${L}.senderPhone` },
    { key: 'senderEmail', type: 'string', required: true, label: `${L}.senderEmail` },
  ],
  async testConnection() {
    return { ok: false, code: 'NOT_IMPLEMENTED' };
  },
};

export default dpdPortugal;
