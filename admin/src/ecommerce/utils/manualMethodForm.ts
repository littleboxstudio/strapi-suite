import type { ManualMethod, ManualMethodInput, SettingsFieldError } from '../settingsTypes';
import { parseMoneyToCents } from './money';
import { normalizeCountries } from './settingsForm';
import { TAX_OTHER, TAX_PRESETS, centsToText, parseDecimal } from './variantDraft';

/** What the manual method modal edits: numbers kept as typed text until saved. */
export type ManualMethodDraft = {
  names: Record<string, string>;
  price: string;
  taxChoice: string;
  taxOther: string;
  countries: string[];
  active: boolean;
};

/** Error code per path: `name.<locale>`, `price`, `tax`, `countries`. */
export type ManualMethodErrors = Record<string, string>;

export function emptyManualMethodDraft(localeCodes: string[]): ManualMethodDraft {
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, ''])),
    price: '',
    taxChoice: String(TAX_PRESETS[0]),
    taxOther: '',
    countries: ['PT'],
    active: true,
  };
}

export function manualMethodToDraft(
  method: ManualMethod,
  localeCodes: string[],
  uiLocale: string
): ManualMethodDraft {
  const preset = TAX_PRESETS.includes(method.tax);
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, method.name[code] ?? ''])),
    price: centsToText(method.price, uiLocale),
    taxChoice: preset ? String(method.tax) : TAX_OTHER,
    taxOther: preset ? '' : String(method.tax),
    countries: [...method.countries],
    active: method.active,
  };
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

  const price = parseMoneyToCents(draft.price);
  if (draft.price.trim() === '') errors.price = 'required';
  else if (price === null) errors.price = 'invalid_number';

  const taxText = draft.taxChoice === TAX_OTHER ? draft.taxOther : draft.taxChoice;
  const tax = parseDecimal(taxText);
  if (taxText.trim() === '') errors.tax = 'required';
  else if (tax === null) errors.tax = 'invalid_number';
  else if (tax > 100) errors.tax = 'out_of_range';

  const countries = normalizeCountries(draft.countries);
  if (countries.length === 0) errors.countries = 'required';

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: { name, price: price as number, tax: tax as number, countries, active: draft.active },
  };
}

/** Server errors keyed like the draft errors (`countries.2` → `countries`); first error wins. */
export function manualMethodErrorMap(errors: SettingsFieldError[]): ManualMethodErrors {
  const map: ManualMethodErrors = {};
  errors.forEach(({ path, code }) => {
    const key = path.startsWith('countries.') ? 'countries' : path;
    if (!(key in map)) map[key] = code;
  });
  return map;
}
