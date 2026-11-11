import type { Core } from '@strapi/strapi';
import { isValidEmailFormat } from './domain/email';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  ConnectionResult,
  ProviderCategory,
  ProviderDefinition,
  ProviderField,
  ProviderRuntime,
  getProviderDefinition,
  getProviderDefinitions,
  validateProviderInput,
} from './providers/registry';
import {
  EncryptedValue,
  decryptSecret,
  encryptSecret,
  isMaskedEcho,
  maskSecret,
  resolveEncryptionKey,
} from './secrets';
import {
  EcommerceNotFoundError,
  EcommerceSecretError,
  EcommerceValidationError,
  ValidationIssue,
} from './errors';
import type { AuditEntry } from './audit';

const AREA = 'settings';
const RUNTIME_TTL_MS = 60_000;

export type IntegrationView = {
  id: string;
  category: ProviderCategory;
  name: string;
  active: boolean;
  verified: boolean;
  fields: ProviderField[];
  config: Record<string, unknown>;
  /** Masked values; null when not set or unreadable. */
  secrets: Record<string, string | null>;
  secretsStatus: 'ok' | 'unreadable' | 'none';
  encryptionKeyConfigured: boolean;
};

export type IntegrationInput = {
  config?: Record<string, unknown>;
  /** A blank or omitted secret keeps the stored value; null clears a stored optional secret. */
  secrets?: Record<string, string | null>;
};

export type StoreSettings = {
  storeName: string;
  logoUrl: string | null;
  brandColor: string;
  storefrontUrl: string | null;
  paymentSuccessPath: string;
  paymentCancelPath: string;
  timezone: string;
  shippingCountries: string[];
  supportEmail: string | null;
  storefrontApiTokenId: number | null;
  checkoutSessionTtlHours: number;
};

export const STORE_SETTINGS_DEFAULTS: StoreSettings = {
  storeName: '',
  logoUrl: null,
  brandColor: '#4945ff',
  storefrontUrl: null,
  paymentSuccessPath: '/checkout/success',
  paymentCancelPath: '/checkout/cancel',
  timezone: 'Europe/Lisbon',
  shippingCountries: ['PT'],
  supportEmail: null,
  storefrontApiTokenId: null,
  checkoutSessionTtlHours: 168,
};

export type ManualMethod = {
  id: number;
  name: Record<string, string>;
  price: number;
  tax: number;
  countries: string[];
  active: boolean;
  position: number;
};

export type ManualMethodInput = Partial<Omit<ManualMethod, 'id'>>;

type IntegrationRow = {
  id: number;
  providerId: string;
  category: ProviderCategory;
  active: boolean;
  config: Record<string, unknown> | null;
  secrets: Record<string, EncryptedValue> | null;
};

type DecryptedSecrets = { values: Record<string, string>; unreadable: boolean };

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const isTimezone = (v: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

// CLDR region codes that are not countries (groupings, pseudo-locales, "Unknown Region").
const NON_COUNTRY_REGIONS = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
let regionNames: Intl.DisplayNames | null = null;
const isCountry = (v: unknown): boolean => {
  if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v) || NON_COUNTRY_REGIONS.has(v)) return false;
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  try {
    return regionNames.of(v) !== undefined;
  } catch {
    return false;
  }
};

/** True for values shaped like a mask (`********`, `sk_********9876`): never accepted as a secret. */
const isMaskShaped = (v: string) => maskSecret(v) === v || /^.{0,3}\*{8}.{0,4}$/.test(v);

export const isEmail = (v: string) => isValidEmailFormat(v);

function validateCountries(value: unknown, path: string, errors: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    errors.push({ path, code: 'invalid_country' });
    return;
  }
  if (value.length === 0) errors.push({ path, code: 'required' });
  value.forEach((c, i) => {
    if (!isCountry(c)) errors.push({ path: `${path}.${i}`, code: 'invalid_country' });
  });
}

