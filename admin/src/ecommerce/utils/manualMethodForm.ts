import type {
  ManualMethod,
  ManualMethodInput,
  SettingsFieldError,
  ShippingZone,
} from '../settingsTypes';
import { formatCents, parseMoneyToCents } from './money';
import { TAX_OTHER, TAX_PRESETS, centsToText, parseDecimal } from './variantDraft';

/** What the manual method modal edits: numbers kept as typed text until saved. */
export type ManualMethodDraft = {
  names: Record<string, string>;
  /** Price per shipping zone id, as typed; blank = not offered in that zone. */
  rates: Record<string, string>;
  taxChoice: string;
  taxOther: string;
  active: boolean;
};

/** Error code per path: `name.<locale>`, `rates`, `rates.<zoneId>`, `tax`. */
export type ManualMethodErrors = Record<string, string>;

export function emptyManualMethodDraft(localeCodes: string[], zones: ShippingZone[]): ManualMethodDraft {
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, ''])),
    rates: Object.fromEntries(zones.map((zone) => [String(zone.id), ''])),
    taxChoice: String(TAX_PRESETS[0]),
    taxOther: '',
    active: true,
  };
}

export function manualMethodToDraft(
  method: ManualMethod,
  localeCodes: string[],
  uiLocale: string,
  zones: ShippingZone[]
): ManualMethodDraft {
  const preset = TAX_PRESETS.includes(method.tax);
  return {
    names: Object.fromEntries(localeCodes.map((code) => [code, method.name[code] ?? ''])),
    rates: Object.fromEntries(
      zones.map((zone) => {
        const cents = method.rates[String(zone.id)];
        return [String(zone.id), typeof cents === 'number' ? centsToText(cents, uiLocale) : ''];
      })
    ),
    taxChoice: preset ? String(method.tax) : TAX_OTHER,
    taxOther: preset ? '' : String(method.tax),
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

  const rates: Record<string, number> = {};
  let typed = 0;
  Object.entries(draft.rates).forEach(([zoneId, text]) => {
    if (text.trim() === '') return;
    typed += 1;
    const cents = parseMoneyToCents(text);
    if (cents === null) errors[`rates.${zoneId}`] = 'invalid_number';
    else rates[zoneId] = cents;
  });
  if (typed === 0) errors.rates = 'required';

  const taxText = draft.taxChoice === TAX_OTHER ? draft.taxOther : draft.taxChoice;
  const tax = parseDecimal(taxText);
  if (taxText.trim() === '') errors.tax = 'required';
  else if (tax === null) errors.tax = 'invalid_number';
  else if (tax > 100) errors.tax = 'out_of_range';

  if (Object.keys(errors).length) return { errors };
  return { errors, input: { name, rates, tax: tax as number, active: draft.active } };
}

/** Server errors keyed like the draft errors (`rates.<zoneId>` kept per zone); first error wins. */
export function manualMethodErrorMap(errors: SettingsFieldError[]): ManualMethodErrors {
  const map: ManualMethodErrors = {};
  errors.forEach(({ path, code }) => {
    if (!(path in map)) map[path] = code;
  });
  return map;
}

/** `"<zone> <price>"` in zone order, joined by " · "; zones without a price are left out. */
export function ratesSummary(
  method: Pick<ManualMethod, 'rates'>,
  zones: Pick<ShippingZone, 'id' | 'name'>[],
  uiLocale: string
): string {
  return zones
    .filter((zone) => typeof method.rates[String(zone.id)] === 'number')
    .map((zone) => `${zone.name} ${formatCents(method.rates[String(zone.id)], uiLocale)}`)
    .join(' · ');
}
