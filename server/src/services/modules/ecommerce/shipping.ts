import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import type { ProviderRuntime } from './providers/registry';
import { MAX_MONEY_CENTS } from './domain/orders';
import { EcommerceCarrierError } from './errors';
import { builtInCarrierAdapters } from './providers/carriers';
import type { CarrierAdapter, CarrierCallOptions } from './providers/carriers/types';
import type { ManualMethod, StoreSettings } from './settings';
import type { ShippingZone } from './shippingZones';

export type ShippingQuoteRequest = {
  country: string;
  postalCode?: string;
  items: { variantId: number; quantity: number; weight: number; width: number; height: number; depth: number }[];
  subtotal: number;
  locale: string;
  /** The shipping zone of `country`; set by the service for the carriers, never by the caller. */
  zoneId?: number;
};

export type ShippingOption = {
  providerId: string;
  serviceId: string;
  name: string;
  price: number;
  tax: number;
  estimatedDays?: number;
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
  const { price, tax, name, serviceId, estimatedDays } = x;
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
  return option;
};

const failureCode = (error: unknown): string => {
  const raw = (error as { code?: unknown } | null)?.code;
  if (raw === 'CARRIER_NOT_CONFIGURED') return 'NOT_CONFIGURED';
  return typeof raw === 'string' && /^[A-Z_]{1,40}$/.test(raw) ? raw : 'QUOTE_FAILED';
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
  const listZones = (): Promise<ShippingZone[]> =>
    strapi.plugin(PLUGIN_ID).service('EcommerceShippingZoneService').list();
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

    // A country outside the markets, or a market in no zone, has no shipping (not a failure).
    if (!(store.markets ?? []).includes(req.country)) return { options, failures };
    const zone = (await listZones()).find((z) => z.countries.includes(req.country));
    if (!zone) return { options, failures };
    const zoneKey = String(zone.id);

    if (activeCarriers.includes('manual')) {
      const defaultLocale = await getDefaultLocale();
      const methods = await svc.listManualMethods();
      for (const m of methods) {
        const price = m.rates?.[zoneKey];
        if (!m.active || typeof price !== 'number') continue;
        options.push({
          providerId: 'manual',
          serviceId: String(m.id),
          name: m.name?.[req.locale] || m.name?.[defaultLocale] || '',
          price,
          tax: m.tax,
        });
      }
    }

    const carriers = activeCarriers.filter((id) => id !== 'manual');
    const settled = await Promise.allSettled(
      carriers.map((providerId) =>
        withTimeout(
          (async (): Promise<{ options: ShippingOption[]; invalid: boolean }> => {
            const adapter = adapters.get(providerId);
            if (adapter && !adapter.quote) return { options: [], invalid: false };
            const runtime = await svc.getRuntime(providerId);
            if (!adapter || !runtime || !runtime.active) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
            // A carrier only quotes for the zones it serves.
            const served = runtime.config.zones;
            if (!Array.isArray(served) || !served.includes(zone.id)) return { options: [], invalid: false };
            // Explicit to the adapter (`timedFetch` assumes 10 s); the race below is the backstop.
            const result = await adapter.quote!(
              { ...req, zoneId: zone.id },
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
    async carrierFor(providerId: string): Promise<{ adapter: CarrierAdapter; runtime: ProviderRuntime }> {
      const adapter = adapters.get(providerId);
      const runtime = await settings().getRuntime(providerId);
      if (!adapter || !runtime || !runtime.active) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
      return { adapter, runtime: { config: runtime.config, secrets: runtime.secrets } };
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
