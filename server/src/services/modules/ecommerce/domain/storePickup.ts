import { randomBytes } from 'node:crypto';
import { isMarketCode, marketCountry, marketOf } from './markets';
import { MarketRates, normalizeMarketRates, readMarketRates } from './shippingRates';

/**
 * Store pickup (store pickup spec 2): the customer collects the order at one of the shop's stores.
 * The whole configuration lives in the `store-pickup` integration config under `storePickup`: the
 * customer-facing name, VAT rate, rate tables per store market (as manual methods) and the stores
 * of each market. A market is served only with a rate table and at least one store.
 */
export const STORE_PICKUP_ID = 'store-pickup';
export const STORE_PICKUP_SERVICE_ID = 'STORE';

/** Same shape as a DPD pickup point (`PickupPointInput`), without opening hours. */
export type PickupStore = {
  id: string;
  name: string;
  address: string;
  address2: string | null;
  postalCode: string;
  city: string;
  country: string;
};

export type StorePickupConfig = {
  name: Record<string, string>;
  tax: number;
  rates: MarketRates;
  /** Key = store market; each store belongs to one market only. */
  stores: Record<string, PickupStore[]>;
};

export type FieldError = { path: string; code: string };

export const STORE_PICKUP_DEFAULTS: StorePickupConfig = {
  name: { en: 'Store pickup', pt: 'Levantamento em loja' },
  tax: 23,
  rates: {},
  stores: {},
};

export const MAX_STORES_PER_MARKET = 100;

const STORE_FIELDS = [
  { key: 'name', max: 120, required: true },
  { key: 'address', max: 200, required: true },
  { key: 'address2', max: 200, required: false },
  { key: 'postalCode', max: 20, required: true },
  { key: 'city', max: 100, required: true },
] as const;

