import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import type { ProviderRuntime } from './providers/registry';
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

const quoters = new Map<string, CarrierQuoter>();

export function registerCarrierQuoter(providerId: string, quoter: CarrierQuoter): void {
  quoters.set(providerId, quoter);
}

/** Test helper: clears every registered quoter. */
export function __resetCarrierQuotersForTests(): void {
  quoters.clear();
}

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

    for (const providerId of activeCarriers) {
      const quoter = quoters.get(providerId);
      if (!quoter) continue;
      try {
        const runtime = await svc.getRuntime(providerId);
        if (!runtime || !runtime.active) continue;
        const result = await quoter(req, { config: runtime.config, secrets: runtime.secrets });
        options.push(...result);
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        failures.push({ providerId, code: typeof code === 'string' ? code : 'QUOTE_FAILED' });
        strapi.log?.warn?.(`[ecommerce] carrier quote failed for ${providerId}`);
      }
    }

    options.sort(compare);
    return { options, failures };
  };

  return {
    registerCarrierQuoter,
    quote,
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
