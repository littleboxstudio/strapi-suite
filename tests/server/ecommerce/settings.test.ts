import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import EcommerceSettingsService from '../../../server/src/services/modules/ecommerce/settings';
import EcommerceAuditService from '../../../server/src/services/modules/ecommerce/audit';
import {
  __resetRegistryForTests,
  registerProvider,
} from '../../../server/src/services/modules/ecommerce/providers/registry';
import { createFakeDb } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = {
  integration: `${P}integration`,
  storeSetting: `${P}store-setting`,
  manualShippingMethod: `${P}manual-shipping-method`,
  auditLog: `${P}audit-log`,
};

const STRIPE_KEY = 'sk_test_51ABCDEFsecretvalue9876';
const MOLONI = {
  config: { clientId: 'cid', username: 'user', companyId: 5 },
  secrets: { clientSecret: 'moloni-client-secret-1', password: 'moloni-password-2' },
};

function makeStrapi(opts: { encryptionKey?: string | null } = {}) {
  const db = createFakeDb(Object.values(UIDS));
  const pluginConfig: any = {
    uuid: { modules: { ecommerce: UIDS } },
    ecommerce: { encryptionKey: opts.encryptionKey === undefined ? 'key-one' : opts.encryptionKey },
  };
  let audit: any;
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => pluginConfig },
    plugin: (id: string) =>
      id === 'i18n'
        ? {
            service: () => ({
              getDefaultLocale: async () => 'en',
              find: async () => [
                { code: 'en', name: 'English' },
                { code: 'pt', name: 'Portuguese' },
              ],
            }),
          }
        : { service: (name: string) => (name === 'EcommerceAuditService' ? audit : undefined) },
  };
  audit = EcommerceAuditService({ strapi });
  const service = EcommerceSettingsService({ strapi });
  return { service, strapi, tables: db.tables, pluginConfig, transaction: db.transaction };
}

const fakeBilling = (exclusive = true) => ({
  id: 'fake-billing',
  category: 'billing' as const,
  name: 'Fake billing',
  exclusive,
  verified: true,
  fields: [],
});

