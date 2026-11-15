import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import type { ProviderRuntime } from './providers/registry';
import { MAX_MONEY_CENTS } from './domain/orders';
import { EcommerceCarrierError } from './errors';
import { builtInCarrierAdapters } from './providers/carriers';
import type { CarrierAdapter, CarrierCallOptions } from './providers/carriers/types';
import type { ManualMethod, StoreSettings } from './settings';
import { orderWeightGrams, priceForWeight } from './domain/shippingRates';
import { marketOf } from './domain/markets';
import { DPD_SERVICE_IDS, dpdServedMarkets, readDpdServices } from './domain/dpdServices';
import type { DpdServiceId } from './domain/dpdServices';
import { DPD_PORTUGAL_ID } from './providers/definitions/dpd-portugal';

export type ShippingQuoteRequest = {
  country: string;
  postalCode?: string;
  items: { variantId: number; quantity: number; weight: number; width: number; height: number; depth: number }[];
  subtotal: number;
  locale: string;
  /** Filled by `quote` before calling adapters: the address's market (`marketOf`). */
  market?: string;
  /** Filled by `quote` before calling adapters: the fallback locale for option names. */
  defaultLocale?: string;
};

export type ShippingOption = {
  providerId: string;
  serviceId: string;
  name: string;
  price: number;
  tax: number;
  estimatedDays?: number;
  /** The storefront/admin must ask for a pickup point (DPD Pickup). Only ever `true`. */
  requiresPickupPoint?: boolean;
};

export type CarrierQuoter = (
  req: ShippingQuoteRequest,
  runtime: ProviderRuntime,
  opts?: CarrierCallOptions
) => Promise<ShippingOption[]>;

export const QUOTE_TIMEOUT_MS = 8000;

const adapters = new Map<string, CarrierAdapter>(builtInCarrierAdapters());

/** Merges `adapter` into the one already registered for `providerId`. */
export function registerCarrierAdapter(providerId: string, adapter: CarrierAdapter): void {
  adapters.set(providerId, { ...adapters.get(providerId), ...adapter });
}

export function registerCarrierQuoter(providerId: string, quoter: CarrierQuoter): void {
  registerCarrierAdapter(providerId, { quote: quoter });
}

export function getCarrierAdapter(providerId: string): CarrierAdapter | undefined {
  return adapters.get(providerId);
}

/** Test helper: restores the built-in adapters only. */
export function __resetCarrierQuotersForTests(): void {
  adapters.clear();
  for (const [id, adapter] of builtInCarrierAdapters()) adapters.set(id, adapter);
}

const pickOption = (o: unknown, providerId: string): ShippingOption | null => {
  const x = o as Partial<ShippingOption> | null;
  if (!x || typeof x !== 'object') return null;
  const { price, tax, name, serviceId, estimatedDays, requiresPickupPoint } = x;
  const valid =
    typeof price === 'number' &&
    Number.isInteger(price) &&
    price >= 0 &&
    price <= MAX_MONEY_CENTS &&
    typeof tax === 'number' &&
    Number.isFinite(tax) &&
    tax >= 0 &&
    tax <= 100 &&
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof serviceId === 'string' &&
    serviceId.trim() !== '' &&
    (estimatedDays === undefined ||
      (typeof estimatedDays === 'number' && Number.isInteger(estimatedDays) && estimatedDays >= 0));
  if (!valid) return null;
  const option: ShippingOption = { providerId, serviceId, name, price, tax };
  if (estimatedDays !== undefined) option.estimatedDays = estimatedDays;
  if (requiresPickupPoint === true) option.requiresPickupPoint = true;
  return option;
};

const failureCode = (error: unknown): string => {
  const raw = (error as { code?: unknown } | null)?.code;
  if (raw === 'CARRIER_NOT_CONFIGURED') return 'NOT_CONFIGURED';
  return typeof raw === 'string' && /^[A-Z_]{1,40}$/.test(raw) ? raw : 'QUOTE_FAILED';
};

