import { describe, it, expect } from 'vitest';
import {
  draftToZoneInput,
  emptyZoneDraft,
  zoneCountriesSummary,
  zoneErrorMap,
  zoneToDraft,
} from '../../../admin/src/ecommerce/utils/shippingZoneForm';

describe('shipping zone form', () => {
  it('starts empty', () => {
    expect(emptyZoneDraft()).toEqual({ name: '', countries: [] });
  });

  it('copies a stored zone into a draft', () => {
    const draft = zoneToDraft({ id: 1, name: 'Ilhas', countries: ['PT'], position: 1 });
    expect(draft).toEqual({ name: 'Ilhas', countries: ['PT'] });
  });

  it('trims the name and normalizes the countries', () => {
    const result = draftToZoneInput({ name: ' Ilhas ', countries: ['pt', 'PT'] });
    expect(result.errors).toEqual({});
    expect(result.input).toEqual({ name: 'Ilhas', countries: ['PT'] });
  });

  it('requires a name and at least one country', () => {
    const result = draftToZoneInput({ name: '', countries: [] });
    expect(result.input).toBeUndefined();
    expect(result.errors).toEqual({ name: 'required', countries: 'required' });
  });

  it('collapses countries.N and gathers the conflicting zones without repeats', () => {
    expect(
      zoneErrorMap([
        { path: 'countries.0', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Continente' },
        { path: 'countries.1', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Continente' },
      ])
    ).toEqual({ fields: { countries: 'ZONE_COUNTRY_CONFLICT' }, conflictZones: ['Continente'] });
  });

  it('keeps the first error per field', () => {
    expect(
      zoneErrorMap([
        { path: 'name', code: 'too_long' },
        { path: 'countries.0', code: 'not_in_market' },
        { path: 'countries.1', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Ilhas' },
      ])
    ).toEqual({ fields: { name: 'too_long', countries: 'not_in_market' }, conflictZones: ['Ilhas'] });
  });

  it('lists the country names of a zone', () => {
    expect(zoneCountriesSummary({ countries: ['PT', 'ES'] }, 'en')).toBe('Portugal, Spain');
  });
});
