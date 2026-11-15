import { readDpdServices } from '../../domain/dpdServices';
import { EcommerceCarrierError } from '../../errors';
import { dpdToken } from '../carriers/dpd/client';
import { searchPudo } from '../carriers/dpd/pickupClient';
import { INVALID_CREDENTIALS, missingFields, str, UNREACHABLE } from '../http';
import type { ConnectionResult, ProviderDefinition, ProviderRuntime } from '../registry';

const L = 'ecommerce.settings.providers.dpd-portugal.fields';

export const DPD_PORTUGAL_ID = 'dpd-portugal';
export const DPD_PICKUP_ENDPOINT_DEFAULT = 'http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl';

/** Postal code of the pickup search done by the connection test (spec 3.3). */
const TEST_POSTAL_CODE = '1000-001';
const TEST_TIMEOUT_MS = 10000;

/**
 * Spec 3.3: requests a token; with PICKUP active, also searches pickup points near `1000-001` and
 * only checks there is no error.
 */
async function testDpdConnection(rt: ProviderRuntime): Promise<ConnectionResult> {
  const pickup = readDpdServices(rt.config.services).PICKUP.active;
  const required = ['authEndpoint', 'clientId', 'clientSecret', 'username', 'password'];
  if (pickup) required.push('pickupKey');
  const missing = required.filter((key) => !str(rt, key));
  if (missing.length) return missingFields(missing);
  try {
    await dpdToken(rt, { timeoutMs: TEST_TIMEOUT_MS });
  } catch (err) {
    return err instanceof EcommerceCarrierError && err.code === 'DPD_AUTH_FAILED' ? INVALID_CREDENTIALS : UNREACHABLE;
  }
  if (pickup) {
    try {
      await searchPudo(
        str(rt, 'pickupEndpoint') || DPD_PICKUP_ENDPOINT_DEFAULT,
        str(rt, 'pickupKey'),
        TEST_POSTAL_CODE,
        { timeoutMs: TEST_TIMEOUT_MS }
      );
    } catch {
      return { ok: false, code: 'UNREACHABLE', message: 'The DPD pickup point search failed.' };
    }
  }
  return { ok: true };
}

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
  testConnection: testDpdConnection,
};

export default dpdPortugal;