/** Validates a store settings patch and returns the normalized values to persist. */
function normalizeStorePatch(patch: Record<string, unknown>): {
  values: Partial<StoreSettings>;
  errors: ValidationIssue[];
} {
  const errors: ValidationIssue[] = [];
  const values: Record<string, unknown> = {};
  const has = (k: keyof StoreSettings) => Object.prototype.hasOwnProperty.call(patch, k);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

  if (has('storeName')) {
    const v = str(patch.storeName);
    if (typeof v !== 'string' || v === '') errors.push({ path: 'storeName', code: 'required' });
    else values.storeName = v;
  }
  for (const key of ['logoUrl', 'storefrontUrl'] as const) {
    if (!has(key)) continue;
    const v = str(patch[key]);
    if (isBlank(v)) values[key] = null;
    else if (typeof v !== 'string' || !isHttpUrl(v)) errors.push({ path: key, code: 'invalid_url' });
    else values[key] = v;
  }
  for (const key of ['paymentSuccessPath', 'paymentCancelPath'] as const) {
    if (!has(key)) continue;
    const v = str(patch[key]);
    if (isBlank(v)) errors.push({ path: key, code: 'required' });
    else if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//'))
      errors.push({ path: key, code: 'invalid_url' });
    else values[key] = v;
  }
  if (has('brandColor')) {
    const v = str(patch.brandColor);
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errors.push({ path: 'brandColor', code: 'invalid_color' });
    else values.brandColor = v;
  }
  if (has('timezone')) {
    const v = str(patch.timezone);
    if (typeof v !== 'string' || v === '' || !isTimezone(v)) errors.push({ path: 'timezone', code: 'invalid_timezone' });
    else values.timezone = v;
  }
  if (has('shippingCountries')) {
    const before = errors.length;
    validateCountries(patch.shippingCountries, 'shippingCountries', errors);
    if (errors.length === before) values.shippingCountries = [...new Set(patch.shippingCountries as string[])];
  }
  if (has('supportEmail')) {
    const v = str(patch.supportEmail);
    if (isBlank(v)) values.supportEmail = null;
    else if (typeof v !== 'string' || !isEmail(v)) errors.push({ path: 'supportEmail', code: 'invalid_email' });
    else values.supportEmail = v;
  }
  if (has('storefrontApiTokenId')) {
    const v = patch.storefrontApiTokenId;
    if (v === null || v === undefined) values.storefrontApiTokenId = null;
    else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) errors.push({ path: 'storefrontApiTokenId', code: 'invalid_token' });
    else values.storefrontApiTokenId = v;
  }
  if (has('checkoutSessionTtlHours')) {
    const v = patch.checkoutSessionTtlHours;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 720)
      errors.push({ path: 'checkoutSessionTtlHours', code: 'invalid_number' });
    else values.checkoutSessionTtlHours = v;
  }
  return { values: values as Partial<StoreSettings>, errors };
}

/**
 * `store-setting.value` is a json column. MariaDB/MySQL enforce CHECK(json_valid(value)) and the
 * Query Engine passes strings through unencoded, so every value is stored as `{ v: <value> }`.
 */
const wrapStoreValue = (value: unknown): { v: unknown } => ({ v: value ?? null });

/** Unwraps `{ v }`; rows written before the wrapper existed hold the raw value. */
const unwrapStoreValue = (stored: unknown): unknown =>
  stored && typeof stored === 'object' && !Array.isArray(stored) && 'v' in stored
    ? (stored as { v: unknown }).v
    : stored;