const STORE_ID_RE = /^st_[a-z0-9]{10}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `st_` + 10 random lowercase alphanumerics (rejection sampling keeps them uniform). */
export function newStoreId(): string {
  let id = '';
  while (id.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte >= 252) continue; // 252 = 7 * 36
      id += ID_ALPHABET[byte % 36];
      if (id.length === 10) break;
    }
  }
  return `st_${id}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const defaults = (): StorePickupConfig => ({
  ...STORE_PICKUP_DEFAULTS,
  name: { ...STORE_PICKUP_DEFAULTS.name },
  rates: {},
  stores: {},
});

/** Trimmed non-empty names; none at all falls back to the default names. */
const readNames = (value: unknown): Record<string, string> => {
  const name: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [locale, text] of Object.entries(value)) {
      if (typeof text === 'string' && text.trim() !== '') name[locale] = text.trim();
    }
  }
  return Object.keys(name).length ? name : { ...STORE_PICKUP_DEFAULTS.name };
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validates one store's fields, pushing errors under `at`; returns the trimmed values. */
function readStoreFields(raw: Record<string, unknown>, at: string, errors: FieldError[]) {
  const values: Record<string, string> = {};
  for (const field of STORE_FIELDS) {
    const value = text(raw[field.key]);
    if (value === '') {
      if (field.required) errors.push({ path: `${at}.${field.key}`, code: 'required' });
    } else if (value.length > field.max) {
      errors.push({ path: `${at}.${field.key}`, code: 'too_long' });
    }
    values[field.key] = value;
  }
  return values;
}

/**
 * Validates the configuration sent by the admin. Rate errors use the manual-method codes under
 * `rates.<market>`; store errors are under `stores.<market>.<index>.<field>`. A store without a
 * (well-formed, unused) id gets a new one; its country is the market's. Its postal code must fall
 * in its market (`STORE_MARKET_MISMATCH`).
 */
export function normalizeStorePickup(
  input: unknown,
  storeMarkets: readonly string[],
  errors: FieldError[],
  newId: () => string = newStoreId
): StorePickupConfig {
  const result = defaults();
  if (input === null || input === undefined) return result;
  if (!isRecord(input)) {
    errors.push({ path: 'storePickup', code: 'invalid_number' });
    return result;
  }

  const tax = input.tax ?? STORE_PICKUP_DEFAULTS.tax;
  if (typeof tax !== 'number' || !Number.isFinite(tax)) errors.push({ path: 'tax', code: 'invalid_number' });
  else if (tax < 0 || tax > 100) errors.push({ path: 'tax', code: 'out_of_range' });

  result.name = readNames(input.name);
  result.tax = typeof tax === 'number' ? tax : STORE_PICKUP_DEFAULTS.tax;
  result.rates = normalizeMarketRates(input.rates, new Set(storeMarkets), errors);

  if (input.stores === null || input.stores === undefined) return result;
  if (!isRecord(input.stores)) {
    errors.push({ path: 'stores', code: 'invalid_number' });
    return result;
  }
  const usedIds = new Set<string>();
  const freshId = () => {
    let id = newId();
    while (usedIds.has(id)) id = newId();
    return id;
  };
  for (const [key, list] of Object.entries(input.stores)) {
    const market = key.toUpperCase();
    const at = `stores.${market}`;
    if (!storeMarkets.includes(market)) {
      errors.push({ path: at, code: 'invalid_market' });
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push({ path: at, code: 'invalid_number' });
      continue;
    }
    if (list.length > MAX_STORES_PER_MARKET) {
      errors.push({ path: at, code: 'too_many' });
      continue;
    }
    const country = marketCountry(market);
    const stores: PickupStore[] = [];
    list.forEach((raw, i) => {
      const storeAt = `${at}.${i}`;
      if (!isRecord(raw)) {
        errors.push({ path: storeAt, code: 'invalid_number' });
        return;
      }
      const v = readStoreFields(raw, storeAt, errors);
      if (v.postalCode !== '' && marketOf(country, v.postalCode, storeMarkets) !== market) {
        errors.push({ path: `${storeAt}.postalCode`, code: 'STORE_MARKET_MISMATCH' });
      }
      const id = typeof raw.id === 'string' && STORE_ID_RE.test(raw.id) && !usedIds.has(raw.id) ? raw.id : freshId();
      usedIds.add(id);
      stores.push({
        id,
        name: v.name,
        address: v.address,
        address2: v.address2 || null,
        postalCode: v.postalCode,
        city: v.city,
        country,
      });
    });
    if (stores.length) result.stores[market] = stores;
  }
  return result;
}

/** Lenient reader for the stored config: invalid parts fall back to the defaults, invalid stores are dropped. */
export function readStorePickup(stored: unknown): StorePickupConfig {
  const result = defaults();
  if (!isRecord(stored)) return result;
  result.name = readNames(stored.name);
  if (typeof stored.tax === 'number' && Number.isFinite(stored.tax)) result.tax = stored.tax;
  result.rates = readMarketRates(stored.rates);
  if (!isRecord(stored.stores)) return result;
  for (const [market, list] of Object.entries(stored.stores)) {
    if (!isMarketCode(market) || !Array.isArray(list)) continue;
    const stores: PickupStore[] = [];
    for (const raw of list.slice(0, MAX_STORES_PER_MARKET)) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || !STORE_ID_RE.test(raw.id)) continue;
      const errors: FieldError[] = [];
      const v = readStoreFields(raw, '', errors);
      if (errors.length) continue;
      stores.push({
        id: raw.id,
        name: v.name,
        address: v.address,
        address2: v.address2 || null,
        postalCode: v.postalCode,
        city: v.city,
        country: marketCountry(market),
      });
    }
    if (stores.length) result.stores[market] = stores;
  }
  return result;
}

export function storesFor(c: StorePickupConfig, market: string): PickupStore[] {
  return c.stores[market] ?? [];
}

/** Store markets with a rate table and at least one store, in the order of the store markets. */
export function storePickupServedMarkets(c: StorePickupConfig, storeMarkets: readonly string[]): string[] {
  return storeMarkets.filter((m) => Array.isArray(c.rates[m]) && storesFor(c, m).length > 0);
}

/** What activating the integration still needs (spec 2): a store market with a rate table and a store. */
export function storePickupActivationIssues(c: StorePickupConfig, storeMarkets: readonly string[]): FieldError[] {
  return storePickupServedMarkets(c, storeMarkets).length ? [] : [{ path: 'rates', code: 'NO_MARKET_WITH_STORES' }];
}

/** Every market the config has a rate table or stores for (for the market removal check). */
export function storePickupMarkets(c: StorePickupConfig): Set<string> {
  return new Set([...Object.keys(c.rates), ...Object.keys(c.stores)]);
}
