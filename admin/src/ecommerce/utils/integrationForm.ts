import type {
  IntegrationInput,
  IntegrationView,
  ProviderField,
  SettingsFieldError,
} from '../settingsTypes';

/** What the configure modal edits: booleans as booleans, everything else as typed text. */
export type IntegrationFormValues = Record<string, string | boolean>;

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
    if (field.type === 'boolean') values[field.key] = stored === true;
    else values[field.key] = stored === undefined || stored === null ? '' : String(stored);
  });
  return values;
}

/**
 * The `PUT /integrations/:id` body. Blank secrets are left out (the server keeps the stored
 * value), integer text becomes a number, and blank config values are sent as null to clear them.
 */
export function buildIntegrationPayload(
  fields: ProviderField[],
  values: IntegrationFormValues
): IntegrationInput {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};

  fields.forEach((field) => {
    const value = values[field.key];
    if (field.type === 'secret') {
      if (typeof value === 'string' && value.trim() !== '') secrets[field.key] = value.trim();
      return;
    }
    if (field.type === 'boolean') {
      config[field.key] = value === true;
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
