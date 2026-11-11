import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EcommerceNotFoundError,
  EcommerceSecretError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import {
  __resetRegistryForTests,
  registerProvider,
} from '../../../server/src/services/modules/ecommerce/providers/registry';
import sharp from 'sharp';
import { UIDS, makeStrapi } from './helpers/settingsStrapi';

const STRIPE_KEY = 'sk_test_51ABCDEFsecretvalue9876';
const MOLONI = {
  config: { clientId: 'cid', username: 'user', companyId: 5 },
  secrets: { clientSecret: 'moloni-client-secret-1', password: 'moloni-password-2' },
};

const fakeBilling = (exclusive = true) => ({
  id: 'fake-billing',
  category: 'billing' as const,
  name: 'Fake billing',
  exclusive,
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
    registerProvider({ id: 'other-carrier', category: 'carrier', name: 'x', exclusive: false, fields: [] });
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

  it('integrationLookups runs the definition with the decrypted runtime and a valid company id', async () => {
    const lookups = vi.fn(async () => ({ lists: { companies: [{ value: '7', label: 'Loja' }] }, failed: [] }));
    registerProvider({
      ...fakeBilling(false),
      id: 'probe',
      fields: [{ key: 'token', type: 'secret', required: true, label: 'x' }],
      lookups,
    });
    const { service } = makeStrapi();
    await service.updateIntegration('probe', { secrets: { token: 'tok-secret-value' } }, '1');
    const out = await service.integrationLookups('probe', '7');
    expect(out.lists.companies).toEqual([{ value: '7', label: 'Loja' }]);
    expect(lookups).toHaveBeenLastCalledWith(
      { config: {}, secrets: { token: 'tok-secret-value' } },
      { companyId: 7 }
    );
    await service.integrationLookups('probe', 'abc');
    expect(lookups).toHaveBeenLastCalledWith(expect.anything(), { companyId: null });
    await service.integrationLookups('probe', '-3');
    expect(lookups).toHaveBeenLastCalledWith(expect.anything(), { companyId: null });
    expect(await service.integrationLookups('manual')).toEqual({ lists: {}, failed: [] });
  });
});

describe('EcommerceSettingsService — Stripe return paths', () => {
  afterEach(() => __resetRegistryForTests());

  it('rejects an invalid path and shows the defaults without anything stored', async () => {
    const { service } = makeStrapi();
    const err: any = await service
      .updateIntegration('stripe', { config: { paymentSuccessPath: '//evil.com' } }, '1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'config.paymentSuccessPath', code: 'invalid_path' });
    const stripe = (await service.listIntegrations()).find((i) => i.id === 'stripe')!;
    expect(stripe.config).toMatchObject({
      paymentSuccessPath: '/checkout/success',
      paymentCancelPath: '/checkout/cancel',
    });
  });

  it('an empty path falls back to the default in the runtime', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { config: { paymentSuccessPath: '/obrigado' } }, '1');
    expect((await service.getRuntime('stripe'))!.config.paymentSuccessPath).toBe('/obrigado');
    await service.updateIntegration('stripe', { config: { paymentSuccessPath: '' } }, '1');
    expect((await service.getRuntime('stripe'))!.config.paymentSuccessPath).toBe('/checkout/success');
  });

  it('a blank path on an active integration falls back to the default, like null', async () => {
    const { service } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    await service.setActive('stripe', true, '1');
    await service.updateIntegration('stripe', { config: { paymentSuccessPath: '/obrigado' } }, '1');
    await service.updateIntegration('stripe', { config: { paymentSuccessPath: '  ' } }, '1');
    expect((await service.getRuntime('stripe'))!.config.paymentSuccessPath).toBe('/checkout/success');
    await service.updateIntegration('stripe', { config: { paymentCancelPath: null } }, '1');
    expect((await service.getRuntime('stripe'))!.config.paymentCancelPath).toBe('/checkout/cancel');
  });

  it('rejects a path with a query or a fragment', async () => {
    const { service } = makeStrapi();
    for (const path of ['/thanks?x=1', '/thanks#a']) {
      const err: any = await service
        .updateIntegration('stripe', { config: { paymentSuccessPath: path } }, '1')
        .catch((e) => e);
      expect(err.errors).toContainEqual({ path: 'config.paymentSuccessPath', code: 'invalid_path' });
    }
  });

  it('activation fails with a stored invalid path', async () => {
    const { service, tables } = makeStrapi();
    await service.updateIntegration('stripe', { secrets: { secretKey: STRIPE_KEY } }, '1');
    tables[UIDS.integration][0].config = { paymentCancelPath: 'no-slash' };
    const err: any = await service.setActive('stripe', true, '1').catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toContainEqual({ path: 'config.paymentCancelPath', code: 'invalid_path' });
  });
});

