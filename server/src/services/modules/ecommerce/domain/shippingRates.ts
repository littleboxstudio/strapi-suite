import { MAX_MONEY_CENTS } from './orders';

/** `upTo` in kg (at most 3 decimals; null = no upper limit); `price` in cents. */
export type WeightBracket = { upTo: number | null; price: number };

/** Key = ISO 3166-1 alpha-2 country, upper case. */
export type MarketRates = Record<string, WeightBracket[]>;

type RateError = { path: string; code: string };

const COUNTRY_RE = /^[A-Z]{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const toGrams = (kg: number): number => Math.round(kg * 1000);

/** Validates one country's brackets, pushing errors under `path`; returns the clean list. */
function normalizeBrackets(value: unknown, path: string, errors: RateError[]): WeightBracket[] {
  if (!Array.isArray(value)) {
    errors.push({ path, code: 'invalid_number' });
    return [];
  }
  if (value.length === 0) {
    errors.push({ path, code: 'required' });
    return [];
  }
  const out: WeightBracket[] = [];
  let prevGrams = 0;
  value.forEach((raw, i) => {
    const at = `${path}.${i}`;
    if (!isRecord(raw)) {
      errors.push({ path: at, code: 'invalid_number' });
      return;
    }
    const { upTo, price } = raw;
    if (upTo === null) {
      if (i !== value.length - 1) errors.push({ path: `${at}.upTo`, code: 'out_of_range' });
    } else if (typeof upTo !== 'number' || !Number.isFinite(upTo)) {
      errors.push({ path: `${at}.upTo`, code: 'invalid_number' });
    } else if (Math.abs(upTo * 1000 - toGrams(upTo)) > 1e-6) {
      errors.push({ path: `${at}.upTo`, code: 'invalid_number' });
    } else if (toGrams(upTo) <= prevGrams) {
      // Covers zero, negatives and non-increasing limits.
      errors.push({ path: `${at}.upTo`, code: 'out_of_range' });
    } else {
      prevGrams = toGrams(upTo);
    }
    if (typeof price !== 'number' || !Number.isInteger(price)) {
      errors.push({ path: `${at}.price`, code: 'invalid_number' });
    } else if (price < 0 || price > MAX_MONEY_CENTS) {
      errors.push({ path: `${at}.price`, code: 'out_of_range' });
    }
    out.push({ upTo: upTo as number | null, price: price as number });
  });
  return out;
}

export function normalizeMarketRates(
  input: unknown,
  markets: ReadonlySet<string>,
  errors: RateError[]
): MarketRates {
  if (input === null || input === undefined) return {};
  if (!isRecord(input)) {
    errors.push({ path: 'rates', code: 'invalid_number' });
    return {};
  }
  const result: MarketRates = {};
  for (const [key, value] of Object.entries(input)) {
    const country = key.toUpperCase();
    const path = `rates.${country}`;
    if (!COUNTRY_RE.test(country) || !markets.has(country)) {
      errors.push({ path, code: 'invalid_country' });
      continue;
    }
    result[country] = normalizeBrackets(value, path, errors);
  }
  return result;
}

/** Lenient reader for stored rows: keeps only valid bracket arrays (old zone-shaped rows read as `{}`). */
export function readMarketRates(stored: unknown): MarketRates {
  if (!isRecord(stored)) return {};
  const result: MarketRates = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!COUNTRY_RE.test(key)) continue;
    const errors: RateError[] = [];
    const brackets = normalizeBrackets(value, key, errors);
    if (errors.length === 0) result[key] = brackets;
  }
  return result;
}

/** Total weight in grams; a missing or negative weight (kg) counts as 0. */
export function orderWeightGrams(items: { weight: number; quantity: number }[]): number {
  let grams = 0;
  for (const { weight, quantity } of items) {
    const w = typeof weight === 'number' && weight > 0 ? weight : 0;
    grams += Math.round(w * 1000) * quantity;
  }
  return grams;
}

/** Price of the first bracket covering `weightGrams` (bracket i covers (prev, limit]); null if none. */
export function priceForWeight(brackets: WeightBracket[], weightGrams: number): number | null {
  for (const b of brackets) {
    if (b.upTo === null || weightGrams <= toGrams(b.upTo)) return b.price;
  }
  return null;
}