function normalizeManualMethod(
  input: ManualMethodInput,
  defaultLocale: string
): { values: Omit<ManualMethod, 'id' | 'position'> & { position?: number }; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];

  const name: Record<string, string> = {};
  if (input.name && typeof input.name === 'object' && !Array.isArray(input.name)) {
    for (const [locale, text] of Object.entries(input.name)) {
      if (typeof text === 'string' && text.trim() !== '') name[locale] = text.trim();
    }
  }
  if (!name[defaultLocale]) errors.push({ path: `name.${defaultLocale}`, code: 'required' });

  const price = input.price;
  if (price === undefined || price === null) errors.push({ path: 'price', code: 'required' });
  else if (typeof price !== 'number' || !Number.isInteger(price)) errors.push({ path: 'price', code: 'invalid_number' });
  else if (price < 0) errors.push({ path: 'price', code: 'out_of_range' });

  const tax = input.tax ?? 23;
  if (typeof tax !== 'number' || !Number.isFinite(tax)) errors.push({ path: 'tax', code: 'invalid_number' });
  else if (tax < 0 || tax > 100) errors.push({ path: 'tax', code: 'out_of_range' });

  const countries = input.countries ?? ['PT'];
  validateCountries(countries, 'countries', errors);

  const position = input.position;
  if (position !== undefined && position !== null && (typeof position !== 'number' || !Number.isInteger(position))) {
    errors.push({ path: 'position', code: 'invalid_number' });
  }

  return {
    values: {
      name,
      price: price as number,
      tax: tax as number,
      countries: Array.isArray(countries) ? [...new Set(countries)] : [],
      active: input.active === undefined ? true : Boolean(input.active),
      ...(typeof position === 'number' ? { position } : {}),
    },
    errors,
  };
}

