import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import type { ProviderRuntime } from './providers/registry';
import { MAX_MONEY_CENTS } from './domain/orders';
import { EcommerceCarrierError } from './errors';
import { builtInCarrierAdapters } from './providers/carriers';
import type { CarrierAdapter } from './providers/carriers/types';
import type { ManualMethod, StoreSettings } from './settings';

export type ShippingQuoteRequest = {
  country: string;
  postalCode?: string;
  items: { variantId: number; quantity: number; weight: number; width: number; height: number; depth: number }[];
  subtotal: number;
  locale: string;
};

export type ShippingOption = {
  providerId: string;
  serviceId: string;
  name: string;
  price: number;
  tax: number;
  estimatedDays?: number;
};

export type CarrierQuoter = (req: ShippingQuoteRequest, runtime: ProviderRuntime) => Promise<ShippingOption[]>;

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

const isValidOption = (o: unknown): o is ShippingOption => {
  const x = o as Partial<ShippingOption> | null;
  return (
    !!x &&
    typeof x === 'object' &&
    Number.isInteger(x.price) &&
    (x.price as number) >= 0 &&
    (x.price as number) <= MAX_MONEY_CENTS &&
    typeof x.tax === 'number' &&
    x.tax >= 0 &&
    x.tax <= 100 &&
    typeof x.name === 'string' &&
    x.name.trim() !== '' &&
    typeof x.serviceId === 'string' &&
    x.serviceId.trim() !== ''
  );
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

    if (!(store.shippingCountries ?? []).includes(req.country)) return { options, failures };

    if (activeCarriers.includes('manual')) {
      const defaultLocale = await getDefaultLocale();
      const methods = await svc.listManualMethods();
      for (const m of methods) {
        if (!m.active || !(m.countries ?? []).includes(req.country)) continue;
        options.push({
          providerId: 'manual',
          serviceId: String(m.id),
          name: m.name?.[req.locale] || m.name?.[defaultLocale] || '',
          price: m.price,
          tax: m.tax,
        });
      }
    }

    const carriers = activeCarriers.filter((id) => id !== 'manual');
    const settled = await Promise.allSettled(
      carriers.map(async (providerId) => {
        const adapter = adapters.get(providerId);
        if (adapter && !adapter.quote) return [];
        const runtime = await svc.getRuntime(providerId);
        if (!adapter || !runtime || !runtime.active) throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
        const result = await withTimeout(
          Promise.resolve().then(() => adapter.quote!(req, { config: runtime.config, secrets: runtime.secrets })),
          QUOTE_TIMEOUT_MS
        );
        if (!Array.isArray(result)) throw new EcommerceCarrierError('INVALID_QUOTE');
        const valid = result.filter(isValidOption).map((o) => ({ ...o, providerId }));
        if (valid.length !== result.length) failures.push({ providerId, code: 'INVALID_QUOTE' });
        return valid;
      })
    );
    settled.forEach((r, i) => {
      const providerId = carriers[i];
      if (r.status === 'fulfilled') {
        options.push(...r.value);
        return;
      }
      const raw = (r.reason as { code?: unknown } | null)?.code;
      const code =
        raw === 'CARRIER_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : typeof raw === 'string' ? raw : 'QUOTE_FAILED';
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
