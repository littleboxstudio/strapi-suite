import { MarketRates, normalizeMarketRates, readMarketRates } from './shippingRates';

/**
 * DPD Portugal services (spec 3.2): each one has its own customer-facing name, VAT rate and rate
 * table (weight brackets per store market, as manual methods). They live in the `dpd-portugal`
 * integration config under `services`; a market with no table has no such service.
 */
export type DpdServiceId = 'EXPRESS' | 'PICKUP';

export type DpdService = {
  active: boolean;
  name: Record<string, string>;
  tax: number;
  rates: MarketRates;
};

export type DpdServices = Record<DpdServiceId, DpdService>;

export type FieldError = { path: string; code: string };

export const DPD_SERVICE_IDS: readonly DpdServiceId[] = ['EXPRESS', 'PICKUP'];

export const DPD_SERVICE_DEFAULTS: DpdServices = {
  EXPRESS: { active: false, name: { en: 'DPD Express', pt: 'DPD Express' }, tax: 23, rates: {} },
  PICKUP: { active: false, name: { en: 'DPD Pickup', pt: 'DPD Pickup' }, tax: 23, rates: {} },
};

/** The markets DPD Pickup serves (spec 3.2): mainland Portugal and the islands. */
export const DPD_PICKUP_MARKETS: readonly string[] = ['PT', 'PT-ISL'];

/** The store markets a service may have rates for: PICKUP only PT and PT-ISL. */
export function dpdServiceMarkets(id: DpdServiceId, markets: Iterable<string>): Set<string> {
  const all = [...markets];
  return new Set(id === 'PICKUP' ? all.filter((m) => DPD_PICKUP_MARKETS.includes(m)) : all);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const defaults = (id: DpdServiceId): DpdService => ({
  ...DPD_SERVICE_DEFAULTS[id],
  name: { ...DPD_SERVICE_DEFAULTS[id].name },
  rates: {},
});

/** Trimmed non-empty names; none at all falls back to the default names. */
const readNames = (value: unknown, id: DpdServiceId): Record<string, string> => {
  const name: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [locale, text] of Object.entries(value)) {
      if (typeof text === 'string' && text.trim() !== '') name[locale] = text.trim();
    }
  }
  return Object.keys(name).length ? name : { ...DPD_SERVICE_DEFAULTS[id].name };
};

/**
 * Validates the services sent by the admin. A missing service keeps its defaults; rate errors use
 * the manual-method codes under `services.<ID>.rates.<market>` (PICKUP: only PT and PT-ISL).
 * Only `active: true` activates a service.
 */
export function normalizeDpdServices(
  input: unknown,
  markets: ReadonlySet<string>,
  errors: FieldError[]
): DpdServices {
  const result = { EXPRESS: defaults('EXPRESS'), PICKUP: defaults('PICKUP') };
  if (input === null || input === undefined) return result;
  if (!isRecord(input)) {
    errors.push({ path: 'services', code: 'invalid_number' });
    return result;
  }
  for (const id of DPD_SERVICE_IDS) {
    const raw = input[id];
    if (raw === undefined || raw === null) continue;
    const at = `services.${id}`;
    if (!isRecord(raw)) {
      errors.push({ path: at, code: 'invalid_number' });
      continue;
    }
    const tax = raw.tax ?? DPD_SERVICE_DEFAULTS[id].tax;
    if (typeof tax !== 'number' || !Number.isFinite(tax)) errors.push({ path: `${at}.tax`, code: 'invalid_number' });
    else if (tax < 0 || tax > 100) errors.push({ path: `${at}.tax`, code: 'out_of_range' });

    const rateErrors: FieldError[] = [];
    const rates = normalizeMarketRates(raw.rates, dpdServiceMarkets(id, markets), rateErrors);
    errors.push(...rateErrors.map((e) => ({ ...e, path: `${at}.${e.path}` })));

    result[id] = {
      active: raw.active === true,
      name: readNames(raw.name, id),
      tax: typeof tax === 'number' ? tax : DPD_SERVICE_DEFAULTS[id].tax,
      rates,
    };
  }
  return result;
}

/**
 * Lenient reader for the stored config: invalid parts fall back to the defaults; PICKUP keeps
 * only its PT and PT-ISL rates.
 */
export function readDpdServices(stored: unknown): DpdServices {
  const result = { EXPRESS: defaults('EXPRESS'), PICKUP: defaults('PICKUP') };
  if (!isRecord(stored)) return result;
  for (const id of DPD_SERVICE_IDS) {
    const raw = stored[id];
    if (!isRecord(raw)) continue;
    const tax = typeof raw.tax === 'number' && Number.isFinite(raw.tax) ? raw.tax : DPD_SERVICE_DEFAULTS[id].tax;
    const allowed = (m: string) => id !== 'PICKUP' || DPD_PICKUP_MARKETS.includes(m);
    const rates = Object.fromEntries(Object.entries(readMarketRates(raw.rates)).filter(([m]) => allowed(m)));
    result[id] = { active: raw.active === true, name: readNames(raw.name, id), tax, rates };
  }
  return result;
}

/**
 * What activating the integration still needs (spec 3.2): an active service, `accountHome` for
 * EXPRESS, `accountShop` and the pickup key for PICKUP.
 */
export function dpdActivationIssues(
  services: DpdServices,
  config: Record<string, unknown>,
  hasSecret: (k: string) => boolean
): FieldError[] {
  if (!services.EXPRESS.active && !services.PICKUP.active) return [{ path: 'services', code: 'NO_ACTIVE_SERVICE' }];
  const issues: FieldError[] = [];
  if (services.EXPRESS.active && isBlank(config.accountHome)) {
    issues.push({ path: 'config.accountHome', code: 'required' });
  }
  if (services.PICKUP.active) {
    if (isBlank(config.accountShop)) issues.push({ path: 'config.accountShop', code: 'required' });
    if (!hasSecret('pickupKey')) issues.push({ path: 'secrets.pickupKey', code: 'required' });
  }
  return issues;
}

/** Markets with a rate table in some active service, limited to (and in the order of) the store markets. */
export function dpdServedMarkets(services: DpdServices, storeMarkets: readonly string[]): string[] {
  const served = new Set<string>();
  for (const id of DPD_SERVICE_IDS) {
    if (services[id].active) Object.keys(services[id].rates).forEach((m) => served.add(m));
  }
  return storeMarkets.filter((m) => served.has(m));
}

/** Every market any service (active or not) has a rate table for. */
export function dpdRateMarkets(services: DpdServices): Set<string> {
  return new Set(DPD_SERVICE_IDS.flatMap((id) => Object.keys(services[id].rates)));
}
