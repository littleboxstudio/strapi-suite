import type { SettingsErrorCode, SettingsFieldError, StoreSettings } from '../settingsTypes';

/** ISO 3166-1 alpha-2 country codes. */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const;

const COUNTRY_SET = new Set<string>(COUNTRY_CODES);

/** The store settings as the form keeps them: optional fields are empty strings, never null. */
export type StoreForm = {
  storeName: string;
  logoUrl: string;
  brandColor: string;
  storefrontUrl: string;
  paymentSuccessPath: string;
  paymentCancelPath: string;
  supportEmail: string;
  timezone: string;
  shippingCountries: string[];
};

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `#RRGGBB`, the only format the server accepts. */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Upper-cased, de-duplicated ISO country codes, in their first-seen order; anything else is dropped. */
export function normalizeCountries(values: string[]): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    const code = value.trim().toUpperCase();
    if (COUNTRY_SET.has(code) && !result.includes(code)) result.push(code);
  });
  return result;
}

/** Every country with its name in `locale`, sorted by name. */
export function countryOptions(locale: string): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale)
  );
}

/** The IANA time zones of the browser, plus `current` when the browser does not list it. */
export function timezoneOptions(current: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

const isTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isRelativePath = (value: string) => value.startsWith('/') && !value.startsWith('//');

export function storeFormFromSettings(settings: StoreSettings): StoreForm {
  return {
    storeName: settings.storeName,
    logoUrl: settings.logoUrl ?? '',
    brandColor: settings.brandColor,
    storefrontUrl: settings.storefrontUrl ?? '',
    paymentSuccessPath: settings.paymentSuccessPath,
    paymentCancelPath: settings.paymentCancelPath,
    supportEmail: settings.supportEmail ?? '',
    timezone: settings.timezone,
    shippingCountries: [...settings.shippingCountries],
  };
}

export function buildStoreSettingsInput(form: StoreForm): StoreSettings {
  const optional = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    storeName: form.storeName.trim(),
    logoUrl: optional(form.logoUrl),
    brandColor: form.brandColor.trim(),
    storefrontUrl: optional(form.storefrontUrl),
    paymentSuccessPath: form.paymentSuccessPath.trim(),
    paymentCancelPath: form.paymentCancelPath.trim(),
    supportEmail: optional(form.supportEmail),
    timezone: form.timezone,
    shippingCountries: normalizeCountries(form.shippingCountries),
  };
}

/** Client-side checks with the server's error codes; the server validates everything again. */
export function validateStoreForm(form: StoreForm): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];
  const push = (path: string, code: SettingsFieldError['code']) => errors.push({ path, code });
  const optionalUrl = (path: 'logoUrl' | 'storefrontUrl') => {
    const value = form[path].trim();
    if (value !== '' && !isValidHttpUrl(value)) push(path, 'invalid_url');
  };
  const requiredPath = (path: 'paymentSuccessPath' | 'paymentCancelPath') => {
    const value = form[path].trim();
    if (value === '') push(path, 'required');
    else if (!isRelativePath(value)) push(path, 'invalid_url');
  };

  if (form.storeName.trim() === '') push('storeName', 'required');
  optionalUrl('logoUrl');
  if (!isValidHexColor(form.brandColor.trim())) push('brandColor', 'invalid_color');
  optionalUrl('storefrontUrl');
  requiredPath('paymentSuccessPath');
  requiredPath('paymentCancelPath');
  const email = form.supportEmail.trim();
  if (email !== '' && !isEmail(email)) push('supportEmail', 'invalid_email');
  if (form.timezone === '' || !isTimezone(form.timezone)) push('timezone', 'invalid_timezone');
  if (normalizeCountries(form.shippingCountries).length === 0) push('shippingCountries', 'required');
  return errors;
}

/** `details.code` of a secret or e-mail error thrown by Strapi's fetch client, or null. */
export function extractErrorCode(err: unknown): SettingsErrorCode | null {
  const code = (err as any)?.response?.data?.error?.details?.code;
  return typeof code === 'string' ? (code as SettingsErrorCode) : null;
}
