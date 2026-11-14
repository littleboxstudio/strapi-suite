import { afterEach, describe, expect, it } from 'vitest';
import { EcommerceValidationError } from '../../../../server/src/services/modules/ecommerce/errors';
import {
  __resetRegistryForTests,
  getProviderDefinition,
} from '../../../../server/src/services/modules/ecommerce/providers/registry';
import { DPD_SERVICE_DEFAULTS } from '../../../../server/src/services/modules/ecommerce/domain/dpdServices';
import { makeStrapi } from '../helpers/settingsStrapi';

const ID = 'dpd-portugal';
const RATE = [{ upTo: null, price: 500 }];
const SECRETS = {
  clientSecret: 'dpd-client-secret-123456',
  password: 'dpd-password-abcdef',
  pickupKey: 'dpd-pickup-key-zyxwvu',
};
const CONFIG = {
  authEndpoint: 'https://auth.example.test/token',
  expeditionEndpoint: 'https://api.example.test/expedition',
  clientId: 'client',
  username: 'user',
  accountHome: 'HOME1',
  accountShop: 'SHOP1',
  senderName: 'Loja',
  senderAddress: 'Rua A 1',
  senderPostalCode: '1000-001',
  senderCity: 'Lisboa',
  senderPhone: '910000000',
  senderEmail: 'loja@example.test',
};

const configured = async (opts: { config?: Record<string, unknown>; secrets?: Record<string, string> } = {}) => {
  const ctx = makeStrapi();
  await ctx.service.updateStoreSettings({ markets: ['PT', 'PT-ISL', 'ES'] });
  await ctx.service.updateIntegration(ID, {
    config: opts.config ?? CONFIG,
    secrets: opts.secrets ?? SECRETS,
  });
  return ctx;
};

afterEach(() => __resetRegistryForTests());

describe('DPD Portugal definition', () => {
  it('is a non-exclusive carrier with the expected fields', () => {
    const def = getProviderDefinition(ID)!;
    expect(def).toMatchObject({ id: ID, category: 'carrier', name: 'DPD Portugal', exclusive: false });
    expect(def.fields.map((f) => `${f.key}:${f.type}:${f.required ? '*' : ''}`)).toEqual([
      'authEndpoint:string:*',
      'expeditionEndpoint:string:*',
      'clientId:string:*',
      'clientSecret:secret:*',
      'username:string:*',
      'password:secret:*',
      'accountHome:string:',
      'accountShop:string:',
      'pickupEndpoint:string:',
      'pickupKey:secret:',
      'senderName:string:*',
      'senderAddress:string:*',
      'senderPostalCode:string:*',
      'senderCity:string:*',
      'senderPhone:string:*',
      'senderEmail:string:*',
    ]);
    expect(def.fields.find((f) => f.key === 'pickupEndpoint')!.default).toBe(
      'http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl'
    );
    for (const f of def.fields) expect(f.label).toBe(`ecommerce.settings.providers.dpd-portugal.fields.${f.key}`);
  });

  it('testConnection is not implemented yet', async () => {
    await expect(getProviderDefinition(ID)!.testConnection!({ config: {}, secrets: {} })).resolves.toEqual({
      ok: false,
      code: 'NOT_IMPLEMENTED',
    });
  });
});