const isFilled = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** DPD credentials needed to create a shipment (Ruling 8), whether the integration is active or not. */
const DPD_CREDENTIAL_FIELDS = ['authEndpoint', 'expeditionEndpoint', 'clientId', 'username'] as const;
const DPD_CREDENTIAL_SECRETS = ['clientSecret', 'password'] as const;
const hasDpdCredentials = (rt: ProviderRuntime): boolean =>
  DPD_CREDENTIAL_FIELDS.every((k) => isFilled(rt.config[k])) &&
  DPD_CREDENTIAL_SECRETS.every((k) => isFilled(rt.secrets[k]));

/** The markets a carrier quotes for: its rate tables (DPD, active services) or `config.markets`. */
const carrierMarkets = (providerId: string, rt: ProviderRuntime, storeMarkets: readonly string[]): string[] => {
  if (providerId === DPD_PORTUGAL_ID) return dpdServedMarkets(readDpdServices(rt.config.services), storeMarkets);
  const served = rt.config.markets;
  return Array.isArray(served) ? served.filter((c): c is string => typeof c === 'string') : [];
};

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EcommerceCarrierError('TIMEOUT')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

type Settings = {
  listManualMethods(): Promise<ManualMethod[]>;
  getStoreSettings(): Promise<StoreSettings>;
  getActiveProviders(category: 'carrier'): Promise<string[]>;
  getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null>;
};

