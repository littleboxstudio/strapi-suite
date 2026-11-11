import { describe, it, expect } from 'vitest';
import {
  COUNTRY_CODES,
  buildStoreSettingsInput,
  countryOptions,
  extractErrorCode,
  isValidHexColor,
  marketInUseZones,
  isValidHttpUrl,
  normalizeCountries,
  storeFormFromSettings,
  timezoneOptions,
  validateStoreForm,
  type StoreForm,
} from '../../../admin/src/ecommerce/utils/settingsForm';
import type { StoreSettings } from '../../../admin/src/ecommerce/settingsTypes';

const SETTINGS: StoreSettings = {
  storeName: 'Littlebox',
  logo: null,
  brandColor: '#4945ff',
  storefrontUrl: 'https://shop.example.com',
  timezone: 'Europe/Lisbon',
  markets: ['PT'],
  supportEmail: null,
};

describe('isValidHttpUrl', () => {
  it('accepts http and https urls', () => {
    expect(isValidHttpUrl('https://shop.example.com')).toBe(true);
    expect(isValidHttpUrl('http://localhost:3000/logo.png')).toBe(true);
  });

  it('rejects other protocols, relative paths and garbage', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('/logo.png')).toBe(false);
    expect(isValidHttpUrl('example.com')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(isValidHttpUrl('  https://example.com  ')).toBe(true);
  });
});

describe('isValidHexColor', () => {
  it('accepts six-digit hex colours in any case', () => {
    expect(isValidHexColor('#4945ff')).toBe(true);
    expect(isValidHexColor('#ABCDEF')).toBe(true);
  });

  it('rejects short, alpha, named and unprefixed colours', () => {
    expect(isValidHexColor('#fff')).toBe(false);
    expect(isValidHexColor('#4945ff80')).toBe(false);
    expect(isValidHexColor('red')).toBe(false);
    expect(isValidHexColor('4945ff')).toBe(false);
    expect(isValidHexColor('#gggggg')).toBe(false);
  });
});

describe('normalizeCountries', () => {
  it('trims, upper-cases and removes duplicates keeping the first order', () => {
    expect(normalizeCountries([' pt', 'ES', 'pt', 'fr '])).toEqual(['PT', 'ES', 'FR']);
  });

  it('drops values that are not ISO 3166-1 alpha-2 countries', () => {
    expect(normalizeCountries(['PT', 'EU', 'ZZ', 'PRT', '', 'xx'])).toEqual(['PT']);
  });

  it('returns an empty list for an empty input', () => {
    expect(normalizeCountries([])).toEqual([]);
  });
});

describe('country and timezone options', () => {
  it('lists every ISO country once, sorted by the localized name', () => {
    const options = countryOptions('en');
    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(new Set(options.map((o) => o.code)).size).toBe(COUNTRY_CODES.length);
    expect(options.find((o) => o.code === 'PT')?.name).toBe('Portugal');
    const names = options.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('uses the admin locale for country names', () => {
    expect(countryOptions('pt').find((o) => o.code === 'DE')?.name).toBe('Alemanha');
  });

  it('always includes the current timezone', () => {
    expect(timezoneOptions('Europe/Lisbon')).toContain('Europe/Lisbon');
    expect(timezoneOptions('Etc/Custom')).toContain('Etc/Custom');
  });
});

describe('store form', () => {
  it('maps settings to a form with empty strings for nulls', () => {
    const form = storeFormFromSettings(SETTINGS);
    expect('logoUrl' in form).toBe(false);
    expect(form.supportEmail).toBe('');
    expect(form.storefrontUrl).toBe('https://shop.example.com');
  });

  it('builds the input with trimmed values and null for blank optional fields', () => {
    const form: StoreForm = {
      ...storeFormFromSettings(SETTINGS),
      storeName: '  Littlebox ',
      supportEmail: ' help@example.com ',
      markets: ['pt', 'PT', 'es'],
    };
    const input = buildStoreSettingsInput(form);
    expect(input.storeName).toBe('Littlebox');
    expect('logo' in input).toBe(false);
    expect('logoUrl' in input).toBe(false);
    expect(input.supportEmail).toBe('help@example.com');
    expect(input.markets).toEqual(['PT', 'ES']);
  });

  it('keeps the session lifetime of the loaded settings', () => {
    const loaded: StoreSettings = { ...SETTINGS, checkoutSessionTtlHours: 24 };
    const input = buildStoreSettingsInput(storeFormFromSettings(loaded));
    expect(input.checkoutSessionTtlHours).toBe(24);
  });

  it('never sends the storefront token id (only generate/regenerate set it)', () => {
    const loaded: StoreSettings = { ...SETTINGS, storefrontApiTokenId: 5, checkoutSessionTtlHours: 24 };
    const input = buildStoreSettingsInput(storeFormFromSettings(loaded));
    expect('storefrontApiTokenId' in input).toBe(false);
  });

  it('does not invent the session lifetime when it was not loaded', () => {
    const input = buildStoreSettingsInput(storeFormFromSettings(SETTINGS));
    expect('checkoutSessionTtlHours' in input).toBe(false);
  });

  it('accepts valid settings', () => {
    expect(validateStoreForm(storeFormFromSettings(SETTINGS))).toEqual([]);
  });

  it('reports every invalid field with the server error codes', () => {
    const form: StoreForm = {
      storeName: ' ',
      brandColor: '#fff',
      storefrontUrl: 'ftp://shop',
      supportEmail: 'nope',
      timezone: '',
      markets: [],
    };
    expect(validateStoreForm(form)).toEqual([
      { path: 'storeName', code: 'required' },
      { path: 'brandColor', code: 'invalid_color' },
      { path: 'storefrontUrl', code: 'invalid_url' },
      { path: 'supportEmail', code: 'invalid_email' },
      { path: 'timezone', code: 'invalid_timezone' },
      { path: 'markets', code: 'required' },
    ]);
  });
});

describe('marketInUseZones', () => {
  it('returns the zone names of the MARKET_IN_USE errors', () => {
    expect(
      marketInUseZones([
        { path: 'markets', code: 'MARKET_IN_USE', detail: 'Ibéria' },
        { path: 'x', code: 'required' },
      ])
    ).toEqual(['Ibéria']);
    expect(marketInUseZones([])).toEqual([]);
  });
});

describe('extractErrorCode', () => {
  it('reads details.code from a Strapi error envelope', () => {
    const err = { response: { data: { error: { details: { code: 'ENCRYPTION_KEY_MISSING' } } } } };
    expect(extractErrorCode(err)).toBe('ENCRYPTION_KEY_MISSING');
  });

  it('returns null when there is no code', () => {
    expect(extractErrorCode(new Error('boom'))).toBeNull();
    expect(extractErrorCode({ response: { data: { error: { details: {} } } } })).toBeNull();
  });
});