describe('EcommerceSettingsService — carrier zones', () => {
  afterEach(() => __resetRegistryForTests());
  const CTT = {
    config: { clientId: 'c', contractNumber: 'n', username: 'u' },
    secrets: { password: 'ctt-password-1' },
  };
  const withZones = async () => {
    const ctx = makeStrapi();
    await ctx.service.updateStoreSettings({ markets: ['PT', 'ES'] });
    await ctx.zones.create({ name: 'PT', countries: ['PT'] });
    await ctx.zones.create({ name: 'ES', countries: ['ES'] });
    return ctx;
  };

  it('stores unique zone ids in the order received', async () => {
    const { service } = await withZones();
    const view = await service.updateIntegration('ctt-expresso', { config: { zones: [2, 1, 2] } });
    expect(view.config.zones).toEqual([2, 1]);
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([2, 1]);
  });

  it('rejects ids of zones that do not exist, active or not', async () => {
    const { service } = await withZones();
    const err: any = await service.updateIntegration('ctt-expresso', { config: { zones: [9] } }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'config.zones', code: 'invalid_zone' }]);
    const bad: any = await service.updateIntegration('ctt-expresso', { config: { zones: ['1'] } }).catch((e) => e);
    expect(bad.errors).toEqual([{ path: 'config.zones', code: 'invalid_zone' }]);
  });

  it('activating CTT requires at least one zone', async () => {
    const { service } = await withZones();
    await service.updateIntegration('ctt-expresso', CTT);
    const err: any = await service.setActive('ctt-expresso', true).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'config.zones', code: 'required' }]);
    await service.updateIntegration('ctt-expresso', { config: { zones: [1] } });
    expect((await service.setActive('ctt-expresso', true)).active).toBe(true);
  });

  it('zones are required like any other field: saving without them only fails while active', async () => {
    const { service } = await withZones();
    const saved = await service.updateIntegration('ctt-expresso', { ...CTT, config: { ...CTT.config, zones: [] } });
    expect(saved.config.zones).toEqual([]);
    await service.updateIntegration('ctt-expresso', { config: { zones: [1] } });
    await service.setActive('ctt-expresso', true);
    const err: any = await service.updateIntegration('ctt-expresso', { config: { zones: [] } }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'config.zones', code: 'required' }]);
    expect((await service.getRuntime('ctt-expresso'))!.config.zones).toEqual([1]);
  });
});