describe('EcommerceSettingsService — integrations', () => {
  const originalEnv = process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
  beforeEach(() => {
    delete process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
  });
  afterEach(() => {
    __resetRegistryForTests();
    vi.useRealTimers();
    if (originalEnv === undefined) delete process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
    else process.env.LTB_ECOMMERCE_ENCRYPTION_KEY = originalEnv;
  });

  it('lists every registered provider, even never-saved ones', async () => {
    const { service } = makeStrapi();
    const list = await service.listIntegrations();
    expect(list.map((i) => i.id)).toEqual(['stripe', 'moloni', 'ctt-expresso', 'manual', 'resend']);
    const moloni = list.find((i) => i.id === 'moloni')!;
    expect(moloni).toMatchObject({
      category: 'billing',
      active: false,
      verified: false,
      secretsStatus: 'none',
      encryptionKeyConfigured: true,
      secrets: { clientSecret: null, password: null },
    });
    expect(moloni.config.documentType).toBe('FR');
  });

  it('shows secrets masked and never in clear', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    const stored = JSON.stringify(tables[UIDS.integration]);
    expect(stored).not.toContain(STRIPE_KEY);

    const list = await service.listIntegrations();
    expect(JSON.stringify(list)).not.toContain(STRIPE_KEY);
    const stripe = list.find((i) => i.id === 'stripe')!;
    expect(stripe.secrets.secretKey).toBe('sk_********9876');
    expect(stripe.secretsStatus).toBe('ok');
  });

  it('keeps the stored secret when the mask echo or an empty value is saved', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    const view = await service.updateIntegration(
      'stripe',
      { secrets: { secretKey: 'sk_********9876', webhookSecret: '' } },
      '1'
    );
    expect(JSON.stringify(view)).not.toContain(STRIPE_KEY);
    expect((await service.getRuntime('stripe'))!.secrets.secretKey).toBe(STRIPE_KEY);
    expect((await service.getRuntime('stripe'))!.secrets.webhookSecret).toBeUndefined();
  });

  it('clears a stored optional secret when null is sent', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY, webhookSecret: 'whsec_value_1234' } }, '1');
    const view = await service.updateIntegration('stripe', { secrets: { webhookSecret: null } }, '2');
    expect(view.secrets.webhookSecret).toBeNull();
    expect(view.secrets.secretKey).toBe('sk_********9876');
    expect(tables[UIDS.integration][0].secrets).not.toHaveProperty('webhookSecret');
    const rt = (await service.getRuntime('stripe'))!;
    expect(rt.secrets.webhookSecret).toBeUndefined();
    expect(rt.secrets.secretKey).toBe(STRIPE_KEY);
    const last = tables[UIDS.auditLog].at(-1);
    expect(last.details.changedFields).toEqual(['webhookSecret']);
  });

  it('clearing an optional secret that is not stored changes nothing', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    await service.updateIntegration('stripe', { secrets: { webhookSecret: null } }, '1');
    expect(tables[UIDS.auditLog]).toHaveLength(1);
  });

  it('refuses to clear a required secret', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    const err: any = await service
      .updateIntegration('stripe', { secrets: { secretKey: null } }, '1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'secrets.secretKey', code: 'required' }]);
    expect((await service.getRuntime('stripe'))!.secrets.secretKey).toBe(STRIPE_KEY);
  });

  it('marks secrets unreadable after the encryption key changes, without throwing', async () => {
    const { service, pluginConfig } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    pluginConfig.ecommerce.encryptionKey = 'key-two';
    const stripe = (await service.listIntegrations()).find((i) => i.id === 'stripe')!;
    expect(stripe.secretsStatus).toBe('unreadable');
    expect(stripe.secrets.secretKey).toBeNull();
    const rt = await service.getRuntime('stripe');
    expect(rt!.secrets.secretKey).toBeUndefined();
  });

  it('never stores a mask-shaped value after key rotation, and cannot activate', async () => {
    const { service, tables, pluginConfig } = makeStrapi();
    await service.updateIntegration('moloni', MOLONI, '1');
    const before = JSON.stringify(tables[UIDS.integration][0].secrets);
    pluginConfig.ecommerce.encryptionKey = 'key-two';
    await service.updateIntegration('moloni', { secrets: { clientSecret: '********', password: 'mol********rd-2' } }, '1');
    expect(JSON.stringify(tables[UIDS.integration][0].secrets)).toBe(before);
    const err: any = await service.setActive('moloni', true, '1').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'secrets.clientSecret', code: 'required' },
        { path: 'secrets.password', code: 'required' },
      ])
    );
  });

  it('ignores a mask-shaped secret when nothing is stored', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: 'sk_********9876' } }, '1');
    expect(tables[UIDS.integration]).toHaveLength(0);
    expect(tables[UIDS.auditLog]).toHaveLength(0);
    await expect(service.setActive('stripe', true, '1')).rejects.toBeInstanceOf(EcommerceValidationError);
  });

  it('skips the write and the audit when nothing changed', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_1' }, secrets: { secretKey: STRIPE_KEY } }, '1');
    const before = JSON.stringify(tables[UIDS.integration]);
    const view = await service.updateIntegration(
      'stripe',
      { config: { publishableKey: 'pk_1' }, secrets: { secretKey: 'sk_********9876' } },
      '2'
    );
    expect(view.secrets.secretKey).toBe('sk_********9876');
    expect(JSON.stringify(tables[UIDS.integration])).toBe(before);
    expect(tables[UIDS.auditLog]).toHaveLength(1);
  });

  it('rejects saving an active integration with a required field cleared', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('moloni', MOLONI, '1');
    await service.setActive('moloni', true, '1');
    const err: any = await service.updateIntegration('moloni', { config: { clientId: '' } }, '1').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'config.clientId', code: 'required' });
  });

  it('refuses to activate when a stored required secret cannot be decrypted', async () => {
    const { service, pluginConfig } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    pluginConfig.ecommerce.encryptionKey = 'key-two';
    const err: any = await service.setActive('stripe', true, '1').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'secrets.secretKey', code: 'required' });
  });

  it('getRuntime returns copies that cannot mutate the cache', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_1' }, secrets: { secretKey: STRIPE_KEY } }, '1');
    const rt = (await service.getRuntime('stripe'))!;
    rt.config.publishableKey = 'tampered';
    rt.secrets.secretKey = 'tampered';
    const again = (await service.getRuntime('stripe'))!;
    expect(again.config.publishableKey).toBe('pk_1');
    expect(again.secrets.secretKey).toBe(STRIPE_KEY);
  });

  it('a read in flight during invalidation does not repopulate the cache with stale data', async () => {
    const { service, strapi } = makeStrapi();
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_1' } }, '1');
    // Hold the next integration read until the update below has committed.
    const realQuery = strapi.db.query;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    strapi.db.query = (uid: string) => {
      const q = realQuery(uid);
      if (uid !== UIDS.integration || held) return q;
      held = true;
      return { ...q, findOne: async (p: any) => { const row = await q.findOne(p); await gate; return row; } };
    };
    const pending = service.getRuntime('stripe'); // reads pk_1, then waits
    strapi.db.query = realQuery;
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_2' } }, '1');
    release();
    expect((await pending)!.config.publishableKey).toBe('pk_1');
    expect((await service.getRuntime('stripe'))!.config.publishableKey).toBe('pk_2');
  });

  it('fails with ENCRYPTION_KEY_MISSING when saving a new secret without a key', async () => {
    const { service, tables } = makeStrapi({ encryptionKey: null });
    const err: any = await service
      .updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceSecretError);
    expect(err.code).toBe('ENCRYPTION_KEY_MISSING');
    expect(tables[UIDS.integration]).toHaveLength(0);
    // non-secret settings still work
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_1' } }, '1');
    const stripe = (await service.listIntegrations()).find((i) => i.id === 'stripe')!;
    expect(stripe.config.publishableKey).toBe('pk_1');
    expect(stripe.encryptionKeyConfigured).toBe(false);
  });

  it('rejects invalid provider input with provider codes', async () => {
    const { service } = makeStrapi();
    const err: any = await service
      .updateIntegration('moloni', { config: { companyId: 'abc', documentType: 'XX' } }, '1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'config.companyId', code: 'invalid_number' },
        { path: 'config.documentType', code: 'invalid_option' },
      ])
    );
  });

  it('throws not found for an unknown provider', async () => {
    const { service } = makeStrapi();
    await expect(service.updateIntegration('nope', {}, '1')).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.setActive('nope', true, '1')).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('refuses to activate without the required fields', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('moloni', { config: { clientId: 'cid' } }, '1');
    const err: any = await service.setActive('moloni', true, '1').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'secrets.password', code: 'required' });
    expect(tables[UIDS.integration][0].active).toBe(false);
  });

  it('activating moloni deactivates the other active billing provider', async () => {
    registerProvider(fakeBilling());
    const { service, transaction } = makeStrapi();
    await service.setActive('fake-billing', true, '1');
    await service.updateIntegration('moloni', MOLONI, '1');
    await service.setActive('moloni', true, '1');
    expect(transaction).toHaveBeenCalled();
    expect(await service.getActiveProviders('billing')).toEqual(['moloni']);
    const list = await service.listIntegrations();
    expect(list.find((i) => i.id === 'fake-billing')!.active).toBe(false);
  });

  it('allows several carriers active at the same time', async () => {
    const { service } = makeStrapi();
    await service.setActive('manual', true, '1');
    registerProvider({ id: 'other-carrier', category: 'carrier', name: 'x', exclusive: false, verified: true, fields: [] });
    await service.setActive('other-carrier', true, '1');
    expect((await service.getActiveProviders('carrier')).sort()).toEqual(['manual', 'other-carrier']);
  });

  it('records the editor as editorId (never the core-reserved updatedBy)', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('moloni', MOLONI, '7');
    expect(tables[UIDS.integration][0]).toMatchObject({ editorId: '7' });
    await service.setActive('moloni', true, '8');
    expect(tables[UIDS.integration][0]).toMatchObject({ editorId: '8' });
    expect(tables[UIDS.integration][0]).not.toHaveProperty('updatedBy');
  });

  it('audits changed field names but never secret values', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('moloni', MOLONI, '7');
    await service.setActive('moloni', true, '7');
    const logs = tables[UIDS.auditLog];
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ area: 'settings', targetId: 'moloni', userId: '7' });
    expect(logs[0].details.changedFields.sort()).toEqual(
      ['clientId', 'clientSecret', 'companyId', 'password', 'username'].sort()
    );
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain(MOLONI.secrets.clientSecret);
    expect(dump).not.toContain(MOLONI.secrets.password);
  });

  it('invalidates the runtime cache on update and on setActive', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    expect((await service.getRuntime('stripe'))!.secrets.secretKey).toBe(STRIPE_KEY);
    await service.updateIntegration('stripe', { secrets: { secretKey: 'sk_test_new_value_1234' } }, '1');
    expect((await service.getRuntime('stripe'))!.secrets.secretKey).toBe('sk_test_new_value_1234');
    expect((await service.getRuntime('stripe'))!.active).toBe(false);
    await service.setActive('stripe', true, '1');
    expect((await service.getRuntime('stripe'))!.active).toBe(true);
  });

  it('caches the runtime for 60 seconds', async () => {
    vi.useFakeTimers();
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { config: { publishableKey: 'pk_1' } }, '1');
    expect((await service.getRuntime('stripe'))!.config.publishableKey).toBe('pk_1');
    tables[UIDS.integration][0].config = { publishableKey: 'pk_2' }; // changed behind the service
    expect((await service.getRuntime('stripe'))!.config.publishableKey).toBe('pk_1');
    vi.advanceTimersByTime(60_001);
    expect((await service.getRuntime('stripe'))!.config.publishableKey).toBe('pk_2');
  });

  it('getRuntime returns null for unknown providers', async () => {
    const { service } = makeStrapi();
    expect(await service.getRuntime('nope')).toBeNull();
  });

  it('testConnection runs the definition with the decrypted runtime', async () => {
    const testConnection = vi.fn(async () => ({ ok: true }));
    registerProvider({
      ...fakeBilling(false),
      id: 'probe',
      fields: [{ key: 'token', type: 'secret', required: true, label: 'x' }],
      testConnection,
    });
    const { service } = makeStrapi();
    await service.updateIntegration('probe', { secrets: { token: 'tok-secret-value' } }, '1');
    expect(await service.testConnection('probe')).toEqual({ ok: true });
    expect(testConnection).toHaveBeenCalledWith({ config: {}, secrets: { token: 'tok-secret-value' } });
    expect(await service.testConnection('manual')).toEqual({ ok: false, code: 'NOT_IMPLEMENTED' });
  });
});