describe('DPD Portugal services settings', () => {
  it('returns the default services before any save', async () => {
    const { service } = makeStrapi();
    expect(await service.getDpdServices()).toEqual(DPD_SERVICE_DEFAULTS);
  });

  it('saves services and keeps them across a generic integration save', async () => {
    const { service } = await configured();
    const res = await service.saveDpdServices({ EXPRESS: { active: true, rates: { PT: RATE } } }, '1');
    expect(res.active).toBe(false);
    expect(res.services.EXPRESS).toMatchObject({ active: true, rates: { PT: RATE } });
    await service.updateIntegration(ID, { config: { clientId: 'other' } });
    expect((await service.getDpdServices()).EXPRESS.rates).toEqual({ PT: RATE });
    const rt = await service.getRuntime(ID);
    expect((rt!.config.services as any).EXPRESS.rates).toEqual({ PT: RATE });
  });

  it('saving services with both inactive turns an active integration inactive', async () => {
    const { service } = await configured();
    await service.saveDpdServices({ EXPRESS: { active: true, rates: { PT: RATE } } });
    await service.setActive(ID, true);
    const res = await service.saveDpdServices({ EXPRESS: { active: false }, PICKUP: { active: false } }, '1');
    expect(res.active).toBe(false);
    expect((await service.listIntegrations()).find((i) => i.id === ID)!.active).toBe(false);
    expect((await service.getRuntime(ID))!.active).toBe(false);
  });

  it('activating with no active service fails with NO_ACTIVE_SERVICE', async () => {
    const { service } = await configured();
    const err: any = await service.setActive(ID, true).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'services', code: 'NO_ACTIVE_SERVICE' }]);
  });

  it('activating with PICKUP active needs accountShop and pickupKey', async () => {
    const { accountShop: _s, ...config } = CONFIG;
    const { pickupKey: _k, ...secrets } = SECRETS;
    const { service } = await configured({ config, secrets });
    await service.saveDpdServices({ PICKUP: { active: true, rates: { PT: RATE } } });
    const err: any = await service.setActive(ID, true).catch((e) => e);
    expect(err.errors).toEqual([
      { path: 'config.accountShop', code: 'required' },
      { path: 'secrets.pickupKey', code: 'required' },
    ]);
  });

  it('activating with EXPRESS active needs accountHome', async () => {
    const { accountHome: _h, ...config } = CONFIG;
    const { service } = await configured({ config });
    await service.saveDpdServices({ EXPRESS: { active: true, rates: { PT: RATE } } });
    const err: any = await service.setActive(ID, true).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'config.accountHome', code: 'required' }]);
  });

  it('activates when an active service has its configuration', async () => {
    const { service } = await configured();
    await service.saveDpdServices({ PICKUP: { active: true, rates: { PT: RATE } } });
    const view = await service.setActive(ID, true);
    expect(view.active).toBe(true);
  });

  it('an active integration refuses a services save that leaves the active services incomplete', async () => {
    const { accountShop: _s, ...config } = CONFIG;
    const { service } = await configured({ config });
    await service.saveDpdServices({ EXPRESS: { active: true, rates: { PT: RATE } } });
    await service.setActive(ID, true);
    const err: any = await service
      .saveDpdServices({ EXPRESS: { active: true }, PICKUP: { active: true, rates: { PT: RATE } } })
      .catch((e) => e);
    expect(err.errors).toEqual([{ path: 'config.accountShop', code: 'required' }]);
  });

  it('an active integration refuses clearing accountHome while EXPRESS is active', async () => {
    const { service } = await configured();
    await service.saveDpdServices({ EXPRESS: { active: true, rates: { PT: RATE } } });
    await service.setActive(ID, true);
    const err: any = await service.updateIntegration(ID, { config: { accountHome: '' } }).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'config.accountHome', code: 'required' }]);
  });

  it('rates for a non-store market fail with the manual-method code', async () => {
    const { service } = await configured();
    const err: any = await service.saveDpdServices({ EXPRESS: { rates: { FR: RATE } } }).catch((e) => e);
    expect(err).toBeInstanceOf(EcommerceValidationError);
    expect(err.errors).toEqual([{ path: 'services.EXPRESS.rates.FR', code: 'invalid_country' }]);
  });

  it('removing a store market used by a DPD rate table fails with MARKET_IN_USE', async () => {
    const { service } = await configured();
    await service.saveDpdServices({ PICKUP: { active: false, rates: { 'PT-ISL': RATE } } });
    const err: any = await service.updateStoreSettings({ markets: ['PT', 'ES'] }).catch((e) => e);
    expect(err.errors).toEqual([{ path: 'markets', code: 'MARKET_IN_USE', detail: 'DPD Portugal' }]);
    expect((await service.getStoreSettings()).markets).toEqual(['PT', 'PT-ISL', 'ES']);
    await expect(service.updateStoreSettings({ markets: ['PT', 'PT-ISL'] })).resolves.toMatchObject({
      markets: ['PT', 'PT-ISL'],
    });
  });

  it('GET never returns the secret values', async () => {
    const { service } = await configured();
    await service.saveDpdServices({ PICKUP: { active: true, rates: { PT: RATE } } });
    const payload = JSON.stringify([await service.listIntegrations(), await service.getDpdServices()]);
    for (const v of Object.values(SECRETS)) expect(payload).not.toContain(v);
    const view = (await service.listIntegrations()).find((i) => i.id === ID)!;
    expect(Object.keys(view.secrets).sort()).toEqual(['clientSecret', 'password', 'pickupKey']);
    expect(view.config.pickupEndpoint).toBe('http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl');
  });

  it('a save with an empty secret keeps the stored one', async () => {
    const { service } = await configured();
    await service.updateIntegration(ID, { secrets: { clientSecret: '', password: '', pickupKey: '' } });
    const rt = await service.getRuntime(ID);
    expect(rt!.secrets).toEqual(SECRETS);
  });
});