const toManualMethod = (r: any): ManualMethod => ({
  id: r.id,
  name: r.name ?? {},
  price: r.price ?? 0,
  tax: r.tax === null || r.tax === undefined ? 23 : Number(r.tax),
  countries: r.countries ?? ['PT'],
  active: r.active ?? true,
  position: r.position ?? 0,
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const EcommerceSettingsService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const audit = (entry: AuditEntry): Promise<void> =>
    strapi.plugin(PLUGIN_ID).service('EcommerceAuditService').log(entry);
  const getDefaultLocale = async (): Promise<string> =>
    strapi.plugin('i18n').service('locales').getDefaultLocale();

  const runtimeCache = new Map<string, { value: ProviderRuntime & { active: boolean }; expiresAt: number }>();
  // Bumped on every invalidation so a read that started before it cannot repopulate the cache.
  let cacheGeneration = 0;
  const invalidate = () => {
    cacheGeneration += 1;
    runtimeCache.clear();
  };
  const copyRuntime = (rt: ProviderRuntime & { active: boolean }) => ({
    config: { ...rt.config },
    secrets: { ...rt.secrets },
    active: rt.active,
  });

  const requireDefinition = (id: string): ProviderDefinition => {
    const def = getProviderDefinition(id);
    if (!def) throw new EcommerceNotFoundError('Integration not found');
    return def;
  };

  const findRow = async (providerId: string): Promise<IntegrationRow | null> =>
    strapi.db.query(uids().integration).findOne({ where: { providerId } });

  const decryptAll = (stored: Record<string, EncryptedValue> | null, key: Buffer | null): DecryptedSecrets => {
    const values: Record<string, string> = {};
    let unreadable = false;
    for (const [k, enc] of Object.entries(stored ?? {})) {
      if (!enc) continue;
      if (!key) {
        unreadable = true;
        continue;
      }
      try {
        values[k] = decryptSecret(enc, key);
      } catch {
        unreadable = true;
      }
    }
    return { values, unreadable };
  };

  const configWithDefaults = (def: ProviderDefinition, stored: Record<string, unknown> | null) => {
    const config: Record<string, unknown> = {};
    for (const field of def.fields) {
      if (field.type === 'secret') continue;
      const value = stored?.[field.key];
      if (value !== undefined && value !== null) config[field.key] = value;
      else if (field.default !== undefined) config[field.key] = field.default;
    }
    return config;
  };

  const toView = (def: ProviderDefinition, row: IntegrationRow | null, key: Buffer | null): IntegrationView => {
    const { values, unreadable } = decryptAll(row?.secrets ?? null, key);
    const secrets: Record<string, string | null> = {};
    for (const field of def.fields) {
      if (field.type === 'secret') secrets[field.key] = maskSecret(values[field.key] ?? null);
    }
    const hasStored = Object.values(row?.secrets ?? {}).some(Boolean);
    return {
      id: def.id,
      category: def.category,
      name: def.name,
      active: row?.active ?? false,
      verified: def.verified,
      fields: def.fields,
      config: configWithDefaults(def, row?.config ?? null),
      secrets,
      secretsStatus: !hasStored ? 'none' : unreadable ? 'unreadable' : 'ok',
      encryptionKeyConfigured: key !== null,
    };
  };

  const buildRuntime = (def: ProviderDefinition, row: IntegrationRow | null) => ({
    config: configWithDefaults(def, row?.config ?? null),
    secrets: decryptAll(row?.secrets ?? null, resolveEncryptionKey(strapi)).values,
  });

  /** Normalizes a non-secret config value for storage (numbers from strings, trimmed strings). */
  const normalizeConfigValue = (field: ProviderField, value: unknown): unknown => {
    if (isBlank(value)) return undefined;
    if (field.type === 'number' && typeof value === 'string') return Number(value.trim());
    if (typeof value === 'string') return value.trim();
    return value;
  };

  const getStoreSettings = async (): Promise<StoreSettings> => {
    const rows: { key: string; value: unknown }[] = await strapi.db.query(uids().storeSetting).findMany({});
    const settings: Record<string, unknown> = { ...STORE_SETTINGS_DEFAULTS };
    for (const r of rows) {
      if (!(r.key in STORE_SETTINGS_DEFAULTS)) continue;
      const value = unwrapStoreValue(r.value);
      if (value !== undefined) settings[r.key] = value;
    }
    return settings as StoreSettings;
  };

  return {
    async listIntegrations(): Promise<IntegrationView[]> {
      const rows: IntegrationRow[] = await strapi.db.query(uids().integration).findMany({});
      const byId = new Map(rows.map((r) => [r.providerId, r]));
      const key = resolveEncryptionKey(strapi);
      return getProviderDefinitions().map((def) => toView(def, byId.get(def.id) ?? null, key));
    },

    async updateIntegration(id: string, input: IntegrationInput, userId?: string | number): Promise<IntegrationView> {
      const def = requireDefinition(id);
      const row = await findRow(id);
      const key = resolveEncryptionKey(strapi);
      const storedSecrets = row?.secrets ?? {};
      const { values: plainStored } = decryptAll(storedSecrets, key);

      // Secrets: empty values and echoes of the stored mask keep the stored value; null clears.
      const newSecrets: Record<string, string> = {};
      const cleared: string[] = [];
      const clearIssues: ValidationIssue[] = [];
      for (const field of def.fields) {
        if (field.type !== 'secret') continue;
        const v = input.secrets?.[field.key];
        if (v === null) {
          if (field.required) clearIssues.push({ path: `secrets.${field.key}`, code: 'required' });
          else if (storedSecrets[field.key]) cleared.push(field.key);
          continue;
        }
        if (typeof v !== 'string' || v.trim() === '') continue;
        const stored = plainStored[field.key];
        if (stored !== undefined && isMaskedEcho(v, stored)) continue;
        // A mask-shaped value is an echo of a mask we cannot verify (unreadable or absent): keep stored.
        if (isMaskShaped(v)) continue;
        newSecrets[field.key] = v;
      }

      // Config: patch on top of the stored values, limited to declared fields.
      const nextConfig: Record<string, unknown> = { ...(row?.config ?? {}) };
      for (const field of def.fields) {
        if (field.type === 'secret' || !input.config || !(field.key in input.config)) continue;
        nextConfig[field.key] = input.config[field.key];
      }

      if (clearIssues.length) throw new EcommerceValidationError('Invalid settings', clearIssues);

      const issues = validateProviderInput(
        def,
        { config: configWithDefaults(def, nextConfig), secrets: newSecrets },
        (k) => Boolean(storedSecrets[k])
      );
      // Missing required fields only block saving an active integration; activation checks them.
      const blocking = row?.active ? issues : issues.filter((i) => i.code !== 'required');
      if (blocking.length) throw new EcommerceValidationError('Invalid settings', blocking);

      if (Object.keys(newSecrets).length && !key) throw new EcommerceSecretError('ENCRYPTION_KEY_MISSING');

      const config: Record<string, unknown> = {};
      const changedFields: string[] = [];
      for (const field of def.fields) {
        if (field.type === 'secret') continue;
        const value = normalizeConfigValue(field, nextConfig[field.key]);
        if (value !== undefined) config[field.key] = value;
        if (JSON.stringify(value) !== JSON.stringify(row?.config?.[field.key] ?? undefined)) {
          changedFields.push(field.key);
        }
      }
      const secrets: Record<string, EncryptedValue> = { ...storedSecrets };
      for (const k of cleared) {
        delete secrets[k];
        changedFields.push(k);
      }
      for (const [k, v] of Object.entries(newSecrets)) {
        secrets[k] = encryptSecret(v, key as Buffer);
        changedFields.push(k);
      }

      if (!changedFields.length) return toView(def, row, key);

      const data = { config, secrets, editorId: userId === undefined ? null : String(userId) };
      if (row) {
        await strapi.db.query(uids().integration).update({ where: { id: row.id }, data });
      } else {
        await strapi.db
          .query(uids().integration)
          .create({ data: { providerId: def.id, category: def.category, active: false, ...data } });
      }
      invalidate();

      await audit({
        area: AREA,
        action: 'integration.update',
        targetId: def.id,
        userId: userId === undefined ? undefined : String(userId),
        details: { changedFields },
      });

      return toView(def, await findRow(id), key);
    },

    async setActive(id: string, active: boolean, userId?: string | number): Promise<IntegrationView> {
      const def = requireDefinition(id);
      const row = await findRow(id);
      const key = resolveEncryptionKey(strapi);

      if (active) {
        const { values } = decryptAll(row?.secrets ?? null, key);
        const issues = validateProviderInput(
          def,
          { config: configWithDefaults(def, row?.config ?? null) },
          (k) => values[k] !== undefined
        );
        if (issues.length) throw new EcommerceValidationError('Invalid settings', issues);
      }

      // A category is exclusive when any of its providers is (billing: one active at a time).
      const exclusive =
        active && getProviderDefinitions().some((d) => d.category === def.category && d.exclusive);
      const deactivated: string[] = [];

      await strapi.db.transaction(async () => {
        const q = strapi.db.query(uids().integration);
        if (exclusive) {
          const others: IntegrationRow[] = await q.findMany({
            where: { category: def.category, active: true, providerId: { $ne: def.id } },
          });
          if (others.length) {
            deactivated.push(...others.map((o) => o.providerId));
            await q.updateMany({ where: { id: { $in: others.map((o) => o.id) } }, data: { active: false } });
          }
        }
        const editorId = userId === undefined ? null : String(userId);
        if (row) {
          await q.update({ where: { id: row.id }, data: { active, editorId } });
        } else {
          await q.create({
            data: { providerId: def.id, category: def.category, active, config: {}, secrets: {}, editorId },
          });
        }
      });
      invalidate();

      await audit({
        area: AREA,
        action: active ? 'integration.activate' : 'integration.deactivate',
        targetId: def.id,
        userId: userId === undefined ? undefined : String(userId),
        details: deactivated.length ? { deactivated } : undefined,
      });

      return toView(def, await findRow(id), key);
    },

    async testConnection(id: string): Promise<ConnectionResult> {
      const def = requireDefinition(id);
      if (!def.testConnection) return { ok: false, code: 'NOT_IMPLEMENTED' };
      return def.testConnection(buildRuntime(def, await findRow(id)));
    },

    /** Server-side only: returns decrypted secrets. Never send the result to a client. */
    async getRuntime(id: string): Promise<(ProviderRuntime & { active: boolean }) | null> {
      const def = getProviderDefinition(id);
      if (!def) return null;
      const cached = runtimeCache.get(id);
      if (cached && cached.expiresAt > Date.now()) return copyRuntime(cached.value);
      const generation = cacheGeneration;
      const row = await findRow(id);
      const value = { ...buildRuntime(def, row), active: row?.active ?? false };
      if (generation === cacheGeneration) {
        runtimeCache.set(id, { value, expiresAt: Date.now() + RUNTIME_TTL_MS });
      }
      return copyRuntime(value);
    },

    async getActiveProviders(category: ProviderCategory): Promise<string[]> {
      const rows: IntegrationRow[] = await strapi.db
        .query(uids().integration)
        .findMany({ where: { category, active: true } });
      return rows.map((r) => r.providerId).filter((id) => getProviderDefinition(id) !== undefined);
    },

    getStoreSettings,

    async updateStoreSettings(patch: Partial<StoreSettings>, userId?: string | number): Promise<StoreSettings> {
      const { values, errors } = normalizeStorePatch((patch ?? {}) as Record<string, unknown>);
      if (errors.length) throw new EcommerceValidationError('Invalid settings', errors);
      if (typeof values.storefrontApiTokenId === 'number') {
        const token = await strapi.service('admin::api-token').getById(values.storefrontApiTokenId);
        if (!token) {
          throw new EcommerceValidationError('Invalid settings', [{ path: 'storefrontApiTokenId', code: 'invalid_token' }]);
        }
      }

      const q = () => strapi.db.query(uids().storeSetting);
      const current = await getStoreSettings();
      const changedFields = Object.keys(values).filter(
        (k) => JSON.stringify((values as any)[k]) !== JSON.stringify((current as any)[k])
      );
      await strapi.db.transaction(async () => {
        for (const k of changedFields) {
          const value = wrapStoreValue((values as any)[k]);
          const existing = await q().findOne({ where: { key: k } });
          if (existing) await q().update({ where: { id: existing.id }, data: { value } });
          else await q().create({ data: { key: k, value } });
        }
      });

      if (changedFields.length) {
        await audit({
          area: AREA,
          action: 'store.update',
          userId: userId === undefined ? undefined : String(userId),
          details: { changedFields },
        });
      }
      return getStoreSettings();
    },

    async listManualMethods(): Promise<ManualMethod[]> {
      const rows = await strapi.db
        .query(uids().manualShippingMethod)
        .findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      return rows.map(toManualMethod);
    },

    async createManualMethod(input: ManualMethodInput, userId?: string | number): Promise<ManualMethod> {
      const { values, errors } = normalizeManualMethod(input ?? {}, await getDefaultLocale());
      if (errors.length) throw new EcommerceValidationError('Invalid settings', errors);
      const q = strapi.db.query(uids().manualShippingMethod);
      if (values.position === undefined) {
        const all = await q.findMany({});
        values.position = all.reduce((max: number, r: any) => Math.max(max, r.position ?? 0), 0) + 1;
      }
      const created = await q.create({ data: values });
      await audit({
        area: AREA,
        action: 'manual_method.create',
        targetId: String(created.id),
        userId: userId === undefined ? undefined : String(userId),
      });
      return toManualMethod(created);
    },

    async updateManualMethod(id: number, input: ManualMethodInput, userId?: string | number): Promise<ManualMethod> {
      const q = strapi.db.query(uids().manualShippingMethod);
      const existing = await q.findOne({ where: { id } });
      if (!existing) throw new EcommerceNotFoundError('Shipping method not found');
      const { id: _id, ...current } = toManualMethod(existing);
      const { values, errors } = normalizeManualMethod({ ...current, ...(input ?? {}) }, await getDefaultLocale());
      if (errors.length) throw new EcommerceValidationError('Invalid settings', errors);
      const updated = await q.update({ where: { id }, data: values });
      await audit({
        area: AREA,
        action: 'manual_method.update',
        targetId: String(id),
        userId: userId === undefined ? undefined : String(userId),
      });
      return toManualMethod(updated);
    },

    async deleteManualMethod(id: number, userId?: string | number): Promise<void> {
      const q = strapi.db.query(uids().manualShippingMethod);
      const existing = await q.findOne({ where: { id } });
      if (!existing) throw new EcommerceNotFoundError('Shipping method not found');
      await q.delete({ where: { id } });
      await audit({
        area: AREA,
        action: 'manual_method.delete',
        targetId: String(id),
        userId: userId === undefined ? undefined : String(userId),
      });
    },
  };
};

export default EcommerceSettingsService;