describe('EcommerceSettingsService — store settings', () => {
  it('returns defaults when nothing is stored', async () => {
    const { service } = makeStrapi();
    expect(await service.getStoreSettings()).toEqual({
      storeName: '',
      logoUrl: null,
      brandColor: '#4945ff',
      storefrontUrl: null,
      paymentSuccessPath: '/checkout/success',
      paymentCancelPath: '/checkout/cancel',
      timezone: 'Europe/Lisbon',
      shippingCountries: ['PT'],
      supportEmail: null,
    });
  });

  it('persists one row per key and audits', async () => {
    const { service, tables } = makeStrapi();
    const res = await service.updateStoreSettings(
      { storeName: 'Loja', storefrontUrl: 'https://shop.example.com', shippingCountries: ['PT', 'ES'] },
      '3'
    );
    expect(res).toMatchObject({ storeName: 'Loja', storefrontUrl: 'https://shop.example.com', shippingCountries: ['PT', 'ES'] });
    expect(tables[UIDS.storeSetting].map((r) => r.key).sort()).toEqual(['shippingCountries', 'storeName', 'storefrontUrl']);
    await service.updateStoreSettings({ storeName: 'Loja 2' }, '3');
    expect(tables[UIDS.storeSetting]).toHaveLength(3);
    expect((await service.getStoreSettings()).storeName).toBe('Loja 2');
    expect(tables[UIDS.auditLog].at(-1)).toMatchObject({ area: 'settings', userId: '3', details: { changedFields: ['storeName'] } });
  });

  it('stores each value wrapped in a JSON object (MariaDB json_valid) and unwraps it on read', async () => {
    const { service, tables } = makeStrapi();
    await service.updateStoreSettings({ storeName: 'Loja Teste', logoUrl: null, shippingCountries: ['ES'] }, '1');
    const row = tables[UIDS.storeSetting].find((r) => r.key === 'storeName');
    expect(row.value).toEqual({ v: 'Loja Teste' });
    const settings = await service.getStoreSettings();
    expect(settings.storeName).toBe('Loja Teste');
    expect(settings.shippingCountries).toEqual(['ES']);
  });

  it('reads legacy rows whose value is not wrapped', async () => {
    const { service, tables } = makeStrapi();
    tables[UIDS.storeSetting].push({ id: 50, key: 'shippingCountries', value: ['FR'] });
    tables[UIDS.storeSetting].push({ id: 51, key: 'storeName', value: 'Legacy' });
    const settings = await service.getStoreSettings();
    expect(settings.shippingCountries).toEqual(['FR']);
    expect(settings.storeName).toBe('Legacy');
  });

  it('the fake DB rejects bare scalars in json columns, like MariaDB', async () => {
    const { strapi } = makeStrapi();
    await expect(
      strapi.db.query(UIDS.storeSetting).create({ data: { key: 'storeName', value: 'bare' } })
    ).rejects.toThrow(/CONSTRAINT/);
  });

  it('validates every field', async () => {
    const { service, tables } = makeStrapi();
    const err: any = await service
      .updateStoreSettings(
        {
          storeName: ' ',
          logoUrl: 'ftp://x/logo.png',
          storefrontUrl: '/relative',
          brandColor: '#fff',
          timezone: 'Mars/Olympus',
          shippingCountries: ['PT', 'pt', 'ZZ'],
          supportEmail: 'not-an-email',
        },
        '1'
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'storeName', code: 'required' },
        { path: 'logoUrl', code: 'invalid_url' },
        { path: 'storefrontUrl', code: 'invalid_url' },
        { path: 'brandColor', code: 'invalid_color' },
        { path: 'timezone', code: 'invalid_timezone' },
        { path: 'shippingCountries.1', code: 'invalid_country' },
        { path: 'shippingCountries.2', code: 'invalid_country' },
        { path: 'supportEmail', code: 'invalid_email' },
      ])
    );
    expect(tables[UIDS.storeSetting]).toHaveLength(0);
  });

  it('accepts null for optional fields and ignores unknown keys', async () => {
    const { service, tables } = makeStrapi();
    await service.updateStoreSettings({ logoUrl: 'http://cdn.example.com/l.png', brandColor: '#A1b2C3' }, '1');
    const res = await service.updateStoreSettings({ logoUrl: null, hacker: 1 } as any, '1');
    expect(res.logoUrl).toBeNull();
    expect(res.brandColor).toBe('#A1b2C3');
    expect(tables[UIDS.storeSetting].some((r) => r.key === 'hacker')).toBe(false);
  });
});