describe('EcommerceSettingsService — store settings', () => {
  it('returns defaults when nothing is stored', async () => {
    const { service } = makeStrapi();
    expect(await service.getStoreSettings()).toEqual({
      storeName: '',
      logo: null,
      brandColor: '#4945ff',
      storefrontUrl: null,
      timezone: 'Europe/Lisbon',
      markets: ['PT'],
      supportEmail: null,
      storefrontApiTokenId: null,
      checkoutSessionTtlHours: 168,
    });
  });

  it('validates checkoutSessionTtlHours', async () => {
    const { service } = makeStrapi();
    for (const v of [0, 721, 1.5, '24']) {
      await expect(service.updateStoreSettings({ checkoutSessionTtlHours: v } as any)).rejects.toMatchObject({
        errors: [{ path: 'checkoutSessionTtlHours', code: 'invalid_number' }],
      });
    }
    const res = await service.updateStoreSettings({ checkoutSessionTtlHours: 720 });
    expect(res).toMatchObject({ checkoutSessionTtlHours: 720 });
  });

  it('ignores storefrontApiTokenId: only generate/regenerate set it', async () => {
    const { service } = makeStrapi();
    for (const v of [7, 99, null, 'x']) {
      expect(await service.updateStoreSettings({ storefrontApiTokenId: v } as any)).toMatchObject({
        storefrontApiTokenId: null,
      });
    }
  });

  it('persists one row per key and audits', async () => {
    const { service, tables } = makeStrapi();
    const res = await service.updateStoreSettings(
      { storeName: 'Loja', storefrontUrl: 'https://shop.example.com', markets: ['PT', 'ES'] },
      '3'
    );
    expect(res).toMatchObject({ storeName: 'Loja', storefrontUrl: 'https://shop.example.com', markets: ['PT', 'ES'] });
    expect(tables[UIDS.storeSetting].map((r) => r.key).sort()).toEqual(['markets', 'storeName', 'storefrontUrl']);
    await service.updateStoreSettings({ storeName: 'Loja 2' }, '3');
    expect(tables[UIDS.storeSetting]).toHaveLength(3);
    expect((await service.getStoreSettings()).storeName).toBe('Loja 2');
    expect(tables[UIDS.auditLog].at(-1)).toMatchObject({ area: 'settings', userId: '3', details: { changedFields: ['storeName'] } });
  });

  it('stores each value wrapped in a JSON object (MariaDB json_valid) and unwraps it on read', async () => {
    const { service, tables } = makeStrapi();
    await service.updateStoreSettings({ storeName: 'Loja Teste', markets: ['ES'] }, '1');
    const row = tables[UIDS.storeSetting].find((r) => r.key === 'storeName');
    expect(row.value).toEqual({ v: 'Loja Teste' });
    const settings = await service.getStoreSettings();
    expect(settings.storeName).toBe('Loja Teste');
    expect(settings.markets).toEqual(['ES']);
  });

  it('reads legacy rows whose value is not wrapped', async () => {
    const { service, tables } = makeStrapi();
    tables[UIDS.storeSetting].push({ id: 50, key: 'markets', value: ['FR'] });
    tables[UIDS.storeSetting].push({ id: 51, key: 'storeName', value: 'Legacy' });
    const settings = await service.getStoreSettings();
    expect(settings.markets).toEqual(['FR']);
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
          storefrontUrl: '/relative',
          brandColor: '#fff',
          timezone: 'Mars/Olympus',
          markets: ['PT', 'pt', 'ZZ'],
          supportEmail: 'not-an-email',
        },
        '1'
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'storeName', code: 'required' },
        { path: 'storefrontUrl', code: 'invalid_url' },
        { path: 'brandColor', code: 'invalid_color' },
        { path: 'timezone', code: 'invalid_timezone' },
        { path: 'markets.1', code: 'invalid_country' },
        { path: 'markets.2', code: 'invalid_country' },
        { path: 'supportEmail', code: 'invalid_email' },
      ])
    );
    expect(tables[UIDS.storeSetting]).toHaveLength(0);
  });

  it('markets are required', async () => {
    const { service } = makeStrapi();
    await expect(service.updateStoreSettings({ markets: [] })).rejects.toMatchObject({
      errors: [{ path: 'markets', code: 'required' }],
    });
  });

  it('removing from markets a country still in a zone fails with MARKET_IN_USE and saves nothing', async () => {
    const { service, zones, tables } = makeStrapi();
    await service.updateStoreSettings({ markets: ['PT', 'ES', 'FR'] });
    await zones.create({ name: 'Ibéria', countries: ['PT', 'ES'] });
    const rowsBefore = JSON.stringify(tables[UIDS.storeSetting]);
    const err: any = await service
      .updateStoreSettings({ storeName: 'Nova', markets: ['PT', 'FR'] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'markets', code: 'MARKET_IN_USE', detail: 'Ibéria' }]);
    expect(JSON.stringify(tables[UIDS.storeSetting])).toBe(rowsBefore);
    expect((await service.getStoreSettings()).storeName).toBe('');

    const res = await service.updateStoreSettings({ markets: ['PT', 'ES'] });
    expect(res.markets).toEqual(['PT', 'ES']);
  });

  it('accepts null for optional fields and ignores unknown keys', async () => {
    const { service, tables } = makeStrapi();
    await service.updateStoreSettings({ supportEmail: 'a@b.pt', brandColor: '#A1b2C3' }, '1');
    const res = await service.updateStoreSettings({ supportEmail: null, hacker: 1 } as any, '1');
    expect(res.supportEmail).toBeNull();
    expect(res.brandColor).toBe('#A1b2C3');
    expect(tables[UIDS.storeSetting].some((r) => r.key === 'hacker')).toBe(false);
  });
});

