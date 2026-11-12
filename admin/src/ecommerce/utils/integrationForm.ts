import type {
  IntegrationInput,
  IntegrationView,
  LookupOption,
  ProviderField,
  SettingsFieldError,
} from '../settingsTypes';

/**
 * What the configure modal edits: booleans as booleans, country codes as a list,
 * everything else as typed text.
 */
export type IntegrationFormValues = Record<string, string | boolean | string[]>;

/** Digits only; the empty string is allowed while typing. */
export function isIntegerText(text: string): boolean {
  return /^\d*$/.test(text);
}

/** Initial form values: stored config (or the field default) and empty secrets. */
export function integrationFormFromView(view: IntegrationView): IntegrationFormValues {
  const values: IntegrationFormValues = {};
  view.fields.forEach((field) => {
    if (field.type === 'secret') {
      values[field.key] = '';
      return;
    }
    const stored = view.config[field.key] ?? field.default;
    if (field.type === 'markets') {
      values[field.key] = Array.isArray(stored) ? stored.map((code) => String(code)) : [];
      return;
    }
    if (field.type === 'boolean') values[field.key] = stored === true;
    else values[field.key] = stored === undefined || stored === null ? '' : String(stored);
  });
  return values;
}

/**
 * The `PUT /integrations/:id` body. Blank secrets are left out (the server keeps the stored
 * value) unless listed in `clearedSecrets` (optional ones only), which are sent as null to delete
 * them; integer text becomes a number, and blank config values are sent as null to clear them.
 */
export function buildIntegrationPayload(
  fields: ProviderField[],
  values: IntegrationFormValues,
  clearedSecrets: string[] = []
): IntegrationInput {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string | null> = {};

  fields.forEach((field) => {
    const value = values[field.key];
    if (field.type === 'secret') {
      if (typeof value === 'string' && value.trim() !== '') secrets[field.key] = value.trim();
      else if (!field.required && clearedSecrets.includes(field.key)) secrets[field.key] = null;
      return;
    }
    if (field.type === 'boolean') {
      config[field.key] = value === true;
      return;
    }
    if (field.type === 'markets') {
      config[field.key] = Array.isArray(value) ? [...value] : [];
      return;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') config[field.key] = null;
    else if (field.type === 'number' && /^\d+$/.test(text)) config[field.key] = Number(text);
    else config[field.key] = text;
  });

  return { config, secrets };
}

/** First error code per field key (`config.companyId`, `secrets.password` → the key). */
export function integrationErrorMap(errors: SettingsFieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  errors.forEach(({ path, code }) => {
    const key = path.split('.')[1] ?? path;
    if (!(key in map)) map[key] = code;
  });
  return map;
}

/**
 * A storefront path: one leading `/`; no spaces, backslashes, query or fragment (same rule as the
 * server).
 */
const isStorefrontPath = (text: string) => /^\/(?!\/)[^\s\\?#]*$/.test(text);

/**
 * Client-side checks keyed by field key, with the server's error codes. Blank values are left to
 * the server, except a required `markets` field with no market on an active integration (like the
 * server, required fields only block saving while the integration is active).
 */
export function validateIntegrationForm(
  fields: ProviderField[],
  values: IntegrationFormValues,
  active = false
): Record<string, string> {
  const errors: Record<string, string> = {};
  fields.forEach((field) => {
    if (field.type === 'markets') {
      const value = values[field.key];
      if (active && field.required && (!Array.isArray(value) || value.length === 0)) {
        errors[field.key] = 'required';
      }
      return;
    }
    if (field.type !== 'string' || field.format !== 'path') return;
    const value = values[field.key];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text !== '' && !isStorefrontPath(text)) errors[field.key] = 'invalid_path';
  });
  return errors;
}

/**
 * Whether the field shows as required. A text field with a default is not: left blank, the
 * server restores the default.
 */
export function showsAsRequired(field: ProviderField): boolean {
  if (!field.required) return false;
  return !(typeof field.default === 'string' && field.default !== '');
}

/** True when the provider is configured in two steps: credentials first, then the rest. */
export function hasCredentialsStep(fields: ProviderField[]): boolean {
  return fields.some((f) => f.group === 'credentials');
}

/** The fields of one step of a two-step form. */
export function stepFields(fields: ProviderField[], step: 'credentials' | 'details'): ProviderField[] {
  return fields.filter((f) => (f.group === 'credentials') === (step === 'credentials'));
}

/** Every required credential is stored (secrets) or saved in the config. */
export function credentialsSaved(view: IntegrationView): boolean {
  return stepFields(view.fields, 'credentials').every((field) => {
    if (!field.required) return true;
    if (field.type === 'secret') return !!view.secrets[field.key];
    const value = view.config[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

/**
 * Required credentials left empty in the form and not already stored. A blank secret keeps the
 * stored one, so it only counts when nothing is stored.
 */
export function missingCredentials(view: IntegrationView, values: IntegrationFormValues): string[] {
  return stepFields(view.fields, 'credentials')
    .filter((field) => {
      if (!field.required) return false;
      const value = values[field.key];
      const filled = typeof value === 'string' && value.trim() !== '';
      return field.type === 'secret' ? !filled && !view.secrets[field.key] : !filled;
    })
    .map((field) => field.key);
}

/**
 * The options for a lookup field. A saved value missing from the provider's list (deleted there,
 * or another company) is kept as an extra option, labelled by `unknownLabel`, so it is not lost.
 */
export function lookupFieldOptions(
  list: LookupOption[],
  current: string,
  unknownLabel: (value: string) => string
): LookupOption[] {
  if (current === '' || list.some((o) => o.value === current)) return list;
  return [...list, { value: current, label: unknownLabel(current) }];
}