describe('EcommerceSettingsService — manual shipping methods', () => {
  const method = (extra: any = {}) => ({
    name: { en: 'Pickup', pt: 'Levantamento' },
    price: 350,
    tax: 23,
    countries: ['PT'],
    active: true,
    ...extra,
  });

  it('creates, lists ordered by position, updates and deletes', async () => {
    const { service, tables } = makeStrapi();
    const a = await service.createManualMethod(method());
    const b = await service.createManualMethod(method({ name: { en: 'Courier' }, price: 0 }));
    expect(b.position).toBeGreaterThan(a.position);
    await service.updateManualMethod(a.id, { position: 10 });
    expect((await service.listManualMethods()).map((m) => m.id)).toEqual([b.id, a.id]);
    const updated = await service.updateManualMethod(b.id, { price: 500 });
    expect(updated).toMatchObject({ price: 500, name: { en: 'Courier' } });
    await service.deleteManualMethod(a.id);
    expect(tables[UIDS.manualShippingMethod]).toHaveLength(1);
    await expect(service.deleteManualMethod(999)).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.updateManualMethod(999, {})).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('applies defaults for tax and countries', async () => {
    const { service } = makeStrapi();
    const m = await service.createManualMethod({ name: { en: 'X' }, price: 0 });
    expect(m).toMatchObject({ tax: 23, countries: ['PT'], active: true });
  });

  it('validates name in the default locale, price, tax and countries', async () => {
    const { service, tables } = makeStrapi();
    const err: any = await service
      .createManualMethod(method({ name: { pt: 'Só PT' }, price: -1, tax: 101, countries: ['PRT'] }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'name.en', code: 'required' },
        { path: 'price', code: 'out_of_range' },
        { path: 'tax', code: 'out_of_range' },
        { path: 'countries.0', code: 'invalid_country' },
      ])
    );
    const err2: any = await service.createManualMethod(method({ price: 1.5, tax: 'x' })).catch((e) => e);
    expect(err2.errors).toEqual(
      expect.arrayContaining([
        { path: 'price', code: 'invalid_number' },
        { path: 'tax', code: 'invalid_number' },
      ])
    );
    expect(tables[UIDS.manualShippingMethod]).toHaveLength(0);
  });
});
