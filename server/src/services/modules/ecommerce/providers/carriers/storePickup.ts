import { STORE_PICKUP_ID, STORE_PICKUP_SERVICE_ID, readStorePickup, servedStores } from '../../domain/storePickup';
import { orderWeightGrams, priceForWeight } from '../../domain/shippingRates';
import type { CarrierAdapter } from './types';

const FALLBACK_NAME = 'Store pickup';

/**
 * Store pickup (store pickup spec 2). Quotes are local: one STORE option priced from the market's
 * rate table, carrying the market's stores as `pickupPoints`. There is no carrier to ship with, so
 * the adapter has no `createShipment`.
 */
export const storePickupAdapter: CarrierAdapter = {
  async quote(req, rt) {
    const config = readStorePickup(rt.config.storePickup);
    const market = req.market ?? req.country;
    const stores = servedStores(config, market, req.storeMarkets ?? [market]);
    if (!stores.length) return [];
    const brackets = config.rates[market];
    if (!Array.isArray(brackets)) return [];
    const price = priceForWeight(brackets, orderWeightGrams(req.items));
    if (price === null) return [];
    const name =
      config.name[req.locale] || (req.defaultLocale ? config.name[req.defaultLocale] : undefined) || FALLBACK_NAME;
    return [
      {
        providerId: STORE_PICKUP_ID,
        serviceId: STORE_PICKUP_SERVICE_ID,
        name,
        price,
        tax: config.tax,
        requiresPickupPoint: true,
        pickupPoints: stores,
      },
    ];
  },
};