describe('EcommerceSettingsService — manual shipping methods', () => {
  const method = (extra: any = {}) => ({
    name: { en: 'Pickup', pt: 'Levantamento' },
    rates: {},
    tax: 23,
    active: true,
    ...extra,
  });

  /** Markets PT and ES, zone 1 = PT, zone 2 = ES. */
  const withZones = async () => {
    const ctx = makeStrapi();
    await ctx.service.updateStoreSettings({ markets: ['PT', 'ES'] });
    const z1 = await ctx.zones.create({ name: 'PT', countries: ['PT'] });
    const z2 = await ctx.zones.create({ name: 'ES', countries: ['ES'] });
    expect([z1.id, z2.id]).toEqual([1, 2]);
    return ctx;
  };

  it('creates, lists ordered by position, updates and deletes', async () => {
    const { service, tables } = makeStrapi();
    const a = await service.createManualMethod(method());
    const b = await service.createManualMethod(method({ name: { en: 'Courier' } }));
    expect(b.position).toBeGreaterThan(a.position);
    await service.updateManualMethod(a.id, { position: 10 });
    expect((await service.listManualMethods()).map((m) => m.id)).toEqual([b.id, a.id]);
    const updated = await service.updateManualMethod(b.id, { tax: 6 });
    expect(updated).toMatchObject({ tax: 6, name: { en: 'Courier' } });
    await service.deleteManualMethod(a.id);
    expect(tables[UIDS.manualShippingMethod]).toHaveLength(1);
    await expect(service.deleteManualMethod(999)).rejects.toBeInstanceOf(EcommerceNotFoundError);
    await expect(service.updateManualMethod(999, {})).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('applies defaults for tax and rates; no price or countries', async () => {
    const { service } = makeStrapi();
    const m = await service.createManualMethod({ name: { en: 'X' } });
    expect(m).toMatchObject({ tax: 23, rates: {}, active: true });
    expect(m).not.toHaveProperty('price');
    expect(m).not.toHaveProperty('countries');
  });

  it('stores a price per zone', async () => {
    const { service, tables } = await withZones();
    const m = await service.createManualMethod({ name: { en: 'Mail', pt: 'Correio' }, rates: { '1': 495, '2': 995 }, tax: 23 });
    expect(m.rates).toEqual({ '1': 495, '2': 995 });
    expect(tables[UIDS.manualShippingMethod][0].rates).toEqual({ '1': 495, '2': 995 });
  });

  it('validates the rates', async () => {
    const { service, tables } = await withZones();
    const issues = async (rates: unknown) =>
      ((await service.createManualMethod(method({ rates })).catch((e) => e)) as any).errors;
    expect(await issues({ '9': 100 })).toEqual([{ path: 'rates.9', code: 'invalid_zone' }]);
    expect(await issues({ '1': -1 })).toEqual([{ path: 'rates.1', code: 'out_of_range' }]);
    expect(await issues({ '1': 100_000_000_000 })).toEqual([{ path: 'rates.1', code: 'out_of_range' }]);
    expect(await issues({ '1': 4.5 })).toEqual([{ path: 'rates.1', code: 'invalid_number' }]);
    expect(await issues({ '1': '450' })).toEqual([{ path: 'rates.1', code: 'invalid_number' }]);
    expect(await issues([])).toEqual([{ path: 'rates', code: 'invalid_number' }]);
    expect(await issues('x')).toEqual([{ path: 'rates', code: 'invalid_number' }]);
    expect(tables[UIDS.manualShippingMethod]).toHaveLength(0);
  });

  it('a null or empty rate removes the zone; a partial update keeps the stored rates', async () => {
    const { service } = await withZones();
    const m = await service.createManualMethod(method({ rates: { '1': null, '2': 300 } }));
    expect(m.rates).toEqual({ '2': 300 });
    expect((await service.updateManualMethod(m.id, { tax: 6 })).rates).toEqual({ '2': 300 });
    expect((await service.updateManualMethod(m.id, { rates: { '1': 100, '2': '' } as any })).rates).toEqual({ '1': 100 });
  });

  it('a stored price of a zone deleted meanwhile does not block later updates', async () => {
    const { service, tables } = await withZones();
    const m = await service.createManualMethod(method({ rates: { '2': 300 } }));
    tables[UIDS.manualShippingMethod][0].rates = { '2': 300, '9': 500 };
    expect((await service.updateManualMethod(m.id, { tax: 6 })).rates).toEqual({ '2': 300 });
    tables[UIDS.manualShippingMethod][0].rates = { '2': 300, '9': 500 };
    expect((await service.updateManualMethod(m.id, { rates: { '9': null, '2': 300 } as any })).rates).toEqual({
      '2': 300,
    });
  });

  it('validates name in the default locale and tax', async () => {
    const { service, tables } = makeStrapi();
    const err: any = await service.createManualMethod(method({ name: { pt: 'Só PT' }, tax: 101 })).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual(
      expect.arrayContaining([
        { path: 'name.en', code: 'required' },
        { path: 'tax', code: 'out_of_range' },
      ])
    );
    const err2: any = await service.createManualMethod(method({ tax: 'x' })).catch((e) => e);
    expect(err2.errors).toEqual([{ path: 'tax', code: 'invalid_number' }]);
    expect(tables[UIDS.manualShippingMethod]).toHaveLength(0);
  });
});

describe('EcommerceSettingsService — store logo', () => {
  const pngFile = async (w = 300, h = 100) => ({
    buffer: await sharp({ create: { width: w, height: h, channels: 3, background: '#f00' } }).png().toBuffer(),
    originalName: 'logo.png',
  });

  it('stores the logo, then replaces it deleting the previous file after the setting is written', async () => {
    const { service, provider, tables } = makeStrapi();
    const first = await service.uploadStoreLogo(await pngFile(), '1');
    expect(first.logo).toMatchObject({ width: 288, height: 96 });
    expect(first.logo!.url).toMatch(/^\/uploads\/store-logo_/);
    expect(provider.delete).not.toHaveBeenCalled();
    expect(tables[UIDS.auditLog].at(-1)).toMatchObject({ action: 'store.update', details: { changedFields: ['logo'] } });

    const order: string[] = [];
    const q = tables[UIDS.storeSetting];
    provider.delete.mockImplementationOnce(async () => {
      order.push(q.find((r) => r.key === 'logo').value.v.hash === first.logo!.hash ? 'old-still-stored' : 'new-stored');
    });
    const second = await service.uploadStoreLogo(await pngFile(200, 50), '1');
    expect(second.logo!.hash).not.toBe(first.logo!.hash);
    expect(provider.delete).toHaveBeenCalledWith(expect.objectContaining({ hash: first.logo!.hash }));
    // the setting already held the new logo when the old file was deleted
    expect(order).toEqual(['new-stored']);
  });

  it('does not fail when deleting the previous file fails', async () => {
    const { service, provider, strapi } = makeStrapi();
    await service.uploadStoreLogo(await pngFile(), '1');
    provider.delete.mockRejectedValueOnce(new Error('boom'));
    const res = await service.uploadStoreLogo(await pngFile(), '1');
    expect(res.logo).not.toBeNull();
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  it('keeps the previous logo when the provider upload fails or the file is not an image', async () => {
    const { service, provider } = makeStrapi();
    const first = await service.uploadStoreLogo(await pngFile(), '1');
    provider.upload.mockRejectedValueOnce(new Error('down'));
    await expect(service.uploadStoreLogo(await pngFile(), '1')).rejects.toThrow('down');
    await expect(
      service.uploadStoreLogo({ buffer: Buffer.from('text'), originalName: 'x.txt' }, '1')
    ).rejects.toThrow('INVALID_IMAGE');
    expect((await service.getStoreSettings()).logo).toEqual(first.logo);
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it('deletes the new file and keeps the previous logo when the setting cannot be written', async () => {
    const { service, provider, transaction } = makeStrapi();
    const first = await service.uploadStoreLogo(await pngFile(), '1');
    transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(service.uploadStoreLogo(await pngFile(), '1')).rejects.toThrow('db down');
    const uploaded = provider.upload.mock.calls.at(-1)![0];
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledWith(expect.objectContaining({ hash: uploaded.hash }));
    expect((await service.getStoreSettings()).logo).toEqual(first.logo);
  });

  it('removes the logo and its file; no logo means nothing to do', async () => {
    const { service, provider, tables } = makeStrapi();
    const before = tables[UIDS.auditLog].length;
    await service.removeStoreLogo('1');
    expect(tables[UIDS.auditLog].length).toBe(before);
    const first = await service.uploadStoreLogo(await pngFile(), '1');
    const res = await service.removeStoreLogo('1');
    expect(res.logo).toBeNull();
    expect(provider.delete).toHaveBeenCalledWith(expect.objectContaining({ hash: first.logo!.hash }));
  });

  it('ignores a logo sent through updateStoreSettings', async () => {
    const { service } = makeStrapi();
    await service.updateStoreSettings({ logo: { url: 'https://evil.example/x.png' } } as any, '1');
    expect((await service.getStoreSettings()).logo).toBeNull();
  });
});
