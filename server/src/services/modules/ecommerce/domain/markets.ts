/**
 * Market codes (DPD Portugal spec 8): a store market is an ISO country, or `PT-ISL` (Portugal -
 * Ilhas: Azores and Madeira). The market only decides shipping prices and availability; addresses,
 * VAT and invoicing keep the ISO country.
 */

/** The only market that is not a country: PT addresses whose postcode starts with 9. */
export const ISLANDS_MARKET = 'PT-ISL';

// CLDR region codes that are not countries (groupings, pseudo-locales, "Unknown Region").
const NON_COUNTRY_REGIONS = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
let regionNames: Intl.DisplayNames | null = null;

/** An ISO 3166-1 alpha-2 country code (upper case). */
export const isCountry = (v: unknown): boolean => {
  if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v) || NON_COUNTRY_REGIONS.has(v)) return false;
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  try {
    return regionNames.of(v) !== undefined;
  } catch {
    return false;
  }
};

/** An ISO country code, or `PT-ISL`. */
export function isMarketCode(code: string): boolean {
  return code === ISLANDS_MARKET || isCountry(code);
}

/**
 * The market of an address. A PT postcode starting with 9 is `PT-ISL` only when the store sells to
 * `PT-ISL`; without it the islands stay in `PT`, as before the market existed.
 */
export function marketOf(
  country: string,
  postalCode: string | null | undefined,
  storeMarkets: readonly string[]
): string {
  if (
    country === 'PT' &&
    String(postalCode ?? '').replace(/\D/g, '').startsWith('9') &&
    storeMarkets.includes(ISLANDS_MARKET)
  ) {
    return ISLANDS_MARKET;
  }
  return country;
}

/** The address country of a market: `PT` for `PT-ISL`, the market itself otherwise. */
export function marketCountry(market: string): string {
  return market === ISLANDS_MARKET ? 'PT' : market;
}
