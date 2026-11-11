import type { SettingsFieldError, ShippingZone, ShippingZoneInput } from '../settingsTypes';
import { countryOptions, normalizeCountries } from './settingsForm';

/** What the zone modal edits. */
export type ZoneDraft = { name: string; countries: string[] };

export function emptyZoneDraft(): ZoneDraft {
  return { name: '', countries: [] };
}

export function zoneToDraft(zone: ShippingZone): ZoneDraft {
  return { name: zone.name, countries: [...zone.countries] };
}

/** Validates the draft; returns the input only when there are no errors. */
export function draftToZoneInput(draft: ZoneDraft): {
  input?: ShippingZoneInput;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === '') errors.name = 'required';
  const countries = normalizeCountries(draft.countries);
  if (countries.length === 0) errors.countries = 'required';
  if (Object.keys(errors).length) return { errors };
  return { errors, input: { name, countries } };
}

/**
 * Server errors keyed like the draft (`countries.2` → `countries`, first error wins), plus the
 * names of the zones that already hold some of the countries (`ZONE_COUNTRY_CONFLICT`).
 */
export function zoneErrorMap(errors: SettingsFieldError[]): {
  fields: Record<string, string>;
  conflictZones: string[];
} {
  const fields: Record<string, string> = {};
  const conflictZones: string[] = [];
  errors.forEach(({ path, code, detail }) => {
    const key = path.split('.')[0];
    if (!(key in fields)) fields[key] = code;
    if (code === 'ZONE_COUNTRY_CONFLICT' && typeof detail === 'string' && !conflictZones.includes(detail)) {
      conflictZones.push(detail);
    }
  });
  return { fields, conflictZones };
}

/** The zone's country names in `locale`, in the zone's order, separated by ", ". */
export function zoneCountriesSummary(zone: Pick<ShippingZone, 'countries'>, locale: string): string {
  const names = new Map(countryOptions(locale).map((o) => [o.code, o.name]));
  return zone.countries.map((code) => names.get(code) ?? code).join(', ');
}

/**
 * The countries a zone can choose: the markets not held by another zone, plus the zone's own
 * stored countries (even outside the markets, so they can be removed).
 */
export function zoneCountryChoices(
  markets: string[],
  zone: Pick<ShippingZone, 'id' | 'countries'> | null,
  zones: Pick<ShippingZone, 'id' | 'countries'>[]
): Set<string> {
  const taken = new Set(zones.filter((z) => z.id !== zone?.id).flatMap((z) => z.countries));
  return new Set([...markets.filter((code) => !taken.has(code)), ...(zone?.countries ?? [])]);
}
