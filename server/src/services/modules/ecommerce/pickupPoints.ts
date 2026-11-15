import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { readDpdServices } from './domain/dpdServices';
import { marketOf } from './domain/markets';
import { EcommerceCarrierError, EcommerceValidationError } from './errors';
import { searchPudo } from './providers/carriers/dpd/pickupClient';
import type { PickupPoint } from './providers/carriers/dpd/payload';
import { DPD_PICKUP_ENDPOINT_DEFAULT, DPD_PORTUGAL_ID } from './providers/definitions/dpd-portugal';
import type { ProviderRuntime } from './providers/registry';
import type { StoreSettings } from './settings';
import { QUOTE_TIMEOUT_MS } from './shipping';

export type { PickupPoint };

/** Ruling 13: points per postal code stay 10 minutes in memory (one cache per process). */
export const PICKUP_CACHE_TTL_MS = 10 * 60 * 1000;
/** Bound of the cache; the oldest entries leave first. */
const MAX_CACHE_ENTRIES = 5000;
const POSTAL_CODE = /^\d{4}-?\d{3}$/;

const cache = new Map<string, { points: PickupPoint[]; at: number }>();

/** Test helper: empties the pickup point cache. */
export function __clearPickupCacheForTests(): void {
  cache.clear();
}

const cached = (postalCode: string): PickupPoint[] | null => {
  const entry = cache.get(postalCode);
  if (!entry) return null;
  if (Date.now() - entry.at < PICKUP_CACHE_TTL_MS) return entry.points;
  cache.delete(postalCode);
  return null;
};

const remember = (postalCode: string, points: PickupPoint[]) => {
  cache.delete(postalCode);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(postalCode, { points, at: Date.now() });
};

const invalid = (path: string, code: string) => new EcommerceValidationError(code, [{ path, code }]);

/** `NNNN-NNN`, or an `INVALID_POSTAL_CODE` error. */
const normalizePostalCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !POSTAL_CODE.test(raw)) throw invalid('postalCode', 'INVALID_POSTAL_CODE');
  const digits = raw.replace(/\D/g, '');
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
};

type Settings = {
  getStoreSettings(): Promise<StoreSettings>;
  getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
};

/**
 * DPD pickup points (spec 5.1): searched by postal code for the storefront and the admin, and
 * confirmed at checkout (`findPoint`). Available only with the `dpd-portugal` integration active,
 * its PICKUP service active, and a PICKUP rate table for the address's market (a store market).
 */
const EcommercePickupPointService = ({ strapi }: { strapi: Core.Strapi }) => {
  const settings = (): Settings => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');

  /** The endpoint and key to search with, or `PICKUP_NOT_AVAILABLE`. */
  const pickupAccess = async (postalCode: string): Promise<{ endpoint: string; key: string }> => {
    const svc = settings();
    const [runtime, store] = await Promise.all([svc.getRuntime(DPD_PORTUGAL_ID), svc.getStoreSettings()]);
    const notAvailable = invalid('postalCode', 'PICKUP_NOT_AVAILABLE');
    if (!runtime || !runtime.active) throw notAvailable;
    const pickup = readDpdServices(runtime.config.services).PICKUP;
    const storeMarkets = store.markets ?? [];
    const market = marketOf('PT', postalCode, storeMarkets);
    if (!pickup.active || !storeMarkets.includes(market) || !Array.isArray(pickup.rates[market])) {
      throw notAvailable;
    }
    const key = runtime.secrets.pickupKey;
    if (typeof key !== 'string' || key.trim() === '') throw notAvailable;
    const endpoint = runtime.config.pickupEndpoint;
    return {
      endpoint: typeof endpoint === 'string' && endpoint.trim() !== '' ? endpoint : DPD_PICKUP_ENDPOINT_DEFAULT,
      key,
    };
  };

  const search = async (input: { postalCode: string; country?: string }): Promise<PickupPoint[]> => {
    const country = String(input.country ?? 'PT').toUpperCase();
    if (country !== 'PT') throw invalid('country', 'PICKUP_NOT_AVAILABLE');
    const postalCode = normalizePostalCode(input.postalCode);
    const { endpoint, key } = await pickupAccess(postalCode);
    const hit = cached(postalCode);
    if (hit) return hit;
    let points: PickupPoint[];
    try {
      points = await searchPudo(endpoint, key, postalCode, { timeoutMs: QUOTE_TIMEOUT_MS });
    } catch {
      // The code only: never the postal code, the key or the carrier's answer.
      strapi.log?.warn?.('[ecommerce] pickup point search failed: PICKUP_SEARCH_FAILED');
      throw new EcommerceCarrierError('PICKUP_SEARCH_FAILED', 'The pickup point search failed.');
    }
    remember(postalCode, points);
    return points;
  };

  return {
    search,
    /** The point `id` near `postalCode`: from the cache, otherwise from a new search. */
    async findPoint(postalCode: string, id: string): Promise<PickupPoint | null> {
      const hit = POSTAL_CODE.test(String(postalCode)) ? cached(normalizePostalCode(postalCode)) : null;
      const fromCache = hit?.find((p) => p.id === id);
      if (fromCache) return fromCache;
      const points = await search({ postalCode });
      return points.find((p) => p.id === id) ?? null;
    },
  };
};

export default EcommercePickupPointService;
