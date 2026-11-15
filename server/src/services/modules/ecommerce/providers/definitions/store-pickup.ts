import { STORE_PICKUP_ID } from '../../domain/storePickup';
import type { ProviderDefinition } from '../registry';

/**
 * Store pickup (store pickup spec 2): no credentials and no external API. The name, VAT rate, rate
 * tables and stores are stored in the config under `storePickup` and saved by the settings service
 * (`saveStorePickup`), not as fields.
 */
const storePickup: ProviderDefinition = {
  id: STORE_PICKUP_ID,
  category: 'carrier',
  name: 'Store pickup',
  exclusive: false,
  fields: [],
};

export default storePickup;
