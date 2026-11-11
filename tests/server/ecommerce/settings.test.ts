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
  return { service, tables: db.tables, pluginConfig, transaction: db.transaction };
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
