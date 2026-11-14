import { DPD_SERVICE_IDS, readDpdServices } from '../../domain/dpdServices';
import type { DpdServiceId } from '../../domain/dpdServices';
import { orderWeightGrams, priceForWeight } from '../../domain/shippingRates';
import type { ShippingOption } from '../../shipping';
import type { CarrierAdapter } from './types';

/** Last-resort option names when a service has no name in the request or default locale. */
const FALLBACK_NAMES: Record<DpdServiceId, string> = { EXPRESS: 'DPD Express', PICKUP: 'DPD Pickup' };

/**
 * DPD Portugal (spec 4). Quotes are local: the prices come from the rate tables of the services in
 * `config.services`, DPD is never called. Each active service with a table for the address's
 * market and a bracket covering the order weight gives one option; PICKUP needs a pickup point.
 */
export const dpdPortugalAdapter: CarrierAdapter = {
  async quote(req, rt) {
    const services = readDpdServices(rt.config.services);
    const market = req.market ?? req.country;
    const grams = orderWeightGrams(req.items);
    const options: ShippingOption[] = [];
    for (const serviceId of DPD_SERVICE_IDS) {
      const service = services[serviceId];
      if (!service.active) continue;
      const brackets = service.rates[market];
      if (!Array.isArray(brackets)) continue;
      const price = priceForWeight(brackets, grams);
      if (price === null) continue;
      const name =
        service.name[req.locale] ||
        (req.defaultLocale ? service.name[req.defaultLocale] : undefined) ||
        FALLBACK_NAMES[serviceId];
      options.push({
        providerId: 'dpd-portugal',
        serviceId,
        name,
        price,
        tax: service.tax,
        ...(serviceId === 'PICKUP' ? { requiresPickupPoint: true } : {}),
      });
    }
    return options;
  },
};
