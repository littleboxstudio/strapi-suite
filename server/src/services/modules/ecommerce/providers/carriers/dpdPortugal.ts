import { DPD_SERVICE_IDS, readDpdServices } from '../../domain/dpdServices';
import type { DpdServiceId } from '../../domain/dpdServices';
import { orderWeightGrams, priceForWeight } from '../../domain/shippingRates';
import { EcommerceCarrierError } from '../../errors';
import { str } from '../http';
import type { ShippingOption } from '../../shipping';
import { dpdCreateExpedition, dpdDownloadLabel } from './dpd/client';
import { buildExpeditionBody } from './dpd/payload';
import type { CarrierAdapter } from './types';

/** Last-resort option names when a service has no name in the request or default locale. */
const FALLBACK_NAMES: Record<DpdServiceId, string> = { EXPRESS: 'DPD Express', PICKUP: 'DPD Pickup' };

/** The sub-account of each service (spec 2.1). */
const SUB_ACCOUNT: Record<DpdServiceId, string> = { EXPRESS: 'accountHome', PICKUP: 'accountShop' };

const TRACKING_URL = 'https://tracking.dpd.pt/track-and-trace?reference=';

/** DPD Portugal ships from Portugal: the expedition date is today there. */
const DEFAULT_TIME_ZONE = 'Europe/Lisbon';

/** `yyyy-MM-dd` of `now` in `timeZone`. */
function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const isServiceId = (v: string): v is DpdServiceId => (DPD_SERVICE_IDS as readonly string[]).includes(v);

const safeFilePart = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'label';

/**
 * DPD Portugal (spec 4, 6). Quotes are local: the prices come from the rate tables of the services
 * in `config.services`, DPD is never called. Each active service with a table for the address's
 * market and a bracket covering the order weight gives one option; PICKUP needs a pickup point.
 * Shipments go to the DPD API with the service's sub-account; the label URL is kept as `labelRef`
 * and downloaded on demand. There is no cancel or tracking API, and DPD does not deduplicate by
 * reference: an uncertain shipment is never retried.
 */
export function createDpdPortugalAdapter(
  deps: { now?: () => Date; timeZone?: string } = {}
): CarrierAdapter {
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;

  return {
    deduplicatesByReference: false,

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

    async createShipment(req, rt, opts) {
      const service = req.serviceId;
      if (!isServiceId(service)) {
        throw new EcommerceCarrierError('NOT_SUPPORTED', 'Unknown DPD service.');
      }
      const subAccount = str(rt, SUB_ACCOUNT[service]);
      if (!subAccount) {
        throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED', `Missing DPD fields: ${SUB_ACCOUNT[service]}`);
      }
      const pickupPointId = req.pickupPoint?.id?.trim() ?? '';
      if (service === 'PICKUP' && !pickupPointId) {
        throw new EcommerceCarrierError('PICKUP_POINT_REQUIRED', 'A pickup point is required.');
      }
      const destination = req.destination;
      const parcels = Number.isInteger(req.parcels) && req.parcels! > 0 ? req.parcels! : 1;
      const weightGrams =
        typeof req.weightGrams === 'number' && Number.isFinite(req.weightGrams)
          ? req.weightGrams
          : orderWeightGrams(req.items);
      const body = buildExpeditionBody({
        service,
        subAccount,
        sender: {
          name: str(rt, 'senderName'),
          address: str(rt, 'senderAddress'),
          postalCode: str(rt, 'senderPostalCode'),
          city: str(rt, 'senderCity'),
          phone: str(rt, 'senderPhone'),
          email: str(rt, 'senderEmail'),
        },
        recipient: {
          name: req.contact.name,
          phone: req.contact.phone || destination.phone,
          email: req.contact.email,
          address: [destination.line1, destination.line2].filter((l) => l && l.trim()).join(' '),
          postalCode: destination.postalCode,
          city: destination.city,
          country: destination.country,
        },
        ...(service === 'PICKUP' ? { pickupPointId } : {}),
        reference: req.ourReference,
        date: localDate(now(), timeZone),
        weightGrams,
        parcels,
      });
      const { trackingCode, labelUrl } = await dpdCreateExpedition(rt, body, opts);
      return {
        externalId: trackingCode,
        trackingCode,
        trackingUrl: TRACKING_URL + encodeURIComponent(trackingCode),
        cost: null,
        labelAvailable: true,
        labelRef: labelUrl,
      };
    },

    async getLabel(externalId, _rt, opts, labelRef) {
      if (!labelRef) {
        throw new EcommerceCarrierError('CARRIER_REQUEST_FAILED', 'The DPD label link is missing.');
      }
      const content = await dpdDownloadLabel(labelRef, opts);
      return { filename: `dpd-${safeFilePart(externalId)}.pdf`, content };
    },
  };
}

export const dpdPortugalAdapter: CarrierAdapter = createDpdPortugalAdapter();
