import type { ManualMethod, ManualMethodInput, SettingsFieldError } from '../settingsTypes';
import { MAX_MONEY_CENTS, formatCents, parseMoneyToCents } from './money';
import { TAX_OTHER, TAX_PRESETS, centsToText, parseDecimal } from './variantDraft';

/** One weight bracket as typed: `upTo` in kg (`''` = no limit, last row only), `price` in euros. */
export type BracketDraft = { upTo: string; price: string };

/** What the manual method modal edits: numbers kept as typed text until saved. */
export type ManualMethodDraft = {
  names: Record<string, string>;
  /** Countries the method ships to, in the order chosen. */
  markets: string[];
  /** Weight brackets per selected country. */
  brackets: Record<string, BracketDraft[]>;
  taxChoice: string;
  taxOther: string;
  active: boolean;
};

/** Error code per path: `name.<locale>`, `markets`, `rates.<CC>.<i>.upTo|price`, `tax`. */
export type ManualMethodErrors = Record<string, string>;

export const newBracketRows = (): BracketDraft[] => [{ upTo: '', price: '' }];

export function emptyManualMethodDraft(localeCodes: string[]): ManualMethodDraft {
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, ''])),
    markets: [],
    brackets: {},
    taxChoice: String(TAX_PRESETS[0]),
    taxOther: '',
    active: true,
  };
}

const kgToText = (kg: number, uiLocale: string) =>
  new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 3, useGrouping: false }).format(kg);

/** Only the countries that are still markets; stale ones in the stored rates are dropped. */
export function manualMethodToDraft(
  method: ManualMethod,
  localeCodes: string[],
  uiLocale: string,
  markets: string[]
): ManualMethodDraft {
  const preset = TAX_PRESETS.includes(method.tax);
  const stored = Object.keys(method.rates ?? {}).filter(
    (code) => markets.includes(code) && Array.isArray(method.rates[code])
  );
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, method.name[code] ?? ''])),
    markets: stored,
    brackets: Object.fromEntries(
      stored.map((code) => [
        code,
        method.rates[code].map((b) => ({
          upTo: b.upTo === null ? '' : kgToText(b.upTo, uiLocale),
          price: centsToText(b.price, uiLocale),
        })),
      ])
    ),
    taxChoice: preset ? String(method.tax) : TAX_OTHER,
    taxOther: preset ? '' : String(method.tax),
    active: method.active,
  };
}

/** Copies the brackets of `from` (deep) to every selected market. */
export function applyToAllMarkets(draft: ManualMethodDraft, from: string): ManualMethodDraft {
  const source = draft.brackets[from];
  if (!source) return draft;
  return {
    ...draft,
    brackets: Object.fromEntries(draft.markets.map((code) => [code, source.map((b) => ({ ...b }))])),
  };
}

/** Kilograms with at most 3 decimals, comma or dot; null when not that shape. */
function parseKg(text: string): number | null {
  const s = text.trim().replace(',', '.');
  return /^\d+(\.\d{1,3})?$/.test(s) ? Number(s) : null;
}

/** Validates the draft; returns the input only when there are no errors. */
export function draftToManualMethodInput(
  draft: ManualMethodDraft,
  defaultLocale: string
): { input?: ManualMethodInput; errors: ManualMethodErrors } {
  const errors: ManualMethodErrors = {};

  const name: Record<string, string> = {};
  Object.entries(draft.names).forEach(([code, text]) => {
    if (text.trim() !== '') name[code] = text.trim();
  });
  if (!name[defaultLocale]) errors[`name.${defaultLocale}`] = 'required';

  const rates: Record<string, { upTo: number | null; price: number }[]> = {};
  if (draft.markets.length === 0) errors.markets = 'required';
  draft.markets.forEach((code) => {
    const rows = draft.brackets[code] ?? [];
    if (rows.length === 0) {
      errors[`rates.${code}`] = 'required';
      return;
    }
    let previousGrams = 0;
    rates[code] = rows.map((row, i) => {
      const at = `rates.${code}.${i}`;
      let upTo: number | null = null;
      if (row.upTo.trim() === '') {
        if (i !== rows.length - 1) errors[`${at}.upTo`] = 'required';
      } else {
        const kg = parseKg(row.upTo);
        if (kg === null) errors[`${at}.upTo`] = 'invalid_number';
        else if (Math.round(kg * 1000) <= previousGrams) errors[`${at}.upTo`] = 'out_of_range';
        else {
          upTo = kg;
          previousGrams = Math.round(kg * 1000);
        }
      }
      const cents = parseMoneyToCents(row.price);
      if (cents === null) errors[`${at}.price`] = 'invalid_number';
      else if (cents > MAX_MONEY_CENTS) errors[`${at}.price`] = 'out_of_range';
      return { upTo, price: cents ?? 0 };
    });
  });

  const taxText = draft.taxChoice === TAX_OTHER ? draft.taxOther : draft.taxChoice;
  const tax = parseDecimal(taxText);
  if (taxText.trim() === '') errors.tax = 'required';
  else if (tax === null) errors.tax = 'invalid_number';
  else if (tax > 100) errors.tax = 'out_of_range';

  if (Object.keys(errors).length) return { errors };
  return { errors, input: { name, rates, tax: tax as number, active: draft.active } };
}

/** Server errors keyed like the draft errors; first error per path wins. */
export function manualMethodErrorMap(errors: SettingsFieldError[]): ManualMethodErrors {
  const map: ManualMethodErrors = {};
  errors.forEach(({ path, code }) => {
    if (!(path in map)) map[path] = code;
  });
  return map;
}

/** `"<country> <min>–<max>"` per country in rate order, joined by " · " (one price when equal). */
export function ratesSummary(
  method: Pick<ManualMethod, 'rates'>,
  uiLocale: string,
  countryName: (code: string) => string
): string {
  return Object.entries(method.rates ?? {})
    .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
    .map(([code, rows]) => {
      const prices = rows.map((b) => b.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const text =
        min === max
          ? formatCents(min, uiLocale)
          : `${formatCents(min, uiLocale)}–${formatCents(max, uiLocale)}`;
      return `${countryName(code)} ${text}`;
    })
    .join(' · ');
}
