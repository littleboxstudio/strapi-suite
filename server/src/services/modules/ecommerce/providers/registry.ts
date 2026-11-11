import stripe from './definitions/stripe';
import moloni from './definitions/moloni';
import cttExpresso from './definitions/ctt-expresso';
import manual from './definitions/manual';
import resend from './definitions/resend';

export type ProviderCategory = 'payment' | 'billing' | 'carrier' | 'email';

export type ProviderField = {
  key: string;
  type: 'string' | 'secret' | 'boolean' | 'number' | 'select';
  required: boolean;
  default?: unknown;
  options?: string[];
  /** Extra validation for `string` fields. */
  format?: 'email';
  /** Admin i18n key */
  label: string;
};

export type ProviderRuntime = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type ConnectionResult = {
  ok: boolean;
  code?: 'INVALID_CREDENTIALS' | 'UNREACHABLE' | 'NOT_IMPLEMENTED' | 'MISSING_FIELDS';
  message?: string;
};

export type ProviderDefinition = {
  id: string;
  category: ProviderCategory;
  name: string;
  fields: ProviderField[];
  /** billing = true */
  exclusive: boolean;
  /** false = shown as "not verified" */
  verified: boolean;
  testConnection?(rt: ProviderRuntime): Promise<ConnectionResult>;
};

const builtIns = (): ProviderDefinition[] => [stripe, moloni, cttExpresso, manual, resend];

let definitions = new Map<string, ProviderDefinition>(builtIns().map((d) => [d.id, d]));

export function getProviderDefinitions(): ProviderDefinition[] {
  return [...definitions.values()];
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return definitions.get(id);
}

export function registerProvider(def: ProviderDefinition): void {
  if (definitions.has(def.id)) {
    throw new Error(`Provider "${def.id}" is already registered`);
  }
  definitions.set(def.id, def);
}

/** Test helper: restores the built-in definitions. */
export function __resetRegistryForTests(): void {
  definitions = new Map(builtIns().map((d) => [d.id, d]));
}

export type ProviderInputIssue = {
  path: string;
  code: 'required' | 'invalid_option' | 'invalid_number' | 'invalid_email';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function validateProviderInput(
  def: ProviderDefinition,
  input: { config?: Record<string, unknown>; secrets?: Record<string, string> },
  hasStoredSecret: (key: string) => boolean
): ProviderInputIssue[] {
  const issues: ProviderInputIssue[] = [];
  const config = input.config ?? {};
  const secrets = input.secrets ?? {};

  for (const field of def.fields) {
    if (field.type === 'secret') {
      const provided = !isEmpty(secrets[field.key]);
      if (field.required && !provided && !hasStoredSecret(field.key)) {
        issues.push({ path: `secrets.${field.key}`, code: 'required' });
      }
      continue;
    }

    const path = `config.${field.key}`;
    const value = config[field.key];
    if (field.type === 'boolean') {
      if (field.required && typeof value !== 'boolean') issues.push({ path, code: 'required' });
      continue;
    }
    if (isEmpty(value)) {
      if (field.required) issues.push({ path, code: 'required' });
      continue;
    }
    if (field.type === 'number') {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
      if (!Number.isInteger(n)) issues.push({ path, code: 'invalid_number' });
    } else if (field.type === 'string' && field.format === 'email') {
      if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) issues.push({ path, code: 'invalid_email' });
    } else if (field.type === 'select') {
      if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
        issues.push({ path, code: 'invalid_option' });
      }
    }
  }
  return issues;
}