const EcommerceShippingService = ({ strapi }: { strapi: Core.Strapi }) => {
  const settings = (): Settings => strapi.plugin(PLUGIN_ID).service('EcommerceSettingsService');
  const getDefaultLocale = async (): Promise<string> =>
    strapi.plugin('i18n').service('locales').getDefaultLocale();

  const compare = (a: ShippingOption, b: ShippingOption) =>
    a.price - b.price || a.name.localeCompare(b.name);

  const quote = async (
    req: ShippingQuoteRequest
  ): Promise<{ options: ShippingOption[]; failures: { providerId: string; code: string }[] }> => {
    const svc = settings();
    const [store, activeCarriers] = await Promise.all([svc.getStoreSettings(), svc.getActiveProviders('carrier')]);
    const options: ShippingOption[] = [];
    const failures: { providerId: string; code: string }[] = [];

    // The address's market (spec 8): an island postcode is PT-ISL only in a store selling there.
    const storeMarkets = store.markets ?? [];
    const market = marketOf(req.country, req.postalCode, storeMarkets);
    // A market outside the store markets has no shipping (not a failure).
    if (!storeMarkets.includes(market)) return { options, failures };

    const carriers = activeCarriers.filter((id) => id !== 'manual');
    const defaultLocale =
      activeCarriers.includes('manual') || carriers.length ? await getDefaultLocale() : undefined;

    if (activeCarriers.includes('manual')) {
      const methods = await svc.listManualMethods();
      const grams = orderWeightGrams(req.items);
      for (const m of methods) {
        if (!m.active) continue;
        // Stored rates that are not a bracket list (the old zone shape) are ignored.
        const brackets = m.rates?.[market];
        if (!Array.isArray(brackets)) continue;
        const price = priceForWeight(brackets, grams);
        if (price === null) continue;
        options.push({
          providerId: 'manual',
          serviceId: String(m.id),
          name: m.name?.[req.locale] || (defaultLocale ? m.name?.[defaultLocale] : undefined) || '',
          price,
          tax: m.tax,
        });
      }
    }

    const adapterReq: ShippingQuoteRequest = { ...req, market, defaultLocale };
    const settled = await Promise.allSettled(
      carriers.map((providerId) =>
        withTimeout(
          (async (): Promise<{ options: ShippingOption[]; invalid: boolean }> => {
            const adapter = adapters.get(providerId);
            if (adapter && !adapter.quote) return { options: [], invalid: false };
            const runtime = await svc.getRuntime(providerId);
            if (!adapter || !runtime || !runtime.active) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
            // A carrier only quotes for the markets it serves.
            if (!carrierMarkets(providerId, runtime, storeMarkets).includes(market)) {
              return { options: [], invalid: false };
            }
            // Explicit to the adapter (`timedFetch` assumes 10 s); the race below is the backstop.
            const result = await adapter.quote!(
              adapterReq,
              { config: runtime.config, secrets: runtime.secrets },
              { timeoutMs: QUOTE_TIMEOUT_MS }
            );
            if (!Array.isArray(result)) throw new EcommerceCarrierError('INVALID_QUOTE');
            const valid = result
              .map((o) => pickOption(o, providerId))
              .filter((o): o is ShippingOption => o !== null);
            return { options: valid, invalid: valid.length !== result.length };
          })(),
          QUOTE_TIMEOUT_MS
        )
      )
    );
    settled.forEach((r, i) => {
      const providerId = carriers[i];
      if (r.status === 'fulfilled') {
        options.push(...r.value.options);
        if (r.value.invalid) failures.push({ providerId, code: 'INVALID_QUOTE' });
        return;
      }
      const code = failureCode(r.reason);
      failures.push({ providerId, code });
      strapi.log?.warn?.(`[ecommerce] carrier quote failed for ${providerId}: ${code}`);
    });

    options.sort(compare);
    return { options, failures };
  };

  return {
    registerCarrierQuoter,
    registerCarrierAdapter,
    quote,
    /**
     * The adapter and runtime of an active carrier. With `forShipment` (spec 7) an inactive DPD
     * integration is accepted when its credentials are set, so orders with a service switched off
     * still ship; quotes keep requiring the integration active.
     */
    async carrierFor(
      providerId: string,
      opts: { forShipment?: boolean } = {}
    ): Promise<{ adapter: CarrierAdapter; runtime: ProviderRuntime }> {
      const adapter = adapters.get(providerId);
      const runtime = await settings().getRuntime(providerId);
      const usable =
        !!runtime &&
        (runtime.active || (opts.forShipment === true && providerId === DPD_PORTUGAL_ID && hasDpdCredentials(runtime)));
      if (!adapter || !runtime || !usable) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
      return { adapter, runtime: { config: runtime.config, secrets: runtime.secrets } };
    },
    /** The registered adapter of `providerId` (its capabilities), whatever its configuration. */
    adapterFor(providerId: string): CarrierAdapter | null {
      return adapters.get(providerId) ?? null;
    },
    /**
     * The markets a method can ship to: its rates (manual, or the DPD service, active or not) or
     * markets (other carriers), inside the store markets. Market codes, not countries: compare an
     * address through `marketOf`.
     */
    async servedCountries(providerId: string, serviceId: string): Promise<string[]> {
      const svc = settings();
      const markets = (await svc.getStoreSettings()).markets ?? [];
      let own: string[] = [];
      if (providerId === 'manual') {
        const method = (await svc.listManualMethods()).find((m) => String(m.id) === serviceId);
        own = Object.entries(method?.rates ?? {})
          .filter(([, brackets]) => Array.isArray(brackets))
          .map(([country]) => country);
      } else if (providerId === DPD_PORTUGAL_ID) {
        const runtime = await svc.getRuntime(providerId);
        const services = readDpdServices(runtime?.config.services);
        own = (DPD_SERVICE_IDS as readonly string[]).includes(serviceId)
          ? Object.keys(services[serviceId as DpdServiceId].rates)
          : runtime
            ? dpdServedMarkets(services, markets)
            : [];
      } else {
        const served = (await svc.getRuntime(providerId))?.config.markets;
        own = Array.isArray(served) ? served.filter((c): c is string => typeof c === 'string') : [];
      }
      return own.filter((c) => markets.includes(c));
    },
    async findOption(
      req: ShippingQuoteRequest,
      providerId: string,
      serviceId: string
    ): Promise<ShippingOption | null> {
      const { options } = await quote(req);
      return options.find((o) => o.providerId === providerId && o.serviceId === serviceId) ?? null;
    },
  };
};

export default EcommerceShippingService;
